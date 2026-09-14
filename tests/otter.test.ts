import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server/app.js";
import { Store } from "../src/server/store.js";
import { GroqClient } from "../src/server/otter/groq.js";
import { buildContext } from "../src/server/otter/context.js";
import { autoTier } from "../src/server/otter/service.js";
import { deriveFacts } from "../src/shared/facts.js";
import type { Scan } from "../src/shared/types.js";

process.env.NODE_ENV = "test";
const KEY = "gsk_test_secret_value_that_must_never_leak";

function mockGroq(reply: () => unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/models"))
      return json({
        data: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "whisper-large-v3-turbo"].map((id) => ({
          id,
          active: true,
        })),
      });
    const result = reply();
    if (result instanceof Response) return result;
    if (url.endsWith("/audio/transcriptions")) return json(result);
    return json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  }) as typeof fetch;
  return { client: new GroqClient(fetcher), calls };
}

async function demoApp(groq: GroqClient) {
  const { app } = await createApp(new Store(":memory:"), true, { groq });
  const created = (
    await app.inject({ method: "POST", url: "/api/v1/scans", payload: { mode: "demo" } })
  ).json();
  const mapped = (await app.inject(`/api/v1/scans/${created.id}`)).json();
  await app.inject({
    method: "POST",
    url: `/api/v1/scans/${created.id}/analyze`,
    payload: {
      projects: mapped.repositoryMap.projects.map((p: any) => ({ id: p.id, name: p.name })),
    },
  });
  const scan: Scan = (await app.inject(`/api/v1/scans/${created.id}`)).json();
  assert.equal(scan.status, "completed");
  const lodash = scan.graph!.nodes.find((n) => n.name === "lodash")!;
  return { app, scan, lodash, url: `/api/v1/scans/${scan.id}/otter` };
}

test("OTTER status reports unconfigured without contacting Groq", async () => {
  delete process.env.GROQ_API_KEY;
  const { client, calls } = mockGroq(() => ({}));
  const { app } = await createApp(new Store(":memory:"), false, { groq: client });
  try {
    const status = (await app.inject("/api/v1/otter/status")).json();
    assert.equal(status.configured, false);
    assert.equal(status.modes.auto, false);
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
  }
});

test("vulnerability context contains only the focused finding", async () => {
  process.env.GROQ_API_KEY = KEY;
  const { client } = mockGroq(() => ({}));
  const { app, scan, lodash } = await demoApp(client);
  try {
    const ctx = buildContext(scan, deriveFacts(scan), {
      kind: "vulnerability",
      advisoryId: "DEMO-001",
      nodeId: lodash.id,
    });
    assert.deepEqual([...ctx.allowedAdvisoryIds], ["DEMO-001"]);
    assert.match(ctx.json, /Prototype pollution/);
    for (const other of ["DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005", "Remote code execution"])
      assert.doesNotMatch(ctx.json, new RegExp(other));
    assert.match(ctx.json, /SYNTHETIC OFFLINE DEMO/);

    const global = buildContext(scan, deriveFacts(scan), { kind: "global", view: "vulnerabilities" });
    assert.equal(global.allowedAdvisoryIds.size, 5);
    assert(global.json.length < 40_000);
  } finally {
    await app.close();
  }
});

test("chat is grounded server-side, validates actions and never returns the key", async () => {
  process.env.GROQ_API_KEY = KEY;
  let next: unknown = {};
  const { client, calls } = mockGroq(() => next);
  const { app, lodash, url } = await demoApp(client);
  try {
    next = {
      answer: "Start with **lodash**.",
      actions: [
        { type: "section", target: "coverage" },
        { type: "section", target: "settings" },
        { type: "package", target: "P999" },
        { type: "trace", target: "P1" },
        { type: "evidence", target: "V1" },
      ],
      outOfScope: false,
    };
    const res = await app.inject({
      method: "POST",
      url,
      payload: {
        scope: { kind: "global", view: "overview" },
        messages: [{ role: "user", content: "What should I investigate first?" }],
      },
    });
    assert.equal(res.statusCode, 200);
    assert(!res.body.includes(KEY));
    const body = res.json();
    assert.equal(body.demo, true);
    assert.deepEqual(
      body.actions.map((a: any) => a.type),
      ["section", "trace", "evidence"],
    );
    assert.equal(body.actions[0].view, "coverage");
    assert.equal(body.actions[1].nodeId, lodash.id);
    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    assert.equal((chat.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    const sent = JSON.parse(String(chat.init.body));
    assert.equal(sent.model, "openai/gpt-oss-120b");
    assert.match(sent.messages[0].content, /ROOTLINE_CONTEXT = \{/);
    assert.match(sent.messages[0].content, /"section":"Overview"/);

    next = { answer: "It is also affected by CVE-2021-44228.", actions: [], outOfScope: false };
    const invented = (
      await app.inject({
        method: "POST",
        url,
        payload: {
          scope: { kind: "global", view: "risks" },
          messages: [{ role: "user", content: "Explain the risks" }],
        },
      })
    ).json();
    assert.equal(invented.withheld, true);
    assert.doesNotMatch(invented.answer, /CVE-2021-44228/);
  } finally {
    await app.close();
  }
});

test("focused branch blocks unrelated questions before calling Groq", async () => {
  process.env.GROQ_API_KEY = KEY;
  const { client, calls } = mockGroq(() => ({
    answer: "Anything",
    actions: [],
    outOfScope: true,
  }));
  const { app, lodash, scan, url } = await demoApp(client);
  try {
    const scope = { kind: "vulnerability", advisoryId: "DEMO-001", nodeId: lodash.id };
    for (const question of ["What other vulnerabilities exist?", "Explain DEMO-005 instead"]) {
      const before = calls.length;
      const body = (
        await app.inject({
          method: "POST",
          url,
          payload: { scope, messages: [{ role: "user", content: question }] },
        })
      ).json();
      assert.equal(body.outOfScope, true);
      assert.match(body.answer, /focused on \*\*DEMO-001 in lodash@4\.17\.20\*\*/);
      assert.equal(calls.length, before);
    }
    const modelFlagged = (
      await app.inject({
        method: "POST",
        url,
        payload: { scope, messages: [{ role: "user", content: "Is log4j worse?" }] },
      })
    ).json();
    assert.equal(modelFlagged.outOfScope, true);

    const log4j = scan.graph!.nodes.find((n) => n.name.includes("log4j-core"))!;
    const mismatched = await app.inject({
      method: "POST",
      url,
      payload: {
        scope: { kind: "vulnerability", advisoryId: "DEMO-001", nodeId: log4j.id },
        messages: [{ role: "user", content: "Explain it" }],
      },
    });
    assert.equal(mismatched.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("transcription forwards audio to Groq and reports failures truthfully", async () => {
  process.env.GROQ_API_KEY = KEY;
  let next: unknown = { text: "  Which applications are affected?  " };
  const { client, calls } = mockGroq(() => next);
  const { app } = await createApp(new Store(":memory:"), false, { groq: client });
  try {
    const audio = Buffer.alloc(4000, 1);
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/otter/transcribe",
      headers: { "content-type": "audio/webm;codecs=opus" },
      payload: audio,
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().text, "Which applications are affected?");
    const form = calls.find((c) => c.url.endsWith("/audio/transcriptions"))!.init.body as FormData;
    assert.equal(form.get("model"), "whisper-large-v3-turbo");
    assert.equal((form.get("file") as File).size, 4000);

    next = { text: "" };
    const silent = await app.inject({
      method: "POST",
      url: "/api/v1/otter/transcribe",
      headers: { "content-type": "audio/webm" },
      payload: audio,
    });
    assert.equal(silent.statusCode, 422);

    next = new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401 });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/otter/transcribe",
      headers: { "content-type": "audio/webm" },
      payload: audio,
    });
    assert.equal(rejected.statusCode, 502);
    assert(!rejected.body.includes(KEY));

    const wrongType = await app.inject({
      method: "POST",
      url: "/api/v1/otter/transcribe",
      headers: { "content-type": "image/png" },
      payload: audio,
    });
    assert.equal(wrongType.statusCode, 415);
  } finally {
    await app.close();
  }
});

test("auto mode routes navigation to the fast tier", () => {
  assert.equal(autoTier("Open the Ripple Graph"), "fast");
  assert.equal(autoTier("Where can I see unresolved dependencies?"), "fast");
  assert.equal(autoTier("Why is lodash ranked first?"), "balanced");
});

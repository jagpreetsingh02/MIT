import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp, verifySignature } from "../src/server/app.js";
import { Store } from "../src/server/store.js";
process.env.NODE_ENV = "test";
test("demo API completes, simulates, exports and rejects invalid/missing data", async () => {
  const { app } = await createApp(new Store(":memory:"));
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/scans",
      payload: { mode: "demo" },
    });
    assert.equal(created.statusCode, 202);
    const id = created.json().id;
    const mapped = await app.inject(`/api/v1/scans/${id}`);
    assert.equal(mapped.json().status, "mapped");
    const analyze = await app.inject({
      method: "POST",
      url: `/api/v1/scans/${id}/analyze`,
      payload: {
        projects: mapped
          .json()
          .repositoryMap.projects.map((p: any) => ({ id: p.id, name: p.name })),
      },
    });
    assert.equal(analyze.statusCode, 202);
    const result = await app.inject(`/api/v1/scans/${id}`);
    assert.equal(result.json().status, "completed");
    const node = result.json().risks[0].nodeId;
    assert.equal((await app.inject(`/api/v1/scans/${id}/graph`)).statusCode, 200);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/scans/${id}/simulate`,
          payload: { nodeId: node },
        })
      ).json().services.length,
      3,
    );
    const exportResult = await app.inject(`/api/v1/scans/${id}/sbom`);
    assert.equal(exportResult.json().spdxVersion, "SPDX-2.3");
    assert(exportResult.headers["content-disposition"]?.includes(".spdx.json"));
    assert.equal((await app.inject("/api/v1/scans/missing")).statusCode, 404);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/scans",
          payload: { mode: "github", repository: "http://localhost/" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/v1/scans", payload: { mode: "invalid" } }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/scans",
          headers: { origin: "https://evil.test" },
          payload: { mode: "demo" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});
test("webhook validates exact raw bytes and rejects malformed signatures", async () => {
  const secret = "test-webhook-secret";
  const body = Buffer.from('{"action": "ping"}');
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert(verifySignature(body, signature, secret));
  assert(!verifySignature(Buffer.from('{"action":"ping"}'), signature, secret));
  assert(!verifySignature(body, "sha256=bad", secret));
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  const { app } = await createApp(new Store(":memory:"));
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/webhooks/github",
          payload: body,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": signature,
            "x-github-delivery": "test-1",
            "x-github-event": "ping",
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/webhooks/github",
          payload: {},
          headers: { "x-hub-signature-256": "sha256=bad" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  }
});
test("API bearer auth gates scans but health reveals no secrets", async () => {
  process.env.API_TOKEN = "test-token-at-least-thirty-two-characters";
  const { app } = await createApp(new Store(":memory:"));
  try {
    assert.equal((await app.inject("/api/v1/scans")).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/scans",
          headers: { authorization: "Bearer " + process.env.API_TOKEN },
        })
      ).statusCode,
      200,
    );
    const health = await app.inject("/api/v1/health");
    assert.equal(health.json().authRequired, true);
    assert(!health.body.includes(process.env.API_TOKEN));
  } finally {
    await app.close();
    delete process.env.API_TOKEN;
  }
});
test("SQLite persists scans, caches and delivery deduplication across reopen", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ripple-test-"));
  const path = join(dir, "db.sqlite");
  try {
    let db = new Store(path);
    db.save(
      {
        id: "saved",
        status: "queued",
        name: "demo",
        mode: "demo",
        ref: "HEAD",
        createdAt: new Date().toISOString(),
        connectors: [],
      },
      { mode: "demo" },
    );
    db.cachePut("test", "value", 60000);
    assert(db.dedupe("delivery"));
    db.close();
    db = new Store(path);
    assert.equal(db.get("saved")?.status, "queued");
    assert.equal(db.cacheGet("test"), "value");
    assert(!db.dedupe("delivery"));
    assert.equal(db.pending().length, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { node, finalize, risks, simulate, purl } from "../src/server/graph.js";
import { demoGraph } from "../src/server/demo.js";
import { parseManifest } from "../src/server/parsers.js";
import { canonicalRepository, mergeAdvisories, Vulnerabilities } from "../src/server/connectors.js";
import { Store } from "../src/server/store.js";
import { Transport } from "../src/server/transport.js";
import { sbom } from "../src/server/sbom.js";
import type { Scan } from "../src/shared/types.js";
const origin = { source: "test", url: "https://example.com", retrievedAt: "2026-09-10T00:00:00Z" };
test("cycle-safe reverse reachability excludes self and finds shortest service path", () => {
  const a = node("npm", "app", "1.0.0", "service"),
    b = node("npm", "b", "1.0.0"),
    c = node("npm", "c", "1.0.0"),
    d = node("npm", "unrelated", "1.0.0");
  const g = finalize({
    nodes: [a, b, c, d],
    edges: [
      { from: a.id, to: b.id },
      { from: b.id, to: c.id },
      { from: c.id, to: b.id },
    ],
    warnings: [],
  });
  assert.deepEqual(simulate(g, c.id).affected.sort(), [a.id, b.id].sort());
  assert.deepEqual(simulate(g, c.id).paths, [[a.id, b.id, c.id]]);
  assert.equal(c.depth, 2);
  assert.equal(d.depth, null);
  assert.equal(simulate(g, c.id).impact, 67);
});
test("risk factors are deterministic, bounded, and unknown data stays explicit", () => {
  const g = demoGraph();
  assert.deepEqual(risks(g), risks(structuredClone(g)));
  assert(risks(g).every((r) => r.score >= 0 && r.score <= 100));
  const n = node("npm", "unknown", "1.0.0");
  const r = risks(finalize({ nodes: [n], edges: [], warnings: [] }))[0];
  assert.equal(r.score, 0);
  assert.equal(r.coverage, "unchecked");
});
test("PURLs preserve scope and normalize Python identity", () => {
  assert.equal(purl("pypi", "Some_Package.Name", "1.0.0"), "pkg:pypi/some-package-name@1.0.0");
  assert.equal(purl("maven", "org.example:artifact", "1.0"), "pkg:maven/org.example/artifact@1.0");
  assert.equal(purl("npm", "@scope/pkg", "1.0.0"), "pkg:npm/%40scope/pkg@1.0.0");
});
test("npm nested versions resolve nearest installed ancestor, not a matching name elsewhere", () => {
  const graph = parseManifest(
    "package-lock.json",
    JSON.stringify({
      name: "app",
      lockfileVersion: 3,
      packages: {
        "": { version: "1.0.0", dependencies: { a: "1.0.0", b: "1.0.0" } },
        "node_modules/a": { version: "1.0.0", dependencies: { shared: "1.0.0" } },
        "node_modules/b": { version: "1.0.0", dependencies: { shared: "2.0.0" } },
        "node_modules/shared": { version: "1.0.0" },
        "node_modules/b/node_modules/shared": { version: "2.0.0" },
      },
    }),
  );
  const b = graph.nodes.find((n) => n.name === "b")!;
  const shared2 = graph.nodes.find((n) => n.name === "shared" && n.version === "2.0.0")!;
  assert(graph.edges.some((e) => e.from === b.id && e.to === shared2.id));
  assert.equal(shared2.depth, 2);
});
test("Python pins accepted, ranges and source execution directives rejected", () => {
  const graph = parseManifest("requirements.txt", "requests==2.28.0\nurllib3==1.26.5");
  assert.equal(graph.nodes.length, 3);
  assert(graph.warnings[0].includes("Flat"));
  for (const text of [
    "requests>=2",
    "-r secrets.txt",
    "https://example.com/x",
    "thing @ git+https://example.com/repo",
  ]) {
    const partial = parseManifest("requirements.txt", text);
    assert.equal(partial.nodes.filter((n) => n.kind === "package").length, 0);
    assert(partial.warnings.length > 0);
  }
});
test("Maven resolved tree preserves transitive edges, POM rejects XML entities", () => {
  const tree = {
    groupId: "app",
    artifactId: "service",
    version: "1.0.0",
    children: [
      {
        groupId: "org.example",
        artifactId: "lib",
        version: "2.0",
        children: [{ groupId: "org.example", artifactId: "child", version: "3.0" }],
      },
    ],
  };
  const graph = parseManifest("dependency-tree.json", JSON.stringify(tree));
  assert.equal(graph.nodes[2].depth, 2);
  assert.throws(() =>
    parseManifest("pom.xml", '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><project/>'),
  );
  const pom = parseManifest(
    "pom.xml",
    "<project><groupId>demo</groupId><artifactId>app</artifactId><version>1.0</version><dependencies><dependency><groupId>org.example</groupId><artifactId>lib</artifactId><version>2.0</version></dependency></dependencies></project>",
  );
  assert.equal(pom.nodes.length, 2);
  assert(pom.warnings.some((w) => w.includes("direct")));
});
test("canonical GitHub identifiers prevent arbitrary server-side fetch targets", () => {
  assert.equal(canonicalRepository("https://github.com/org/repo.git"), "org/repo");
  assert.equal(canonicalRepository("org/repo"), "org/repo");
  for (const input of [
    "http://localhost:3000/x",
    "https://github.com.evil.test/a/b",
    "https://github.com/a/b?token=x",
    "https://user:pass@github.com/a/b",
    "a/..",
  ])
    assert.throws(() => canonicalRepository(input));
});
test("advisory aliases deduplicate without dropping source provenance", () => {
  const result = mergeAdvisories([
    { id: "GHSA-123", aliases: ["CVE-2021-1234"], summary: "a", provenance: [origin] },
    { id: "CVE-2021-1234", aliases: [], summary: "b", cvss: 9.8, provenance: [origin] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].cvss, 9.8);
  assert.equal(result[0].provenance.length, 2);
});
test("connector cache records source and timestamp; allowlist blocks arbitrary URLs", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  const http = new Transport(store, async () => {
    calls++;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  });
  const a = await http.get("npm", "https://registry.npmjs.org/a/1.0.0");
  const b = await http.get("npm", "https://registry.npmjs.org/a/1.0.0");
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert(a.provenance.retrievedAt);
  await assert.rejects(http.get("bad", "https://127.0.0.1/private"));
  await assert.rejects(http.get("bad", "https://registry.npmjs.org:8443/a"));
  store.close();
});
test("NVD enrichment uses mapped CVE IDs and extracts numeric primary CVSS", async () => {
  const urls: string[] = [];
  const client = new Vulnerabilities({
    get: async (_source, url) => {
      urls.push(url);
      return {
        data: {
          vulnerabilities: [
            {
              cve: {
                id: "CVE-2021-1234",
                metrics: { cvssMetricV31: [{ type: "Primary", cvssData: { baseScore: 9.8 } }] },
              },
            },
          ],
        } as any,
        provenance: origin,
      };
    },
  });
  assert.equal((await client.nvd("CVE-2021-1234")).cvss, 9.8);
  assert(urls[0].includes("cveId=CVE-2021-1234"));
  await assert.rejects(client.nvd("lodash"));
});
test("SPDX preserves every graph edge and exact package version", () => {
  const graph = demoGraph();
  const scan: Scan = {
    id: "test-scan",
    name: "demo",
    mode: "demo",
    ref: "HEAD",
    status: "completed",
    createdAt: origin.retrievedAt,
    completedAt: origin.retrievedAt,
    connectors: [],
    graph,
    risks: risks(graph),
  };
  const result = sbom(scan);
  assert.equal(result.spdxVersion, "SPDX-2.3");
  assert.equal(result.packages.length, graph.nodes.length);
  assert.equal(
    result.relationships.filter((r) => r.relationshipType === "DEPENDS_ON").length,
    graph.edges.length,
  );
  assert(result.packages.every((p) => p.externalRefs[0].referenceLocator.startsWith("pkg:")));
  assert.equal(result.documentDescribes.length, 4);
});
test("SPDX export conforms to the official 2.3 JSON schema", async () => {
  const { default: Ajv } = await import("ajv");
  const { default: addFormats } = await import("ajv-formats");
  const { readFileSync } = await import("node:fs");
  const validator = new Ajv({ strict: false, allErrors: true });
  addFormats(validator);
  const validate = validator.compile(
    JSON.parse(readFileSync("docs/schemas/spdx-2.3.schema.json", "utf8")),
  );
  const graph = demoGraph();
  const scan: Scan = {
    id: "schema-test",
    name: "demo",
    mode: "demo",
    ref: "HEAD",
    status: "completed",
    createdAt: origin.retrievedAt,
    completedAt: origin.retrievedAt,
    connectors: [],
    graph,
  };
  assert(validate(sbom(scan)), JSON.stringify(validate.errors));
});

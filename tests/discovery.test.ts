import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverProjects, type SourceFile } from "../src/server/discovery.js";
import { resolveProject } from "../src/server/resolve-project.js";
import { finalize, risks, simulate } from "../src/server/graph.js";
import { osvAdvisory, cvssFromVector } from "../src/server/advisories.js";
import { GitHub, enrichGraph } from "../src/server/connectors.js";
import { Store } from "../src/server/store.js";
import { Jobs } from "../src/server/jobs.js";
import type { Project } from "../src/shared/types.js";
const origin = {
  source: "test fixture",
  url: "https://example.com/fixture",
  retrievedAt: "2026-09-13T00:00:00Z",
};
function file(filename: string, data: unknown): SourceFile {
  return { filename, content: JSON.stringify(data), provenance: origin };
}
function project(path = ".", id = "app"): Project {
  return {
    id,
    name: id,
    path,
    ecosystem: "npm",
    manifest: (path === "." ? "" : path + "/") + "package.json",
    lockfile: "package-lock.json",
    files: [],
    selected: true,
    role: "project",
    resolution: "resolved",
    notes: [],
  };
}
const lock = {
  lockfileVersion: 3,
  name: "root",
  packages: {
    "": { name: "root", version: "1.0.0", workspaces: ["apps/*", "packages/*"] },
    "apps/a": { name: "app-a", version: "1.0.0", dependencies: { shared: "1.0.0" } },
    "apps/b": { name: "app-b", version: "1.0.0", dependencies: { shared: "1.0.0" } },
    "packages/shared": { name: "shared", version: "1.0.0", dependencies: { deep: "2.0.0" } },
    "node_modules/shared": { link: true, resolved: "packages/shared" },
    "node_modules/deep": { version: "2.0.0", dependencies: { leaf: "1.0.0" } },
    "node_modules/leaf": { version: "1.0.0" },
  },
};
test("25 manifest pairs group into 25 projects without a manifest-count failure", () => {
  const files = Array.from({ length: 25 }, (_, i) => [
    `apps/p${i}/package.json`,
    `apps/p${i}/package-lock.json`,
  ])
    .flat()
    .map((path) => ({ path, sha: path }));
  const map = discoverProjects(files, "org/repo", "main", "abc");
  assert.equal(map.projects.length, 25);
  assert.equal(map.fileCount, 50);
  assert(map.projects.every((p) => p.manifest && p.lockfile));
});
test("discovery distinguishes ecosystems, companion files, tooling, and empty repositories", () => {
  const names = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "api/pyproject.toml",
    "api/uv.lock",
    "payments/pom.xml",
    "payments/dependency-tree.json",
    "tests/fixture/package.json",
    "node_modules/fake/package.json",
  ];
  const map = discoverProjects(
    names.map((path) => ({ path, sha: "" })),
    "org/repo",
    "main",
    "abc",
  );
  assert.equal(map.projects.length, 4);
  assert.equal(map.projects.find((p) => p.path === ".")?.lockfile, "package-lock.json");
  assert.equal(map.projects.find((p) => p.path === "tests/fixture")?.selected, false);
  assert.equal(
    discoverProjects([{ path: "README.md", sha: "" }], "o/r", "main", "a").projects.length,
    0,
  );
});
test("npm workspaces resolve symlinks and preserve shared indirect dependency paths", () => {
  const source = file("package-lock.json", lock);
  const a = resolveProject(project("apps/a", "a"), [source]);
  const b = resolveProject(project("apps/b", "b"), [source]);
  const graph = finalize({
    nodes: [...a.nodes, ...b.nodes],
    edges: [...a.edges, ...b.edges],
    warnings: [],
  });
  const leaf = graph.nodes.find((n) => n.name === "leaf")!;
  assert.equal(leaf.depth, 3);
  const impact = simulate(graph, leaf.id);
  assert.equal(impact.services.length, 2);
  assert.equal(impact.pathCount, 2);
  assert(impact.paths.every((p) => p.length === 4));
  assert.equal(graph.nodes.filter((n) => n.name === "leaf").length, 1);
});
test("separate installed instances do not invent cross-project paths", () => {
  const make = (dep: string) => ({
    lockfileVersion: 3,
    packages: {
      "": { version: "1.0.0", dependencies: { shared: "1.0.0" } },
      "node_modules/shared": { version: "1.0.0", dependencies: { [dep]: "1.0.0" } },
      ["node_modules/" + dep]: { version: "1.0.0" },
    },
  });
  const pA = { ...project(".", "a"), lockfile: "a/package-lock.json", path: "a" },
    pB = { ...project(".", "b"), lockfile: "b/package-lock.json", path: "b" };
  const a = resolveProject(pA, [file(pA.lockfile, make("leaf-a"))]),
    b = resolveProject(pB, [file(pB.lockfile, make("leaf-b"))]);
  const graph = finalize({
    nodes: [...a.nodes, ...b.nodes],
    edges: [...a.edges, ...b.edges],
    warnings: [],
  });
  assert.deepEqual(simulate(graph, graph.nodes.find((n) => n.name === "leaf-a")!.id).services, [
    "service-a",
  ]);
  assert.equal(
    simulate(graph, graph.nodes.find((n) => n.name === "shared")!.id).services.length,
    2,
  );
});
test("duplicate project edge records do not multiply ripple paths or seed application roots", () => {
  const graph = finalize(resolveProject(project("apps/a", "a"), [file("package-lock.json", lock)]));
  const leaf = graph.nodes.find((n) => n.name === "leaf")!;
  const root = graph.nodes.find((n) => n.kind === "service")!;
  root.purl = leaf.purl;
  graph.edges.push(...graph.edges.map((edge) => ({ ...edge, projectId: "another-context" })));
  const result = simulate(graph, leaf.id);
  assert.deepEqual(result.seedIds, [leaf.id]);
  assert.equal(result.pathCount, 1);
  assert.equal(result.services.length, 1);
  assert.equal(result.hypothetical, true);
});
test("runtime and development usage propagates through dependencies", () => {
  const data = {
    lockfileVersion: 3,
    packages: {
      "": { version: "1.0.0", dependencies: { prod: "1.0.0" }, devDependencies: { tool: "1.0.0" } },
      "node_modules/prod": { version: "1.0.0" },
      "node_modules/tool": { version: "1.0.0", dev: true, dependencies: { helper: "1.0.0" } },
      "node_modules/helper": { version: "1.0.0", dev: true },
    },
  };
  const g = resolveProject(project(), [file("package-lock.json", data)]);
  assert.equal(g.nodes.find((n) => n.name === "prod")?.scope, "runtime");
  assert.equal(g.nodes.find((n) => n.name === "helper")?.scope, "development");
  assert.equal(g.nodes.find((n) => n.name === "helper")?.depth, 2);
});
test("OSV CVSS is computed from the source vector; unrelated package fixes never attach", () => {
  assert.equal(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvssFromVector("made-up"), undefined);
  const n = resolveProject(project(), [
    file("package-lock.json", {
      lockfileVersion: 3,
      packages: {
        "": { version: "1.0.0", dependencies: { a: "1.0.0" } },
        "node_modules/a": { version: "1.0.0" },
      },
    }),
  ]).nodes.find((n) => n.name === "a")!;
  const record = {
    id: "TEST-1",
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
    affected: [
      {
        package: { name: "a", ecosystem: "npm" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.1.0" }] }],
      },
      {
        package: { name: "other", ecosystem: "npm" },
        ranges: [{ events: [{ fixed: "999.0.0" }] }],
      },
    ],
  };
  const advisory = osvAdvisory(record, n, origin)!;
  assert.equal(advisory.cvss, 9.8);
  assert.equal(advisory.fixed, "1.1.0");
  assert.equal(osvAdvisory({ ...record, affected: [record.affected[1]] }, n, origin), undefined);
});
test("source failure leaves packages partially checked, with no fabricated findings", async () => {
  const graph = resolveProject(project(), [
    file("package-lock.json", {
      lockfileVersion: 3,
      packages: {
        "": { version: "1.0.0", dependencies: { a: "1.0.0" } },
        "node_modules/a": { version: "1.0.0" },
      },
    }),
  ]);
  await enrichGraph(
    graph,
    {
      get: async () => {
        throw new Error("HTTP 429");
      },
    },
    () => {},
  );
  assert.equal(graph.nodes.find((n) => n.name === "a")!.coverage, "partial");
  assert(graph.warnings.some((w) => w.includes("incomplete")));
  assert.equal(graph.nodes.flatMap((n) => n.advisories).length, 0);
});
test("map selection is persisted, renaming does not change relations, and unknown IDs are rejected", async () => {
  const store = new Store(":memory:");
  const jobs = new Jobs(store);
  const created = jobs.create({ mode: "demo" });
  await jobs.drain();
  const scan = store.get(created.id)!;
  assert.equal(scan.status, "mapped");
  const p = scan.repositoryMap!.projects[0];
  assert.throws(() => jobs.analyze(scan.id, [{ id: "missing", name: "fake" }]));
  jobs.analyze(scan.id, [{ id: p.id, name: "My storefront" }]);
  await jobs.drain();
  const done = store.get(scan.id)!;
  assert.equal(done.status, "completed");
  assert.equal(done.graph!.nodes.filter((n) => n.kind === "service").length, 1);
  assert.equal(done.graph!.nodes.find((n) => n.kind === "service")?.name, "My storefront");
  await jobs.close();
  store.close();
});
test("Github discovery reads more than 20 manifests using commit-pinned public content", async () => {
  const sha = "a".repeat(40);
  const tree = Array.from({ length: 26 }, (_, i) => ({
    path: `apps/p${i}/package.json`,
    type: "blob",
    sha: String(i),
  }));
  const requests: string[] = [];
  const github = new GitHub({
    get: async (_name, url) => {
      requests.push(url);
      const data = url.includes("raw.githubusercontent.com")
        ? JSON.stringify({ name: "project", dependencies: {} })
        : url.endsWith("/o/r")
          ? { default_branch: "main" }
          : url.includes("/commits/")
            ? { sha }
            : url.includes("/trees/")
              ? { tree }
              : {};
      return { data: data as any, provenance: origin };
    },
  });
  const result = await github.discover("o/r", "HEAD");
  assert.equal(result.map.projects.length, 26);
  assert.equal(result.map.ref, "main");
  assert.equal(result.map.commit, sha);
  assert.equal(requests.filter((u) => u.includes("/" + sha + "/apps/")).length, 26);
});
test("optional GITHUB_TOKEN authenticates GitHub API and raw content requests only when set", async () => {
  const sha = "b".repeat(40);
  const seen: { url: string; auth?: string }[] = [];
  const github = new GitHub({
    get: async (_name, url, options) => {
      seen.push({ url, auth: options?.headers?.Authorization });
      const data = url.includes("raw.githubusercontent.com")
        ? JSON.stringify({ name: "app", dependencies: {} })
        : url.endsWith("/o/r")
          ? { default_branch: "main" }
          : url.includes("/commits/")
            ? { sha }
            : { tree: [{ path: "package.json", type: "blob", sha: "1" }] };
      return { data: data as any, provenance: origin };
    },
  });
  const previous = process.env.GITHUB_TOKEN;
  try {
    process.env.GITHUB_TOKEN = "ghp_test_token_value";
    const result = await github.discover("o/r", "HEAD");
    assert.equal(result.map.projects.length, 1);
    assert(seen.some((r) => r.url.startsWith("https://api.github.com/")));
    assert(seen.some((r) => r.url.startsWith("https://raw.githubusercontent.com/")));
    assert(seen.every((r) => r.auth === "Bearer ghp_test_token_value"));
    assert(!JSON.stringify(result.map).includes("ghp_test_token_value"));

    seen.length = 0;
    delete process.env.GITHUB_TOKEN;
    await github.discover("o/r", "HEAD");
    assert(seen.length > 0 && seen.every((r) => r.auth === undefined));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});
test("large graphs are retained instead of failing at 2000 nodes", () => {
  const g = resolveProject(project(), [
    file("package-lock.json", {
      lockfileVersion: 3,
      packages: {
        "": {
          version: "1.0.0",
          dependencies: Object.fromEntries(
            Array.from({ length: 2100 }, (_, i) => ["p" + i, "1.0.0"]),
          ),
        },
        ...Object.fromEntries(
          Array.from({ length: 2100 }, (_, i) => ["node_modules/p" + i, { version: "1.0.0" }]),
        ),
      },
    }),
  ]);
  assert.equal(g.nodes.length, 2101);
  assert.deepEqual(risks(g), risks(g));
});

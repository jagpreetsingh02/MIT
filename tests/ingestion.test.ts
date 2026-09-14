import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProject } from "../src/server/resolve-project.js";
import { discoverProjects, type SourceFile } from "../src/server/discovery.js";
import { enrichGraph } from "../src/server/connectors.js";
import { risks } from "../src/server/graph.js";
const provenance = { source: "test", url: "", retrievedAt: "2026-09-14T00:00:00Z" };
function ingest(contents: Record<string, string>) {
  const map = discoverProjects(
    Object.keys(contents).map((path) => ({ path, sha: "test" })),
    "example/test",
    "main",
    "test",
  );
  const files: SourceFile[] = Object.entries(contents).map(([filename, content]) => ({
    filename,
    content,
    provenance,
  }));
  const project = map.projects[0];
  const graph = resolveProject(project, files);
  return { map, project, graph, packages: graph.nodes.filter((n) => n.kind === "package") };
}
test("501 manifest pairs remain 501 logical projects without a count rejection", () => {
  const files = Array.from({ length: 501 }, (_, i) =>
    ["package.json", "package-lock.json"].map((name) => ({
      path: "apps/" + i + "/" + name,
      sha: "",
    })),
  ).flat();
  const map = discoverProjects(files, "example/many", "main", "test");
  assert.equal(map.projects.length, 501);
  assert.equal(map.fileCount, 1002);
});
test("Python runtime, optional and build declarations survive with original constraints", async () => {
  const { project, graph, packages } = ingest({
    "pyproject.toml":
      '[project]\nname="ocr"\ndependencies=["torch>=2.5","pillow>=11","requests==2.31.0"]\n[project.optional-dependencies]\ndev=["pytest>=8"]\n[build-system]\nrequires=["setuptools>=68"]',
  });
  assert.equal(packages.length, 5);
  assert.equal(project.exactCount, 1);
  assert.equal(project.unresolvedCount, 4);
  assert.equal(project.ingestionStatus, "PARTIAL");
  assert.equal(packages.find((n) => n.name === "torch")?.declaredSpecifier, ">=2.5");
  const queried: string[] = [];
  await enrichGraph(
    graph,
    {
      get: async (_source: string, _url: string, options: any) => {
        queried.push(options.body.package.purl);
        return { data: {} as any, provenance };
      },
    },
    () => {},
  );
  assert.deepEqual(queried, ["pkg:pypi/requests@2.31.0"]);
  assert(
    packages
      .filter((n) => n.versionStatus === "unresolved")
      .every((n) => n.coverage === "partial" && n.version === "" && !n.advisories.length),
  );
  assert(
    risks(graph)
      .filter((r) => packages.find((n) => n.id === r.nodeId)?.versionStatus === "unresolved")
      .every((r) => r.score === 0),
  );
});
test("declared-only repository produces nodes and makes no source requests", async () => {
  const { graph, project, packages } = ingest({
    "pyproject.toml": '[project]\ndependencies=["requests>=2.31","numpy"]',
  });
  assert.equal(project.ingestionStatus, "DECLARED_ONLY");
  assert.equal(packages.length, 2);
  let calls = 0;
  await enrichGraph(
    graph,
    {
      get: async () => {
        calls++;
        throw new Error("Unresolved packages must not be sent to sources");
      },
    },
    () => {},
  );
  assert.equal(calls, 0);
  assert(packages.every((n) => n.coverage === "partial"));
});
test("npm v1 lock creates exact direct and indirect nodes", () => {
  const { packages, graph } = ingest({
    "package.json": JSON.stringify({ dependencies: { a: "1.0.0" } }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 1,
      name: "app",
      version: "1.0.0",
      dependencies: {
        a: {
          version: "1.0.0",
          requires: { b: "^2.0.0" },
          dependencies: { b: { version: "2.0.0" } },
        },
      },
    }),
  });
  assert.equal(packages.length, 2);
  assert.equal(packages.find((n) => n.name === "b")?.depth, 2);
  assert.equal(graph.edges.length, 2);
});
test("lockfile without root declarations retains installed packages as listed", () => {
  const { packages, project } = ingest({
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: { "node_modules/a": { version: "1.2.3" } },
    }),
  });
  assert.equal(packages.length, 1);
  assert.equal(project.exactCount, 1);
  assert.equal(packages[0].depth, null);
});
test("malformed lock does not discard valid npm declarations", () => {
  const { packages, project } = ingest({
    "package.json": JSON.stringify({ dependencies: { a: "^1.0.0", b: "2.0.0" } }),
    "package-lock.json": "invalid",
  });
  assert.equal(packages.length, 2);
  assert.equal(project.exactCount, 1);
  assert.equal(project.unresolvedCount, 1);
});
test("Python companion requirements remain one project and retain ranges", () => {
  const { map, packages } = ingest({
    "pyproject.toml": '[project]\nname="app"\n',
    "requirements.txt": "requests>=2.31\nnumpy==1.26.4",
    "requirements-dev.txt": "pytest>=8",
  });
  assert.equal(map.projects.length, 1);
  assert.equal(packages.length, 3);
  assert.equal(packages.find((n) => n.name === "numpy")?.version, "1.26.4");
});
test("Maven managed declarations survive missing dependency versions", () => {
  const { packages, project } = ingest({
    "pom.xml":
      "<project><groupId>example</groupId><artifactId>app</artifactId><version>1.0.0</version><dependencies><dependency><groupId>org.example</groupId><artifactId>lib</artifactId></dependency></dependencies></project>",
  });
  assert.equal(packages.length, 1);
  assert.equal(project.unresolvedCount, 1);
  assert.equal(packages[0].name, "org.example:lib");
});
test("invalid manifest does not hide a valid lock and missing lock entries are not duplicated", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { a: "1.2.3", missing: "^1.0.0" } },
      "node_modules/a": { version: "1.2.3" },
    },
  });
  const broken = ingest({ "package.json": "invalid", "package-lock.json": lock });
  assert.equal(broken.project.exactCount, 1);
  assert.equal(broken.project.unresolvedCount, 1);
  const valid = ingest({
    "package.json": JSON.stringify({ dependencies: { a: "1.2.3", missing: "^1.0.0" } }),
    "package-lock.json": lock,
  });
  assert.equal(valid.packages.length, 2);
});
test("one unsupported project cannot fail repository discovery or analysis", async () => {
  const { Store } = await import("../src/server/store.js");
  const { Jobs } = await import("../src/server/jobs.js");
  const { Transport } = await import("../src/server/transport.js");
  const store = new Store(":memory:");
  const files: Record<string, string> = {
    "good/pyproject.toml": '[project]\ndependencies=["requests>=2.31"]',
    "unsupported/setup.py": "raise RuntimeError('must never execute')",
    "broken/package.json": "invalid",
  };
  const sha = "a".repeat(40);
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    let body: unknown = url.includes("/commits/")
      ? { sha }
      : url.includes("/trees/")
        ? { tree: Object.keys(files).map((path) => ({ path, type: "blob", sha: "b".repeat(40) })) }
        : { default_branch: "main" };
    if (url.includes("raw.githubusercontent.com"))
      return new Response(files[url.split(sha + "/")[1]], {
        headers: { "content-type": "text/plain" },
      });
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  const jobs = new Jobs(store, () => new Transport(store, fetcher));
  try {
    const created = jobs.create({ mode: "github", repository: "example/mixed", ref: "main" });
    async function until(status: string) {
      for (let i = 0; i < 1000; i++) {
        const s = store.get(created.id)!;
        if (s.status === status) return s;
        assert.notEqual(s.status, "failed", s.error);
        await new Promise((r) => setTimeout(r, 2));
      }
      throw new Error("Job timeout");
    }
    const mapped = await until("mapped");
    assert.equal(mapped.repositoryMap!.projects.length, 3);
    assert.equal(mapped.repositoryMap!.projects.find((p) => p.path === "good")?.unresolvedCount, 1);
    jobs.analyze(
      created.id,
      mapped.repositoryMap!.projects.map((p) => ({ id: p.id, name: p.name })),
    );
    const completed = await until("completed");
    assert.equal(completed.graph!.nodes.filter((n) => n.kind === "package").length, 1);
    assert.equal(
      completed.repositoryMap!.projects.filter((p) => p.ingestionStatus === "UNSUPPORTED").length,
      2,
    );
  } finally {
    await jobs.close();
    store.close();
  }
});

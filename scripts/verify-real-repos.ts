import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.VERIFY_BASE || "http://127.0.0.1:3000/api/v1";
const repositories = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "expressjs/express",
      "jagpreetsingh02/MIT",
      "npm/cli",
      "pallets/flask",
      "spring-projects/spring-petclinic",
      "GoogleCloudPlatform/microservices-demo",
      "octocat/Hello-World",
    ];
async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function wait(id: string, statuses: string[]) {
  const started = Date.now();
  let scan;
  while (Date.now() - started < 600000) {
    scan = await request("/scans/" + id);
    if (statuses.includes(scan.status) || scan.status === "failed") return scan;
    await new Promise((r) => setTimeout(r, 1700));
  }
  throw new Error("Timed out waiting for " + id);
}
let results: any[] = [];
try {
  const { readFile } = await import("node:fs/promises");
  results = JSON.parse(
    await readFile("docs/verification/live-repositories.json", "utf8"),
  ).results.filter((r: any) => !repositories.includes(r.repository));
} catch {}
for (const repository of repositories) {
  const started = Date.now();
  try {
    const created = await request("/scans", { mode: "github", repository, ref: "HEAD" });
    let scan = await wait(created.id, ["mapped"]);
    if (scan.status === "failed") throw new Error(scan.error);
    console.log(
      repository +
        ": mapped " +
        scan.repositoryMap.projects.length +
        " projects / " +
        scan.repositoryMap.fileCount +
        " files",
    );
    const candidates = scan.repositoryMap.projects.filter((p: any) => p.selected);
    const selected =
      repository === "GoogleCloudPlatform/microservices-demo"
        ? candidates.filter((p: any) => ["pypi", "maven", "npm"].includes(p.ecosystem)).slice(0, 5)
        : candidates.filter((p: any) => p.role !== "workspace").slice(0, 1);
    if (selected.length) {
      await request("/scans/" + scan.id + "/analyze", {
        projects: selected.map((p: any) => ({ id: p.id, name: p.name })),
      });
      scan = await wait(scan.id, ["completed"]);
    }
    const packages = scan.graph?.nodes.filter((n: any) => n.kind === "package") || [];
    const unique = [...new Map<string, any>(packages.map((n: any) => [n.purl, n])).values()];
    const record = {
      repository,
      ref: scan.ref,
      commit: scan.commit,
      scanId: scan.id,
      projects: scan.repositoryMap.projects.length,
      files: scan.repositoryMap.fileCount,
      selected: selected.map((p: any) => ({ name: p.name, path: p.path, ecosystem: p.ecosystem })),
      status: scan.status,
      packageVersions: unique.length,
      checked: unique.filter((n) => n.coverage === "checked").length,
      advisories: [...new Set(unique.flatMap((n) => n.advisories.map((a: any) => a.id)))],
      warnings: scan.graph?.warnings || scan.repositoryMap.warnings,
      error: scan.error,
      durationSeconds: Math.round((Date.now() - started) / 1000),
    };
    results.push(record);
    console.log(
      JSON.stringify({
        ...record,
        warnings: record.warnings.length,
        advisories: record.advisories.length,
      }),
    );
  } catch (error) {
    results.push({ repository, error: (error as Error).message });
    console.log(repository + ": " + (error as Error).message);
  }
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/live-repositories.json",
    JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
  );
}
if (results.some((result) => result.error || result.status === "failed")) process.exitCode = 1;

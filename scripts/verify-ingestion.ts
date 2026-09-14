import { writeFile, mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = "http://127.0.0.1:3000";
const repos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "google/osv-scanner",
      "jagpreetsingh02/SWASTRA-OCR",
      "expressjs/express",
      "jagpreetsingh02/MIT",
      "npm/cli",
      "pallets/flask",
      "spring-projects/spring-petclinic",
      "GoogleCloudPlatform/microservices-demo",
      "octocat/Hello-World",
    ];
async function api(path: string, body?: unknown) {
  const r = await fetch(base + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
async function wait(id: string, status: string) {
  for (let i = 0; i < 900; i++) {
    const s = await api("/scans/" + id);
    if (s.status === "failed") throw new Error(s.error);
    if (s.status === status) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Scan timeout");
}
const results: any[] = [];
for (const repository of repos) {
  try {
    const created = await api("/scans", { mode: "github", repository, ref: "HEAD" });
    let scan = await wait(created.id, "mapped");
    const map = scan.repositoryMap;
    console.log(repository + ": mapped " + map.projects.length + " projects");
    const preview = {
      dependencies: map.projects.reduce((s: number, p: any) => s + (p.packageCount || 0), 0),
      exact: map.projects.reduce((s: number, p: any) => s + (p.exactCount || 0), 0),
      unresolved: map.projects.reduce((s: number, p: any) => s + (p.unresolvedCount || 0), 0),
    };
    const selected =
      repository === "google/osv-scanner" || repository === "GoogleCloudPlatform/microservices-demo"
        ? map.projects
        : map.projects.filter((p: any) => p.selected && p.role !== "workspace").slice(0, 1);
    if (selected.length) {
      await api("/scans/" + scan.id + "/analyze", {
        projects: selected.map((p: any) => ({ id: p.id, name: p.name })),
      });
      scan = await wait(scan.id, "completed");
    }
    const packages = (scan.graph?.nodes || []).filter((n: any) => n.kind === "package");
    const exact = [
      ...new Map<string, any>(
        packages.filter((n: any) => n.versionStatus !== "unresolved").map((n: any) => [n.purl, n]),
      ).values(),
    ];
    const unresolved = packages.filter((n: any) => n.versionStatus === "unresolved");
    if (unresolved.some((n: any) => n.coverage === "checked" || n.advisories.length || n.version))
      throw new Error("Unresolved dependency was falsely matched");
    const result = {
      repository,
      scanId: scan.id,
      commit: scan.commit,
      ref: scan.ref,
      status: scan.status,
      projects: map.projects.length,
      files: map.fileCount,
      allProjectPreview: preview,
      selected: selected.map((p: any) => p.path),
      dependencies: packages.length,
      exactVersions: exact.length,
      unresolved: unresolved.length,
      graphNodes: scan.graph?.nodes.length || 0,
      checked: exact.filter((n) => n.coverage === "checked").length,
      coverage: scan.repositoryMap.projects.map((p: any) => ({
        path: p.path,
        status: p.ingestionStatus,
        detected: p.packageCount,
        exact: p.exactCount,
        unresolved: p.unresolvedCount,
      })),
      warnings: scan.graph?.warnings || map.warnings,
    };
    results.push(result);
    console.log(
      JSON.stringify({ ...result, coverage: undefined, warnings: result.warnings.length }),
    );
  } catch (error) {
    results.push({ repository, error: (error as Error).message });
    console.error(repository + ": " + (error as Error).message);
    process.exitCode = 1;
  }
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/ingestion-repositories.json",
    JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2),
  );
}
if (process.env.VERIFY_BROWSER === "1") {
  const browser = await chromium.launch();
  try {
    const checks: any[] = [];
    for (const repository of ["google/osv-scanner", "jagpreetsingh02/SWASTRA-OCR"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/app#new");
      await page.getByLabel("Repository URL").fill("https://github.com/" + repository);
      await page.getByRole("button", { name: "Map repository", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Your repository, understood." })).toBeVisible(
        { timeout: 180000 },
      );
      if (repository.includes("SWASTRA"))
        await expect(page.getByText("Detected dependencies: 14", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Analyze repository", exact: true }).click();
      await expect(page.getByRole("region", { name: "Analysis summary" })).toBeVisible({
        timeout: 300000,
      });
      if (repository.includes("SWASTRA")) {
        await expect(page.getByRole("status")).toContainText("14 dependencies were discovered");
        await page.getByRole("button", { name: "View all dependencies" }).click();
        await page.getByRole("textbox", { name: "Search dependencies" }).fill("torch");
        await expect(page.locator("tbody")).toContainText(">=2.5");
        await expect(page.locator("tbody")).toContainText("Not checked");
      }
      expect(errors).toEqual([]);
      checks.push({ repository, errors, passed: true });
      await page.screenshot({
        path: "test-results/ingestion-" + repository.split("/")[1] + ".png",
      });
      await page.close();
    }
    await writeFile(
      "docs/verification/ingestion-browser.json",
      JSON.stringify({ verifiedAt: new Date().toISOString(), checks }, null, 2),
    );
  } finally {
    await browser.close();
  }
}

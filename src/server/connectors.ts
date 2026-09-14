import { XMLParser } from "fast-xml-parser";
import { importPKCS8, SignJWT } from "jose";
import { readFile } from "node:fs/promises";
import type { Advisory, Graph, PackageNode, Provenance } from "../shared/types.js";
import { discoverProjects, type RepositoryFile, type SourceFile } from "./discovery.js";
import type { HttpSource } from "./transport.js";
import { osvAdvisory } from "./advisories.js";
const encode = encodeURIComponent;
export class Registries {
  constructor(private http: HttpSource) {}
  async enrich(n: PackageNode) {
    if (n.ecosystem === "npm") {
      const { data, provenance } = await this.http.get<any>(
        "npm",
        `https://registry.npmjs.org/${encode(n.name)}/${encode(n.version)}`,
      );
      if (data.name !== n.name || data.version !== n.version)
        throw new Error("Registry identity mismatch.");
      n.license = typeof data.license === "string" ? data.license : undefined;
      n.provenance.push(provenance);
    } else if (n.ecosystem === "pypi") {
      const { data, provenance } = await this.http.get<any>(
        "PyPI",
        `https://pypi.org/pypi/${encode(n.name)}/${encode(n.version)}/json`,
      );
      n.license = data.info?.license_expression || undefined;
      n.provenance.push(provenance);
      for (const v of data.vulnerabilities || [])
        if (!v.withdrawn)
          n.advisories.push({
            id: v.id,
            aliases: v.aliases || [],
            summary: v.summary || "PyPI reported advisory",
            fixed: v.fixed_in?.join(", "),
            provenance: [provenance, ...(v.link ? [{ ...provenance, url: v.link }] : [])],
          });
    } else {
      const [group, artifact] = n.name.split(":");
      const path =
        group.split(".").map(encode).join("/") +
        "/" +
        encode(artifact) +
        "/" +
        encode(n.version) +
        "/" +
        encode(artifact) +
        "-" +
        encode(n.version) +
        ".pom";
      const { data, provenance } = await this.http.get<string>(
        "Maven Central",
        `https://repo.maven.apache.org/maven2/${path}`,
      );
      if (/<!DOCTYPE|<!ENTITY/i.test(data)) throw new Error("Unexpected XML entity declaration.");
      const doc = new XMLParser({ processEntities: false, parseTagValue: false }).parse(
        data,
      ).project;
      n.provenance.push(provenance);
      // License names are not assumed to be valid SPDX expressions.
      if (doc?.licenses)
        n.provenance.push({ ...provenance, source: "Maven license metadata (see POM)" });
    }
  }
}
export class Vulnerabilities {
  constructor(private http: HttpSource) {}
  async osv(n: PackageNode) {
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const { data, provenance } = await this.http.get<any>("OSV", "https://api.osv.dev/v1/query", {
        method: "POST",
        body: { package: { purl: n.purl }, ...(pageToken ? { page_token: pageToken } : {}) },
        interval: 25,
      });
      if (data.vulns !== undefined && !Array.isArray(data.vulns))
        throw new Error("Invalid OSV response.");
      for (const v of data.vulns || []) {
        const advisory = osvAdvisory(v, n, provenance);
        if (advisory) n.advisories.push(advisory);
      }
      pageToken = data.next_page_token;
      if (++pages >= 5 && pageToken) throw new Error("OSV pagination limit reached.");
    } while (pageToken);
  }
  async nvd(id: string): Promise<{ cvss?: number; provenance: Provenance }> {
    if (!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new Error("Invalid CVE identifier.");
    const { data, provenance } = await this.http.get<any>(
      "NVD",
      `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encode(id)}`,
      {
        headers: process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : undefined,
        interval: process.env.NVD_API_KEY ? 700 : 6500,
        ttl: 86400000,
      },
    );
    const cve = data.vulnerabilities?.find((v: any) => v.cve?.id === id)?.cve;
    const scores = [
      ...(cve?.metrics?.cvssMetricV40 || []),
      ...(cve?.metrics?.cvssMetricV31 || []),
      ...(cve?.metrics?.cvssMetricV30 || []),
      ...(cve?.metrics?.cvssMetricV2 || []),
    ];
    const primary = scores.find((m: any) => m.type === "Primary") || scores[0];
    const score = primary?.cvssData?.baseScore;
    return {
      cvss: typeof score === "number" && score >= 0 && score <= 10 ? score : undefined,
      provenance,
    };
  }
  async cve(id: string) {
    if (!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new Error("Invalid CVE identifier.");
    return this.http.get<any>("CVE Program", `https://cveawg.mitre.org/api/cve/${encode(id)}`, {
      ttl: 86400000,
    });
  }
  async oss(nodes: PackageNode[]) {
    if (!process.env.OSS_INDEX_EMAIL || !process.env.OSS_INDEX_TOKEN) return;
    for (let i = 0; i < nodes.length; i += 128) {
      const batch = nodes.slice(i, i + 128);
      const { data, provenance } = await this.http.get<any[]>(
        "OSS Index",
        "https://ossindex.sonatype.org/api/v3/component-report",
        {
          method: "POST",
          body: { coordinates: batch.map((n) => n.purl) },
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(process.env.OSS_INDEX_EMAIL + ":" + process.env.OSS_INDEX_TOKEN).toString(
                "base64",
              ),
          },
        },
      );
      for (const record of data) {
        const n = batch.find((n) => n.purl === record.coordinates);
        if (!n) continue;
        for (const v of record.vulnerabilities || [])
          n.advisories.push({
            id: v.cve || v.id,
            aliases: v.cve ? [v.cve] : [],
            summary: v.title || "OSS Index advisory",
            cvss:
              typeof v.cvssScore === "number" ? Math.max(0, Math.min(10, v.cvssScore)) : undefined,
            provenance: [{ ...provenance, url: v.reference || provenance.url }],
          });
      }
    }
  }
  /** Paginated incremental feed; consumers must map applicability independently. */
  async *nvdSince(start: string, end: string) {
    const delta = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(delta) || delta < 0 || delta > 120 * 86400000)
      throw new Error("NVD sync window must be 0–120 days.");
    let index = 0,
      total = 1;
    while (index < total) {
      const query = new URLSearchParams({
        lastModStartDate: start,
        lastModEndDate: end,
        startIndex: String(index),
        resultsPerPage: "100",
      });
      const result = await this.http.get<any>(
        "NVD",
        `https://services.nvd.nist.gov/rest/json/cves/2.0?${query}`,
        {
          headers: process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : undefined,
          interval: process.env.NVD_API_KEY ? 700 : 6500,
        },
      );
      yield result;
      total = result.data.totalResults || 0;
      index += result.data.resultsPerPage || 100;
    }
  }
}
export function mergeAdvisories(advisories: Advisory[]): Advisory[] {
  const groups: Advisory[] = [];
  for (const a of advisories) {
    const ids = new Set([a.id, ...a.aliases]);
    const matches = groups.filter((b) => [b.id, ...b.aliases].some((id) => ids.has(id)));
    if (!matches.length) {
      groups.push({ ...a, aliases: [...a.aliases], provenance: [...a.provenance] });
      continue;
    }
    const target = matches[0];
    for (const item of [a, ...matches.slice(1)]) {
      target.aliases = [...new Set([...target.aliases, item.id, ...item.aliases])].filter(
        (id) => id !== target.id,
      );
      if (item.cvss !== undefined) target.cvss = Math.max(target.cvss || 0, item.cvss);
      target.fixed ||= item.fixed;
      target.exploited ||= item.exploited;
      target.provenance.push(...item.provenance);
    }
    for (const duplicate of matches.slice(1)) groups.splice(groups.indexOf(duplicate), 1);
  }
  return groups;
}
export async function enrichGraph(
  graph: Graph,
  http: HttpSource,
  progress: (current?: number, total?: number, message?: string) => void,
) {
  const registries = new Registries(http);
  const vulnerabilities = new Vulnerabilities(http);
  const groups = new Map<string, PackageNode[]>();
  for (const n of graph.nodes.filter(
    (n) => n.kind === "package" && n.versionStatus !== "unresolved" && !!n.version,
  ))
    groups.set(n.purl, [...(groups.get(n.purl) || []), n]);
  const packages = [...groups.values()].map((g) => g[0]);
  const configured = Number(process.env.MAX_ENRICH_PACKAGES || 2000);
  const limit = Number.isFinite(configured) ? Math.max(1, Math.min(10000, configured)) : 2000;
  const selected = packages.slice(0, limit);
  if (selected.length < packages.length)
    graph.warnings.push(
      `Checked ${selected.length} of ${packages.length} package versions due to the scan budget. Other packages remain unchecked.`,
    );
  let cursor = 0,
    checked = 0,
    consecutiveFailures = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < selected.length) {
        const n = selected[cursor++];
        if (consecutiveFailures >= 4) {
          n.coverage = "partial";
          continue;
        }
        try {
          await vulnerabilities.osv(n);
          n.coverage = "checked";
          consecutiveFailures = 0;
        } catch {
          n.coverage = "partial";
          consecutiveFailures++;
        }
        n.advisories = mergeAdvisories(n.advisories);
        checked++;
        progress(
          checked,
          packages.length,
          `Checked ${checked} of ${packages.length} package versions`,
        );
      }
    }),
  );
  const incomplete = selected.filter((n) => n.coverage !== "checked").length;
  if (incomplete)
    graph.warnings.push(
      `Vulnerability coverage is incomplete for ${incomplete} packages because the source was unavailable or rate limited. These packages are not marked safe.`,
    );
  const findings = selected.filter((n) => n.advisories.length);
  // Metadata is secondary to vulnerability coverage: enrich only packages with findings.
  let registryFailures = 0;
  for (const n of findings.slice(0, 20)) {
    if (registryFailures >= 2) break;
    try {
      await registries.enrich(n);
    } catch {
      registryFailures++;
    }
    progress(checked, packages.length, `Adding source evidence for ${n.name}`);
  }
  try {
    await vulnerabilities.oss(selected);
  } catch {
    graph.warnings.push("Optional OSS Index lookup failed.");
  }
  const cveIds = [
    ...new Set(
      findings
        .flatMap((n) => n.advisories.flatMap((a) => [a.id, ...a.aliases]))
        .filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id)),
    ),
  ];
  if (cveIds.length) {
    try {
      const result = await http.get<any>(
        "CISA KEV",
        "https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json",
        { ttl: 3600000 },
      );
      const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
      if (!Array.isArray(data.vulnerabilities)) throw new Error("Invalid CISA response");
      const exploited = new Set(data.vulnerabilities.map((v: any) => v.cveID));
      for (const n of findings)
        for (const a of n.advisories)
          if ([a.id, ...a.aliases].some((id) => exploited.has(id))) {
            a.exploited = true;
            a.provenance.push(result.provenance);
          }
    } catch {
      graph.warnings.push(
        "Known-exploitation evidence could not be checked. Absence of a signal is not evidence of no exploitation.",
      );
    }
  }
  // OSV CVSS vectors are already scored. NVD fills missing CVSS, bounded for demo latency.
  const missing = [
    ...new Set(
      findings
        .flatMap((n) =>
          n.advisories.filter((a) => a.cvss === undefined).flatMap((a) => [a.id, ...a.aliases]),
        )
        .filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id)),
    ),
  ];
  const cap = Math.max(0, Math.min(20, Number(process.env.MAX_NVD_CVES || 3)));
  let failures = 0;
  for (const id of missing.slice(0, cap)) {
    if (failures >= 2) break;
    progress(checked, packages.length, `Looking up CVSS evidence for ${id}`);
    try {
      const result = await vulnerabilities.nvd(id);
      for (const n of selected)
        for (const a of n.advisories)
          if (a.id === id || a.aliases.includes(id)) {
            if (result.cvss !== undefined) a.cvss = result.cvss;
            a.provenance.push(result.provenance);
          }
    } catch {
      failures++;
    }
  }
  if (missing.length > cap || failures)
    graph.warnings.push(
      "Some advisories have no numeric CVSS in this snapshot. Their severity is shown as unscored; priority may be a lower bound.",
    );
  for (const n of selected) {
    n.advisories = mergeAdvisories(n.advisories);
    for (const instance of groups.get(n.purl)!) {
      instance.advisories = structuredClone(n.advisories);
      instance.coverage = n.coverage;
      if (n.license) instance.license = n.license;
      instance.provenance.push(
        ...n.provenance.filter(
          (p) => !instance.provenance.some((old) => old.url === p.url && old.source === p.source),
        ),
      );
    }
  }
}
export function canonicalRepository(value: string) {
  const match = value.match(
    /^(?:https:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/,
  );
  if (!match || [".", ".."].includes(match[2]))
    throw new Error(
      "Use a canonical GitHub owner/repository or https://github.com/owner/repository URL.",
    );
  return match[1] + "/" + match[2];
}
export class GitHub {
  constructor(private http: HttpSource) {}
  async headers(installationId?: number): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    };
    if (installationId) {
      const allowed = (process.env.GITHUB_INSTALLATION_IDS || "").split(",").map(Number);
      if (!allowed.includes(installationId)) throw new Error("GitHub installation is not allowed.");
      if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY_PATH)
        throw new Error("GitHub App credentials are not configured.");
      const key = await importPKCS8(
        await readFile(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8"),
        "RS256",
      );
      const jwt = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256" })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
        .setExpirationTime("9m")
        .setIssuer(process.env.GITHUB_APP_ID)
        .sign(key);
      const { data } = await this.http.get<any>(
        "GitHub",
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: { ...headers, Authorization: "Bearer " + jwt },
          body: { permissions: { contents: "read" } },
          ttl: 0,
        },
      );
      headers.Authorization = "Bearer " + data.token;
    } else if (process.env.GITHUB_TOKEN) {
      // Optional server-side token for public scans; lifts the shared-IP anonymous rate limit.
      headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
    }
    return headers;
  }
  async discover(repository: string, ref: string, installationId?: number) {
    const repo = canonicalRepository(repository);
    const headers = await this.headers(installationId);
    let commit: any;
    let actualRef = ref;
    try {
      const metadata = await this.http.get<any>("GitHub", `https://api.github.com/repos/${repo}`, {
        headers,
        ttl: 300_000,
      });
      if (ref === "HEAD") actualRef = metadata.data.default_branch;
      commit = (
        await this.http.get<any>(
          "GitHub",
          `https://api.github.com/repos/${repo}/commits/${encode(actualRef)}`,
          { headers, ttl: 60_000 },
        )
      ).data;
    } catch (error) {
      const message = (error as Error).message;
      throw new Error(
        message.includes("404")
          ? "Repository or ref was not found. Check the owner/name and branch; private repositories need a configured GitHub App."
          : message.includes("403") || message.includes("429")
            ? "GitHub is rate limiting this connection. Try again later, or configure GITHUB_TOKEN or the existing GitHub App on the server."
            : message,
      );
    }
    if (!/^[a-f0-9]{40}$/.test(commit.sha))
      throw new Error("GitHub did not return a valid commit.");
    const { data: tree } = await this.http.get<any>(
      "GitHub",
      `https://api.github.com/repos/${repo}/git/trees/${commit.sha}?recursive=1`,
      { headers },
    );
    let files: RepositoryFile[] = tree.tree || [];
    const warnings: string[] = [];
    if (tree.truncated) {
      files = [];
      const queue = [{ sha: commit.sha, path: "" }];
      for (let i = 0; i < queue.length; i++) {
        try {
          const { data } = await this.http.get<any>(
            "GitHub",
            `https://api.github.com/repos/${repo}/git/trees/${queue[i].sha}`,
            { headers },
          );
          for (const entry of data.tree || []) {
            const path = queue[i].path + entry.path;
            if (
              entry.type === "tree" &&
              !/(^|\/)(node_modules|vendor|\.git|\.venv)(\/|$)/.test(path)
            )
              queue.push({ sha: entry.sha, path: path + "/" });
            else if (entry.type === "blob") files.push({ ...entry, path });
          }
        } catch {
          warnings.push(
            `Could not list ${queue[i].path || "repository root"}. Discovery is partial.`,
          );
        }
        if (i >= 499) {
          warnings.push(
            "Large repository: discovery stopped after 500 directory requests. Discovered projects can still be analyzed.",
          );
          break;
        }
      }
    }
    const map = discoverProjects(files, repo, actualRef, commit.sha);
    map.warnings.push(...warnings);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (cursor < map.projects.length) {
          const project = map.projects[cursor++];
          if (!project.manifest?.endsWith("package.json")) continue;
          try {
            const f = await this.file(
              repo,
              commit.sha,
              files.find((f) => f.path === project.manifest)!,
              installationId,
            );
            const manifest = JSON.parse(f.content);
            if (typeof manifest.name === "string") project.name = manifest.name;
            if (manifest.workspaces) {
              project.role = "workspace";
              project.notes.push("Workspace root; child packages are listed separately.");
              if (!Object.keys(manifest.dependencies || {}).length) project.selected = false;
            } else if (manifest.scripts?.start || manifest.scripts?.serve)
              project.role = "application";
            else if (
              !Object.keys(manifest.dependencies || {}).length &&
              Object.keys(manifest.devDependencies || {}).length
            )
              project.role = "tooling";
          } catch {
            project.notes.push("Project metadata could not be read; using its directory name.");
          }
        }
      }),
    );
    return { map, files };
  }
  async file(
    repository: string,
    commit: string,
    file: RepositoryFile,
    installationId?: number,
  ): Promise<SourceFile> {
    if (!file) throw new Error("Dependency file is missing from the pinned repository snapshot.");
    if ((file.size || 0) > 8_000_000)
      throw new Error(
        "This dependency file is larger than the 8 MB analysis budget. Other projects can still be analyzed.",
      );
    if (installationId) {
      const { data, provenance } = await this.http.get<any>(
        "GitHub",
        `https://api.github.com/repos/${canonicalRepository(repository)}/git/blobs/${file.sha}`,
        { headers: await this.headers(installationId) },
      );
      if (data.encoding !== "base64") throw new Error("Unexpected GitHub blob encoding.");
      return {
        filename: file.path,
        content: Buffer.from(data.content, "base64").toString("utf8"),
        provenance: {
          ...provenance,
          url: `https://github.com/${repository}/blob/${commit}/${file.path}`,
        },
      };
    }
    // Public content pinned to the verified commit avoids one API request per blob.
    const path = file.path.split("/").map(encode).join("/");
    const { data, provenance } = await this.http.get<string>(
      "GitHub",
      `https://raw.githubusercontent.com/${canonicalRepository(repository)}/${commit}/${path}`,
      {
        interval: 30,
        ...(process.env.GITHUB_TOKEN
          ? { headers: { Authorization: "Bearer " + process.env.GITHUB_TOKEN } }
          : {}),
      },
    );
    return {
      filename: file.path,
      content: typeof data === "string" ? data : JSON.stringify(data),
      provenance: { ...provenance, url: `https://github.com/${repository}/blob/${commit}/${path}` },
    };
  }
  async manifests(repository: string, ref: string, installationId?: number) {
    const { map, files } = await this.discover(repository, ref, installationId);
    const results: SourceFile[] = [];
    for (const project of map.projects) {
      const file = files.find((f) => f.path === (project.lockfile || project.manifest));
      if (!file) continue;
      try {
        results.push(await this.file(repository, map.commit, file, installationId));
      } catch (error) {
        map.warnings.push(`${project.path}: ${(error as Error).message}`);
      }
    }
    return { files: results, commit: map.commit, warnings: map.warnings };
  }
}

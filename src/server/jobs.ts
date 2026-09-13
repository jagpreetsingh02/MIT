import { randomUUID } from "node:crypto";
import { metrics } from "@opentelemetry/api";
import { Store } from "./store.js";
import { Transport } from "./transport.js";
import { GitHub, canonicalRepository, enrichGraph } from "./connectors.js";
import { demoGraph } from "./demo.js";
import { finalize, risks } from "./graph.js";
import { discoverProjects, type SourceFile } from "./discovery.js";
import { resolveProject } from "./resolve-project.js";
import type {
  Scan,
  ScanInput,
  ConnectorHealth,
  ProjectSelection,
  ScanProgress,
  Graph,
} from "../shared/types.js";
export const connectors = (): ConnectorHealth[] => [
  ...["GitHub", "npm", "PyPI", "Maven Central", "OSV", "NVD", "CVE Program", "CISA KEV"].map(
    (name) => ({ name, status: "ready" as const, message: "Not queried in this scan" }),
  ),
  {
    name: "OSS Index",
    status: process.env.OSS_INDEX_EMAIL && process.env.OSS_INDEX_TOKEN ? "ready" : "disabled",
    message: "Optional; requires server credentials",
  },
];
export class Jobs {
  private running = false;
  private stopped = false;
  private current?: Promise<void>;
  constructor(
    readonly store: Store,
    private httpFactory = () => new Transport(store),
  ) {}
  create(input: ScanInput): Scan {
    if (this.store.pending().length >= 20)
      throw new Error("Scan queue is full. Try again after pending scans finish.");
    const scan: Scan = {
      id: randomUUID(),
      status: "queued",
      name:
        input.mode === "demo"
          ? "acme/commerce-platform"
          : input.mode === "github"
            ? canonicalRepository(input.repository!)
            : input.filename!,
      ref: input.ref || "HEAD",
      mode: input.mode,
      createdAt: new Date().toISOString(),
      connectors: connectors(),
      progress: { stage: "discover", message: "Reading repository structure", completed: [] },
    };
    this.store.save(scan, input);
    this.kick();
    return scan;
  }
  analyze(id: string, selections: ProjectSelection[]) {
    const scan = this.store.get(id);
    if (!scan) throw new Error("Scan not found.");
    if (scan.status !== "mapped")
      throw new Error("Project selection is only available after discovery and before analysis.");
    if (!selections.length) throw new Error("Select at least one project to analyze.");
    if (
      new Set(selections.map((s) => s.id)).size !== selections.length ||
      selections.some((s) => !scan.repositoryMap!.projects.some((p) => p.id === s.id))
    )
      throw new Error("The selection contains an unknown or duplicate project.");
    scan.repositoryMap!.projects.forEach((p) => {
      const chosen = selections.find((s) => s.id === p.id);
      p.selected = !!chosen;
      if (chosen) p.name = chosen.name.trim() || p.name;
    });
    scan.analysisRequested = true;
    scan.status = "queued";
    this.stage(scan, "extract", "Waiting to extract selected projects");
    this.store.save(scan);
    this.kick();
    return scan;
  }
  kick() {
    if (!this.running && !this.stopped) this.current = this.drain();
  }
  async close() {
    this.stopped = true;
    await this.current;
  }
  async drain() {
    this.running = true;
    try {
      while (!this.stopped) {
        const scan = this.store.pending().at(-1);
        if (!scan) break;
        await this.run(scan);
      }
    } finally {
      this.running = false;
    }
  }
  private stage(
    scan: Scan,
    stage: ScanProgress["stage"],
    message: string,
    current?: number,
    total?: number,
  ) {
    const completed = scan.progress?.completed || [];
    if (scan.progress && scan.progress.stage !== stage && !completed.includes(scan.progress.stage))
      completed.push(scan.progress.stage);
    scan.progress = { stage, message, current, total, completed };
    this.store.save(scan);
  }
  private async run(scan: Scan) {
    const http = this.httpFactory();
    const github = new GitHub(http);
    const input = this.store.input(scan.id);
    const persist = () => {
      scan.connectors = connectors().map((c) => http.health.get(c.name) || c);
      this.store.save(scan);
    };
    try {
      if (!scan.analysisRequested) {
        scan.status = "discovering";
        this.stage(scan, "discover", "Finding projects and grouping dependency files");
        if (input.mode === "github") {
          const { map, files } = await github.discover(
            input.repository!,
            input.ref || "HEAD",
            input.installationId,
          );
          scan.repositoryMap = map;
          scan.name = map.repository;
          scan.ref = map.ref;
          scan.commit = map.commit;
          this.store.saveFiles(scan.id, files);
        } else if (input.mode === "demo") {
          const graph = demoGraph();
          scan.repositoryMap = {
            repository: scan.name,
            ref: "demo",
            commit: "offline-fixture",
            fileCount: 8,
            warnings: ["Synthetic demo security data. No external APIs are used."],
            projects: graph.nodes
              .filter((n) => n.kind === "service")
              .map((n) => ({
                id: n.id,
                name: n.name,
                path: "apps/" + n.name.split(":").pop(),
                ecosystem: n.ecosystem,
                manifest:
                  n.ecosystem === "npm"
                    ? "package.json"
                    : n.ecosystem === "pypi"
                      ? "requirements.txt"
                      : "pom.xml",
                lockfile: n.ecosystem === "npm" ? "package-lock.json" : undefined,
                files: [],
                selected: true,
                role: "application",
                resolution: "resolved",
                notes: ["Illustrative application and dependency graph."],
              })),
          };
        } else
          scan.repositoryMap = discoverProjects(
            [{ path: input.filename!, sha: "" }],
            input.filename!,
            "upload",
            "uploaded-file",
          );
        scan.status = "mapped";
        this.stage(
          scan,
          "map",
          scan.repositoryMap.projects.length
            ? `Found ${scan.repositoryMap.projects.length} projects. Choose what to analyze.`
            : "No supported dependency files were found. Try a repository with npm, Python or Maven dependency files.",
        );
        persist();
        return;
      }
      scan.status = "scanning";
      const chosen = scan.repositoryMap!.projects.filter((p) => p.selected);
      const graph: Graph = { nodes: [], edges: [], warnings: [...scan.repositoryMap!.warnings] };
      this.stage(
        scan,
        "extract",
        "Extracting dependencies from selected projects",
        0,
        chosen.length,
      );
      if (input.mode === "demo") {
        const original = demoGraph();
        const included = new Set(chosen.map((p) => p.id));
        const queue = [...included];
        for (let i = 0; i < queue.length; i++)
          for (const e of original.edges.filter((e) => e.from === queue[i]))
            if (!included.has(e.to)) {
              included.add(e.to);
              queue.push(e.to);
            }
        graph.nodes = original.nodes.filter((n) => included.has(n.id));
        graph.nodes.forEach((n) => {
          const project = chosen.find((p) => p.id === n.id);
          if (project) {
            n.name = project.name;
            n.projectId = project.id;
          }
        });
        graph.edges = original.edges.filter((e) => included.has(e.from) && included.has(e.to));
        graph.warnings.push(...original.warnings);
        chosen.forEach((p) => {
          p.analyzed = true;
        });
      } else {
        const tree = this.store.files(scan.id);
        const loaded = new Map<string, SourceFile>();
        for (let i = 0; i < chosen.length; i++) {
          const project = chosen[i];
          this.stage(scan, "extract", `Reading ${project.name}`, i, chosen.length);
          try {
            const paths = [
              ...new Set([project.manifest, project.lockfile].filter((p): p is string => !!p)),
            ];
            const files: SourceFile[] = [];
            for (const path of paths) {
              try {
                if (!loaded.has(path))
                  loaded.set(
                    path,
                    input.mode === "manifest"
                      ? {
                          filename: path,
                          content: input.content!,
                          provenance: {
                            source: "Uploaded manifest",
                            url: "",
                            retrievedAt: scan.createdAt,
                          },
                        }
                      : await github.file(
                          input.repository!,
                          scan.commit!,
                          tree.find((f) => f.path === path)!,
                          input.installationId,
                        ),
                  );
                files.push(loaded.get(path)!);
              } catch (error) {
                project.notes.push((error as Error).message);
              }
            }
            const g = resolveProject(project, files);
            graph.nodes.push(...g.nodes);
            graph.edges.push(...g.edges);
            graph.warnings.push(...g.warnings.map((w) => `${project.name}: ${w}`));
            project.notes = [...new Set([...project.notes, ...g.warnings])];
            project.resolution = g.warnings.length ? "partial" : "resolved";
            project.packageCount = g.nodes.filter((n) => n.kind === "package").length;
            project.analyzed = true;
          } catch (error) {
            project.resolution = "failed";
            project.notes.push((error as Error).message);
            graph.warnings.push(
              `${project.name}: ${(error as Error).message}. Other projects were retained.`,
            );
          }
          this.stage(
            scan,
            "extract",
            `Read ${i + 1} of ${chosen.length} projects`,
            i + 1,
            chosen.length,
          );
        }
      }
      this.stage(scan, "resolve", "Resolving dependency relationships");
      scan.graph = finalize(graph);
      persist();
      if (input.mode !== "demo") {
        scan.status = "enriching";
        this.stage(
          scan,
          "vulnerabilities",
          "Checking known vulnerabilities",
          0,
          graph.nodes.filter((n) => n.kind === "package").length,
        );
        await enrichGraph(scan.graph, http, (current, total, message) => {
          this.stage(
            scan,
            "vulnerabilities",
            message || "Checking known vulnerabilities",
            current,
            total,
          );
          persist();
        });
        persist();
      } else {
        this.stage(scan, "vulnerabilities", "Loaded labeled synthetic advisory fixtures");
        scan.connectors = connectors().map((c) => ({
          ...c,
          status: "fixture",
          message: "Offline demo; no source was queried",
        }));
      }
      this.stage(scan, "risk", "Calculating explainable Ripple Priority");
      scan.risks = risks(scan.graph);
      this.stage(scan, "ripple", "Preparing dependency paths to affected applications");
      scan.status = "completed";
      scan.completedAt = new Date().toISOString();
      this.stage(scan, "done", "Analysis complete");
    } catch (error) {
      scan.status = "failed";
      scan.error = (error as Error).message;
      metrics.getMeter("rippleguard").createCounter("scan_failures").add(1);
    } finally {
      this.store.save(scan);
    }
  }
}

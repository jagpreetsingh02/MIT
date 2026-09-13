import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  GitBranch,
  Layers3,
  LoaderCircle,
  Network,
  Plus,
  Radio,
  Search,
  X,
  AlertTriangle,
  KeyRound,
} from "lucide-react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import "./landing.css";
import "./journey.css";
import HeroSection6 from "./components/ui/hero-section-6";
import { Button } from "./components/ui/Button";
import { DependencyGraph } from "./components/DependencyGraph";
import { RepositoryMap } from "./components/RepositoryMap";
import { ScanProgress } from "./components/ScanProgress";
import { PackageDetails } from "./components/PackageDetails";
import type { Scan, ScanInput, Simulation, ProjectSelection } from "../shared/types";
type View = "overview" | "inventory" | "scans" | "connectors" | "methodology" | "new";
let accessToken = "";
function initialView(): View {
  const hash = location.hash.slice(1);
  return ["inventory", "scans", "connectors", "methodology", "new"].includes(hash)
    ? (hash as View)
    : "overview";
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
    },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The request could not finish. Please try again.");
  return data;
}
function App() {
  const [scan, setScan] = useState<Scan | null>(null),
    [selected, setSelected] = useState(""),
    [paths, setPaths] = useState<Simulation | null>(null),
    [ripple, setRipple] = useState(false),
    [view, setView] = useState<View>(initialView),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Scan[]>([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [mode, setMode] = useState<"github" | "manifest">("github"),
    [repository, setRepository] = useState(""),
    [ref, setRef] = useState("HEAD"),
    [filename, setFilename] = useState("package-lock.json"),
    [content, setContent] = useState(""),
    [auth, setAuth] = useState(false),
    [token, setToken] = useState(""),
    [notice, setNotice] = useState("");
  const nav = (v: View) => {
    setView(v);
    setError("");
    window.history.replaceState(null, "", v === "overview" ? "/app" : "/app#" + v);
  };
  function receive(data: Scan) {
    setScan(data);
    if (data.status === "completed")
      setSelected((prev) =>
        data.graph?.nodes.some((n) => n.id === prev)
          ? prev
          : data.risks?.[0]?.nodeId || data.graph?.nodes[0]?.id || "",
      );
  }
  async function load(id: string) {
    const data = await api<Scan>("/scans/" + id);
    receive(data);
    return data;
  }
  async function start(input: ScanInput) {
    setBusy(true);
    setError("");
    setRipple(false);
    setSelected("");
    setPaths(null);
    try {
      const created = await api<Scan>("/scans", input);
      localStorage.setItem("rippleguard-scan", created.id);
      receive(created);
      nav("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function initialize() {
    try {
      const health = await api<{ authRequired: boolean }>("/health");
      if (health.authRequired && !accessToken) {
        setAuth(true);
        return;
      }
      if (accessToken) await api("/scans");
      setAuth(false);
      if (location.hash === "#demo") {
        await start({ mode: "demo" });
        return;
      }
      const last = localStorage.getItem("rippleguard-scan");
      if (last) {
        try {
          await load(last);
          return;
        } catch {
          localStorage.removeItem("rippleguard-scan");
        }
      }
      if (initialView() === "overview") nav("new");
    } catch (e) {
      setAuth(true);
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    const handler = () => setView(initialView());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    if (!scan || ["completed", "mapped", "failed"].includes(scan.status)) return;
    let active = true;
    const timer = setTimeout(
      () =>
        api<Scan>("/scans/" + scan.id)
          .then((data) => {
            if (active) receive(data);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      1000,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scan]);
  useEffect(() => {
    if (view === "scans")
      api<Scan[]>("/scans")
        .then(setHistory)
        .catch((e) => setError(e.message));
  }, [view]);
  useEffect(() => {
    setPaths(null);
    setRipple(false);
    if (!scan || scan.status !== "completed" || !selected) return;
    let active = true;
    api<Simulation>(`/scans/${scan.id}/simulate`, { nodeId: selected })
      .then((p) => {
        if (active) setPaths(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [scan?.id, scan?.status, selected]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  async function analyze(projects: ProjectSelection[]) {
    setBusy(true);
    setError("");
    try {
      receive(await api<Scan>(`/scans/${scan!.id}/analyze`, { projects }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportSbom() {
    try {
      const data = await api(`/scans/${scan!.id}/sbom`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `rippleguard-${scan!.id}.spdx.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice("SPDX 2.3 SBOM exported.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const graph = scan?.graph;
  const risks = scan?.risks || [];
  const node = graph?.nodes.find((n) => n.id === selected);
  const risk = risks.find((r) => graph?.nodes.find((n) => n.id === r.nodeId)?.purl === node?.purl);
  const packages = useMemo(
    () => [
      ...new Map(
        (graph?.nodes || []).filter((n) => n.kind === "package").map((n) => [n.purl, n]),
      ).values(),
    ],
    [graph],
  );
  const checked = packages.filter((n) => ["checked", "fixture"].includes(n.coverage)).length;
  const findingCount = new Set(packages.flatMap((n) => n.advisories.map((a) => a.id))).size;
  const top = risks[0];
  const topNode = graph?.nodes.find((n) => n.id === top?.nodeId);
  const rows = risks.filter((r) => {
    const n = graph?.nodes.find((n) => n.id === r.nodeId);
    return (
      n &&
      n.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "vulnerable" && n.advisories.length > 0) ||
        n.ecosystem === filter)
    );
  });
  function pick(id: string) {
    setSelected(id);
    nav("overview");
  }
  function trace() {
    if (paths) {
      setRipple(true);
      setView("overview");
      document
        .getElementById("ripple-workspace")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  return (
    <div className="journey-app">
      <header className="journey-header">
        <a className="brand" href="/">
          <Radio size={25} />
          RippleGuard
        </a>
        <nav aria-label="Main navigation">
          <button className={view === "overview" ? "active" : ""} onClick={() => nav("overview")}>
            Investigation
          </button>
          <button className={view === "scans" ? "active" : ""} onClick={() => nav("scans")}>
            History
          </button>
        </nav>
        <Button onClick={() => nav("new")}>
          <Plus size={15} />
          New scan
        </Button>
      </header>
      <main className="journey-main">
        <div className="journey-title">
          <h1>
            {view === "new"
              ? "Start with your repository."
              : view === "scans"
                ? "Recent investigations."
                : view === "methodology"
                  ? "Risk you can explain."
                  : view === "connectors"
                    ? "Source coverage."
                    : scan?.status === "mapped"
                      ? "Your repository, understood."
                      : scan?.status === "completed"
                        ? "See the risk. Trace the ripple."
                        : "Understanding your repository."}
          </h1>
          <p>
            {view === "new"
              ? "Find the dependency that matters. See every application it connects to."
              : scan?.status === "mapped"
                ? "Confirm the projects below before we check their dependencies."
                : "Repository → Projects → Dependencies → Known vulnerabilities → Impact"}
          </p>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <Button
              onClick={() => {
                setError("");
                if (scan) void load(scan.id);
              }}
            >
              Retry
            </Button>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {auth ? (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              accessToken = token;
              void initialize();
            }}
          >
            <KeyRound />
            <h2>Connect to your workspace</h2>
            <label>
              Server access token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </label>
            <Button type="submit">Connect</Button>
            <p>The token stays in this tab’s memory.</p>
          </form>
        ) : view === "new" ? (
          <div className="scan-layout">
            <form
              className="scan-form"
              onSubmit={(e) => {
                e.preventDefault();
                void start(
                  mode === "github" ? { mode, repository, ref } : { mode, filename, content },
                );
              }}
            >
              <div className="segmented">
                <button
                  type="button"
                  className={mode === "github" ? "chosen" : ""}
                  onClick={() => setMode("github")}
                >
                  <GitBranch size={17} />
                  GitHub repository
                </button>
                <button
                  type="button"
                  className={mode === "manifest" ? "chosen" : ""}
                  onClick={() => setMode("manifest")}
                >
                  <FileCode2 size={17} />
                  Dependency file
                </button>
              </div>
              {mode === "github" ? (
                <>
                  <label>
                    Repository URL
                    <input
                      placeholder="https://github.com/owner/repository"
                      value={repository}
                      onChange={(e) => setRepository(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Branch, tag, or commit
                    <input value={ref} onChange={(e) => setRef(e.target.value)} required />
                  </label>
                  <p className="field-help">
                    HEAD uses the default branch. Analysis is pinned to the exact commit we
                    discover.
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Dependency file
                    <input
                      type="file"
                      accept=".json,.txt,.xml,.toml,.yaml,.lock"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          if (f.size > 2_000_000) {
                            setError(
                              "Upload limit is 2 MB. Larger repository files can be read through GitHub.",
                            );
                            return;
                          }
                          setFilename(f.name);
                          setContent(await f.text());
                        }
                      }}
                    />
                  </label>
                  <label>
                    Filename
                    <input value={filename} onChange={(e) => setFilename(e.target.value)} />
                  </label>
                  <label>
                    File content
                    <textarea
                      rows={8}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      required
                    />
                  </label>
                </>
              )}
              <Button className="primary" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}Map
                repository
              </Button>
            </form>
            <aside className="scan-notes">
              <h2>
                One dependency.
                <br />A much bigger picture.
              </h2>
              <p>
                We map your projects first. Then we check installed packages and follow their
                dependency paths back to the applications that use them.
              </p>
              <div className="demo-choice">
                <strong>Try the complete journey</strong>
                <p>
                  Explore a commerce repository with four applications. Demo vulnerabilities are
                  synthetic and work offline.
                </p>
                <Button onClick={() => void start({ mode: "demo" })} disabled={busy}>
                  Explore demo <ArrowRight size={15} />
                </Button>
              </div>
            </aside>
          </div>
        ) : view === "scans" ? (
          <section className="history-list">
            {history.length ? (
              history.map((item) => (
                <button
                  key={item.id}
                  className="history-row"
                  onClick={() => {
                    setSelected("");
                    load(item.id)
                      .then(() => {
                        localStorage.setItem("rippleguard-scan", item.id);
                        nav("overview");
                      })
                      .catch((e) => setError(e.message));
                  }}
                >
                  <Clock3 size={18} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.ref} · {new Date(item.createdAt).toLocaleString()}
                    </small>
                  </span>
                  <span className="status-badge">
                    {item.status === "mapped" ? "Awaiting selection" : item.status}
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <div className="empty-state">
                <h2>No scans yet</h2>
                <Button onClick={() => nav("new")}>Map a repository</Button>
              </div>
            )}
          </section>
        ) : view === "methodology" ? (
          <article className="documentation">
            <h2>From a package to the services it reaches</h2>
            <p>
              A dependency edge means one package depends on another. Ripple follows these edges
              backwards, starting from every installed instance of the selected package version.
              This reveals affected applications, not proof that vulnerable code executes.
            </p>
            <div className="formula">
              Priority = severity + exploitation + exposure + application reach
            </div>
            <p>
              CVSS × 6 contributes up to 60 points. Confirmed exploitation contributes 15. Exposure
              contributes 10 divided by known shortest depth, halved for development-only use.
              Application reach contributes up to 12 points for the fraction of mapped projects
              affected, plus up to 3 for affected ancestors.
            </p>
            <p>
              Known vulnerabilities rank before packages without findings. Missing CVSS contributes
              no severity points and is labeled unscored. This deterministic score is not an
              exploitation probability.
            </p>
            <h2>What the paths mean</h2>
            <p>
              Solid edges are dependency relationships recorded in a supported snapshot. Dashed
              edges mean a package was listed in a flat or conditional Python snapshot;
              direct/indirect membership is not claimed. npm workspace installations stay distinct
              from unrelated projects. Selected package versions trace across all their installed
              instances.
            </p>
            <p>
              Up to 200 simple paths are enumerated under a bounded search, with at least one
              shortest path retained for every affected project. A capped result is explicitly
              labeled “at least”. Large graphs render a focused subset while the inventory retains
              all package versions.
            </p>
            <h2>Coverage is part of the answer</h2>
            <p>
              OSV supplies exact-package advisory matches and CVSS vectors. NVD can fill missing
              numeric CVSS. CISA’s Known Exploited Vulnerabilities catalog supplies positive
              exploitation evidence. No EPSS probability is currently queried. Source failures,
              skipped versions and incomplete relationships remain visible.
            </p>
          </article>
        ) : view === "connectors" ? (
          <section className="connectors-view">
            {(scan?.connectors || []).map((c) => (
              <div className="connector-row" key={c.name}>
                <div>
                  <strong>{c.name}</strong>
                  <p>{c.message}</p>
                </div>
                <span className={`status-badge ${c.status === "degraded" ? "failed" : ""}`}>
                  {c.status}
                </span>
              </div>
            ))}
            <p className="coverage-note">
              Status from this snapshot. Ready means not queried; it does not mean full coverage.
            </p>
          </section>
        ) : !scan ? (
          <div className="empty-state">
            <h2>Map a repository to begin</h2>
            <Button onClick={() => nav("new")}>Start an investigation</Button>
          </div>
        ) : (
          <>
            <section className="repository-strip">
              <GitBranch size={21} />
              <div className="repo-identity">
                <strong>{scan.name}</strong>
                <span>Ref: {scan.ref}</span>
                {scan.commit && <code className="commit-id">Commit: {scan.commit}</code>}
              </div>
              <span className={`status-badge ${scan.mode === "demo" ? "demo" : ""}`}>
                {scan.mode === "demo"
                  ? "Demo snapshot"
                  : scan.status === "completed"
                    ? "Repository analyzed"
                    : scan.status === "mapped"
                      ? "Repository Map"
                      : "Analysis in progress"}
              </span>
            </section>
            {scan.status === "mapped" && scan.repositoryMap ? (
              <RepositoryMap
                key={scan.id}
                map={scan.repositoryMap}
                busy={busy}
                onAnalyze={(selection) => void analyze(selection)}
              />
            ) : scan.status === "failed" ? (
              <div className="empty-state">
                <AlertTriangle size={28} />
                <h2>We couldn’t complete this step</h2>
                <p>{scan.error}</p>
                <Button onClick={() => nav("new")}>Try another repository</Button>
                <Button onClick={() => void start({ mode: "demo" })}>Use offline demo</Button>
              </div>
            ) : scan.status !== "completed" ? (
              <ScanProgress scan={scan} />
            ) : (
              <>
                <section className="result-summary" aria-label="Analysis summary">
                  <span>
                    <strong>{checked}</strong> of {packages.length} package versions checked
                  </span>
                  <span>
                    <strong>{findingCount}</strong> known {scan.mode === "demo" ? "demo " : ""}
                    advisories
                  </span>
                  <span>
                    <strong>{risks.filter((r) => r.advisories && r.score >= 60).length}</strong>{" "}
                    high-priority dependencies
                  </span>
                  <span>
                    <strong>{graph?.nodes.filter((n) => n.kind === "service").length || 0}</strong>{" "}
                    projects mapped
                  </span>
                </section>
                {(checked < packages.length ||
                  graph?.warnings.length ||
                  scan.repositoryMap?.projects.some((p) => p.resolution !== "resolved")) && (
                  <details className="coverage-callout">
                    <summary>
                      <AlertTriangle size={15} />{" "}
                      {scan.mode === "demo"
                        ? "Synthetic demo security data"
                        : checked < packages.length
                          ? "Vulnerability coverage is incomplete"
                          : "Dependency coverage notes"}{" "}
                      · Review what was and wasn’t checked
                    </summary>
                    {graph?.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </details>
                )}
                {view === "inventory" ? (
                  <section className="inventory-full">{table(true)}</section>
                ) : (
                  <>
                    {topNode && top?.advisories > 0 ? (
                      <section className="top-risk">
                        <div>
                          <h2>Start here: {topNode.name}</h2>
                          <p className="top-version">
                            {topNode.version} · {topNode.ecosystem} · {top.advisories} known{" "}
                            {scan.mode === "demo" ? "demo " : ""}findings
                          </p>
                          <div className="reason-chips">
                            {top.reasons
                              ?.filter((r) => !r.startsWith("Used at"))
                              .slice(0, 4)
                              .map((reason) => (
                                <span key={reason}>{reason}</span>
                              ))}
                          </div>
                        </div>
                        <div className="top-priority">
                          <span>Ripple Priority</span>
                          <strong>
                            {top.score}
                            <small>/100</small>
                          </strong>
                          <Button
                            className="ripple-button"
                            onClick={() => {
                              if (selected !== topNode.id) {
                                pick(topNode.id);
                              } else trace();
                            }}
                            disabled={selected === topNode.id && !paths}
                          >
                            <Radio size={16} />
                            {selected === topNode.id ? "Trace Ripple" : "Inspect top dependency"}
                          </Button>
                        </div>
                      </section>
                    ) : (
                      <section className="no-findings">
                        <h2>
                          {checked > 0
                            ? "No known vulnerabilities found in the packages successfully checked."
                            : "No packages could be fully checked."}
                        </h2>
                        <p>
                          {packages.length
                            ? "Select any package to explore a hypothetical compromise. This does not establish that the repository is secure."
                            : "Review project coverage notes for unresolved versions or unsupported dependency formats."}
                        </p>
                      </section>
                    )}
                    <div className="analysis-toolbar">
                      <div className="view-tabs">
                        <button className="active">
                          <Network size={16} />
                          Dependency paths
                        </button>
                        <button onClick={() => nav("inventory")}>
                          <Layers3 size={16} />
                          All packages
                        </button>
                      </div>
                      <span>
                        {scan.mode === "demo"
                          ? "Offline demo · synthetic advisories"
                          : "Source-backed snapshot"}
                      </span>
                    </div>
                    <div id="ripple-workspace" className="ripple-workspace">
                      {ripple && paths && (
                        <div className="ripple-impact" role="status">
                          <Radio size={24} />
                          <div>
                            <h2>
                              {paths.hypothetical ? "What-if impact" : "Ripple traced"}: affects{" "}
                              {paths.services.length} of {paths.totalServices} projects
                            </h2>
                            <p>
                              {paths.pathsTruncated ? "At least " : ""}
                              {paths.pathCount} dependency paths · {paths.affected.length} dependent
                              nodes · {paths.serviceImpact}% of mapped projects
                            </p>
                            <small>
                              These applications depend on the package through recorded paths. Code
                              execution is not analyzed.
                            </small>
                          </div>
                          <Button aria-label="Clear simulation" onClick={() => setRipple(false)}>
                            <X size={17} />
                          </Button>
                        </div>
                      )}
                      <div className="analysis-layout">
                        <div className="map-column">
                          {graph && node && (
                            <DependencyGraph
                              graph={graph}
                              risks={risks}
                              selected={selected}
                              onSelect={pick}
                              simulation={ripple ? paths : null}
                              paths={paths}
                            />
                          )}
                          {paths && (
                            <div className="ripple-paths">
                              <h2>
                                {ripple
                                  ? "Affected application paths"
                                  : "Dependency paths into this package"}
                              </h2>
                              {paths.relationshipUncertain && (
                                <p>
                                  Dashed root links indicate listed packages, not confirmed direct
                                  dependencies.
                                </p>
                              )}
                              {paths.paths.slice(0, 12).map((path, i) => (
                                <div className="path" key={i}>
                                  {path.map((id, j) => (
                                    <span className="path-step" key={id}>
                                      {j > 0 && <ArrowRight size={12} />}
                                      <button onClick={() => pick(id)}>
                                        {graph?.nodes.find((n) => n.id === id)?.name}
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ))}
                              {paths.paths.length > 12 && (
                                <p>
                                  Showing 12 of {paths.pathCount}
                                  {paths.pathsTruncated ? "+" : ""} paths. The graph includes the
                                  affected ancestors.
                                </p>
                              )}
                              {!paths.paths.length && (
                                <p>No application path was recorded for this node.</p>
                              )}
                            </div>
                          )}
                        </div>
                        {node && graph && (
                          <PackageDetails
                            node={node}
                            risk={risk}
                            graph={graph}
                            paths={paths}
                            onTrace={trace}
                            busy={!paths}
                          />
                        )}
                      </div>
                    </div>
                    <section className="priority-section">{table(false)}</section>
                  </>
                )}
                {scan.repositoryMap && (
                  <details className="project-outcomes">
                    <summary>Analysis coverage by project</summary>
                    {scan.repositoryMap.projects
                      .filter((p) => p.selected)
                      .map((p) => (
                        <p key={p.id}>
                          <strong>{p.name}</strong> · {p.resolution} · {p.packageCount ?? "Demo"}{" "}
                          packages{p.notes.length ? ` — ${p.notes.join(" ")}` : ""}
                        </p>
                      ))}
                  </details>
                )}
              </>
            )}
          </>
        )}
        <footer className="page-footer">
          <span>
            <Radio size={14} />
            RippleGuard · Source facts. Visible impact.
          </span>
          <div>
            <button onClick={() => nav("methodology")}>How scoring works</button>
            <button onClick={() => nav("connectors")}>Source coverage</button>
            {scan?.status === "completed" && (
              <button onClick={() => void exportSbom()}>
                <ArrowDownToLine size={12} />
                Export SBOM
              </button>
            )}
          </div>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
  function table(full: boolean) {
    return (
      <>
        <div className="table-heading">
          <div>
            <h2>{full ? "All package versions" : "Dependencies worth investigating"}</h2>
            <p>
              {full
                ? "Every resolved package version, including unscored and unchecked packages."
                : "Known findings first, followed by deterministic Ripple Priority."}
            </p>
          </div>
          {!full && (
            <Button onClick={() => nav("inventory")}>
              View all dependencies <ArrowRight size={14} />
            </Button>
          )}
        </div>
        {full && (
          <div className="table-filters">
            <label className="search-input">
              <Search size={16} />
              <input
                aria-label="Search dependencies"
                placeholder="Search dependencies…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter dependencies"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All packages</option>
              <option value="vulnerable">Known findings</option>
              <option value="npm">npm</option>
              <option value="pypi">Python</option>
              <option value="maven">Maven</option>
            </select>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Package / installed version</th>
                <th>Ripple Priority</th>
                <th>Known findings</th>
                <th>How it enters</th>
                <th>Projects affected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(full ? rows : risks.slice(0, 6)).map((r) => {
                const n = graph!.nodes.find((n) => n.id === r.nodeId)!;
                return (
                  <tr key={n.id}>
                    <td>
                      <button className="package-link" onClick={() => pick(n.id)}>
                        <span>
                          <strong>{n.name}</strong>
                          <small>
                            {n.version} · {n.ecosystem}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className={`score-number ${r.level}`}>{r.score}</span>
                      <span className={`risk-badge ${r.level}`}>{r.level}</span>
                    </td>
                    <td>
                      {n.advisories.length}
                      <small className="coverage-label">
                        {n.coverage === "checked"
                          ? "Checked"
                          : n.coverage === "fixture"
                            ? "Demo data"
                            : "Incomplete"}
                      </small>
                    </td>
                    <td>
                      {n.depth === null
                        ? "Relationship unknown"
                        : n.depth === 1
                          ? "Direct dependency"
                          : `Hidden ${n.depth} levels deep`}
                    </td>
                    <td>
                      {r.services.length} of{" "}
                      {graph!.nodes.filter((n) => n.kind === "service").length}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Inspect ${n.name}`}
                        onClick={() => pick(n.id)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && full && (
            <div className="empty-state">
              <p>No matching packages.</p>
              <Button
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/app" ? <App /> : <HeroSection6 />,
);

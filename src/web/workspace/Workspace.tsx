import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  AppWindow,
  Boxes,
  Bug,
  Check,
  FileCheck2,
  Gauge,
  GitBranch,
  History as HistoryIcon,
  KeyRound,
  LayoutDashboard,
  Menu,
  Plus,
  ShieldAlert,
  Waypoints,
  X,
} from "lucide-react";
import type {
  OtterAction,
  OtterScope,
  ProjectSelection,
  Scan,
  ScanInput,
  Simulation,
} from "../../shared/types";
import { OtterMark } from "../otter/OtterMark";
import { type BriefHandlers, OtterPanel } from "../otter/OtterPanel";
import { APPLICATION_SUGGESTIONS, GLOBAL_SUGGESTIONS } from "../otter/suggestions";
import { GLOBAL_KEY, useOtter } from "../otter/useOtter";
import { RepositoryMap } from "../components/RepositoryMap";
import { ScanProgress } from "../components/ScanProgress";
import { cn } from "@/lib/utils";
import { api, hasAccessToken, setAccessToken } from "./api";
import { deriveFacts, findingKey, type Severity } from "../../shared/facts";
import { Applications } from "./sections/Applications";
import { Coverage } from "./sections/Coverage";
import { Dependencies } from "./sections/Dependencies";
import { Evidence } from "./sections/Evidence";
import { NewScan } from "./sections/NewScan";
import { Overview } from "./sections/Overview";
import { RippleGraph } from "./sections/RippleGraph";
import { Risks } from "./sections/Risks";
import { ScanHistory } from "./sections/ScanHistory";
import { Vulnerabilities } from "./sections/Vulnerabilities";
import { ANALYSIS_VIEWS, type AnalysisView, type View, viewFromHash } from "./types";
import { Action, Blank, SectionHeader } from "./ui";

const LAST_SCAN_KEY = "rootline-scan";

const NAV: { view: AnalysisView; label: string; Icon: typeof LayoutDashboard }[] = [
  { view: "overview", label: "Overview", Icon: LayoutDashboard },
  { view: "risks", label: "Risks", Icon: ShieldAlert },
  { view: "applications", label: "Applications", Icon: AppWindow },
  { view: "dependencies", label: "Dependencies", Icon: Boxes },
  { view: "vulnerabilities", label: "Vulnerabilities", Icon: Bug },
  { view: "graph", label: "Ripple Graph", Icon: Waypoints },
  { view: "coverage", label: "Coverage", Icon: Gauge },
  { view: "evidence", label: "Evidence", Icon: FileCheck2 },
];

export function RootLineMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 3v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12 10c0 4-6 4-6 9M12 10c0 4 6 4 6 9M12 10v9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="3.5" r="2" fill="currentColor" />
    </svg>
  );
}

export function Workspace() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const [selected, setSelected] = useState("");
  const [paths, setPaths] = useState<Simulation | null>(null);
  const [ripple, setRipple] = useState(false);
  const [pendingTrace, setPendingTrace] = useState(false);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Scan[]>([]);
  const [auth, setAuth] = useState(false);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [otterPanel, setOtterPanel] = useState<"closed" | "chat" | "brief">("closed");
  const [briefKey, setBriefKey] = useState("");
  const [focusApp, setFocusApp] = useState("");
  const [evidenceFocus, setEvidenceFocus] = useState("");

  const facts = useMemo(() => (scan?.status === "completed" ? deriveFacts(scan) : null), [scan]);
  const otter = useOtter(facts ? scan?.id : undefined);

  useEffect(() => {
    setBriefKey("");
    setFocusApp("");
    setEvidenceFocus("");
  }, [scan?.id]);

  function go(next: View) {
    setView(next);
    setError("");
    setMenuOpen(false);
    window.history.replaceState(null, "", next === "overview" ? "/app" : "/app#" + next);
    window.scrollTo({ top: 0 });
  }

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
      localStorage.setItem(LAST_SCAN_KEY, created.id);
      receive(created);
      go("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function initialize() {
    try {
      const health = await api<{ authRequired: boolean }>("/health");
      if (health.authRequired && !hasAccessToken()) {
        setAuth(true);
        return;
      }
      if (hasAccessToken()) await api("/scans");
      setAuth(false);
      if (location.hash === "#demo") {
        await start({ mode: "demo" });
        return;
      }
      const last = localStorage.getItem(LAST_SCAN_KEY);
      if (last) {
        try {
          await load(last);
          return;
        } catch {
          localStorage.removeItem(LAST_SCAN_KEY);
        }
      }
      if (viewFromHash() === "overview") go("new");
    } catch (e) {
      setAuth(true);
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    const handler = () => setView(viewFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  useEffect(() => {
    if (!scan || ["completed", "mapped", "failed"].includes(scan.status)) return;
    let active = true;
    const timer = setTimeout(
      () =>
        api<Scan>("/scans/" + scan.id)
          .then((data) => active && receive(data))
          .catch((e) => active && setError(e.message)),
      1000,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scan]);

  useEffect(() => {
    if (view === "history")
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
      .then((p) => active && setPaths(p))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [scan?.id, scan?.status, selected]);

  useEffect(() => {
    if (pendingTrace && paths) {
      setRipple(true);
      setPendingTrace(false);
    }
  }, [pendingTrace, paths]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  async function analyze(projects: ProjectSelection[]) {
    if (!scan) return;
    setBusy(true);
    setError("");
    try {
      receive(await api<Scan>(`/scans/${scan.id}/analyze`, { projects }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportSbom() {
    if (!scan) return;
    try {
      const data = await api(`/scans/${scan.id}/sbom`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `rootline-${scan.id}.spdx.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice("SPDX 2.3 SBOM exported.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function investigate(nodeId: string, trace = false) {
    if (nodeId === selected) {
      if (trace && paths) setRipple(true);
      else setPendingTrace(trace);
    } else {
      setSelected(nodeId);
      setPendingTrace(trace);
    }
    go("graph");
  }

  function openScan(id: string) {
    setSelected("");
    load(id)
      .then(() => {
        localStorage.setItem(LAST_SCAN_KEY, id);
        go("overview");
      })
      .catch((e) => setError(e.message));
  }

  const analysisView = (ANALYSIS_VIEWS as readonly string[]).includes(view)
    ? (view as AnalysisView)
    : null;
  const briefRow = facts?.findingRows.find((r) => r.key === briefKey);
  const selectedNode = facts?.nodeById.get(selected);
  const focusAppNode = facts?.nodeById.get(focusApp);
  const otterAvailable = Boolean(facts && scan && analysisView && !auth);
  const otterOpen = otterAvailable && otterPanel !== "closed";

  function otterScope(): OtterScope {
    const v = analysisView ?? "overview";
    return {
      kind: "global",
      view: v,
      applicationId: v === "applications" && focusAppNode ? focusApp : undefined,
      nodeId:
        (v === "graph" || v === "dependencies") && selectedNode
          ? selected
          : v === "vulnerabilities" && briefRow
            ? briefRow.pkg.id
            : undefined,
      advisoryId:
        v === "vulnerabilities" && briefRow
          ? briefRow.advisory.id
          : v === "evidence" && evidenceFocus
            ? evidenceFocus
            : undefined,
      ripple: v === "graph" ? ripple : undefined,
    };
  }

  const seeing = (() => {
    const v = analysisView ?? "overview";
    const label = NAV.find((n) => n.view === v)!.label;
    const pkg = selectedNode
      ? `${selectedNode.name}${selectedNode.kind === "package" ? `@${selectedNode.version}` : ""}`
      : "";
    const detail =
      v === "applications"
        ? focusAppNode?.name
        : v === "graph"
          ? pkg && `${pkg}${ripple ? " · ripple traced" : ""}`
          : v === "dependencies"
            ? pkg
            : v === "vulnerabilities" && briefRow
              ? `${briefRow.advisory.id} in ${briefRow.pkg.name}`
              : v === "evidence"
                ? evidenceFocus
                : "";
    return detail ? `${label} · ${detail}` : label;
  })();

  const isNarrow = () => window.matchMedia("(max-width: 767px)").matches;

  function openBrief(key: string) {
    setSeverity("all");
    setBriefKey(key);
    setOtterPanel("brief");
    if (view !== "vulnerabilities") go("vulnerabilities");
  }

  function showApplication(id: string) {
    setFocusApp(id);
    go("applications");
  }

  function showEvidence(advisoryId: string) {
    setEvidenceFocus(advisoryId);
    go("evidence");
  }

  function runOtterAction(action: OtterAction) {
    if (isNarrow() && action.type !== "vulnerability") setOtterPanel("closed");
    if (action.type === "section") go(action.view);
    else if (action.type === "application") showApplication(action.applicationId);
    else if (action.type === "package") investigate(action.nodeId);
    else if (action.type === "trace") investigate(action.nodeId, true);
    else if (action.type === "vulnerability") openBrief(findingKey(action.advisoryId, action.nodeId));
    else if (action.type === "evidence") showEvidence(action.advisoryId);
  }

  const briefHandlers: BriefHandlers | null =
    briefRow && otterPanel === "brief"
      ? {
          row: briefRow,
          onTrace: () => {
            if (isNarrow()) setOtterPanel("closed");
            investigate(briefRow.pkg.id, true);
          },
          onEvidence: () => {
            if (isNarrow()) setOtterPanel("closed");
            showEvidence(briefRow.advisory.id);
          },
          onApplication: (id) => {
            if (isNarrow()) setOtterPanel("closed");
            showApplication(id);
          },
          onClose: () => setOtterPanel("closed"),
          onAsk: () => {
            otter.openBranch({
              key: "v:" + briefRow.key,
              advisoryId: briefRow.advisory.id,
              nodeId: briefRow.pkg.id,
              severity: briefRow.severity,
              title: briefRow.advisory.id,
              subtitle: `${briefRow.pkg.name}@${briefRow.pkg.version}`,
            });
            setOtterPanel("chat");
          },
        }
      : null;

  const counts: Partial<Record<AnalysisView, number>> = facts
    ? {
        risks: (scan?.risks ?? []).filter((r) => r.advisories > 0).length,
        applications: facts.services.length,
        dependencies: facts.packages.length,
        vulnerabilities: facts.findings.length,
      }
    : {};

  const sectionProps =
    scan && facts
      ? {
          scan,
          facts,
          go,
          investigate,
          showSeverity: (s: Severity | "all") => {
            setSeverity(s);
            go("vulnerabilities");
          },
        }
      : null;

  function analysisContent() {
    if (view === "evidence" && !sectionProps) return <Evidence scan={scan} facts={facts} />;
    if (!scan)
      return (
        <>
          <SectionHeader
            title="No repository analyzed yet"
            question="Map a repository or open the offline demo to fill this workspace."
          />
          <Blank
            title="Map a repository to begin"
            action={<Action text="New Scan" onClick={() => go("new")} />}
          />
        </>
      );
    if (scan.status === "mapped" && scan.repositoryMap)
      return (
        <>
          <SectionHeader
            title="Your repository, understood."
            question="Confirm the projects below before RootLine checks their dependencies."
          />
          <RepositoryMap
            key={scan.id}
            map={scan.repositoryMap}
            busy={busy}
            onAnalyze={(selection) => void analyze(selection)}
          />
        </>
      );
    if (scan.status === "failed")
      return (
        <Blank
          title="We couldn’t complete this step"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Action text="Try another repository" onClick={() => go("new")} />
              <Action text="Use offline demo" onClick={() => void start({ mode: "demo" })} />
            </div>
          }
        >
          {scan.error}
        </Blank>
      );
    if (!sectionProps)
      return (
        <>
          <SectionHeader
            title="Understanding your repository."
            question="Repository → Projects → Dependencies → Known vulnerabilities → Impact"
          />
          <ScanProgress scan={scan} />
        </>
      );
    switch (view) {
      case "risks":
        return <Risks {...sectionProps} />;
      case "applications":
        return (
          <Applications
            {...sectionProps}
            focusId={focusApp}
            onFocus={setFocusApp}
            onAsk={(id) => {
              setFocusApp(id);
              otter.setActiveKey(GLOBAL_KEY);
              setOtterPanel("chat");
            }}
          />
        );
      case "dependencies":
        return <Dependencies {...sectionProps} />;
      case "vulnerabilities":
        return (
          <Vulnerabilities
            {...sectionProps}
            severity={severity}
            briefKey={otterOpen && otterPanel === "brief" ? briefKey : ""}
            onBrief={openBrief}
          />
        );
      case "graph":
        return (
          <RippleGraph
            {...sectionProps}
            selected={selected}
            paths={paths}
            ripple={ripple}
            onTrace={() => paths && setRipple(true)}
            onClear={() => setRipple(false)}
          />
        );
      case "coverage":
        return <Coverage {...sectionProps} />;
      case "evidence":
        return <Evidence scan={scan} facts={facts} focusId={evidenceFocus} />;
      default:
        return <Overview {...sectionProps} />;
    }
  }

  const navButton = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-lg border-0 px-3 py-2 text-left text-[13px] font-medium",
      active
        ? "bg-accent text-accent-foreground"
        : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <a href="/" className="flex items-center gap-2 text-lg font-[680] tracking-[-0.5px] text-primary no-underline">
          <RootLineMark className="size-5 text-rust" />
          RootLine
        </a>
        <button
          className="icon-button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <aside
        className={cn(
          "fixed bottom-0 left-0 top-14 z-30 w-60 flex-col border-r border-border bg-card md:top-0 md:flex",
          menuOpen ? "flex shadow-xl" : "hidden",
        )}
      >
        <a
          href="/"
          className="hidden h-16 shrink-0 items-center gap-2 px-5 text-xl font-[680] tracking-[-0.6px] text-primary no-underline md:flex"
        >
          <RootLineMark className="size-6 text-rust" />
          RootLine
        </a>
        <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 pt-3 md:pt-1">
          <span className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[1.4px] text-muted-foreground">
            Analysis
          </span>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {NAV.map(({ view: v, label, Icon }) => (
              <li key={v}>
                <button
                  className={navButton(view === v)}
                  aria-current={view === v ? "page" : undefined}
                  onClick={() => go(v)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                  {counts[v] !== undefined && (
                    <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {counts[v]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <hr className="mx-3 my-3 border-0 border-t border-border" />
          <ul className="m-0 grid list-none gap-0.5 p-0">
            <li>
              <button
                className={navButton(view === "new")}
                aria-current={view === "new" ? "page" : undefined}
                onClick={() => go("new")}
              >
                <Plus size={16} aria-hidden="true" />
                New Scan
              </button>
            </li>
            <li>
              <button
                className={navButton(view === "history")}
                aria-current={view === "history" ? "page" : undefined}
                onClick={() => go("history")}
              >
                <HistoryIcon size={16} aria-hidden="true" />
                Scan History
              </button>
            </li>
          </ul>
          <p className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-muted-foreground">
            Source facts. Visible impact. Security findings are never generated by AI.
          </p>
        </nav>
      </aside>

      <div
        className={cn(
          "transition-[padding] duration-300 md:pl-60",
          otterOpen && "lg:pr-[420px]",
        )}
      >
        {scan && view !== "new" && view !== "history" && !auth && (
          <section
            aria-label="Repository context"
            className="sticky top-14 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur md:top-0 md:px-8"
          >
            <GitBranch size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <strong className="break-all text-[13px] font-[560] text-foreground">{scan.name}</strong>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                Ref: {scan.ref}
              </span>
              {scan.commit && (
                <code
                  className="whitespace-nowrap font-mono text-[11px] text-muted-foreground"
                  title={scan.commit}
                >
                  Commit: {scan.commit.slice(0, 12)}
                </code>
              )}
            </div>
            <span className={`status-badge ${scan.mode === "demo" ? "demo" : ""}`}>
              {scan.mode === "demo"
                ? "Demo snapshot"
                : scan.status === "completed"
                  ? "Repository analyzed"
                  : scan.status === "mapped"
                    ? "Repository map"
                    : scan.status === "failed"
                      ? "Analysis failed"
                      : "Analysis in progress"}
            </span>
            {scan.status === "completed" && (
              <Action text="Export SBOM" onClick={() => void exportSbom()} />
            )}
          </section>
        )}

        <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-7 md:px-8">
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              {scan && (
                <Action
                  text="Retry"
                  onClick={() => {
                    setError("");
                    void load(scan.id);
                  }}
                />
              )}
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
                setAccessToken(token);
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
              <Action type="submit" text="Connect" />
              <p>The token stays in this tab’s memory.</p>
            </form>
          ) : view === "new" ? (
            <NewScan busy={busy} onStart={(input) => void start(input)} onError={setError} />
          ) : view === "history" ? (
            <ScanHistory
              history={history}
              currentId={scan?.id}
              onOpen={openScan}
              onNew={() => go("new")}
            />
          ) : (
            analysisContent()
          )}
        </main>
      </div>

      {menuOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 top-14 z-20 border-0 bg-black/20 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {otterAvailable &&
        scan &&
        facts &&
        (otterOpen ? (
          <OtterPanel
            otter={otter}
            scan={scan}
            facts={facts}
            brief={briefHandlers}
            seeing={seeing}
            globalScope={otterScope}
            globalSuggestions={
              analysisView === "applications" && focusAppNode
                ? APPLICATION_SUGGESTIONS
                : GLOBAL_SUGGESTIONS[analysisView ?? "overview"]
            }
            onAction={runOtterAction}
            onClose={() => setOtterPanel("closed")}
          />
        ) : (
          <button
            aria-label="Open OTTER"
            onClick={() => setOtterPanel("chat")}
            className="otter-launcher fixed bottom-5 right-5 z-40 flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card py-2 pl-2 pr-4 text-[13px] font-semibold tracking-[0.6px] text-foreground shadow-lg transition-[box-shadow,border-color] duration-300 hover:border-rust/40 hover:shadow-xl"
          >
            <OtterMark
              active={Object.values(otter.pending).some(Boolean)}
              className="size-7 text-rust"
            />
            OTTER
          </button>
        ))}

      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}

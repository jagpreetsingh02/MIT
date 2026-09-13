import { useMemo, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { Graph, Risk, Simulation } from "../../shared/types";
import { Button } from "./ui/Button";
export function DependencyGraph({
  graph,
  risks,
  selected,
  onSelect,
  simulation,
  paths,
}: {
  graph: Graph;
  risks: Risk[];
  selected: string;
  onSelect: (id: string) => void;
  simulation: Simulation | null;
  paths?: Simulation | null;
}) {
  const [zoom, setZoom] = useState(1);
  const [overview, setOverview] = useState(false);
  const layout = useMemo(() => {
    const trace = simulation || paths;
    const focus = new Set([selected, ...(trace?.seedIds || []), ...(trace?.affected || [])]);
    let nodes = overview && !simulation ? graph.nodes : graph.nodes.filter((n) => focus.has(n.id));
    if (!nodes.length) nodes = graph.nodes;
    // Bound rendering, never the underlying analysis. The table retains every package.
    const selectedFirst = [...nodes].sort(
      (a, b) =>
        Number(b.id === selected) - Number(a.id === selected) ||
        Number(b.kind === "service") - Number(a.kind === "service") ||
        (trace?.distances?.[a.id] ?? 99) - (trace?.distances?.[b.id] ?? 99),
    );
    const shown = selectedFirst.slice(0, 70);
    const included = new Set(shown.map((n) => n.id));
    const rawEdges = (overview && !simulation ? graph.edges : trace?.edges || graph.edges).filter(
      (e) => included.has(e.from) && included.has(e.to),
    );
    const edges = [...new Map(rawEdges.map((e) => [e.from + ":" + e.to, e])).values()];
    const depth = new Map<string, number>();
    shown.filter((n) => n.kind === "service").forEach((n) => depth.set(n.id, 0));
    // Use path positions to make the selected dependency the common right-hand destination.
    for (const path of trace?.paths || [])
      for (let i = 0; i < path.length; i++)
        depth.set(path[i], Math.max(depth.get(path[i]) || 0, i));
    const max = Math.min(8, Math.max(1, ...depth.values()));
    const groups = new Map<number, typeof shown>();
    shown.forEach((n) => {
      const col =
        n.kind === "service"
          ? 0
          : !overview && trace?.seedIds?.includes(n.id)
            ? max
            : Math.min(8, depth.get(n.id) ?? n.depth ?? 1);
      groups.set(col, [...(groups.get(col) || []), n]);
    });
    const columns = [...groups.keys()].sort((a, b) => a - b);
    const height = Math.max(
      380,
      Math.max(1, ...[...groups.values()].map((ns) => ns.length)) * 78 + 80,
    );
    const width = Math.max(880, columns.length * 240 + 40);
    const positions = new Map<string, { x: number; y: number }>();
    columns.forEach((col, i) =>
      groups
        .get(col)!
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((n, j, ns) =>
          positions.set(n.id, {
            x: 25 + (i * (width - 235)) / Math.max(1, columns.length - 1),
            y: 70 + ((j + 0.5) * (height - 100)) / ns.length,
          }),
        ),
    );
    return {
      nodes: shown,
      edges,
      positions,
      width,
      height,
      hidden: graph.nodes.length - shown.length,
      clipped: nodes.length > 70,
    };
  }, [graph, selected, simulation, paths, overview]);
  const riskByPurl = new Map(
    risks.map((r) => [graph.nodes.find((n) => n.id === r.nodeId)?.purl, r]),
  );
  const affected = new Set([
    selected,
    ...(simulation?.seedIds || []),
    ...(simulation?.affected || []),
  ]);
  return (
    <section className={`graph-shell ${simulation ? "ripple-running" : ""}`}>
      <div className="graph-title">
        <div>
          <h2>{simulation ? "Follow the ripple" : "Why is this package here?"}</h2>
          <p>
            {simulation
              ? "Risk travels back through dependent packages to your applications."
              : "Each line means “depends on”. Read application → package."}
          </p>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={overview}
            onChange={(e) => setOverview(e.target.checked)}
            disabled={!!simulation}
          />
          Show overview
        </label>
      </div>
      <div className="graph-scroll">
        <svg
          className="dependency-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? `${zoom * 800}px` : "800px" }}
          role="group"
          aria-label="Dependency paths to selected package"
        >
          <defs>
            <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".7" fill="#d4dde2" />
            </pattern>
            <marker
              id="edge-arrow"
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M0 0L6 3L0 6" fill="#a3b0b9" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
          {layout.edges.map((e) => {
            const a = layout.positions.get(e.from)!,
              b = layout.positions.get(e.to)!;
            const active = !!simulation && affected.has(e.from) && affected.has(e.to);
            return (
              <path
                key={e.from + e.to}
                d={`M${a.x + 190} ${a.y} C${a.x + 230} ${a.y},${b.x - 45} ${b.y},${b.x - 4} ${b.y}`}
                fill="none"
                stroke={active ? "#bc522d" : "#b6c3cc"}
                strokeWidth={active ? 2.5 : 1.5}
                strokeDasharray={e.relationship === "listed" ? "4 5" : undefined}
                markerEnd="url(#edge-arrow)"
                className={active ? "ripple-edge" : ""}
                style={{ animationDelay: `${(simulation?.distances?.[e.to] || 0) * 0.3}s` }}
              />
            );
          })}
          {layout.nodes.map((n) => {
            const p = layout.positions.get(n.id)!;
            const service = n.kind === "service";
            const chosen = n.id === selected || paths?.seedIds?.includes(n.id);
            const risk = riskByPurl.get(n.purl);
            const isAffected = !!simulation && affected.has(n.id);
            const title = n.name.includes(":") ? n.name.split(":").pop()! : n.name;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y - 26})`}
                tabIndex={0}
                role="button"
                aria-pressed={!!chosen}
                aria-label={`${n.name} ${n.version}${service ? ", application" : n.advisories.length ? ", known vulnerability" : ""}`}
                onClick={() => onSelect(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(n.id);
                  }
                }}
                className={`graph-node ${isAffected ? "reached" : ""}`}
                style={{ animationDelay: `${(simulation?.distances?.[n.id] || 0) * 0.3}s` }}
              >
                <title>
                  {n.name} {n.version}
                </title>
                {chosen && (
                  <rect
                    x="-5"
                    y="-5"
                    width="200"
                    height="62"
                    rx="10"
                    fill="none"
                    stroke="#ba532e"
                    strokeWidth="2"
                  />
                )}
                <rect
                  width="190"
                  height="52"
                  rx="7"
                  fill={service ? (isAffected ? "#9c4328" : "#2b4442") : "#fff"}
                  stroke={chosen || isAffected ? "#bc522d" : "#cbd6de"}
                />
                <circle
                  cx="15"
                  cy="18"
                  r="4"
                  fill={service ? "#c7e5da" : n.advisories.length ? "#b84436" : "#8d9ca5"}
                />
                <text x="27" y="22" className="node-name" fill={service ? "white" : "#263d49"}>
                  {title.length > 22 ? title.slice(0, 20) + "…" : title}
                </text>
                <text x="27" y="39" className="node-version" fill={service ? "#e4efeb" : "#596e7b"}>
                  {service
                    ? isAffected
                      ? "AFFECTED APPLICATION"
                      : "APPLICATION / PROJECT"
                    : `${n.version}${n.advisories.length ? " · " + (risk?.level || "known") + " priority" : ""}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="graph-footer">
        <div className="legend">
          <span>
            <i className="legend-root" />
            Application
          </span>
          <span>
            <i className="dot critical" />
            Known vulnerability
          </span>
          <span>
            <i className="legend-selection" />
            Selected
          </span>
        </div>
        <div className="graph-tools">
          <Button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.7, z - 0.15))}>
            <Minus size={15} />
          </Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
            <Plus size={15} />
          </Button>
          <Button aria-label="Fit graph" onClick={() => setZoom(1)}>
            <Maximize2 size={15} />
          </Button>
        </div>
      </div>
      {layout.hidden > 0 && (
        <p className="graph-context">
          Showing {layout.nodes.length} of {graph.nodes.length} graph nodes
          {layout.clipped ? " (display limit)" : " on the selected dependency paths"}. All package
          versions remain available below.
        </p>
      )}
    </section>
  );
}

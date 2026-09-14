import { ArrowRight, Radio, X } from "lucide-react";
import type { Simulation } from "../../../shared/types";
import { DependencyGraph } from "../../components/DependencyGraph";
import { PackageDetails } from "../../components/PackageDetails";
import type { SectionProps } from "../types";
import { Blank, SectionHeader } from "../ui";

export function RippleGraph({
  scan,
  facts,
  investigate,
  selected,
  paths,
  ripple,
  onTrace,
  onClear,
}: SectionProps & {
  selected: string;
  paths: Simulation | null;
  ripple: boolean;
  onTrace: () => void;
  onClear: () => void;
}) {
  const graph = scan.graph;
  const node = graph?.nodes.find((n) => n.id === selected);
  const risk = node && facts.riskFor(node);
  const priorities = (scan.risks ?? []).filter((r) => r.advisories > 0);
  const others = facts.packages.filter((n) => n.advisories.length === 0);
  const name = (id: string) => facts.nodeById.get(id)?.name;
  return (
    <>
      <SectionHeader
        title="Ripple Graph"
        question="Why a dependency exists and where its impact spreads. Edges point from an application to what it depends on; Trace Ripple follows them back."
      >
        <label className="filter-select">
          <span className="text-xs">Investigating</span>
          <select
            aria-label="Choose a package to investigate"
            value={selected}
            onChange={(e) => investigate(e.target.value)}
          >
            {priorities.length > 0 && (
              <optgroup label="Known findings">
                {priorities.map((r) => (
                  <option key={r.nodeId} value={r.nodeId}>
                    {name(r.nodeId)} · priority {r.score}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Other packages">
              {others.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} {n.versionStatus === "unresolved" ? "" : n.version}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </SectionHeader>

      {!graph || !node ? (
        <Blank title="Choose a package to investigate">
          Select a dependency from Risks or Dependencies to see its paths into your applications.
        </Blank>
      ) : (
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
                  {paths.pathCount} dependency paths · {paths.affected.length} dependent nodes ·{" "}
                  {paths.serviceImpact}% of mapped projects
                </p>
                <small>
                  These applications depend on the package through recorded paths. Code execution
                  is not analyzed.
                </small>
              </div>
              <button
                className="icon-button ml-auto shrink-0"
                aria-label="Clear simulation"
                onClick={onClear}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="analysis-layout">
            <div className="map-column">
              <DependencyGraph
                graph={graph}
                risks={scan.risks ?? []}
                selected={selected}
                onSelect={investigate}
                simulation={ripple ? paths : null}
                paths={paths}
              />
              {paths && (
                <div className="ripple-paths">
                  <h2>
                    {ripple ? "Affected application paths" : "Dependency paths into this package"}
                  </h2>
                  {paths.relationshipUncertain && (
                    <p>
                      Dashed root links indicate listed packages, not confirmed direct dependencies.
                    </p>
                  )}
                  {paths.paths.slice(0, 12).map((path) => (
                    <div className="path" key={path.join(">")}>
                      {path.map((id, j) => (
                        <span className="path-step" key={id}>
                          {j > 0 && <ArrowRight size={12} />}
                          <button onClick={() => investigate(id)}>{name(id)}</button>
                        </span>
                      ))}
                    </div>
                  ))}
                  {paths.paths.length > 12 && (
                    <p>
                      Showing 12 of {paths.pathCount}
                      {paths.pathsTruncated ? "+" : ""} paths. The graph includes the affected
                      ancestors.
                    </p>
                  )}
                  {!paths.paths.length && <p>No application path was recorded for this node.</p>}
                </div>
              )}
            </div>
            <PackageDetails
              node={node}
              risk={risk}
              graph={graph}
              paths={paths}
              onTrace={onTrace}
              busy={!paths}
            />
          </div>
        </div>
      )}
    </>
  );
}

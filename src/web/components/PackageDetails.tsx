import { ArrowRight, ExternalLink, Box } from "lucide-react";
import type { Graph, PackageNode, Risk, Simulation } from "../../shared/types";
import { InteractiveHoverButton } from "./ui/interactive-hover-button";
export function PackageDetails({
  node,
  risk,
  graph,
  paths,
  onTrace,
  busy,
}: {
  node: PackageNode;
  risk?: Risk;
  graph: Graph;
  paths: Simulation | null;
  onTrace: () => void;
  busy: boolean;
}) {
  return (
    <aside className="inspector package-details" aria-label="Package details">
      <div className="package-title">
        <span className="package-icon">
          <Box size={22} />
        </span>
        <div>
          <h2>{node.name}</h2>
          <span>
            {node.versionStatus === "unresolved"
              ? (node.declaredSpecifier || "No version declared") + " · exact version unresolved"
              : node.version}{" "}
            · {node.ecosystem}
          </span>
        </div>
      </div>
      {risk && node.versionStatus !== "unresolved" && (
        <div className="package-risk">
          <span>Ripple Priority</span>
          <strong>
            {risk.score}
            <small>/100</small>
          </strong>
          <span className={`risk-badge ${risk.level}`}>{risk.level} priority</span>
        </div>
      )}
      <div className="detail-reasons">
        {risk?.reasons?.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </div>
      {node.kind === "package" && (
        <>
          <div className="px-[18px]">
            <InteractiveHoverButton
              className="w-full border-border py-2 pl-8 pr-5 text-xs text-foreground [&_svg]:size-4"
              disabled={busy}
              onClick={onTrace}
              text={node.advisories.length ? "Trace Ripple" : "Trace what-if impact"}
            />
          </div>
          <p className="inspector-help">
            {node.advisories.length
              ? "Show applications that depend on this package."
              : "Hypothetical compromise; no vulnerability is asserted."}
          </p>
        </>
      )}
      <section className="inspector-section">
        <h3>How did it enter the application?</h3>
        {!paths ? (
          <p>Finding dependency paths…</p>
        ) : paths.services.length ? (
          <>
            <p>
              Used by {paths.services.length} of {paths.totalServices} mapped projects through{" "}
              {paths.pathsTruncated ? "at least " : ""}
              {paths.pathCount} paths.
            </p>
            {paths.paths.slice(0, 5).map((path, i) => (
              <div className="detail-path" key={i}>
                {path.map((id, j) => (
                  <span key={id}>
                    {j > 0 && <ArrowRight size={11} />} {graph.nodes.find((n) => n.id === id)?.name}
                  </span>
                ))}
              </div>
            ))}
            {paths.paths.length > 5 && (
              <p>+ {paths.paths.length - 5} more paths in the impact view.</p>
            )}
            {paths.relationshipUncertain && (
              <p className="partial-text">
                Some root links mean “listed in lockfile”; exact application ancestry is not fully
                known.
              </p>
            )}
          </>
        ) : (
          <p>No application path was recorded for this package.</p>
        )}
      </section>
      <section className="inspector-section">
        <h3>{node.advisories.length ? "Known vulnerabilities" : "Vulnerability coverage"}</h3>
        {!node.advisories.length ? (
          <p>
            {node.versionStatus === "unresolved"
              ? "Discovered declaration; exact installed version is unresolved. Not sent to vulnerability matching."
              : node.coverage === "checked"
                ? "No known vulnerabilities were found in this package by the sources successfully checked."
                : node.coverage === "fixture"
                  ? "No advisory in the synthetic demo fixture."
                  : "This package was not fully checked. No security conclusion can be drawn."}
          </p>
        ) : (
          node.advisories.map((a) => (
            <article className="advisory" key={a.id}>
              <strong>{a.id}</strong>
              <p>{a.summary}</p>
              <div className="advisory-facts">
                <span>
                  Severity:{" "}
                  {a.cvss !== undefined
                    ? a.cvss >= 9
                      ? "Critical"
                      : a.cvss >= 7
                        ? "High"
                        : a.cvss >= 4
                          ? "Medium"
                          : "Low"
                    : a.severity || "not supplied"}
                </span>
                <span>CVSS: {a.cvss ?? "not available"}</span>
                <span>
                  Exploitation:{" "}
                  {a.exploited
                    ? "known, source reported"
                    : "no evidence available in this snapshot"}
                </span>
                <span>
                  Fix: {a.fixed ? `source lists ${a.fixed}` : "no verified fixed version available"}
                </span>
              </div>
              {a.aliases.length > 0 && <small>{a.aliases.join(" · ")}</small>}
              {!!a.affected?.length && (
                <details>
                  <summary>Affected version evidence</summary>
                  {a.affected?.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                </details>
              )}
              {a.provenance.map((p, i) =>
                /^https:\/\//.test(p.url) ? (
                  <a key={i} href={p.url} target="_blank" rel="noreferrer">
                    {p.source}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <small key={i}>{p.source}</small>
                ),
              )}
              <small>
                Evidence retrieved {new Date(a.provenance[0]?.retrievedAt).toLocaleDateString()}
              </small>
            </article>
          ))
        )}
      </section>
      {risk && (
        <details className="provenance">
          <summary>How the score is calculated</summary>
          {Object.entries(risk.factors).map(([name, value]) => (
            <p className="factor" key={name}>
              <span>
                {
                  {
                    severity: "CVSS severity × 6",
                    exploit: "Known exploitation",
                    exposure: "Depth and runtime exposure",
                    blastRadius: "Affected projects and ancestors",
                  }[name]
                }
              </span>
              <strong>+{value}</strong>
            </p>
          ))}
          <p>
            Deterministic priority, not an exploitation probability. Missing evidence may lower the
            score.
          </p>
        </details>
      )}
      <details className="provenance">
        <summary>Package identity & source files</summary>
        <code>{node.purl}</code>
        {node.provenance.map((p, i) => (
          <p key={i}>
            {/^https:\/\//.test(p.url) ? (
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.source}
                <ExternalLink size={11} />
              </a>
            ) : (
              p.source
            )}
          </p>
        ))}
      </details>
    </aside>
  );
}

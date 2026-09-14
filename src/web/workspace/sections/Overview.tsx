import { AlertTriangle } from "lucide-react";
import { SEVERITIES } from "../../../shared/facts";
import { BarList, Meter } from "../charts";
import { SEVERITY_META } from "../severity";
import type { SectionProps } from "../types";
import { Action, Panel, SectionHeader, Stat } from "../ui";

export function Overview({ scan, facts, go, investigate, showSeverity }: SectionProps) {
  const risks = scan.risks ?? [];
  const priorities = risks.filter((r) => r.advisories > 0);
  const top = priorities[0];
  const topNode = top && facts.nodeById.get(top.nodeId);
  const demo = scan.mode === "demo";
  const vulnerable = facts.vulnerablePackages;
  const notChecked = Math.max(facts.packages.length - facts.checked - facts.unresolved, 0);
  const incomplete =
    facts.checked < facts.packages.length ||
    Boolean(scan.graph?.warnings.length) ||
    Boolean(scan.repositoryMap?.projects.some((p) => p.selected && p.resolution !== "resolved"));

  return (
    <>
      <SectionHeader
        title="Overview"
        question="What is happening in this repository, at a glance. Every number links to the facts behind it."
      />

      <section
        className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="Analysis summary"
      >
        <Stat
          label="Applications"
          value={facts.services.length}
          detail="projects mapped"
        />
        <Stat
          label="Dependencies"
          value={facts.packages.length}
          detail={
            facts.exact === 0 && facts.unresolved > 0
              ? `${facts.packages.length} dependencies discovered`
              : `${facts.checked} of ${facts.exact} exact package versions checked`
          }
        />
        <Stat
          label={demo ? "Known demo advisories" : "Known vulnerabilities"}
          value={facts.findings.length}
          detail={`in ${vulnerable.length} ${vulnerable.length === 1 ? "package" : "packages"}`}
        />
        <Stat
          label="High-priority dependencies"
          value={priorities.filter((r) => r.score >= 60).length}
          detail="Ripple Priority 60 or above"
        />
      </section>

      {facts.unresolved > 0 && (
        <p className="coverage-callout" role="status">
          {facts.packages.length} dependencies were discovered, but {facts.unresolved} could not be
          matched to exact installed versions.{" "}
          {facts.exact
            ? "Vulnerability checks were performed only on exact versions."
            : "Dependencies were discovered, but no exact installed versions were available for vulnerability matching."}
        </p>
      )}

      {topNode && top ? (
        <Panel className="mb-5 border-[#ecd8c7] bg-[#fffaf5]">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="min-w-0">
              <span className="text-[11px] font-medium uppercase tracking-[1.2px] text-rust">
                Deserves attention first
              </span>
              <h2 className="mt-1 text-xl font-[560] tracking-[-0.4px] text-foreground">
                Start here: {topNode.name}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {topNode.version} · {topNode.ecosystem} · {top.advisories} known{" "}
                {demo ? "demo " : ""}
                {top.advisories === 1 ? "finding" : "findings"} · reaches {top.services.length} of{" "}
                {facts.services.length} applications
              </p>
              <div className="reason-chips mt-3">
                {top.reasons
                  ?.filter((r) => !r.startsWith("Used at"))
                  .slice(0, 4)
                  .map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <span className="block text-[11px] text-muted-foreground">Ripple Priority</span>
                <strong className="text-[32px] font-[550] tabular-nums tracking-[-1px] text-rust">
                  {top.score}
                  <small className="ml-0.5 text-sm font-normal text-muted-foreground">/100</small>
                </strong>
              </div>
              <div className="flex flex-col gap-2">
                <Action text="Trace Ripple" onClick={() => investigate(topNode.id, true)} />
                <Action text="All risks" onClick={() => go("risks")} />
              </div>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel className="mb-5">
          <h2 className="text-base font-[550] text-foreground">
            {facts.checked > 0
              ? "No known vulnerabilities found in the packages successfully checked."
              : "No packages could be fully checked."}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {facts.packages.length
              ? "This does not establish that the repository is secure. Open the Ripple Graph to explore a hypothetical compromise of any package."
              : "Review Coverage for unresolved versions or unsupported dependency formats."}
          </p>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={demo ? "Demo advisories by severity" : "Known vulnerabilities by severity"}
          description="Severity comes from the advisory's CVSS score, or the source's own rating when no score is supplied."
        >
          <BarList
            unit={facts.findings.length === 1 ? "vulnerability" : "vulnerabilities"}
            empty="No known vulnerabilities in the packages checked."
            onSelect={(key) => showSeverity(key as (typeof SEVERITIES)[number])}
            bars={SEVERITIES.map((s) => {
              const { label, color, Icon } = SEVERITY_META[s];
              return {
                key: s,
                label,
                color,
                icon: <Icon size={13} style={{ color }} aria-hidden="true" />,
                value: facts.findings.filter((f) => f.severity === s).length,
              };
            })}
          />
        </Panel>

        <Panel
          title="How vulnerable packages enter"
          description="Direct dependencies are declared by an application. Hidden ones arrive through other packages."
        >
          <BarList
            unit="vulnerable packages"
            empty="No vulnerable packages to place in the dependency tree."
            onSelect={() => go("risks")}
            bars={[
              {
                key: "direct",
                label: "Direct dependency",
                color: "#367a69",
                value: vulnerable.filter((n) => n.depth !== null && n.depth <= 1).length,
              },
              {
                key: "hidden",
                label: "Hidden deeper",
                color: "#367a69",
                value: vulnerable.filter((n) => n.depth !== null && n.depth > 1).length,
              },
              {
                key: "unknown",
                label: "Relationship unknown",
                color: "#367a69",
                value: vulnerable.filter((n) => n.depth === null).length,
              },
            ]}
          />
        </Panel>

        <Panel
          title="Applications reached by vulnerable packages"
          description="Count of distinct vulnerable packages found on each application's recorded dependency paths."
        >
          <BarList
            unit="vulnerable packages"
            empty="No application is reached by a known vulnerable package."
            onSelect={() => go("applications")}
            bars={[...facts.applications]
              .sort((a, b) => b.vulnerable.length - a.vulnerable.length)
              .slice(0, 8)
              .map((app) => ({
                key: app.node.id,
                label: app.node.name,
                color: "#bd4e28",
                value: app.vulnerable.length,
              }))}
          />
        </Panel>

        <Panel
          title="How much RootLine could check"
          description="Unknown coverage is not safety. Only exact package versions are matched against vulnerability sources."
          actions={<Action text="Coverage" onClick={() => go("coverage")} />}
        >
          <Meter
            unit="dependencies"
            segments={[
              {
                key: "checked",
                label: demo ? "Checked against demo data" : "Checked against sources",
                color: "#283c3d",
                value: facts.checked,
              },
              {
                key: "incomplete",
                label: "Not fully checked",
                color: "#fab219",
                value: notChecked,
              },
              {
                key: "unresolved",
                label: "Exact version unresolved",
                color: "#b6c0c8",
                value: facts.unresolved,
              },
            ]}
          />
        </Panel>
      </div>

      {incomplete && (
        <p className="coverage-callout flex items-center gap-2">
          <AlertTriangle size={15} />
          {demo
            ? "Synthetic demo security data. DEMO advisories are illustrative fixtures."
            : facts.checked < facts.packages.length
              ? "Vulnerability coverage is incomplete. Review what was and wasn't checked in Coverage."
              : "Dependency coverage notes are available in Coverage."}
        </p>
      )}
    </>
  );
}

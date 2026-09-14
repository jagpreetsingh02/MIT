import { entryLabel, SEVERITIES, type Severity } from "../../../shared/facts";
import { cn } from "@/lib/utils";
import { SEVERITY_META, SeverityBadge } from "../severity";
import type { SectionProps } from "../types";
import { Action, Blank, SectionHeader } from "../ui";

export function Vulnerabilities({
  scan,
  facts,
  go,
  investigate,
  severity,
  showSeverity,
  briefKey,
  onBrief,
}: SectionProps & {
  severity: Severity | "all";
  briefKey: string;
  onBrief: (key: string) => void;
}) {
  const demo = scan.mode === "demo";
  const rows = facts.findingRows.filter((r) => severity === "all" || r.severity === severity);
  return (
    <>
      <SectionHeader
        title="Vulnerabilities"
        question={`Every known ${demo ? "demo advisory" : "vulnerability"} matched to an exact installed package version. Each row is one finding; open its brief to understand it or investigate it with OTTER.`}
      >
        <label className="filter-select">
          <span className="sr-only">Filter by severity</span>
          <select
            aria-label="Filter by severity"
            value={severity}
            onChange={(e) => showSeverity(e.target.value as Severity | "all")}
          >
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_META[s].label}
              </option>
            ))}
          </select>
        </label>
      </SectionHeader>
      {demo && (
        <p className="coverage-callout">
          DEMO advisories are synthetic fixtures for an offline walkthrough, not real
          vulnerabilities.
        </p>
      )}
      {!facts.findingRows.length ? (
        <Blank
          title="No known vulnerabilities matched"
          action={<Action text="Coverage" onClick={() => go("coverage")} />}
        >
          Only exact package versions that sources could check are matched. Unchecked packages carry
          no security conclusion.
        </Blank>
      ) : !rows.length ? (
        <Blank
          title={`No ${SEVERITY_META[severity as Severity].label.toLowerCase()} findings`}
          action={<Action text="Show all" onClick={() => showSeverity("all")} />}
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Advisory</th>
                <th>Package / installed version</th>
                <th>Severity</th>
                <th>CVSS</th>
                <th>Exploitation</th>
                <th>How it enters</th>
                <th>Fix</th>
                <th>Applications</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, advisory: a, severity: s, pkg, risk }) => (
                <tr
                  key={key}
                  aria-selected={briefKey === key}
                  className={cn(briefKey === key && "bg-[#fffaf5] shadow-[inset_3px_0_0_var(--rust)]")}
                >
                  <td className="whitespace-normal">
                    <strong className="block font-mono text-[11px] font-medium text-foreground">
                      {a.id}
                    </strong>
                    <span className="mt-1 block min-w-52 max-w-[38ch] text-[11px] leading-snug">
                      {a.summary}
                    </span>
                    <Action
                      text="View brief"
                      className="mt-2"
                      aria-label={`Open Vulnerability Brief for ${a.id} in ${pkg.name}`}
                      onClick={() => onBrief(key)}
                    />
                  </td>
                  <td>
                    <button
                      className="package-link"
                      aria-label={`Inspect ${pkg.name} for ${a.id}`}
                      onClick={() => investigate(pkg.id)}
                    >
                      <span>
                        <strong>{pkg.name}</strong>
                        <small>{pkg.version}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <SeverityBadge severity={s} />
                  </td>
                  <td className="tabular-nums">{a.cvss ?? "Not available"}</td>
                  <td>{a.exploited ? "Known, source reported" : "No evidence in snapshot"}</td>
                  <td>{entryLabel(pkg)}</td>
                  <td>{a.fixed ? `Source lists ${a.fixed}` : "No verified fix version"}</td>
                  <td>
                    {risk?.services.length ?? 0} of {facts.services.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

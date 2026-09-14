import { AlertTriangle } from "lucide-react";
import { Meter } from "../charts";
import type { SectionProps } from "../types";
import { Panel, SectionHeader, Stat } from "../ui";

export function Coverage({ scan, facts }: SectionProps) {
  const demo = scan.mode === "demo";
  const notChecked = Math.max(facts.packages.length - facts.checked - facts.unresolved, 0);
  const projects = scan.repositoryMap?.projects.filter((p) => p.selected) ?? [];
  const warnings = scan.graph?.warnings ?? [];
  return (
    <>
      <SectionHeader
        title="Coverage"
        question="What RootLine could and could not verify. Unknown coverage is not safety: an unchecked package carries no security conclusion."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Dependencies found" value={facts.packages.length} />
        <Stat
          label="Exact versions checked"
          value={facts.checked}
          detail={`of ${facts.exact} exact versions`}
        />
        <Stat label="Not fully checked" value={notChecked} />
        <Stat label="Exact version unresolved" value={facts.unresolved} detail="not matched" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Vulnerability check coverage"
          description="Share of discovered dependencies that reached vulnerability matching."
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
              { key: "incomplete", label: "Not fully checked", color: "#fab219", value: notChecked },
              {
                key: "unresolved",
                label: "Exact version unresolved",
                color: "#b6c0c8",
                value: facts.unresolved,
              },
            ]}
          />
        </Panel>

        <Panel
          title="Sources"
          description="Status recorded in this snapshot. Ready means not queried; it does not mean full coverage."
        >
          <ul className="m-0 grid list-none gap-0 p-0">
            {scan.connectors.map((c) => (
              <li
                key={c.name}
                className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <strong className="block text-xs font-medium text-foreground">{c.name}</strong>
                  <p className="text-[11px] leading-snug text-muted-foreground">{c.message}</p>
                </div>
                <span className={`status-badge ${c.status === "degraded" ? "failed" : ""}`}>
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {projects.length > 0 && (
        <Panel title="Analysis coverage by project" className="mt-4">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Resolution</th>
                  <th>Dependencies</th>
                  <th>Exact</th>
                  <th>Unresolved</th>
                  <th>Relationships</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong className="block text-[11px] font-medium text-foreground">
                        {p.name}
                      </strong>
                      <small className="font-mono">{p.path}</small>
                    </td>
                    <td>{p.ingestionStatus || p.resolution}</td>
                    <td>{p.packageCount ?? "Demo"}</td>
                    <td>{p.exactCount ?? p.packageCount ?? 0}</td>
                    <td>{p.unresolvedCount ?? 0}</td>
                    <td>{p.relationships ?? "not reported"}</td>
                    <td className="min-w-64 whitespace-normal">{p.notes.join(" ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {warnings.length > 0 && (
        <Panel title="Coverage notes" className="mt-4">
          <ul className="m-0 grid list-none gap-2 p-0">
            {warnings.map((w) => (
              <li key={w} className="flex gap-2 text-xs leading-relaxed text-[#805d2c]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

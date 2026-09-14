import { ArrowUpRight, Radio } from "lucide-react";
import { entryLabel, SEVERITIES, severityOf } from "../../../shared/facts";
import { SeverityBadge } from "../severity";
import type { SectionProps } from "../types";
import { Action, Blank, SectionHeader } from "../ui";

export function Risks({ scan, facts, go, investigate }: SectionProps) {
  const priorities = (scan.risks ?? []).filter((r) => r.advisories > 0);
  const demo = scan.mode === "demo";
  return (
    <>
      <SectionHeader
        title="Risks"
        question="Which dependencies deserve attention first. Known findings are ranked by deterministic Ripple Priority."
      >
        <Action text="How scoring works" onClick={() => go("evidence")} />
      </SectionHeader>
      {!priorities.length ? (
        <Blank
          title={
            facts.checked > 0
              ? "No known vulnerabilities in the packages successfully checked"
              : "No packages could be fully checked"
          }
          action={<Action text="All dependencies" onClick={() => go("dependencies")} />}
        >
          No finding does not mean the repository is secure. Coverage shows what RootLine could and
          could not verify.
        </Blank>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Package / installed version</th>
                <th>Ripple Priority</th>
                <th>Worst {demo ? "demo " : ""}finding</th>
                <th>How it enters</th>
                <th>Applications affected</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {priorities.map((r, i) => {
                const n = facts.nodeById.get(r.nodeId);
                if (!n) return null;
                const worst = n.advisories
                  .map(severityOf)
                  .sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))[0];
                return (
                  <tr key={n.id}>
                    <td className="tabular-nums">{i + 1}</td>
                    <td>
                      <button className="package-link" onClick={() => investigate(n.id)}>
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
                      <SeverityBadge severity={worst} />
                      <small className="coverage-label">
                        {r.advisories} {r.advisories === 1 ? "finding" : "findings"}
                      </small>
                    </td>
                    <td>{entryLabel(n)}</td>
                    <td>
                      {r.services.length} of {facts.services.length}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Trace ripple for ${n.name}`}
                        title="Trace Ripple"
                        onClick={() => investigate(n.id, true)}
                      >
                        <Radio size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Inspect ${n.name}`}
                        title="Open in Ripple Graph"
                        onClick={() => investigate(n.id)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

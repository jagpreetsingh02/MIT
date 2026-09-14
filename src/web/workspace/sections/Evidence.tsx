import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Provenance, Scan } from "../../../shared/types";
import type { Facts } from "../../../shared/facts";
import { SeverityBadge } from "../severity";
import { Panel, SectionHeader } from "../ui";

function Source({ p }: { p: Provenance }) {
  const date = p.retrievedAt ? new Date(p.retrievedAt).toLocaleDateString() : "date not recorded";
  return (
    <li className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
      {/^https:\/\//.test(p.url) ? (
        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[#52806e]"
        >
          {p.source}
          <ExternalLink size={11} />
        </a>
      ) : (
        <span className="text-foreground">{p.source}</span>
      )}
      <span>· retrieved {date}</span>
      {p.fixture && <span className="status-badge demo">fixture</span>}
    </li>
  );
}

export function Evidence({
  scan,
  facts,
  focusId,
}: {
  scan: Scan | null;
  facts: Facts | null;
  focusId?: string;
}) {
  const completed = scan?.status === "completed" && facts;
  useEffect(() => {
    if (focusId)
      document
        .getElementById("evidence-" + focusId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusId]);
  return (
    <>
      <SectionHeader
        title="Evidence"
        question="Why RootLine can make each claim. Security facts come from named sources; scores and paths are derived deterministically from them."
      />
      {completed && (
        <section className="mb-8 grid gap-4" aria-label="Finding evidence">
          {!facts.findings.length && (
            <Panel>
              <p className="text-xs text-muted-foreground">
                No advisory was matched in this snapshot, so there is no vulnerability evidence to
                show. Package source files are listed in each package's details in the Ripple Graph.
              </p>
            </Panel>
          )}
          {facts.findings.map(({ advisory: a, severity, packages }) => (
            <Panel
              key={a.id}
              id={"evidence-" + a.id}
              className={cn(
                "scroll-mt-24 transition-shadow duration-300",
                focusId === a.id && "border-rust/50 shadow-[0_0_0_3px_color-mix(in_oklab,var(--rust)_14%,transparent)]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-mono text-[13px] font-medium text-foreground">{a.id}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{a.summary}</p>
                </div>
                <SeverityBadge severity={severity} />
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["CVSS", a.cvss ?? "Not available"],
                  ["CVSS vector", a.cvssVector ?? "Not supplied"],
                  ["Exploitation", a.exploited ? "Known, source reported" : "No evidence available"],
                  ["Fixed version", a.fixed ?? "No verified fixed version"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="m-0 mt-0.5 break-words text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              {a.aliases.length > 0 && (
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  Aliases: {a.aliases.join(" · ")}
                </p>
              )}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 text-[11px] font-semibold text-foreground">
                    Advisory sources
                  </h3>
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {a.provenance.map((p) => (
                      <Source key={p.source + p.url} p={p} />
                    ))}
                  </ul>
                  {!!a.affected?.length && (
                    <details className="mt-2 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">Affected version evidence</summary>
                      {a.affected.map((text) => (
                        <p key={text} className="mt-1">
                          {text}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
                <div>
                  <h3 className="mb-1.5 text-[11px] font-semibold text-foreground">
                    Matched installed packages
                  </h3>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {packages.map((n) => (
                      <li key={n.id} className="min-w-0">
                        <code className="block break-all font-mono text-[11px] text-foreground">
                          {n.purl}
                        </code>
                        <ul className="m-0 mt-0.5 grid list-none gap-0.5 p-0">
                          {n.provenance.map((p) => (
                            <Source key={p.source + p.url} p={p} />
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>
          ))}
        </section>
      )}

      <article className="documentation mt-0">
        <h2>From a package to the services it reaches</h2>
        <p>
          A dependency edge means one package depends on another. Ripple follows these edges
          backwards, starting from every installed instance of the selected package version. This
          reveals affected applications, not proof that vulnerable code executes.
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
          Known vulnerabilities rank before packages without findings. Missing CVSS contributes no
          severity points and is labeled unscored. This deterministic score is not an exploitation
          probability.
        </p>
        <h2>What the paths mean</h2>
        <p>
          Solid edges are dependency relationships recorded in a supported snapshot. Dashed edges
          mean a package was listed in a flat or conditional Python snapshot; direct/indirect
          membership is not claimed. npm workspace installations stay distinct from unrelated
          projects. Selected package versions trace across all their installed instances.
        </p>
        <p>
          Up to 200 simple paths are enumerated under a bounded search, with at least one shortest
          path retained for every affected project. A capped result is explicitly labeled “at
          least”. Large graphs render a focused subset while the inventory retains all package
          versions.
        </p>
        <h2>Coverage is part of the answer</h2>
        <p>
          OSV supplies exact-package advisory matches and CVSS vectors. NVD can fill missing numeric
          CVSS. CISA’s Known Exploited Vulnerabilities catalog supplies positive exploitation
          evidence. No EPSS probability is currently queried. Source failures, skipped versions and
          incomplete relationships remain visible.
        </p>
      </article>
    </>
  );
}

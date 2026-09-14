import { useEffect } from "react";
import { FileCode2, FolderGit2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ecosystemLabel } from "../../../shared/facts";
import type { SectionProps } from "../types";
import { Action, Blank, SectionHeader } from "../ui";

export function Applications({
  scan,
  facts,
  investigate,
  focusId,
  onFocus,
  onAsk,
}: SectionProps & {
  focusId: string;
  onFocus: (id: string) => void;
  onAsk: (id: string) => void;
}) {
  useEffect(() => {
    if (focusId)
      document
        .getElementById("application-" + focusId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);
  const skipped = scan.repositoryMap?.projects.filter((p) => !p.selected) ?? [];
  const apps = [...facts.applications].sort(
    (a, b) => b.vulnerable.length - a.vulnerable.length || a.node.name.localeCompare(b.node.name),
  );
  return (
    <>
      <SectionHeader
        title="Applications"
        question="The projects RootLine analyzed in this repository, what each one depends on, and which known vulnerabilities reach it."
      />
      {!apps.length ? (
        <Blank title="No applications were mapped">
          Dependency files were read, but no application project could be identified.
        </Blank>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {apps.map((app) => {
            const p = app.project;
            const worst = [...app.vulnerable]
              .map((n) => ({ n, r: facts.riskFor(n) }))
              .sort((a, b) => (b.r?.score ?? 0) - (a.r?.score ?? 0));
            return (
              <article
                key={app.node.id}
                id={"application-" + app.node.id}
                className={cn(
                  "min-w-0 scroll-mt-24 rounded-[10px] border border-border bg-card p-5 transition-shadow duration-300",
                  focusId === app.node.id && "border-rust/50 shadow-[0_0_0_3px_color-mix(in_oklab,var(--rust)_14%,transparent)]",
                )}
                aria-label={`Application ${app.node.name}`}
                aria-current={focusId === app.node.id ? "true" : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted text-[#476359]">
                      <FolderGit2 size={18} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-[560] text-foreground">{app.node.name}</h2>
                      <code className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">
                        {p ? (p.path === "." ? "Repository root" : p.path) : app.node.purl}
                      </code>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="status-badge demo normal-case">{ecosystemLabel(app.node.ecosystem)}</span>
                    {p && <span className="status-badge demo">{p.role}</span>}
                    {p?.ingestionStatus && (
                      <span
                        className={`status-badge ${p.ingestionStatus === "EXACT" ? "" : "failed"}`}
                      >
                        {p.ingestionStatus === "EXACT"
                          ? "Exact versions"
                          : p.ingestionStatus.replace("_", " ").toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>

                <dl className="my-4 grid grid-cols-3 gap-3 border-y border-border py-3">
                  {[
                    ["Dependencies", app.dependencies.length],
                    ["Declared directly", app.direct],
                    ["Vulnerable", app.vulnerable.length],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[11px] text-muted-foreground">{label}</dt>
                      <dd className="m-0 mt-0.5 text-lg font-[550] tabular-nums text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {worst.length ? (
                  <>
                    <h3 className="mb-2 text-xs font-semibold text-foreground">
                      Vulnerable packages reaching this application
                    </h3>
                    <ul className="m-0 grid list-none gap-1 p-0">
                      {worst.slice(0, 5).map(({ n, r }) => (
                        <li key={n.id}>
                          <button
                            className="flex w-full items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-muted"
                            onClick={() => investigate(n.id)}
                          >
                            <span className="min-w-0 truncate text-xs text-foreground">
                              {n.name}{" "}
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {n.version}
                              </span>
                            </span>
                            {r && (
                              <span className="flex shrink-0 items-center gap-2">
                                <span className={`score-number ${r.level}`}>{r.score}</span>
                                <span className={`risk-badge ${r.level}`}>{r.level}</span>
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {worst.length > 5 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        + {worst.length - 5} more in Risks.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No known vulnerable package reaches this application in the checked
                    dependencies.
                  </p>
                )}

                {p && (
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <FileCode2 size={13} />
                    <span>Manifest: {p.manifest || "not present"}</span>
                    {p.lockfile && <span>Lockfile: {p.lockfile}</span>}
                  </div>
                )}
                {p?.notes.map((note) => (
                  <p key={note} className="mt-2 text-[11px] text-muted-foreground">
                    {note}
                  </p>
                ))}
                <div className="mt-4 flex flex-wrap gap-2">
                  {worst[0] && (
                    <Action text="Trace top risk" onClick={() => investigate(worst[0].n.id, true)} />
                  )}
                  <Action
                    text="Ask OTTER"
                    aria-label={`Ask OTTER about ${app.node.name}`}
                    onClick={() => onAsk(app.node.id)}
                  />
                  {focusId !== app.node.id && (
                    <Action
                      text="Focus"
                      aria-label={`Focus ${app.node.name}`}
                      onClick={() => onFocus(app.node.id)}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {skipped.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-[560] text-foreground">Not analyzed in this scan</h2>
          <ul className="m-0 grid list-none gap-1 p-0 text-xs text-muted-foreground">
            {skipped.map((p) => (
              <li key={p.id}>
                <strong className="font-medium text-foreground">{p.name}</strong> ·{" "}
                <code className="font-mono">{p.path}</code> · deselected before analysis
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

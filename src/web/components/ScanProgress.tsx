import { Check, LoaderCircle } from "lucide-react";
import type { Scan } from "../../shared/types";
const stages = [
  ["discover", "Repository understood"],
  ["map", "Projects confirmed"],
  ["extract", "Dependencies extracted"],
  ["resolve", "Relationships resolved"],
  ["vulnerabilities", "Known vulnerabilities checked"],
  ["risk", "Ripple Priority calculated"],
  ["ripple", "Impact paths prepared"],
] as const;
export function ScanProgress({ scan }: { scan: Scan }) {
  const progress = scan.progress;
  return (
    <section className="journey-progress" aria-live="polite">
      <h2>{progress?.message || "Preparing your scan"}</h2>
      <p>{scan.name} · Your source files are read, never executed.</p>
      {progress?.total !== undefined && (
        <div className="work-count">
          {progress.current || 0} / {progress.total}
        </div>
      )}
      <ol>
        {stages.map(([id, label]) => {
          const done = progress?.completed.includes(id) || scan.status === "completed";
          const current = progress?.stage === id;
          return (
            <li key={id} className={done ? "done" : current ? "current" : ""}>
              {done ? (
                <Check size={16} />
              ) : current ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <span className="stage-dot" />
              )}
              <span>{label}</span>
              {current && <small>In progress</small>}
            </li>
          );
        })}
      </ol>
      <p>Partial results stay visible if a source or project cannot be fully analyzed.</p>
    </section>
  );
}

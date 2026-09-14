import { useState } from "react";
import { FileCode2, GitBranch, LoaderCircle } from "lucide-react";
import type { ScanInput } from "../../../shared/types";
import { Action, SectionHeader } from "../ui";

export function NewScan({
  busy,
  onStart,
  onError,
}: {
  busy: boolean;
  onStart: (input: ScanInput) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"github" | "manifest">("github");
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("HEAD");
  const [filename, setFilename] = useState("package-lock.json");
  const [content, setContent] = useState("");
  return (
    <>
      <SectionHeader
        title="Start with your repository."
        question="RootLine maps the applications in a repository, checks their exact dependencies, and traces how far a vulnerable package reaches."
      />
      <div className="scan-layout mt-0">
        <form
          className="scan-form"
          onSubmit={(e) => {
            e.preventDefault();
            onStart(mode === "github" ? { mode, repository, ref } : { mode, filename, content });
          }}
        >
          <div className="segmented">
            <button
              type="button"
              className={mode === "github" ? "chosen" : ""}
              onClick={() => setMode("github")}
            >
              <GitBranch size={17} />
              GitHub repository
            </button>
            <button
              type="button"
              className={mode === "manifest" ? "chosen" : ""}
              onClick={() => setMode("manifest")}
            >
              <FileCode2 size={17} />
              Dependency file
            </button>
          </div>
          {mode === "github" ? (
            <>
              <label>
                Repository URL
                <input
                  placeholder="https://github.com/owner/repository"
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  required
                />
              </label>
              <label>
                Branch, tag, or commit
                <input value={ref} onChange={(e) => setRef(e.target.value)} required />
              </label>
              <p className="field-help">
                HEAD uses the default branch. Analysis is pinned to the exact commit we discover.
              </p>
            </>
          ) : (
            <>
              <label>
                Dependency file
                <input
                  type="file"
                  accept=".json,.txt,.xml,.toml,.yaml,.lock"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 2_000_000) {
                      onError(
                        "Upload limit is 2 MB. Larger repository files can be read through GitHub.",
                      );
                      return;
                    }
                    setFilename(f.name);
                    setContent(await f.text());
                  }}
                />
              </label>
              <label>
                Filename
                <input value={filename} onChange={(e) => setFilename(e.target.value)} />
              </label>
              <label>
                File content
                <textarea
                  rows={8}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          <div className="mt-2 flex items-center gap-3">
            <Action type="submit" text="Map repository" disabled={busy} />
            {busy && <LoaderCircle className="spin text-muted-foreground" size={16} />}
          </div>
        </form>
        <aside className="scan-notes">
          <h2>
            One dependency.
            <br />A much bigger picture.
          </h2>
          <p>
            We map your projects first. Then we check installed packages and follow their dependency
            paths back to the applications that use them. Source files are read, never executed.
          </p>
          <div className="demo-choice">
            <strong>Try the complete journey</strong>
            <p>
              Explore a commerce repository with four applications. Demo vulnerabilities are
              synthetic and work offline.
            </p>
            <Action text="Explore demo" disabled={busy} onClick={() => onStart({ mode: "demo" })} />
          </div>
        </aside>
      </div>
    </>
  );
}

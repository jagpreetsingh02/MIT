import { useState } from "react";
import { FolderGit2, FileCode2, ArrowRight, AlertTriangle } from "lucide-react";
import type { RepositoryMap as Map, ProjectSelection } from "../../shared/types";
import { Button } from "./ui/Button";
export function RepositoryMap({
  map,
  busy,
  onAnalyze,
}: {
  map: Map;
  busy: boolean;
  onAnalyze: (selection: ProjectSelection[]) => void;
}) {
  const [projects, setProjects] = useState(map.projects);
  const selected = projects.filter((p) => p.selected);
  return (
    <section className="repository-map">
      <div className="map-intro">
        <FolderGit2 size={27} />
        <div>
          <h2>
            We found {projects.length} {projects.length === 1 ? "project" : "projects"} in your
            repository.
          </h2>
          <p>
            Choose what to analyze. Names are display labels; dependency relationships and security
            findings come from the source files.
          </p>
        </div>
      </div>
      <div className="map-actions">
        <span>
          {selected.length} of {projects.length} selected · {map.fileCount} dependency files grouped
        </span>
        <Button
          onClick={() =>
            setProjects((ps) => ps.map((p) => ({ ...p, selected: !ps.every((p) => p.selected) })))
          }
        >
          {projects.every((p) => p.selected) ? "Deselect all" : "Select all"}
        </Button>
      </div>
      <div className="project-list">
        {projects.map((project) => (
          <div key={project.id} className={`project-row ${project.selected ? "included" : ""}`}>
            <input
              type="checkbox"
              aria-label={`Analyze ${project.name}`}
              checked={project.selected}
              onChange={(e) =>
                setProjects((ps) =>
                  ps.map((p) => (p.id === project.id ? { ...p, selected: e.target.checked } : p)),
                )
              }
            />
            <div className="project-main">
              <label className="sr-only" htmlFor={"name-" + project.id}>
                Display name for {project.path}
              </label>
              <input
                id={"name-" + project.id}
                className="project-name"
                aria-label={`Display name for ${project.path}`}
                value={project.name}
                maxLength={100}
                onChange={(e) =>
                  setProjects((ps) =>
                    ps.map((p) => (p.id === project.id ? { ...p, name: e.target.value } : p)),
                  )
                }
              />
              <code>{project.path === "." ? "Repository root" : project.path}</code>
              <div className="project-files">
                <FileCode2 size={13} />
                <span>Manifest: {project.manifest || "not present"}</span>
                {project.lockfile && <span>Lockfile: {project.lockfile}</span>}
              </div>
              {project.packageCount !== undefined && (
                <p className="project-note">
                  Detected dependencies: {project.packageCount} · Exact versions:{" "}
                  {project.exactCount ?? 0} · Unresolved: {project.unresolvedCount ?? 0} · Coverage:{" "}
                  {project.ingestionStatus}
                </p>
              )}
              {project.notes.map((note, i) => (
                <p className="project-note" key={i}>
                  {note}
                </p>
              ))}
            </div>
            <div className="project-tags">
              <span className="ecosystem-label">
                {project.ecosystem === "pypi"
                  ? "Python"
                  : project.ecosystem === "maven"
                    ? "Maven"
                    : "npm"}
              </span>
              <span>{project.role}</span>
              <span
                className={
                  project.resolution === "resolved" ? "resolution-good" : "resolution-partial"
                }
              >
                {project.resolution === "resolved" ? "Lockfile available" : "Partial resolution"}
              </span>
            </div>
          </div>
        ))}
      </div>
      {!projects.length && (
        <div className="empty-state">
          <FolderGit2 size={30} />
          <h3>No supported dependency files</h3>
          <p>Try a repository with package.json, a Python dependency file, or pom.xml.</p>
        </div>
      )}
      {map.warnings.map((w, i) => (
        <p className="coverage-callout" key={i}>
          <AlertTriangle size={15} />
          {w}
        </p>
      ))}
      {projects.length > 0 && (
        <div className="map-confirm">
          <p>
            {selected.length} selected {selected.length === 1 ? "project" : "projects"} will be
            checked at the pinned commit.
          </p>
          <Button
            className="primary"
            disabled={busy || !selected.length || selected.some((p) => !p.name.trim())}
            onClick={() => onAnalyze(selected.map(({ id, name }) => ({ id, name })))}
          >
            Analyze repository <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { entryLabel, versionLabel } from "../../../shared/facts";
import type { SectionProps } from "../types";
import { Action, SectionHeader } from "../ui";

export function Dependencies({ scan, facts, investigate }: SectionProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const rows = (scan.risks ?? []).filter((r) => {
    const n = facts.nodeById.get(r.nodeId);
    return (
      n &&
      n.kind === "package" &&
      n.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "vulnerable" && n.advisories.length > 0) ||
        (filter === "direct" && n.depth !== null && n.depth <= 1) ||
        (filter === "hidden" && n.depth !== null && n.depth > 1) ||
        (filter === "unresolved" && n.versionStatus === "unresolved") ||
        n.ecosystem === filter)
    );
  });
  return (
    <>
      <SectionHeader
        title="Dependencies"
        question="Every exact package version and unresolved declaration RootLine found, including unscored and unchecked dependencies."
      />
      <div className="table-filters">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search dependencies"
            placeholder="Search dependencies…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="filter-select">
          <span className="sr-only">Filter dependencies</span>
          <select
            aria-label="Filter dependencies"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All packages</option>
            <option value="vulnerable">Known findings</option>
            <option value="direct">Direct dependencies</option>
            <option value="hidden">Hidden dependencies</option>
            <option value="unresolved">Unresolved versions</option>
            <option value="npm">npm</option>
            <option value="pypi">Python</option>
            <option value="maven">Maven</option>
          </select>
        </label>
        <span className="self-center text-xs text-muted-foreground">
          {rows.length} of {facts.packages.length} shown
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Package / installed version</th>
              <th>Ripple Priority</th>
              <th>Known findings</th>
              <th>How it enters</th>
              <th>Applications affected</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = facts.nodeById.get(r.nodeId)!;
              const unresolved = n.versionStatus === "unresolved";
              return (
                <tr key={n.id}>
                  <td>
                    <button className="package-link" onClick={() => investigate(n.id)}>
                      <span>
                        <strong>{n.name}</strong>
                        <small>
                          {versionLabel(n)} · {n.ecosystem}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className={`score-number ${r.level}`}>
                      {unresolved ? "Not scored" : r.score}
                    </span>
                    {!unresolved && <span className={`risk-badge ${r.level}`}>{r.level}</span>}
                  </td>
                  <td>
                    {unresolved ? "Not checked" : n.advisories.length}
                    <small className="coverage-label">
                      {n.coverage === "checked"
                        ? "Checked"
                        : n.coverage === "fixture"
                          ? "Demo data"
                          : "Incomplete"}
                    </small>
                  </td>
                  <td>{entryLabel(n)}</td>
                  <td>
                    {r.services.length} of {facts.services.length}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Inspect ${n.name}`}
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
        {!rows.length && (
          <div className="empty-state">
            <p>No matching packages.</p>
            <Action
              text="Clear filters"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

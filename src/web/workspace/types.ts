import type { Scan } from "../../shared/types";
import type { Facts, Severity } from "../../shared/facts";

export const ANALYSIS_VIEWS = [
  "overview",
  "risks",
  "applications",
  "dependencies",
  "vulnerabilities",
  "graph",
  "coverage",
  "evidence",
] as const;
export type AnalysisView = (typeof ANALYSIS_VIEWS)[number];
export type View = AnalysisView | "new" | "history";

const aliases: Record<string, View> = {
  inventory: "dependencies",
  scans: "history",
  connectors: "coverage",
  methodology: "evidence",
  ripple: "graph",
};

export function viewFromHash(): View {
  const hash = location.hash.slice(1);
  if (aliases[hash]) return aliases[hash];
  return [...ANALYSIS_VIEWS, "new", "history"].includes(hash as View) ? (hash as View) : "overview";
}

export interface SectionProps {
  scan: Scan;
  facts: Facts;
  go: (view: View) => void;
  investigate: (nodeId: string, trace?: boolean) => void;
  showSeverity: (severity: Severity | "all") => void;
}

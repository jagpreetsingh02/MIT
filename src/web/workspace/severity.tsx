import { CircleAlert, CircleHelp, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { Severity } from "../../shared/facts";

export const SEVERITY_META: Record<
  Severity,
  { label: string; color: string; Icon: typeof OctagonAlert }
> = {
  critical: { label: "Critical", color: "#d03b3b", Icon: OctagonAlert },
  high: { label: "High", color: "#ec835a", Icon: TriangleAlert },
  medium: { label: "Medium", color: "#fab219", Icon: CircleAlert },
  low: { label: "Low", color: "#6f8f9c", Icon: Info },
  unscored: { label: "Unscored", color: "#b6c0c8", Icon: CircleHelp },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, color, Icon } = SEVERITY_META[severity];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-foreground">
      <Icon size={13} style={{ color }} aria-hidden="true" />
      {label}
    </span>
  );
}

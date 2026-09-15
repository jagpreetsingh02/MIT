import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Bar {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: ReactNode;
  note?: string;
}

function share(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

export function BarList({
  bars,
  unit,
  onSelect,
  empty,
}: {
  bars: Bar[];
  unit: string;
  onSelect?: (key: string) => void;
  empty: string;
}) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  const total = bars.reduce((sum, b) => sum + b.value, 0);
  if (!total) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {bars.map((bar) => {
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
              {bar.icon}
              <span className="truncate">{bar.label}</span>
            </span>
            <span className="relative h-2.5 min-w-0 overflow-hidden rounded-[4px] bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-[4px] transition-[width] duration-500"
                style={{
                  width: `${max ? Math.max((bar.value / max) * 100, bar.value ? 2 : 0) : 0}%`,
                  background: bar.color,
                }}
              />
            </span>
            <span className="text-right text-xs tabular-nums text-foreground">{bar.value}</span>
            <span
              role="tooltip"
              className="pointer-events-none absolute -top-8 left-1/3 z-20 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow-md group-hover:block group-focus-visible:block"
            >
              {bar.label}: {bar.value} {unit} · {share(bar.value, total)}%
              {bar.note ? ` · ${bar.note}` : ""}
            </span>
          </>
        );
        const row =
          "group relative grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-md px-2 py-1.5 text-left";
        return (
          <li key={bar.key}>
            {onSelect ? (
              <button
                type="button"
                className={cn(row, "border-0 bg-transparent hover:bg-muted")}
                onClick={() => onSelect(bar.key)}
                aria-label={`${bar.label}: ${bar.value} ${unit}`}
              >
                {body}
              </button>
            ) : (
              <div className={cn(row, "hover:bg-muted")}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Meter({ segments, unit }: { segments: Bar[]; unit: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div>
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px] bg-muted"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value} ${unit}`).join(", ")}
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.key}
              title={`${s.label}: ${s.value} ${unit} · ${share(s.value, total)}%`}
              className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            />
          ))}
      </div>
      <ul className="m-0 mt-3 grid list-none gap-1.5 p-0">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-xs text-foreground">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1">{s.label}</span>
            <span className="tabular-nums">{s.value}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">
              {share(s.value, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

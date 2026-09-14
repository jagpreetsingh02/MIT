import { cn } from "@/lib/utils";

export function OtterMark({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)}>
      {active && (
        <span className="otter-rings pointer-events-none absolute inset-0" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border border-rust/50" />
          <span className="absolute inset-0 rounded-full border border-rust/40" />
        </span>
      )}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-full">
        <circle cx="12" cy="12" r="10.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M6.2 13.6c1.9-1.7 3.9-1.7 5.8 0s3.9 1.7 5.8 0"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M8 9.6c1.3-1.1 2.7-1.1 4 0s2.7 1.1 4 0"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
    </span>
  );
}

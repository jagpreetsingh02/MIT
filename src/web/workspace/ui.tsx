import type { ButtonHTMLAttributes, ReactNode } from "react";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { cn } from "@/lib/utils";

export function Action({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { text: string }) {
  return (
    <InteractiveHoverButton
      className={cn(
        "w-auto min-w-28 shrink-0 whitespace-nowrap border-border py-2 pl-8 pr-5 text-xs text-foreground [&_svg]:size-4 [&>div:last-child]:left-3.5 group-hover:[&>div:last-child]:left-0",
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeader({
  title,
  question,
  children,
}: {
  title: string;
  question: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-[570] leading-tight tracking-[-0.8px] text-foreground">
          {title}
        </h1>
        <p className="mt-1.5 max-w-[70ch] text-[13px] text-muted-foreground">{question}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  children,
  className,
  actions,
  id,
}: {
  id?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section id={id} className={cn("min-w-0 rounded-[10px] border border-border bg-card p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-[560] text-foreground">{title}</h2>}
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-card px-5 py-4">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <strong className="mt-1.5 block text-[26px] font-[550] tabular-nums tracking-[-0.7px] text-foreground">
        {value}
      </strong>
      {detail && <span className="mt-0.5 block text-[11px] text-muted-foreground">{detail}</span>}
    </div>
  );
}

export function Blank({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed border-border bg-card px-6 py-10 text-center">
      <h2 className="text-lg font-[550] text-foreground">{title}</h2>
      {children && <p className="max-w-[60ch] text-[13px] text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

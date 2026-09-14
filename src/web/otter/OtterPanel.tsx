import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, X } from "lucide-react";
import type { Facts, FindingRow } from "../../shared/facts";
import type { OtterAction, OtterScope, Scan } from "../../shared/types";
import { type PromptMode, PromptInput } from "@/components/ui/ai-chat-input";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "../workspace/api";
import { SeverityBadge } from "../workspace/severity";
import { Action } from "../workspace/ui";
import { Markdown } from "./Markdown";
import { OtterMark } from "./OtterMark";
import { FOCUSED_SUGGESTIONS } from "./suggestions";
import { GLOBAL_KEY, type Otter, type OtterThread, type OtterTurn } from "./useOtter";
import { VulnerabilityBrief } from "./VulnerabilityBrief";

const MODES: PromptMode[] = [
  { id: "auto", label: "Auto", level: 2, description: "OTTER picks the right depth for each question." },
  { id: "fast", label: "Fast", level: 1, description: "Quick answers and navigation." },
  { id: "deep", label: "Deep", level: 3, description: "Slower, more thorough explanations." },
];

export interface BriefHandlers {
  row: FindingRow;
  onTrace: () => void;
  onEvidence: () => void;
  onApplication: (id: string) => void;
  onClose: () => void;
  onAsk: () => void;
}

function Thinking({ focused }: { focused: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1" role="status">
      <OtterMark active className="size-6 text-rust" />
      <span className="text-[12px] text-muted-foreground">
        {focused ? "OTTER is reading this finding's evidence" : "OTTER is reading RootLine's facts"}
      </span>
      <span className="otter-thinking flex items-end gap-0.5" aria-hidden="true">
        <i className="block size-1 rounded-full bg-rust" />
        <i className="block size-1 rounded-full bg-rust" />
        <i className="block size-1 rounded-full bg-rust" />
      </span>
    </div>
  );
}

export function OtterPanel({
  otter,
  scan,
  facts,
  brief,
  seeing,
  globalScope,
  globalSuggestions,
  onAction,
  onClose,
}: {
  otter: Otter;
  scan: Scan;
  facts: Facts;
  brief: BriefHandlers | null;
  seeing: string;
  globalScope: () => OtterScope;
  globalSuggestions: string[];
  onAction: (action: OtterAction) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; size: number }[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const thread = otter.active;
  const focused = thread.kind === "vulnerability";
  const pending = Boolean(otter.pending[thread.key]);
  const demo = scan.mode === "demo";
  const status = otter.status;
  const unavailable = status && (!status.configured || !status.modes.auto);
  const { refreshStatus } = otter;

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [thread.turns.length, pending, thread.key]);

  useEffect(() => {
    setVoiceError("");
  }, [thread.key]);

  function ripple(origin?: HTMLElement) {
    const panel = panelRef.current;
    if (!panel || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const p = panel.getBoundingClientRect();
    const o = origin?.getBoundingClientRect();
    const x = o ? o.left + o.width / 2 - p.left : p.width / 2;
    const y = o ? o.top + o.height / 2 - p.top : p.height / 2;
    const size = 2.2 * Math.hypot(Math.max(x, p.width - x), Math.max(y, p.height - y));
    setRipples((r) => [...r, { id: Date.now(), x, y, size }]);
  }

  function scopeFor(t: OtterThread): OtterScope {
    return t.kind === "vulnerability"
      ? { kind: "vulnerability", advisoryId: t.advisoryId!, nodeId: t.nodeId! }
      : globalScope();
  }

  function ask(text: string) {
    const question = text.trim();
    if (!question) return;
    otter.send(thread.key, question, scopeFor(thread), focused ? thread.subtitle : seeing);
  }

  function switchTo(key: string, origin?: HTMLElement) {
    if (key === thread.key) return;
    ripple(origin);
    otter.setActiveKey(key);
  }

  const suggestions = focused ? FOCUSED_SUGGESTIONS : globalSuggestions;

  function renderTurn(turn: OtterTurn) {
    if (turn.role === "user")
      return (
        <div key={turn.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300">
          <p className="m-0 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground">
            {turn.content}
          </p>
        </div>
      );
    return (
      <article
        key={turn.id}
        aria-label="OTTER reply"
        className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-500"
      >
        <OtterMark className={cn("mt-0.5 size-6", turn.failed ? "text-[#b3261e]" : "text-rust")} />
        <div className="min-w-0 flex-1">
          {turn.failed ? (
            <div role="alert" className="rounded-lg border border-[#efcdbd] bg-[#fff0eb] px-3 py-2 text-[12px] text-[#983d24]">
              <p className="m-0 font-medium">OTTER couldn't answer.</p>
              <p className="m-0 mt-0.5">{turn.content}</p>
              <Action
                text="Retry"
                className="mt-2 bg-card"
                disabled={pending}
                onClick={() => otter.retry(thread.key, turn.id, scopeFor(thread), turn.seeing ?? seeing)}
              />
            </div>
          ) : (
            <>
              <div
                className={cn(
                  turn.outOfScope && "rounded-lg border border-rust/30 bg-[#fffaf5] px-3 py-2",
                  turn.withheld && "rounded-lg border border-[#e7d8be] bg-[#fffaf0] px-3 py-2",
                )}
              >
                <Markdown text={turn.content} />
              </div>
              {turn.outOfScope && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Action text="Continue this investigation" onClick={() => inputRef.current?.focus()} />
                  <Action
                    text="Ask in global OTTER"
                    onClick={(e) => {
                      if (turn.question) otter.setDraft(GLOBAL_KEY, turn.question);
                      switchTo(GLOBAL_KEY, e.currentTarget);
                    }}
                  />
                </div>
              )}
              {!!turn.actions?.length && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {turn.actions.map((action) => (
                    <Action key={action.label} text={action.label} onClick={() => onAction(action)} />
                  ))}
                </div>
              )}
              {turn.demo && !turn.outOfScope && (
                <p className="m-0 mt-1.5 text-[10px] uppercase tracking-[0.8px] text-muted-foreground">
                  Based on synthetic demo data
                </p>
              )}
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <>
      <button
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 z-40 border-0 bg-black/25 md:hidden"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        aria-label="OTTER"
        className="otter-panel fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl md:inset-x-auto md:right-0 md:top-0 md:h-auto md:w-[420px] md:rounded-none md:border-l md:border-t-0 lg:shadow-[0_0_0_1px_var(--border)]"
      >
        {ripples.map((r) => (
          <span
            key={r.id}
            className="otter-ripple"
            style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
            onAnimationEnd={() => setRipples((all) => all.filter((x) => x.id !== r.id))}
          />
        ))}

        {brief ? (
          <div key={`brief-${brief.row.key}`} className="flex h-full min-h-0 flex-col animate-in fade-in duration-300">
            <VulnerabilityBrief
              scan={scan}
              facts={facts}
              row={brief.row}
              onTrace={brief.onTrace}
              onEvidence={brief.onEvidence}
              onApplication={brief.onApplication}
              onClose={brief.onClose}
              onAsk={(origin) => {
                ripple(origin);
                brief.onAsk();
              }}
            />
          </div>
        ) : (
          <section className="flex h-full min-h-0 flex-col" aria-label={focused ? "Focused OTTER conversation" : "Global OTTER conversation"}>
            <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              {focused && (
                <button
                  className="icon-button"
                  aria-label="Back to global OTTER"
                  onClick={(e) => switchTo(GLOBAL_KEY, e.currentTarget)}
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <OtterMark active={pending} className="size-7 text-rust" />
              <div className="min-w-0 flex-1">
                <strong className="block text-[14px] font-semibold tracking-[0.4px] text-foreground">
                  OTTER
                </strong>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {focused ? "Focused investigation" : "Explains and navigates this RootLine scan"}
                </span>
              </div>
              {demo && <span className="status-badge demo">Demo data</span>}
              <button className="icon-button" aria-label="Close OTTER" onClick={onClose}>
                <X size={18} />
              </button>
            </header>

            {otter.branches.length > 0 && (
              <nav
                aria-label="OTTER conversations"
                className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2"
              >
                <button
                  aria-pressed={!focused}
                  onClick={(e) => switchTo(GLOBAL_KEY, e.currentTarget)}
                  className={cn(
                    "shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    !focused
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  Global
                </button>
                {otter.branches.map((b) => (
                  <span
                    key={b.key}
                    className={cn(
                      "flex shrink-0 items-center rounded-full border text-[11px]",
                      b.key === thread.key
                        ? "border-rust bg-accent text-accent-foreground"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    <button
                      aria-pressed={b.key === thread.key}
                      aria-label={`Open focused investigation ${b.advisoryId} in ${b.subtitle}`}
                      onClick={(e) => switchTo(b.key, e.currentTarget)}
                      className="cursor-pointer border-0 bg-transparent py-1 pl-2.5 pr-1 font-mono text-inherit"
                    >
                      {b.advisoryId}
                    </button>
                    <button
                      aria-label={`Close focused investigation ${b.advisoryId}`}
                      onClick={() => otter.closeBranch(b.key)}
                      className="mr-1 grid size-4 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-inherit hover:bg-black/10"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </nav>
            )}

            <div key={thread.key} className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
              {focused ? (
                <div className="mx-4 mt-3 rounded-lg border border-rust/30 bg-[#fffaf5] px-3 py-2.5" aria-label="Investigation focus">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[1.2px] text-rust">
                      Focused investigation
                    </span>
                    {thread.severity && <SeverityBadge severity={thread.severity} />}
                  </div>
                  <strong className="mt-1 block break-all font-mono text-[14px] font-medium text-foreground">
                    {thread.advisoryId}
                  </strong>
                  <span className="block break-all font-mono text-[12px] text-muted-foreground">{thread.subtitle}</span>
                  <p className="m-0 mt-1.5 text-[11px] text-muted-foreground">
                    Only this finding's RootLine facts are shared with OTTER.
                  </p>
                </div>
              ) : (
                <p className="m-0 px-4 pt-2.5 text-[11px] text-muted-foreground" aria-live="polite">
                  OTTER sees: <span className="text-foreground">{seeing}</span>
                </p>
              )}

              {unavailable && (
                <p role="alert" className="mx-4 mt-3 flex gap-2 rounded-lg border border-[#e7d8be] bg-[#fffaf0] px-3 py-2 text-[12px] text-[#805d2c]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {status.message ?? "OTTER is unavailable right now."}
                </p>
              )}

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-4" aria-live="polite">
                  {!thread.turns.length && (
                    <div className="grid gap-2 pt-2">
                      <OtterMark className="size-9 text-rust" />
                      <h2 className="m-0 text-[15px] font-semibold text-foreground">
                        {focused ? `Let's look at ${thread.advisoryId}.` : "Ask OTTER about this scan."}
                      </h2>
                      <p className="m-0 text-[12px] leading-relaxed text-muted-foreground">
                        {focused
                          ? "Ask why it matters, how it enters your applications, or what the evidence says. Answers use only this finding's RootLine data."
                          : "OTTER explains RootLine's findings in plain language and can take you to the right screen. It never decides what is vulnerable; RootLine's analysis does."}
                      </p>
                    </div>
                  )}
                  {thread.turns.map(renderTurn)}
                  {pending && <Thinking focused={focused} />}
                </div>
              </div>

              <div className="shrink-0 border-t border-border bg-card px-3 pb-3 pt-2">
                {!pending && (
                  <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Suggested questions">
                    {suggestions.slice(0, thread.turns.length ? 4 : 10).map((s) => (
                      <button
                        key={s}
                        disabled={Boolean(unavailable)}
                        onClick={() => ask(s)}
                        className="shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-rust/40 hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {voiceError && (
                  <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-[#efcdbd] bg-[#fff0eb] px-3 py-2 text-[12px] text-[#983d24]">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span className="flex-1">{voiceError}</span>
                    <button className="icon-button" aria-label="Dismiss voice error" onClick={() => setVoiceError("")}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <PromptInput
                  ref={inputRef}
                  value={otter.drafts[thread.key] ?? ""}
                  onChange={(v) => otter.setDraft(thread.key, v)}
                  onSubmit={ask}
                  placeholder={focused ? `Ask about ${thread.advisoryId}…` : "Ask OTTER about this scan…"}
                  modes={MODES.filter((m) => !status || status.modes[m.id as "auto"] !== false || !status.configured)}
                  mode={otter.mode}
                  onModeChange={(m) => otter.setMode(m as "auto")}
                  disabled={Boolean(unavailable)}
                  sending={pending}
                  voice={{
                    enabled: Boolean(status?.transcription),
                    transcribe: transcribeAudio,
                    onError: setVoiceError,
                    onStateChange: (state) => state !== "idle" && setVoiceError(""),
                  }}
                />
                <p className="m-0 mt-1.5 text-center text-[10px] text-muted-foreground">
                  OTTER explains RootLine data. Security facts come from the scan, not the model.
                </p>
              </div>
            </div>
          </section>
        )}
      </aside>
    </>
  );
}

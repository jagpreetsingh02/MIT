import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SPRING = "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
const MIN_HEIGHT = 44;
const MAX_HEIGHT = 160;
const MAX_RECORDING_MS = 60_000;

function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = useState<number | "auto">("auto");
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (spanRef.current) setWidth(spanRef.current.offsetWidth);
  }, [text]);

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
      style={{ width }}
    >
      <span ref={spanRef} className="invisible whitespace-nowrap px-1">
        {text}
      </span>
      <span
        key={text}
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300"
      >
        {text}
      </span>
    </span>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.75" />
      <path d="M12 7a5 5 0 0 0-5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function DynamicBarsIcon({ level }: { level: number }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="8" width="2.5" height="4.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={1} />
      <rect x="5.75" y="5" width="2.5" height="7.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={level >= 2 ? 1 : 0.3} />
      <rect x="10" y="2" width="2.5" height="10.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={level >= 3 ? 1 : 0.3} />
    </svg>
  );
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

function microphoneError(error: unknown) {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone permission was denied. Allow microphone access for this site in your browser settings to use voice input.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect a microphone and try again.";
  if (name === "NotReadableError")
    return "The microphone is in use by another application or could not be started.";
  return "The microphone could not be started.";
}

export interface PromptMode {
  id: string;
  label: string;
  level: number;
  description: string;
}

export type VoiceState = "idle" | "requesting" | "recording" | "transcribing";

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  className?: string;
  modes?: PromptMode[];
  mode?: string;
  onModeChange?: (mode: string) => void;
  disabled?: boolean;
  sending?: boolean;
  voice?: {
    enabled: boolean;
    transcribe: (audio: Blob) => Promise<string>;
    onError: (message: string) => void;
    onStateChange?: (state: VoiceState) => void;
  };
}

export const PromptInput = React.forwardRef<HTMLTextAreaElement, PromptInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      placeholder = "Ask anything",
      className,
      modes = [],
      mode,
      onModeChange,
      disabled = false,
      sending = false,
      voice,
    },
    ref,
  ) => {
    const [voiceState, setVoiceStateRaw] = useState<VoiceState>("idle");
    const [audioData, setAudioData] = useState<number[]>(new Array(5).fill(0));
    const [textareaHeight, setTextareaHeight] = useState(MIN_HEIGHT);
    const [isScrolling, setIsScrolling] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const topFadeRef = useRef<HTMLDivElement>(null);
    const bottomFadeRef = useRef<HTMLDivElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const timerRef = useRef<number | null>(null);
    const valueRef = useRef(value);
    const voiceRef = useRef(voice);
    valueRef.current = value;
    voiceRef.current = voice;

    const setVoiceState = useCallback((state: VoiceState) => {
      setVoiceStateRaw(state);
      voiceRef.current?.onStateChange?.(state);
    }, []);

    const hasValue = value.trim() !== "";
    const recording = voiceState === "recording";
    const busyVoice = voiceState === "requesting" || voiceState === "transcribing";

    const updateFades = () => {
      const el = textareaRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (topFadeRef.current) topFadeRef.current.style.opacity = Math.min(scrollTop / 20, 1).toString();
      if (bottomFadeRef.current) {
        const bottomScroll = scrollHeight - clientHeight - scrollTop;
        bottomFadeRef.current.style.opacity = Math.min(Math.max(bottomScroll - 16, 0) / 10, 1).toString();
      }
    };

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "0px";
      const scrollHeight = el.scrollHeight;
      const next = Math.max(MIN_HEIGHT, Math.min(scrollHeight, MAX_HEIGHT));
      el.style.height = `${next}px`;
      setTextareaHeight(next);
      setIsScrolling(scrollHeight > MAX_HEIGHT);
      setTimeout(updateFades, 0);
    }, [value]);

    const releaseAudio = useCallback(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
      setAudioData(new Array(5).fill(0));
    }, []);

    useEffect(
      () => () => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
          recorder.onstop = null;
          recorder.stop();
        }
        releaseAudio();
      },
      [releaseAudio],
    );

    const stopRecording = useCallback(() => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    }, []);

    const startRecording = useCallback(async () => {
      const handlers = voiceRef.current;
      if (!handlers) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        handlers.onError("Voice input is not supported in this browser.");
        return;
      }
      setVoiceState("requesting");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        setVoiceState("idle");
        handlers.onError(microphoneError(error));
        return;
      }
      streamRef.current = stream;

      let recorder: MediaRecorder;
      try {
        const mimeType = pickMimeType();
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        releaseAudio();
        setVoiceState("idle");
        handlers.onError("Recording could not start in this browser.");
        return;
      }
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        failed = true;
        handlers.onError("Recording failed. Try again.");
      };
      recorder.onstop = async () => {
        releaseAudio();
        recorderRef.current = null;
        if (failed) {
          setVoiceState("idle");
          return;
        }
        const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (audio.size < 1000) {
          setVoiceState("idle");
          handlers.onError("The recording was too short. Hold the microphone button a little longer.");
          return;
        }
        setVoiceState("transcribing");
        try {
          const text = (await voiceRef.current!.transcribe(audio)).trim();
          const current = valueRef.current.trim();
          onChange(current ? `${current} ${text}` : text);
          setTimeout(() => textareaRef.current?.focus(), 0);
        } catch (error) {
          voiceRef.current?.onError(
            error instanceof Error && error.message
              ? `Transcription failed: ${error.message}`
              : "Transcription failed. Try again or type your question.",
          );
        } finally {
          setVoiceState("idle");
        }
      };

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const context = new AudioCtx();
        audioContextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 64;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const draw = () => {
          analyser.getByteFrequencyData(data);
          const step = Math.max(1, Math.floor(data.length / 5));
          setAudioData(
            Array.from({ length: 5 }, (_, i) => {
              let sum = 0;
              for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
              return sum / step / 255;
            }),
          );
          rafRef.current = requestAnimationFrame(draw);
        };
        draw();
      } catch {
        // The level meter is decorative; recording continues without it.
      }

      recorder.start();
      setVoiceState("recording");
      timerRef.current = window.setTimeout(stopRecording, MAX_RECORDING_MS);
    }, [onChange, releaseAudio, setVoiceState, stopRecording]);

    const submit = () => {
      if (!hasValue || disabled || sending || voiceState !== "idle") return;
      onSubmit(value.trim());
    };

    const cycleMode = () => {
      if (!modes.length || !onModeChange) return;
      const index = modes.findIndex((m) => m.id === mode);
      onModeChange(modes[(index + 1) % modes.length].id);
    };

    const showStop = recording;
    const showSpinner = busyVoice || (sending && !recording);
    const showArrow = !showStop && !showSpinner && (hasValue || !voice?.enabled);
    const showMic = !showStop && !showSpinner && !showArrow;
    const currentMode = modes.find((m) => m.id === mode);

    const onAction = (event: React.MouseEvent) => {
      event.preventDefault();
      if (recording) stopRecording();
      else if (showArrow) submit();
      else if (showMic) void startRecording();
    };

    const actionLabel = showStop
      ? "Stop recording"
      : voiceState === "transcribing"
        ? "Transcribing recording"
        : voiceState === "requesting"
          ? "Waiting for microphone permission"
          : sending
            ? "OTTER is answering"
            : showArrow
              ? "Send message"
              : "Record a voice question";

    return (
      <div
        className={cn(
          "relative w-full rounded-[22px] border border-border bg-card shadow-sm transition-[border-color,box-shadow] duration-300 focus-within:border-ring/40 focus-within:ring-1 focus-within:ring-ring/20",
          className,
        )}
        style={{ height: textareaHeight + 44, transition: `height 0.25s ${SPRING}, border-color .3s, box-shadow .3s` }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .prompt-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; background: transparent; }
              .prompt-scrollbar::-webkit-scrollbar-track { background: transparent; }
              .prompt-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
              .prompt-scrollbar:hover::-webkit-scrollbar-thumb { background: color-mix(in oklab, var(--muted-foreground) 30%, transparent); }
            `,
          }}
        />
        <textarea
          ref={(node) => {
            textareaRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={updateFades}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            voiceState === "recording"
              ? "Listening… press stop when you finish"
              : voiceState === "transcribing"
                ? "Transcribing your recording…"
                : voiceState === "requesting"
                  ? "Waiting for microphone permission…"
                  : placeholder
          }
          aria-label="Message OTTER"
          disabled={disabled || voiceState !== "idle"}
          rows={1}
          className={cn(
            "prompt-scrollbar absolute inset-x-0 top-0 z-[1] w-full resize-none border-0 bg-transparent py-3 pl-4 pr-12 text-sm leading-[21px] text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed",
            isScrolling ? "overflow-y-auto" : "overflow-y-hidden",
          )}
          style={{ transition: `height 0.25s ${SPRING}` }}
        />

        <div
          ref={topFadeRef}
          className="pointer-events-none absolute left-4 right-12 top-0 z-[2] h-6 rounded-t-[22px] bg-gradient-to-b from-card via-card/90 to-transparent"
          style={{ opacity: 0 }}
        />
        <div
          ref={bottomFadeRef}
          className="pointer-events-none absolute left-4 right-12 z-[2] h-6 bg-gradient-to-t from-card via-card/90 to-transparent"
          style={{ opacity: 0, top: `${textareaHeight - 24}px`, transition: `top 0.25s ${SPRING}` }}
        />

        <div
          className={cn(
            "absolute bottom-2 left-2.5 right-12 z-[10] flex items-center gap-1 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
            recording ? "pointer-events-none translate-y-2 opacity-0 blur-sm" : "translate-y-0 opacity-100 blur-0",
          )}
        >
          {currentMode && onModeChange && modes.length > 1 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cycleMode}
              title={currentMode.description}
              aria-label={`Answer mode: ${currentMode.label}. ${currentMode.description} Click to change.`}
              className="group flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2 py-1 text-foreground/55 outline-none transition-all duration-200 hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <DynamicBarsIcon level={currentMode.level} />
              <span className="select-none text-xs font-semibold">
                <MorphingText text={currentMode.label} />
              </span>
            </button>
          )}
          {voiceState === "transcribing" && (
            <span className="ml-1 text-[11px] text-muted-foreground" aria-live="polite">
              Transcribing…
            </span>
          )}
        </div>

        <div
          aria-hidden="true"
          className={cn(
            "absolute bottom-2 right-12 z-[10] flex h-8 items-center justify-end gap-[3px] transition-all duration-400 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
            recording ? "w-16 translate-x-0 opacity-100" : "pointer-events-none w-0 translate-x-4 opacity-0",
          )}
        >
          {audioData.map((level, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-rust transition-[height] duration-75 ease-out"
              style={{ height: `${Math.max(4, level * 24)}px` }}
            />
          ))}
        </div>
        {recording && (
          <span className="sr-only" role="status">
            Recording. Press stop recording when you finish speaking.
          </span>
        )}

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onAction}
          disabled={disabled || showSpinner || (showArrow && !hasValue)}
          aria-label={actionLabel}
          title={actionLabel}
          className={cn(
            "absolute bottom-2 right-2 z-[10] flex size-8 cursor-pointer items-center justify-center rounded-full border-0 text-primary-foreground outline-none transition-all duration-300 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
            recording ? "bg-rust" : "bg-primary",
          )}
        >
          <span className="relative flex h-full w-full items-center justify-center">
            <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]", showArrow ? "rotate-0 scale-100 opacity-100 blur-none" : "pointer-events-none rotate-45 scale-50 opacity-0 blur-[1px]")}>
              <ArrowUpIcon />
            </span>
            <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]", showMic ? "rotate-0 scale-100 opacity-100 blur-none" : "pointer-events-none -rotate-45 scale-50 opacity-0 blur-[1px]")}>
              <MicIcon />
            </span>
            <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]", showStop ? "rotate-0 scale-100 opacity-100 blur-none" : "pointer-events-none rotate-45 scale-50 opacity-0 blur-[1px]")}>
              <StopIcon />
            </span>
            <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300", showSpinner ? "scale-100 opacity-100" : "pointer-events-none scale-50 opacity-0")}>
              <SpinnerIcon />
            </span>
          </span>
        </button>
      </div>
    );
  },
);

PromptInput.displayName = "PromptInput";

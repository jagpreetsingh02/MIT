import type { OtterMode } from "../../shared/types.js";

export type Tier = "fast" | "balanced" | "deep";
interface ModelChoice {
  id: string;
  reasoning?: "low" | "medium" | "high";
  /** Supports Groq Structured Outputs strict mode (constrained decoding). */
  strict?: boolean;
}

// Ordered preferences; only models the key can currently use are ever selected.
const CHAT_MODELS: Record<Tier, ModelChoice[]> = {
  fast: [
    { id: "openai/gpt-oss-20b", reasoning: "low", strict: true },
    { id: "llama-3.1-8b-instant" },
  ],
  balanced: [
    { id: "openai/gpt-oss-120b", reasoning: "low", strict: true },
    { id: "llama-3.3-70b-versatile" },
    { id: "openai/gpt-oss-20b", reasoning: "medium", strict: true },
  ],
  deep: [
    { id: "openai/gpt-oss-120b", reasoning: "high", strict: true },
    { id: "llama-3.3-70b-versatile" },
  ],
};
const TRANSCRIPTION_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const MODEL_TTL = 10 * 60_000;
const MAX_CHAT_ATTEMPTS = 3;
const MAX_RATE_LIMIT_WAIT_MS = 6_000;

export class OtterError extends Error {
  constructor(
    message: string,
    public statusCode = 502,
    /** A different model (or one more try) may succeed: malformed JSON, rate limit, upstream 5xx. */
    public retryable = false,
    /** Groq's suggested wait before retrying a rate-limited request. */
    public retryAfterMs?: number,
    /** Model output Groq rejected as invalid JSON. Used only to salvage a reply; never logged. */
    public failedGeneration?: string,
  ) {
    super(message);
  }
}

function baseUrl() {
  const override = process.env.GROQ_BASE_URL;
  if (override && process.env.NODE_ENV === "test") {
    const url = new URL(override);
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return url.origin;
  }
  return "https://api.groq.com";
}

export interface UpstreamDiagnostic {
  status: number;
  type?: string;
  code?: string;
  message?: string;
  retryAfterMs?: number;
  /** For json_validate_failed: whether the rejected output still contained a usable reply. */
  salvageable?: boolean;
  model?: string;
  tier?: Tier;
  what: string;
}
export type DiagnosticLogger = (diagnostic: UpstreamDiagnostic, msg: string) => void;

// Only Groq's own error type/code and a scrubbed, truncated message are kept. Groq's
// `failed_generation` (model output that may echo scan data or user content) is never read.
export function sanitizeUpstreamMessage(message: unknown) {
  if (typeof message !== "string") return undefined;
  const key = process.env.GROQ_API_KEY;
  return (key ? message.split(key).join("[redacted]") : message)
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/org_[A-Za-z0-9]+/g, "org_[redacted]")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function retryAfter(response: Response, message?: string) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);
  const hinted = message?.match(/try again in ([\d.]+)(ms|s)\b/i);
  if (hinted) return Math.ceil(Number(hinted[1]) * (hinted[2].toLowerCase() === "ms" ? 1 : 1000));
  return undefined;
}

async function readUpstreamError(response: Response) {
  let error: any;
  try {
    error = JSON.parse((await response.text()).slice(0, 100_000))?.error;
  } catch {}
  const message = sanitizeUpstreamMessage(error?.message);
  return {
    detail: {
      type: typeof error?.type === "string" ? error.type.slice(0, 80) : undefined,
      code: typeof error?.code === "string" ? error.code.slice(0, 80) : undefined,
      message,
      retryAfterMs: response.status === 429 ? retryAfter(response, message) : undefined,
    },
    failedGeneration:
      typeof error?.failed_generation === "string" ? error.failed_generation : undefined,
  };
}

/** Recovers a reply object from output Groq rejected, when it is complete, valid JSON with an answer. */
function salvageReply(failedGeneration?: string) {
  const match = failedGeneration?.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed?.answer === "string" && parsed.answer.trim()
      ? JSON.stringify(parsed)
      : undefined;
  } catch {
    return undefined;
  }
}

function upstreamError(status: number, what: string, code?: string) {
  if (status === 401 || status === 403)
    return new OtterError("Groq rejected the server's OTTER credentials.", 502);
  if (status === 429)
    return new OtterError("Groq's rate limit was reached. Try again shortly.", 429, true);
  if (status === 413)
    return what === "transcription"
      ? new OtterError("The recording is too large to transcribe.", 413)
      : new OtterError("Groq's rate limit was reached. Try again shortly.", 429, true);
  if (code === "json_validate_failed")
    return new OtterError("OTTER's answer came back malformed. Try asking again.", 502, true);
  if (status >= 500)
    return new OtterError("Groq is temporarily unavailable. Try again shortly.", 503, true);
  return new OtterError(`Groq could not complete the ${what} request.`, 502);
}

async function readJson(response: Response, limit = 1_000_000): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new OtterError("Groq returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new OtterError("Groq's response was too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OtterError("Groq returned an unreadable response.");
  }
}

export class GroqClient {
  private models?: { ids: Set<string>; expires: number };

  constructor(
    private fetcher: typeof fetch = fetch,
    public log: DiagnosticLogger = (diagnostic, msg) =>
      console.warn(JSON.stringify({ level: "warn", msg, groq: diagnostic })),
  ) {}

  get configured() {
    return Boolean(process.env.GROQ_API_KEY);
  }

  private async request(
    path: string,
    init: RequestInit,
    timeout: number,
    what: string,
    meta: { model?: string; tier?: Tier } = {},
  ) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new OtterError("OTTER is not configured on this server.", 503);
    let response: Response;
    try {
      response = await this.fetcher(baseUrl() + path, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const timedOut = (error as Error)?.name === "TimeoutError";
      this.log(
        { status: 0, code: timedOut ? "timeout" : "network_error", what, ...meta },
        "Groq request failed",
      );
      throw new OtterError(
        timedOut
          ? "Groq took too long to answer. Try again shortly."
          : "OTTER could not reach Groq. Check the server's network access.",
        timedOut ? 504 : 502,
      );
    }
    if (!response.ok) {
      const { detail, failedGeneration } = await readUpstreamError(response);
      const error = upstreamError(response.status, what, detail.code);
      error.retryAfterMs = detail.retryAfterMs;
      error.failedGeneration = failedGeneration;
      const salvageable =
        detail.code === "json_validate_failed"
          ? { salvageable: Boolean(salvageReply(failedGeneration)) }
          : {};
      this.log(
        { status: response.status, ...detail, ...salvageable, what, ...meta },
        "Groq request failed",
      );
      throw error;
    }
    return readJson(response);
  }

  async available(): Promise<Set<string>> {
    if (this.models && this.models.expires > Date.now()) return this.models.ids;
    const data = await this.request("/openai/v1/models", { method: "GET" }, 10_000, "model list");
    const ids = new Set<string>(
      (Array.isArray(data?.data) ? data.data : [])
        .filter((m: any) => typeof m?.id === "string" && m.active !== false)
        .map((m: any) => m.id),
    );
    this.models = { ids, expires: Date.now() + MODEL_TTL };
    return ids;
  }

  async chatModel(tier: Tier) {
    const ids = await this.available();
    return CHAT_MODELS[tier].find((m) => ids.has(m.id));
  }

  async status() {
    const ids = await this.available();
    const has = (tier: Tier) => CHAT_MODELS[tier].some((m) => ids.has(m.id));
    return {
      modes: { auto: has("balanced") || has("fast"), fast: has("fast"), deep: has("deep") } as Record<
        OtterMode,
        boolean
      >,
      transcription: TRANSCRIPTION_MODELS.some((m) => ids.has(m)),
    };
  }

  /** Available models for a tier, in preference order, with the balanced tier as a backstop. */
  private async chatCandidates(tier: Tier) {
    const ids = await this.available();
    const seen = new Set<string>();
    return [...CHAT_MODELS[tier], ...(tier === "balanced" ? [] : CHAT_MODELS.balanced)].filter(
      (m) => ids.has(m.id) && !seen.has(m.id) && seen.add(m.id),
    );
  }

  async chat(
    tier: Tier,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    schema?: { name: string; schema: Record<string, unknown> },
  ): Promise<string> {
    const candidates = await this.chatCandidates(tier);
    if (!candidates.length)
      throw new OtterError("No supported Groq chat model is available to this key.", 503);
    // Bounded fallback (at most MAX_CHAT_ATTEMPTS calls): on a retryable failure try the next
    // available model, then the first again. A rate-limited retry waits only when Groq says the
    // limit clears within MAX_RATE_LIMIT_WAIT_MS.
    const plan = [...candidates, candidates[0]].slice(0, MAX_CHAT_ATTEMPTS);
    let lastError: OtterError | undefined;
    for (const [attempt, model] of plan.entries()) {
      if (attempt === plan.length - 1 && attempt > 0 && lastError?.statusCode === 429) {
        const wait = lastError.retryAfterMs;
        if (!wait || wait > MAX_RATE_LIMIT_WAIT_MS) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      try {
        return await this.chatOnce(tier, model, messages, schema);
      } catch (error) {
        if (!(error instanceof OtterError) || !error.retryable) throw error;
        lastError = error;
        // A rejected generation that is still a complete reply is used as-is (it goes through the
        // same server-side validation), which avoids spending another call against Groq's limits.
        const salvaged = salvageReply(error.failedGeneration);
        if (salvaged) return salvaged;
      }
    }
    throw lastError!;
  }

  private async chatOnce(
    tier: Tier,
    model: ModelChoice,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    schema?: { name: string; schema: Record<string, unknown> },
  ) {
    const data = await this.request(
      "/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          messages,
          temperature: 0.2,
          max_completion_tokens: tier === "deep" ? 4000 : 1800,
          // Strict Structured Outputs constrain decoding to the schema, which avoids Groq's
          // json_validate_failed errors seen with JSON Object Mode on gpt-oss models.
          response_format:
            schema && model.strict
              ? {
                  type: "json_schema",
                  json_schema: { name: schema.name, strict: true, schema: schema.schema },
                }
              : { type: "json_object" },
          ...(model.reasoning ? { reasoning_effort: model.reasoning } : {}),
        }),
      },
      tier === "deep" ? 90_000 : 45_000,
      "chat",
      { model: model.id, tier },
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new OtterError("Groq returned no answer.", 502, true);
    return content;
  }

  async transcribe(audio: Buffer, contentType: string): Promise<string> {
    const ids = await this.available();
    const model = TRANSCRIPTION_MODELS.find((m) => ids.has(m));
    if (!model) throw new OtterError("No Groq transcription model is available to this key.", 503);
    const extension = contentType.includes("ogg")
      ? "ogg"
      : contentType.includes("mp4") || contentType.includes("m4a")
        ? "m4a"
        : contentType.includes("wav")
          ? "wav"
          : contentType.includes("mpeg")
            ? "mp3"
            : "webm";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), `speech.${extension}`);
    form.append("model", model);
    form.append("response_format", "json");
    form.append("temperature", "0");
    const data = await this.request(
      "/openai/v1/audio/transcriptions",
      { method: "POST", body: form },
      60_000,
      "transcription",
    );
    return typeof data?.text === "string" ? data.text.trim() : "";
  }
}

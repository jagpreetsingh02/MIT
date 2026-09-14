import type { OtterMode } from "../../shared/types.js";

export type Tier = "fast" | "balanced" | "deep";
interface ModelChoice {
  id: string;
  reasoning?: "low" | "medium" | "high";
}

// Ordered preferences; only models the key can currently use are ever selected.
const CHAT_MODELS: Record<Tier, ModelChoice[]> = {
  fast: [{ id: "openai/gpt-oss-20b", reasoning: "low" }, { id: "llama-3.1-8b-instant" }],
  balanced: [
    { id: "openai/gpt-oss-120b", reasoning: "low" },
    { id: "llama-3.3-70b-versatile" },
    { id: "openai/gpt-oss-20b", reasoning: "medium" },
  ],
  deep: [{ id: "openai/gpt-oss-120b", reasoning: "high" }, { id: "llama-3.3-70b-versatile" }],
};
const TRANSCRIPTION_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const MODEL_TTL = 10 * 60_000;

export class OtterError extends Error {
  constructor(
    message: string,
    public statusCode = 502,
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

function upstreamError(status: number, what: string) {
  if (status === 401 || status === 403)
    return new OtterError("Groq rejected the server's OTTER credentials.", 502);
  if (status === 429) return new OtterError("Groq's rate limit was reached. Try again shortly.", 429);
  if (status === 413) return new OtterError("The recording is too large to transcribe.", 413);
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

  constructor(private fetcher: typeof fetch = fetch) {}

  get configured() {
    return Boolean(process.env.GROQ_API_KEY);
  }

  private async request(path: string, init: RequestInit, timeout: number, what: string) {
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
    } catch {
      throw new OtterError("OTTER could not reach Groq. Check the server's network access.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError(response.status, what);
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

  async chat(
    tier: Tier,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
  ): Promise<string> {
    const model =
      (await this.chatModel(tier)) ??
      (tier !== "balanced" ? await this.chatModel("balanced") : undefined);
    if (!model) throw new OtterError("No supported Groq chat model is available to this key.", 503);
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
          response_format: { type: "json_object" },
          ...(model.reasoning ? { reasoning_effort: model.reasoning } : {}),
        }),
      },
      tier === "deep" ? 90_000 : 45_000,
      "chat",
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new OtterError("Groq returned no answer.");
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

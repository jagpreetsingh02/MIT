import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OTTER_SECTIONS, type OtterStatus, type Scan } from "../../shared/types.js";
import { GroqClient, OtterError } from "./groq.js";
import { askOtter } from "./service.js";

const id = z.string().min(1).max(200);
const chatSchema = z
  .object({
    mode: z.enum(["auto", "fast", "deep"]).default("auto"),
    scope: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("global"),
          view: z.enum(OTTER_SECTIONS),
          applicationId: id.optional(),
          nodeId: id.optional(),
          advisoryId: id.optional(),
          ripple: z.boolean().optional(),
        })
        .strict(),
      z.object({ kind: z.literal("vulnerability"), advisoryId: id, nodeId: id }).strict(),
    ]),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(6000),
          })
          .strict(),
      )
      .min(1)
      .max(40)
      .refine((m) => m.at(-1)?.role === "user", "The last message must be from the user.")
      .refine((m) => (m.at(-1)?.content.length ?? 0) <= 2000, "Questions are limited to 2,000 characters."),
  })
  .strict();

const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|m4a|x-m4a|wav|x-wav|mpeg|mp3)$/;
const AUDIO_HEADER = /^audio\/(webm|ogg|mp4|m4a|x-m4a|wav|x-wav|mpeg|mp3)(\s*;.*)?$/i;

export async function otterRoutes(
  app: FastifyInstance,
  getScan: (id: string, ready?: boolean) => Scan,
  client = new GroqClient(),
) {
  function fail(reply: any, error: unknown) {
    if (error instanceof OtterError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: error.issues[0]?.message || "Invalid OTTER request." });
    throw error;
  }

  app.get("/api/v1/otter/status", async (_req, reply): Promise<OtterStatus> => {
    const off = { auto: false, fast: false, deep: false };
    if (!client.configured)
      return {
        configured: false,
        modes: off,
        transcription: false,
        message: "OTTER is not configured on this server. Set GROQ_API_KEY to enable it.",
      };
    try {
      return { configured: true, ...(await client.status()) };
    } catch (error) {
      if (error instanceof OtterError)
        return { configured: true, modes: off, transcription: false, message: error.message };
      return fail(reply, error);
    }
  });

  app.post<{ Params: { scanId: string } }>(
    "/api/v1/scans/:scanId/otter",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      try {
        const body = chatSchema.parse(req.body);
        return await askOtter(client, getScan(req.params.scanId, true), body);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  await app.register(async (audio) => {
    audio.addContentTypeParser(
      AUDIO_HEADER,
      { parseAs: "buffer", bodyLimit: 12_000_000 },
      (_req, body, done) => done(null, body),
    );
    audio.post(
      "/api/v1/otter/transcribe",
      { bodyLimit: 12_000_000, config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        const body = req.body as Buffer | undefined;
        if (!AUDIO_TYPES.test(type) || !Buffer.isBuffer(body))
          return reply.code(415).send({ error: "Send the recording as an audio file." });
        if (body.length < 1000)
          return reply.code(422).send({ error: "The recording was too short to transcribe." });
        try {
          const text = await client.transcribe(body, type);
          if (!text)
            return reply.code(422).send({ error: "No speech was detected in the recording." });
          return { text: text.slice(0, 2000) };
        } catch (error) {
          return fail(reply, error);
        }
      },
    );
  });
}

// Empty in local dev: Vite's dev-server proxy forwards relative /api/v1 requests
// to the local backend. In production this is set to the deployed Render URL,
// so the Vercel-hosted frontend calls the backend cross-origin.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

let accessToken = "";

export function setAccessToken(token: string) {
  accessToken = token;
}

export function hasAccessToken() {
  return Boolean(accessToken);
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API_BASE + "/api/v1" + path, {
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
    },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The request could not finish. Please try again.");
  return data;
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  const type = (audio.type || "audio/webm").split(";")[0];
  let response: Response;
  try {
    response = await fetch(API_BASE + "/api/v1/otter/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": type,
        ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
      },
      body: audio,
    });
  } catch {
    throw new Error("the RootLine server could not be reached.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.text !== "string")
    throw new Error(data.error || "the server could not transcribe the recording.");
  return data.text;
}

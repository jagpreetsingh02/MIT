let accessToken = "";

export function setAccessToken(token: string) {
  accessToken = token;
}

export function hasAccessToken() {
  return Boolean(accessToken);
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/v1" + path, {
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
    response = await fetch("/api/v1/otter/transcribe", {
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

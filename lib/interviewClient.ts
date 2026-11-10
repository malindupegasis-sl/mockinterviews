import type { InterviewRequest } from "./types";

/**
 * Calls /api/interview and streams the interviewer's reply.
 * `onText` receives the full text accumulated so far after every chunk.
 * Resolves with the complete raw text (completion token included, if any).
 */
export async function streamInterviewerTurn(
  req: InterviewRequest,
  onText: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/interview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  text += decoder.decode();
  if (!text.trim()) throw new Error("The interviewer returned an empty response.");
  return text;
}

import { apiFetch, throwApiError } from "./api";
import type { InterviewEvent, InterviewRequest, TurnMeta } from "./types";

/**
 * Calls /api/interview and streams the interviewer's reply (newline-delimited JSON).
 * `onText` receives the full spoken text accumulated so far after every chunk.
 * Resolves with the final text and the server's metadata for the turn.
 */
export async function streamInterviewerTurn(
  req: InterviewRequest,
  onText: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; meta: TurnMeta }> {
  const res = await apiFetch("/api/interview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) await throwApiError(res, `Request failed (${res.status}).`);
  const body = res.body!;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let done: Extract<InterviewEvent, { type: "done" }> | null = null;

  const handle = (raw: string) => {
    if (!raw.trim()) return;
    const event = JSON.parse(raw) as InterviewEvent;
    if (event.type === "text") {
      text += event.text;
      onText(text);
    } else if (event.type === "done") {
      done = event;
    }
  };

  while (true) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handle(buffer + decoder.decode());

  const final = done as Extract<InterviewEvent, { type: "done" }> | null;
  if (!final) throw new Error("The interviewer's reply was cut off. Try again.");
  if (!final.text.trim()) throw new Error("The interviewer returned an empty response.");
  return { text: final.text, meta: final.meta };
}

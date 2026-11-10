import { apiFetch, throwApiError } from "./api";
import type { ChatMessage, FeedbackRequest, FullReport, QuestionFeedback } from "./types";

/** Visible transcript turns only (drops practice-mode control turns). */
export function visibleTurns(messages: ChatMessage[]): FeedbackRequest["transcript"] {
  return messages.filter((m) => !m.control).map(({ role, content }) => ({ role, content }));
}

async function post<T>(body: FeedbackRequest & { practice?: boolean }, signal?: AbortSignal): Promise<T> {
  const res = await apiFetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await throwApiError(res, `Feedback failed (${res.status}).`);
  return (await res.json()) as T;
}

export function fetchQuestionFeedback(
  req: Omit<FeedbackRequest, "kind">,
  signal?: AbortSignal,
): Promise<QuestionFeedback> {
  return post<QuestionFeedback>({ ...req, kind: "question" }, signal);
}

export function fetchFullReport(
  req: Omit<FeedbackRequest, "kind"> & { practice: boolean },
  signal?: AbortSignal,
): Promise<FullReport> {
  return post<FullReport>({ ...req, kind: "full" }, signal);
}

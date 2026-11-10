import { INTERVIEW_COMPLETE_TOKEN, QUESTION_COMPLETE_TOKEN } from "./prompts";

const TOKENS = [INTERVIEW_COMPLETE_TOKEN, QUESTION_COMPLETE_TOKEN];

/**
 * Removes the control tokens from interviewer text and reports which were present.
 * While text is still streaming, a partial token at the very end (e.g. "[QUEST")
 * is also hidden so it never flashes on screen or gets spoken.
 */
export function stripCompletionToken(text: string): {
  text: string;
  complete: boolean; // [INTERVIEW_COMPLETE]
  questionComplete: boolean; // [QUESTION_COMPLETE]
} {
  const complete = text.includes(INTERVIEW_COMPLETE_TOKEN);
  const questionComplete = text.includes(QUESTION_COMPLETE_TOKEN);
  let out = text;
  for (const token of TOKENS) out = out.split(token).join("");

  // Hide a trailing prefix of either token, if any.
  outer: for (const token of TOKENS) {
    for (let n = token.length - 1; n > 0; n--) {
      if (out.endsWith(token.slice(0, n))) {
        out = out.slice(0, -n);
        break outer;
      }
    }
  }
  return { text: out.trimEnd(), complete, questionComplete };
}

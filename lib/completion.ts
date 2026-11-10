import { INTERVIEW_COMPLETE_TOKEN } from "./prompts";

/**
 * Removes the completion token from interviewer text and reports whether it
 * was present. While text is still streaming, a partial token at the very end
 * (e.g. "[INTERV") is also hidden so it never flashes on screen.
 */
export function stripCompletionToken(text: string): {
  text: string;
  complete: boolean;
} {
  const complete = text.includes(INTERVIEW_COMPLETE_TOKEN);
  let out = text.split(INTERVIEW_COMPLETE_TOKEN).join("");

  // Hide a trailing prefix of the token, if any.
  for (let n = INTERVIEW_COMPLETE_TOKEN.length - 1; n > 0; n--) {
    if (out.endsWith(INTERVIEW_COMPLETE_TOKEN.slice(0, n))) {
      out = out.slice(0, -n);
      break;
    }
  }
  return { text: out.trimEnd(), complete };
}

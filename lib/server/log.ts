// Privacy-safe error descriptions for server logs: never include request bodies,
// prompts or model output, only status, error type and request id.

import Anthropic from "@anthropic-ai/sdk";

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const type = (err.error as { error?: { type?: string } } | undefined)?.error?.type ?? err.name;
    // 400 messages can describe request content, so they're left out, except for
    // account problems (e.g. "spend limit reached"), which never quote user text.
    const accountIssue = /spend|limit|credit|billing|balance/i.test(err.message);
    const detail = err.status && (err.status !== 400 || accountIssue) ? `: ${err.message.slice(0, 200)}` : "";
    return `Anthropic API ${err.status ?? "connection"} ${type}${detail} (request id: ${err.requestID ?? "n/a"})`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message.slice(0, 200)}`;
  return "unknown error";
}

import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";
import { interviewerSystemPrompt, OPENING_USER_MESSAGE } from "@/lib/prompts";
import { LIMITS, type ChatMessage } from "@/lib/types";

// Allow long-ish streams on Vercel.
export const maxDuration = 60;

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Validates the request body; returns an error string or the parsed values. */
function parseBody(body: unknown):
  | { error: string }
  | { context: string; numQuestions: number; messages: ChatMessage[] } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body." };
  const { context, numQuestions, messages } = body as Record<string, unknown>;

  if (typeof context !== "string" || !context.trim())
    return { error: "Interview context is required." };
  if (context.length > LIMITS.contextMaxChars)
    return { error: `Context must be at most ${LIMITS.contextMaxChars} characters.` };

  const n = Number(numQuestions);
  if (!Number.isInteger(n) || n < LIMITS.minQuestions || n > LIMITS.maxQuestions)
    return { error: `Number of questions must be ${LIMITS.minQuestions}–${LIMITS.maxQuestions}.` };

  if (!Array.isArray(messages)) return { error: "messages must be an array." };
  for (const [i, m] of messages.entries()) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.length > LIMITS.answerMaxChars
    )
      return { error: `Invalid message at index ${i}.` };
    // The client transcript starts with the interviewer and alternates from there.
    const expected = i % 2 === 0 ? "assistant" : "user";
    if (m.role !== expected) return { error: "Messages must alternate, starting with the interviewer." };
  }
  if (messages.length > 0 && messages[messages.length - 1].role !== "user")
    return { error: "The last message must be the candidate's answer." };

  return { context: context.trim(), numQuestions: n, messages: messages as ChatMessage[] };
}

/**
 * POST /api/interview
 * Body: { context, numQuestions, messages } where messages is the visible transcript.
 * Streams the interviewer's next turn back as plain UTF-8 text.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const parsed = parseBody(body);
  if ("error" in parsed) return bad(parsed.error);
  const { context, numQuestions, messages } = parsed;

  const stream = anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    system: interviewerSystemPrompt({ context, numQuestions }),
    messages: [
      { role: "user", content: OPENING_USER_MESSAGE },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    // Low effort: conversational turns, so skip deep thinking and keep latency down.
    output_config: { effort: "low" },
    // Cache the stable prefix (system prompt + earlier turns) across turns.
    cache_control: { type: "ephemeral" },
    // If the model declines in a category that supports it, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  // Wait for response headers so auth/rate-limit errors become a proper HTTP error
  // instead of a broken stream.
  try {
    await stream.withResponse();
  } catch (err) {
    console.error("[interview] Anthropic request failed:", err);
    const status = err instanceof Anthropic.APIError && err.status ? err.status : 502;
    return bad("The interviewer is unavailable right now. Please try again.", status >= 500 ? 502 : status);
  }

  // Forward only the visible text deltas (thinking blocks are not sent to the client).
  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          console.warn("[interview] Model refused:", final.stop_details);
        }
        controller.close();
      } catch (err) {
        console.error("[interview] Stream error:", err);
        controller.error(err);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body$, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

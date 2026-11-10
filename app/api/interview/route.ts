import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";
import {
  CONTROL_PREFIX,
  controlMessage,
  interviewerSystemPrompt,
  OPENING_USER_MESSAGE,
} from "@/lib/prompts";
import { LIMITS, type Control, type InterviewMode } from "@/lib/types";

// Allow long-ish streams on Vercel.
export const maxDuration = 60;

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

interface Parsed {
  context: string;
  cv: string;
  numQuestions: number;
  mode: InterviewMode;
  messages: Anthropic.MessageParam[];
}

/** Validates the request body and builds the API messages; returns an error string on failure. */
function parseBody(body: unknown): { error: string } | Parsed {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body." };
  const { context, cv = "", numQuestions, mode = "full", messages } = body as Record<string, unknown>;

  if (typeof context !== "string" || !context.trim())
    return { error: "Interview context is required." };
  if (context.length > LIMITS.contextMaxChars)
    return { error: `Context must be at most ${LIMITS.contextMaxChars} characters.` };
  if (typeof cv !== "string" || cv.length > LIMITS.cvMaxChars)
    return { error: `Background must be at most ${LIMITS.cvMaxChars} characters.` };
  if (mode !== "full" && mode !== "practice") return { error: "Invalid mode." };

  const n = Number(numQuestions);
  if (!Number.isInteger(n) || n < LIMITS.minQuestions || n > LIMITS.maxQuestions)
    return { error: `Number of questions must be ${LIMITS.minQuestions}–${LIMITS.maxQuestions}.` };

  if (!Array.isArray(messages) || messages.length > LIMITS.maxTranscriptTurns)
    return { error: "Invalid messages." };

  const out: Anthropic.MessageParam[] = [{ role: "user", content: OPENING_USER_MESSAGE }];
  for (const [i, m] of messages.entries()) {
    // The client transcript starts with the interviewer and alternates from there.
    const expected = i % 2 === 0 ? "assistant" : "user";
    if (!m || m.role !== expected) return { error: "Messages must alternate, starting with the interviewer." };

    if (m.control) {
      // Practice-mode control turn: the text is generated here, never taken from the client.
      const c = m.control as Control;
      if (
        mode !== "practice" ||
        m.role !== "user" ||
        !["next", "retry", "finish"].includes(c.type) ||
        !Number.isInteger(c.question) ||
        c.question < 1 ||
        c.question > n
      )
        return { error: `Invalid control message at index ${i}.` };
      out.push({ role: "user", content: controlMessage(c, n) });
      continue;
    }

    if (typeof m.content !== "string" || !m.content.trim() || m.content.length > LIMITS.answerMaxChars)
      return { error: `Invalid message at index ${i}.` };
    // Candidates can't impersonate the practice app.
    const content =
      m.role === "user" ? m.content.split(CONTROL_PREFIX).join("").trim() || "(no answer)" : m.content;
    out.push({ role: m.role, content });
  }
  if (messages.length > 0 && messages[messages.length - 1].role !== "user")
    return { error: "The last message must be from the candidate." };

  return { context: context.trim(), cv: cv.trim(), numQuestions: n, mode, messages: out };
}

/**
 * POST /api/interview
 * Body: { context, cv?, numQuestions, mode?, messages } (messages = visible transcript + control turns).
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
  const { context, cv, numQuestions, mode, messages } = parsed;

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    system: interviewerSystemPrompt({ context, cv, numQuestions, mode }),
    messages,
    // Low effort: conversational turns, so skip deep thinking and keep latency down.
    output_config: { effort: "low" },
    // Cache the stable prefix (system prompt + earlier turns) across turns.
    cache_control: { type: "ephemeral" },
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

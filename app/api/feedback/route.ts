import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";
import { fullFeedbackSystemPrompt, questionFeedbackSystemPrompt } from "@/lib/prompts";
import { requireAccess } from "@/lib/server/access";
import { describeError } from "@/lib/server/log";
import { rateLimit } from "@/lib/server/ratelimit";
import { LIMITS, type Difficulty, type FullReport, type QuestionFeedback, type Role } from "@/lib/types";

// Feedback runs at higher effort than the interviewer: quality over speed.
export const maxDuration = 120;

const str = { type: "string" } as const;
const int = { type: "integer" } as const;

/** Calls the model with a JSON-schema-constrained output and parses it ourselves, so a cut-off
 * or refused response is reported by its real stop reason instead of a parse exception. */
async function callStructured(
  system: string,
  input: string,
  schema: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ data: unknown; res: Anthropic.Message }> {
  const res = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: input }],
      output_config: { effort: "high", format: { type: "json_schema", schema } },
    },
    { signal }, // stop the model call if the user navigates away
  );
  let data: unknown = null;
  if (res.stop_reason === "end_turn") {
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { data, res };
}

const QUESTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { score: int, what_worked: str, biggest_weakness: str, stronger_answer: str, rewrite: str },
  required: ["score", "what_worked", "biggest_weakness", "stronger_answer", "rewrite"],
  additionalProperties: false,
};

const FULL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    overall_score: int,
    verdict: str,
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: str,
          answer_turns: { type: "array", items: int },
          answer_summary: str,
          score: int,
          biggest_weakness: str,
          stronger_answer: str,
        },
        required: ["question", "answer_turns", "answer_summary", "score", "biggest_weakness", "stronger_answer"],
        additionalProperties: false,
      },
    },
    weakest_answer: {
      type: "object",
      properties: { question_index: int, rewrite: str },
      required: ["question_index", "rewrite"],
      additionalProperties: false,
    },
    patterns: {
      type: "array",
      items: {
        type: "object",
        properties: { title: str, detail: str },
        required: ["title", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["overall_score", "verdict", "questions", "weakest_answer", "patterns"],
  additionalProperties: false,
};

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

/** Builds the user message: context, background and a turn-numbered transcript. */
function buildInput(opts: {
  context: string;
  cv: string;
  transcript: { role: Role; content: string }[];
  practice: boolean;
}) {
  const turns = opts.transcript
    .map((t, i) => `[T${i + 1}] ${t.role === "assistant" ? "INTERVIEWER" : "CANDIDATE"}: ${t.content}`)
    .join("\n\n");
  return [
    `<interview_context>\n${opts.context}\n</interview_context>`,
    `<candidate_background>\n${opts.cv || "(none provided)"}\n</candidate_background>`,
    opts.practice
      ? "Note: this was a practice session. The transcript contains only the candidate's final attempt at each question."
      : "",
    `<transcript>\n${turns}\n</transcript>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * POST /api/feedback
 * Body: { kind: "question" | "full", context, cv?, difficulty?, transcript, practice? }
 * Returns QuestionFeedback or FullReport as JSON.
 *
 * Every request logs "[feedback]" lines to the server terminal: how long it took
 * and the token usage on success, or the reason on failure. No user text is logged,
 * and nothing is stored.
 */
export async function POST(req: Request) {
  const denied = requireAccess(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const { kind, context, cv = "", difficulty = "medium", transcript, practice = false } = body ?? {};

  if (kind !== "question" && kind !== "full") return bad("Invalid kind.");
  if (typeof context !== "string" || !context.trim() || context.length > LIMITS.contextMaxChars)
    return bad("Invalid context.");
  if (typeof cv !== "string" || cv.length > LIMITS.cvMaxChars) return bad("Invalid background.");
  if (!["easy", "medium", "hard"].includes(difficulty as string)) return bad("Invalid difficulty.");
  if (
    !Array.isArray(transcript) ||
    transcript.length === 0 ||
    transcript.length > LIMITS.maxTranscriptTurns ||
    !transcript.every(
      (t) =>
        t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.length <= LIMITS.answerMaxChars,
    )
  )
    return bad("Invalid transcript.");
  if (!transcript.some((t) => t.role === "user")) return bad("There are no answers to review yet.");

  const limited = await rateLimit(req, "feedback");
  if (limited) return limited;

  const level = difficulty as Difficulty;
  const input = buildInput({ context, cv, transcript, practice: Boolean(practice) });
  const label = kind === "full" ? "full report" : "question feedback";
  const started = Date.now();
  const secs = () => ((Date.now() - started) / 1000).toFixed(1) + "s";
  console.info(`[feedback] ${label}: reviewing ${transcript.length} turns (${level})…`);

  try {
    if (kind === "question") {
      const { data, res } = await callStructured(questionFeedbackSystemPrompt(level), input, QUESTION_SCHEMA, req.signal);
      const out = data as QuestionFeedback | null;
      if (!out) {
        logUnusable(label, secs(), res.stop_reason, res.stop_details);
        return bad("Couldn't produce feedback for that answer. Try again.", 502);
      }
      logOk(label, secs(), res.usage);
      const fb: QuestionFeedback = { ...out, score: clamp(out.score, 1, 5) };
      return Response.json(fb);
    }

    const { data, res } = await callStructured(fullFeedbackSystemPrompt(level), input, FULL_SCHEMA, req.signal);
    const out = data as FullReport | null;
    if (!out || !Array.isArray(out.questions) || out.questions.length === 0) {
      logUnusable(label, secs(), res.stop_reason, res.stop_details, out ? "no questions in output" : undefined);
      return bad("Couldn't produce the report. Try again.", 502);
    }
    logOk(label, secs(), res.usage);

    // Keep only references to real candidate turns, and clamp scores.
    const isCandidateTurn = (n: number) => transcript[n - 1]?.role === "user";
    const report: FullReport = {
      overall_score: clamp(out.overall_score, 1, 10),
      verdict: out.verdict,
      questions: out.questions.map((q) => ({
        ...q,
        score: clamp(q.score, 1, 5),
        answer_turns: [...new Set(q.answer_turns)].filter(isCandidateTurn).sort((a, b) => a - b),
      })),
      weakest_answer: {
        question_index: clamp(out.weakest_answer.question_index, 0, out.questions.length - 1),
        rewrite: out.weakest_answer.rewrite,
      },
      patterns: out.patterns.slice(0, 3),
    };
    return Response.json(report);
  } catch (err) {
    if (req.signal.aborted) {
      console.info(`[feedback] ${label}: cancelled after ${secs()} (the browser left the page)`);
      return bad("Cancelled.", 499);
    }
    console.error(`[feedback] ${label} FAILED after ${secs()}: ${describeError(err)}`);
    if (err instanceof Anthropic.APIError) {
      const status = err.status && err.status < 500 ? err.status : 502;
      return bad("Feedback is unavailable right now. Please try again.", status);
    }
    return bad("Feedback is unavailable right now. Please try again.", 502);
  }
}

function logOk(label: string, time: string, usage: Anthropic.Usage) {
  console.info(`[feedback] ${label} OK in ${time} (input ${usage.input_tokens} tokens, output ${usage.output_tokens} tokens)`);
}

function logUnusable(label: string, time: string, stopReason: string | null, details: unknown, extra?: string) {
  const why =
    stopReason === "max_tokens"
      ? "hit max_tokens before finishing"
      : stopReason === "refusal"
        ? `model declined (category: ${(details as { category?: string } | null)?.category ?? "unknown"})`
        : extra ?? `stop_reason=${stopReason}, output was not valid JSON`;
  console.error(`[feedback] ${label} UNUSABLE after ${time}: ${why}`);
}

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { anthropic, MODEL } from "@/lib/anthropic";
import { FULL_FEEDBACK_SYSTEM_PROMPT, QUESTION_FEEDBACK_SYSTEM_PROMPT } from "@/lib/prompts";
import { LIMITS, type FullReport, type QuestionFeedback, type Role } from "@/lib/types";

// Feedback runs at higher effort than the interviewer: quality over speed.
export const maxDuration = 120;

const str = { type: "string" } as const;
const int = { type: "integer" } as const;

const QUESTION_SCHEMA = {
  type: "object",
  properties: { score: int, what_worked: str, biggest_weakness: str, stronger_answer: str, rewrite: str },
  required: ["score", "what_worked", "biggest_weakness", "stronger_answer", "rewrite"],
  additionalProperties: false,
} as const;

const FULL_SCHEMA = {
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
} as const;

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
 * Body: { kind: "question" | "full", context, cv?, transcript, practice? }
 * Returns QuestionFeedback or FullReport as JSON.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const { kind, context, cv = "", transcript, practice = false } = body ?? {};

  if (kind !== "question" && kind !== "full") return bad("Invalid kind.");
  if (typeof context !== "string" || !context.trim() || context.length > LIMITS.contextMaxChars)
    return bad("Invalid context.");
  if (typeof cv !== "string" || cv.length > LIMITS.cvMaxChars) return bad("Invalid background.");
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

  const input = buildInput({ context, cv, transcript, practice: Boolean(practice) });

  try {
    if (kind === "question") {
      const res = await anthropic.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: QUESTION_FEEDBACK_SYSTEM_PROMPT,
        messages: [{ role: "user", content: input }],
        output_config: { effort: "high", format: jsonSchemaOutputFormat(QUESTION_SCHEMA) },
      }, { signal: req.signal }); // stop the model call if the user navigates away
      const out = res.parsed_output;
      if (res.stop_reason !== "end_turn" || !out) {
        console.error("[feedback] unusable response:", res.stop_reason, res.stop_details);
        return bad("Couldn't produce feedback for that answer. Try again.", 502);
      }
      const fb: QuestionFeedback = { ...out, score: clamp(out.score, 1, 5) };
      return Response.json(fb);
    }

    const res = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: FULL_FEEDBACK_SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
      output_config: { effort: "high", format: jsonSchemaOutputFormat(FULL_SCHEMA) },
    }, { signal: req.signal });
    const out = res.parsed_output;
    if (res.stop_reason !== "end_turn" || !out || out.questions.length === 0) {
      console.error("[feedback] unusable response:", res.stop_reason, res.stop_details);
      return bad("Couldn't produce the report. Try again.", 502);
    }

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
    console.error("[feedback] Anthropic request failed:", err);
    const status = err instanceof Anthropic.APIError && err.status && err.status < 500 ? err.status : 502;
    return bad("Feedback is unavailable right now. Please try again.", status);
  }
}

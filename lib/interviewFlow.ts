// Server-owned interview structure.
//
// The server is stateless (it runs as serverless functions), so the conversation
// state is rebuilt on every request from the turn metadata the server issued
// earlier (ChatMessage.meta), validated against the difficulty rules. From that
// state the server decides what happens next and tells the model exactly what to
// do. The model never counts questions or decides when the interview ends.

import type Anthropic from "@anthropic-ai/sdk";
import { ACK_LINES, CONTROL_USER_MESSAGE, OPENING_USER_MESSAGE, renderDirective } from "./prompts";
import {
  LIMITS,
  MAX_FOLLOW_UPS,
  type ChatMessage,
  type Difficulty,
  type Directive,
  type InterviewMode,
  type TurnMeta,
} from "./types";

export interface FlowConfig {
  numQuestions: number;
  mode: InterviewMode;
  difficulty: Difficulty;
}

/** What the server will do for the next interviewer turn. */
export type Plan =
  /** Speak fixed text without calling the model (practice-mode acknowledgement). */
  | { kind: "fixed"; text: string; meta: TurnMeta }
  /** Call the model with a plain-text directive; the turn's meta is known up front. */
  | { kind: "model"; directive: Directive; meta: TurnMeta }
  /** Hard mode: the model returns { action, text }; meta depends on the action. */
  | { kind: "decide"; directive: Extract<Directive, { type: "hard_decide" }> };

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

function validDirective(d: unknown, n: number): d is Directive {
  if (!d || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  switch (x.type) {
    case "open":
    case "ack":
      return true;
    case "ask":
      return isInt(x.question, 2, n) && (x.after === "answer" || x.after === "next");
    case "retry":
    case "follow_up":
      return isInt(x.question, 1, n);
    case "closing":
      return x.after === "answer" || x.after === "next" || x.after === "cap";
    case "hard_decide":
      return isInt(x.question, 1, n) && isInt(x.followUps, 0, 1) && ["ask_next", "closing", "ack"].includes(x.then as string);
    default:
      return false;
  }
}

/** Checks the client-supplied history is well-formed and consistent with the rules. */
export function validateHistory(messages: unknown, cfg: FlowConfig): string | null {
  if (!Array.isArray(messages) || messages.length > LIMITS.maxTranscriptTurns) return "Invalid messages.";
  const maxF = MAX_FOLLOW_UPS[cfg.difficulty];
  for (const [i, m] of messages.entries()) {
    const expected = i % 2 === 0 ? "assistant" : "user";
    if (!m || m.role !== expected) return "Messages must alternate, starting with the interviewer.";
    if (m.role === "assistant") {
      const meta = m.meta as TurnMeta | undefined;
      if (typeof m.content !== "string" || m.content.length > LIMITS.answerMaxChars) return `Invalid message at index ${i}.`;
      if (
        !meta ||
        !["question", "follow_up", "ack", "closing"].includes(meta.kind) ||
        !isInt(meta.question, 1, cfg.numQuestions) ||
        !isInt(meta.followUps, 0, maxF) ||
        !validDirective(meta.directive, cfg.numQuestions)
      )
        return `Invalid interviewer turn at index ${i}.`;
      if (meta.kind === "ack" && cfg.mode !== "practice") return `Invalid interviewer turn at index ${i}.`;
    } else if (m.control !== undefined) {
      if (cfg.mode !== "practice" || (m.control !== "next" && m.control !== "retry")) return `Invalid control at index ${i}.`;
    } else if (typeof m.content !== "string" || !m.content.trim() || m.content.length > LIMITS.answerMaxChars) {
      return `Invalid answer at index ${i}.`;
    }
  }
  if (messages.length > 0 && messages[messages.length - 1].role !== "user") return "The last message must be from the candidate.";
  return null;
}

/** Decides the next interviewer turn from the (validated) history. */
export function planNextTurn(messages: ChatMessage[], cfg: FlowConfig): Plan | { error: string } {
  const n = cfg.numQuestions;
  if (messages.length === 0) {
    const directive: Directive = { type: "open" };
    return { kind: "model", directive, meta: { kind: "question", question: 1, followUps: 0, directive } };
  }

  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2].meta!; // last interviewer turn
  const q = prev.question;
  const f = prev.followUps;

  if (prev.kind === "closing") return { error: "The interview has ended." };

  // Turn cap: count spoken turns (not practice button presses or fixed acknowledgements).
  // If a normal turn now would leave no room for the closing line within the cap
  // (it would need an answer and then the closing: 3 more turns), wrap up instead.
  const spoken = messages.filter((m) => !m.control && m.meta?.directive.type !== "ack").length;
  if (spoken + 3 > LIMITS.maxTurns) {
    const directive: Directive = { type: "closing", after: "cap" };
    return { kind: "model", directive, meta: { kind: "closing", question: q, followUps: f, directive } };
  }

  // Practice-mode buttons: only valid while paused after a question.
  if (last.control) {
    if (prev.kind !== "ack") return { error: "Next/Retry is only available after a question is finished." };
    if (last.control === "retry") {
      const directive: Directive = { type: "retry", question: q };
      return { kind: "model", directive, meta: { kind: "question", question: q, followUps: 0, directive } };
    }
    if (q < n) {
      const directive: Directive = { type: "ask", question: q + 1, after: "next" };
      return { kind: "model", directive, meta: { kind: "question", question: q + 1, followUps: 0, directive } };
    }
    const directive: Directive = { type: "closing", after: "next" };
    return { kind: "model", directive, meta: { kind: "closing", question: q, followUps: f, directive } };
  }

  // The candidate answered.
  if (prev.kind === "ack") return { error: "The question is finished. Choose Next question or Retry." };

  /** The current question is finished: pause (practice), ask the next one, or close. */
  const done = (extra: Partial<TurnMeta> = {}): Plan => {
    if (cfg.mode === "practice") {
      const directive: Directive = { type: "ack" };
      const text = ACK_LINES[(q + f) % ACK_LINES.length];
      return { kind: "fixed", text, meta: { kind: "ack", question: q, followUps: f, directive, ...extra } };
    }
    if (q < n) {
      const directive: Directive = { type: "ask", question: q + 1, after: "answer" };
      return { kind: "model", directive, meta: { kind: "question", question: q + 1, followUps: 0, directive, ...extra } };
    }
    const directive: Directive = { type: "closing", after: "answer" };
    return { kind: "model", directive, meta: { kind: "closing", question: q, followUps: f, directive, ...extra } };
  };

  const followUp = (): Plan => {
    const directive: Directive = { type: "follow_up", question: q };
    return { kind: "model", directive, meta: { kind: "follow_up", question: q, followUps: f + 1, directive } };
  };

  switch (cfg.difficulty) {
    case "easy":
      return done();
    case "medium":
      return f < 1 ? followUp() : done();
    case "hard": {
      // After the 2nd follow-up the question is done, whatever the model would say.
      if (f >= 2) return done({ action: "question_done", forced: true });
      const then = cfg.mode === "practice" ? "ack" : q < n ? "ask_next" : "closing";
      return { kind: "decide", directive: { type: "hard_decide", question: q, followUps: f, then } };
    }
  }
}

/** Turn meta for a Hard-mode decision (the server has already validated `action`). */
export function metaForDecision(
  d: Extract<Directive, { type: "hard_decide" }>,
  action: "follow_up" | "question_done",
): TurnMeta {
  const base = { directive: d as Directive, action };
  if (action === "follow_up") return { ...base, kind: "follow_up", question: d.question, followUps: d.followUps + 1 };
  if (d.then === "ask_next") return { ...base, kind: "question", question: d.question + 1, followUps: 0 };
  if (d.then === "closing") return { ...base, kind: "closing", question: d.question, followUps: d.followUps };
  return { ...base, kind: "ack", question: d.question, followUps: d.followUps };
}

/**
 * Rebuilds the API conversation: every past interviewer turn is preceded by the
 * directive that produced it (re-rendered deterministically, so the prompt cache
 * stays valid), and the next directive goes last as a mid-conversation system message.
 */
export function buildApiMessages(
  messages: ChatMessage[],
  cfg: FlowConfig,
  next: Directive,
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [{ role: "user", content: OPENING_USER_MESSAGE }];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (m.meta!.directive.type !== "ack") {
        out.push({ role: "system", content: renderDirective(m.meta!.directive, cfg.numQuestions) });
      }
      out.push({ role: "assistant", content: m.content || "Thank you." });
    } else {
      out.push({ role: "user", content: m.control ? CONTROL_USER_MESSAGE : m.content.trim() });
    }
  }
  out.push({ role: "system", content: renderDirective(next, cfg.numQuestions) });
  return out;
}

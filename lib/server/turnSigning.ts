// HMAC signing of server-issued turn records (TURN_SECRET).
//
// The server is stateless: it trusts the turn records the browser sends back
// only if their signatures verify. Each signature covers the interview id, the
// interview settings (difficulty, mode, question count), the turn's position, its
// metadata, a hash of its exact text, and the previous turn's signature. So the
// client can't change counts or difficulty, edit what the interviewer said, or
// insert, drop or reorder interviewer turns.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FlowConfig } from "../interviewFlow";
import type { ChatMessage, Directive, TurnMeta } from "../types";

const DEV_SECRET = "dev-only-insecure-turn-secret";
let warned = false;

function secret(): string | null {
  const s = process.env.TURN_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV !== "production") {
    if (!warned) console.warn("[turns] TURN_SECRET not set (or under 16 chars): using an insecure development secret.");
    warned = true;
    return DEV_SECRET;
  }
  return null;
}

/** True when signing is possible (TURN_SECRET set, or running locally). */
export function signingConfigured() {
  return secret() !== null;
}

export function newInterviewId() {
  return randomBytes(12).toString("base64url");
}

/** Fixed-order serialisation so the same record always produces the same signature. */
function canonicalDirective(d: Directive) {
  const x = d as Record<string, unknown>;
  return [x.type, x.question ?? null, x.after ?? null, x.followUps ?? null, x.then ?? null];
}

function payload(meta: TurnMeta, content: string, index: number, prevSig: string, cfg: FlowConfig) {
  return JSON.stringify([
    "v1",
    meta.iid,
    cfg.difficulty,
    cfg.mode,
    cfg.numQuestions,
    index,
    prevSig,
    meta.kind,
    meta.question,
    meta.followUps,
    canonicalDirective(meta.directive),
    meta.action ?? null,
    meta.forced ?? false,
    createHash("sha256").update(content).digest("base64url"),
  ]);
}

function hmac(data: string) {
  return createHmac("sha256", secret()!).update(data).digest("base64url");
}

/** Signs a new interviewer turn that will sit at `index` in the conversation. */
export function signTurn(
  meta: TurnMeta,
  content: string,
  index: number,
  history: ChatMessage[],
  cfg: FlowConfig,
): TurnMeta {
  const prev = [...history].reverse().find((m) => m.meta)?.meta;
  const iid = prev?.iid ?? newInterviewId();
  const unsigned = { ...meta, iid, sig: undefined };
  return { ...unsigned, sig: hmac(payload(unsigned, content, index, prev?.sig ?? "", cfg)) };
}

/** Verifies every interviewer turn in the history; returns an error message or null. */
export function verifyHistory(history: ChatMessage[], cfg: FlowConfig): string | null {
  let prevSig = "";
  let iid: string | undefined;
  for (const [i, m] of history.entries()) {
    if (m.role !== "assistant") continue;
    const meta = m.meta!;
    if (typeof meta.sig !== "string" || typeof meta.iid !== "string") return "unsigned";
    if (iid !== undefined && meta.iid !== iid) return "mixed interviews";
    iid = meta.iid;
    const expected = Buffer.from(hmac(payload(meta, m.content, i, prevSig, cfg)));
    const given = Buffer.from(meta.sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return `bad signature at turn ${i}`;
    prevSig = meta.sig;
  }
  return null;
}

import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";
import { buildApiMessages, metaForDecision, planNextTurn, validateHistory, type FlowConfig } from "@/lib/interviewFlow";
import { JsonStringFieldStream } from "@/lib/jsonStream";
import { interviewerSystemPrompt } from "@/lib/prompts";
import { requireAccess } from "@/lib/server/access";
import { describeError } from "@/lib/server/log";
import { rateLimit } from "@/lib/server/ratelimit";
import { signingConfigured, signTurn, verifyHistory } from "@/lib/server/turnSigning";
import { LIMITS, type ChatMessage, type Difficulty, type InterviewEvent, type TurnMeta } from "@/lib/types";

// Allow long-ish streams on Vercel.
export const maxDuration = 60;

/** Hard mode: the model's structured decision alongside the spoken text. */
const DECISION_SCHEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["follow_up", "question_done"] },
      text: { type: "string" },
    },
    required: ["action", "text"],
    additionalProperties: false,
  },
};

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

const encoder = new TextEncoder();
const line = (e: InterviewEvent) => encoder.encode(JSON.stringify(e) + "\n");

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
};

/**
 * POST /api/interview
 * Body: { context, cv?, numQuestions, mode, difficulty, messages }.
 * The server decides what the interviewer does next (see lib/interviewFlow.ts) and
 * streams it back as newline-delimited JSON: { type: "text" } chunks while the
 * model speaks, then one { type: "done", text, meta } with the turn's metadata.
 */
export async function POST(req: Request) {
  const denied = requireAccess(req);
  if (denied) return denied;
  if (!signingConfigured()) {
    console.error("[interview] TURN_SECRET is not set: refusing requests. Set it in the Vercel project settings.");
    return bad("This app isn't configured yet.", 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const { context, cv = "", numQuestions, mode = "full", difficulty = "medium", messages } = body ?? {};

  if (typeof context !== "string" || !context.trim()) return bad("Interview context is required.");
  if (context.length > LIMITS.contextMaxChars) return bad(`Context must be at most ${LIMITS.contextMaxChars} characters.`);
  if (typeof cv !== "string" || cv.length > LIMITS.cvMaxChars) return bad(`Background must be at most ${LIMITS.cvMaxChars} characters.`);
  if (mode !== "full" && mode !== "practice") return bad("Invalid mode.");
  if (!["easy", "medium", "hard"].includes(difficulty as string)) return bad("Invalid difficulty.");
  const n = Number(numQuestions);
  if (!Number.isInteger(n) || n < LIMITS.minQuestions || n > LIMITS.maxQuestions)
    return bad(`Number of questions must be ${LIMITS.minQuestions}–${LIMITS.maxQuestions}.`);

  const cfg: FlowConfig = { numQuestions: n, mode, difficulty: difficulty as Difficulty };
  const invalid = validateHistory(messages, cfg);
  if (invalid) return bad(invalid);
  const history = messages as ChatMessage[];

  // Only accept turn records this server signed, for these exact settings.
  const tampered = verifyHistory(history, cfg);
  if (tampered) {
    console.warn(`[interview] rejected history: ${tampered}`);
    return bad("This interview's history couldn't be verified. Please start a new interview.", 409);
  }

  const plan = planNextTurn(history, cfg);
  if ("error" in plan) return bad(plan.error, 409);

  // Per-IP limits: new interviews per day, and interviewer turns per day.
  const limited =
    (history.length === 0 ? await rateLimit(req, "interviews") : null) ?? (await rateLimit(req, "turns"));
  if (limited) return limited;

  const index = history.length; // where the new interviewer turn will sit

  // Practice-mode acknowledgement: fixed text, no model call.
  if (plan.kind === "fixed") {
    logTurn(cfg, plan.meta);
    const meta = signTurn(plan.meta, plan.text, index, history, cfg);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(line({ type: "text", text: plan.text }));
        c.enqueue(line({ type: "done", text: plan.text, meta }));
        c.close();
      },
    });
    return new Response(stream, { headers: NDJSON_HEADERS });
  }

  const directive = plan.directive;
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    system: interviewerSystemPrompt({ context: context.trim(), cv: cv.trim(), numQuestions: n, mode, difficulty: cfg.difficulty }),
    messages: buildApiMessages(history, cfg, directive),
    // Low effort: conversational turns, so skip deep thinking and keep latency down.
    // Hard-mode decisions add a structured { action, text } output.
    output_config: plan.kind === "decide" ? { effort: "low", format: DECISION_SCHEMA } : { effort: "low" },
    // Cache the stable prefix (system prompt + earlier turns) across turns.
    cache_control: { type: "ephemeral" },
  });

  // Wait for response headers so auth/rate-limit errors become a proper HTTP error
  // instead of a broken stream.
  try {
    await stream.withResponse();
  } catch (err) {
    console.error("[interview] Anthropic request failed:", describeError(err));
    const status = err instanceof Anthropic.APIError && err.status ? err.status : 502;
    return bad("The interviewer is unavailable right now. Please try again.", status >= 500 ? 502 : status);
  }

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // For Hard decisions the model streams JSON; pull out the spoken "text" as it arrives.
        const extractor = plan.kind === "decide" ? new JsonStringFieldStream("text") : null;
        let spoken = "";
        for await (const event of stream) {
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          const piece = extractor ? extractor.push(event.delta.text) : event.delta.text;
          if (piece) {
            spoken += piece;
            controller.enqueue(line({ type: "text", text: piece }));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal")
          console.warn(`[interview] model declined (category: ${final.stop_details?.category ?? "unknown"})`);

        let meta: TurnMeta;
        if (plan.kind === "decide") {
          // Validate the structured action; anything unexpected counts as "question_done".
          let action: "follow_up" | "question_done" = "question_done";
          try {
            const parsed = JSON.parse(extractor!.json);
            if (parsed.action === "follow_up" || parsed.action === "question_done") action = parsed.action;
            if (typeof parsed.text === "string" && parsed.text.length > spoken.length) spoken = parsed.text;
          } catch {
            console.warn("[interview] Hard decision JSON unparseable; treating as question_done.");
          }
          meta = metaForDecision(plan.directive, action);
        } else {
          meta = plan.meta;
        }
        logTurn(cfg, meta);
        const text = spoken.trim();
        controller.enqueue(line({ type: "done", text, meta: signTurn(meta, text, index, history, cfg) }));
        controller.close();
      } catch (err) {
        console.error("[interview] Stream error:", describeError(err));
        controller.error(err);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(out, { headers: NDJSON_HEADERS });
}

/** One line per interviewer turn in the server log. Contains no user text. */
function logTurn(cfg: FlowConfig, meta: TurnMeta) {
  console.info(
    `[interview] ${cfg.difficulty}/${cfg.mode} q${meta.question}/${cfg.numQuestions} ${meta.kind}` +
      ` follow-ups=${meta.followUps} directive=${meta.directive.type}` +
      (meta.action ? ` action=${meta.action}${meta.forced ? " (forced)" : ""}` : ""),
  );
}

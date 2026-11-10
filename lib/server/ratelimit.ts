// Per-IP rate limiting. Uses Upstash Redis (REST API, no SDK) when configured,
// otherwise an in-memory counter, which resets on restart and isn't shared
// between serverless instances, so it is a best-effort fallback only.
//
// IP addresses are never stored: keys use a salted hash of the IP.

import { createHash } from "node:crypto";

export type Bucket = "interviews" | "turns" | "feedback" | "tts" | "access_failures";

/** Daily limits per IP (access failures are per hour). */
export const RATE_LIMITS: Record<Bucket, number> = {
  interviews: 5, // new interviews per day
  turns: 300, // interviewer turns per day (stops replaying a conversation to run up costs)
  feedback: 60, // feedback cards + reports per day
  tts: 1500, // ElevenLabs sentences per day (only when ElevenLabs is configured)
  access_failures: 20, // wrong access codes per hour
};

const MESSAGES: Record<Bucket, string> = {
  interviews: "You've reached today's limit of 5 interviews. Try again tomorrow.",
  turns: "You've reached today's usage limit. Try again tomorrow.",
  feedback: "You've reached today's feedback limit. Try again tomorrow.",
  tts: "Voice limit reached for today.",
  access_failures: "Too many wrong codes. Try again in an hour.",
};

function redisConfig() {
  // Vercel's Upstash integration may name these KV_REST_API_URL / KV_REST_API_TOKEN.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/** Client IP as seen by Vercel's proxy (falls back to "unknown" locally). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

function ipKey(ip: string) {
  const salt = process.env.TURN_SECRET ?? "mock-interview";
  return createHash("sha256").update(salt + ip).digest("base64url").slice(0, 22);
}

function windowKey(bucket: Bucket) {
  const iso = new Date().toISOString(); // UTC
  return bucket === "access_failures" ? iso.slice(0, 13) : iso.slice(0, 10);
}

// ---- In-memory fallback ----
const memory = new Map<string, { count: number; expires: number }>();
let warned = false;

function incrMemory(key: string, ttlSec: number): number {
  if (!warned) {
    console.warn("[ratelimit] Upstash Redis not configured: using an in-memory limiter (per instance, resets on restart).");
    warned = true;
  }
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.expires < now) {
    memory.set(key, { count: 1, expires: now + ttlSec * 1000 });
    return 1;
  }
  entry.count++;
  return entry.count;
}

async function incrRedis(cfg: { url: string; token: string }, key: string, ttlSec: number): Promise<number> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, ttlSec],
    ]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const data = (await res.json()) as { result?: number; error?: string }[];
  if (data[0]?.error || typeof data[0]?.result !== "number") throw new Error(`Upstash error: ${data[0]?.error}`);
  return data[0].result;
}

/** Counts one use of `bucket` for this request's IP. Returns a 429 Response if over the limit, else null. */
export async function rateLimit(req: Request, bucket: Bucket): Promise<Response | null> {
  const key = `rl:${bucket}:${windowKey(bucket)}:${ipKey(clientIp(req))}`;
  const ttl = bucket === "access_failures" ? 3600 : 2 * 86400;
  let count: number;
  const redis = redisConfig();
  try {
    count = redis ? await incrRedis(redis, key, ttl) : incrMemory(key, ttl);
  } catch (err) {
    // Don't lock everyone out if Redis is down; fall back to memory for this request.
    console.error("[ratelimit] Upstash failed, using in-memory fallback:", err instanceof Error ? err.message : err);
    count = incrMemory(key, ttl);
  }
  if (count > RATE_LIMITS[bucket]) {
    console.warn(`[ratelimit] ${bucket} limit reached for one client (${count}/${RATE_LIMITS[bucket]}).`);
    return Response.json({ error: MESSAGES[bucket], code: "rate_limit" }, { status: 429 });
  }
  return null;
}

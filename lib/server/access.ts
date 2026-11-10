// Access-code gate, checked server-side on every API route.

import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_HEADER = "x-access-code";

let warned = false;

/** Constant-time comparison (hashing first makes the lengths equal). */
function same(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** True if `code` matches ACCESS_CODE. */
export function isValidCode(code: string): boolean | "unconfigured" {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return "unconfigured";
  return same(code, expected);
}

/**
 * Returns an error Response if the request lacks a valid access code, else null.
 * With ACCESS_CODE unset: allowed in local development (with a warning), refused in production.
 */
export function requireAccess(req: Request): Response | null {
  const result = isValidCode(req.headers.get(ACCESS_HEADER) ?? "");
  if (result === "unconfigured") {
    if (process.env.NODE_ENV !== "production") {
      if (!warned) console.warn("[access] ACCESS_CODE is not set: allowing all requests (development only).");
      warned = true;
      return null;
    }
    console.error("[access] ACCESS_CODE is not set: refusing requests. Set it in the Vercel project settings.");
    return Response.json({ error: "This app isn't configured yet.", code: "unconfigured" }, { status: 503 });
  }
  if (!result) return Response.json({ error: "Access code required.", code: "access" }, { status: 401 });
  return null;
}

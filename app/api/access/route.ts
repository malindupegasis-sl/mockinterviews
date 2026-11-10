import { isValidCode } from "@/lib/server/access";
import { rateLimit } from "@/lib/server/ratelimit";

/**
 * POST /api/access  Body: { code }
 * Lets the access screen check a code before the interview starts.
 * Wrong codes are rate-limited per IP to stop guessing.
 */
export async function POST(req: Request) {
  let code = "";
  try {
    const body = await req.json();
    if (typeof body?.code === "string") code = body.code.slice(0, 200);
  } catch {
    /* treated as empty */
  }

  const result = isValidCode(code);
  if (result === "unconfigured") {
    if (process.env.NODE_ENV !== "production") return Response.json({ ok: true });
    console.error("[access] ACCESS_CODE is not set: refusing requests. Set it in the Vercel project settings.");
    return Response.json({ error: "This app isn't configured yet." }, { status: 503 });
  }
  if (result) return Response.json({ ok: true });

  const limited = await rateLimit(req, "access_failures");
  if (limited) return limited;
  return Response.json({ error: "That code isn't right." }, { status: 401 });
}

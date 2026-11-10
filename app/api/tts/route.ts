import { connection } from "next/server";
import { requireAccess } from "@/lib/server/access";
import { rateLimit } from "@/lib/server/ratelimit";
import {
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_VOICE_SETTINGS,
  TTS_MAX_CHARS,
  elevenLabsConfig,
} from "@/lib/tts";

/** GET /api/tts → { configured } so the client knows whether to use browser speech instead. */
export async function GET(req: Request) {
  await connection(); // read env vars at request time, not at build time
  const denied = requireAccess(req);
  if (denied) return denied;
  return Response.json({ configured: elevenLabsConfig() !== null });
}

/**
 * POST /api/tts
 * Body: { text, previousText? }. Proxies the ElevenLabs streaming endpoint and
 * pipes the MP3 audio straight through to the browser. The API key never leaves the server.
 */
export async function POST(req: Request) {
  const denied = requireAccess(req);
  if (denied) return denied;
  const config = elevenLabsConfig();
  if (!config) return Response.json({ error: "ElevenLabs is not configured." }, { status: 503 });
  const limited = await rateLimit(req, "tts");
  if (limited) return limited;

  let text: unknown, previousText: unknown;
  try {
    ({ text, previousText } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > TTS_MAX_CHARS)
    return Response.json({ error: "Invalid text." }, { status: 400 });

  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream`,
  );
  url.searchParams.set("output_format", "mp3_44100_128");

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: ELEVENLABS_VOICE_SETTINGS,
        // Earlier sentences of the same turn keep intonation continuous across clips.
        ...(typeof previousText === "string" && previousText
          ? { previous_text: previousText.slice(-TTS_MAX_CHARS) }
          : {}),
      }),
      signal: req.signal,
    });
  } catch (err) {
    console.error("[tts] ElevenLabs request failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "Text-to-speech failed." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    // ElevenLabs error bodies describe the account/request problem, not the spoken text.
    console.error("[tts] ElevenLabs error:", upstream.status, detail.slice(0, 200));
    // Tell the client whether retrying could help: auth and quota errors won't fix themselves.
    const quota = upstream.status === 402 || /quota|credits|payment/i.test(detail);
    if (quota) return Response.json({ error: "ElevenLabs quota exceeded.", code: "quota" }, { status: 402 });
    if (upstream.status === 401 || upstream.status === 403)
      return Response.json({ error: "ElevenLabs rejected the API key.", code: "auth" }, { status: 401 });
    return Response.json({ error: "Text-to-speech failed.", code: "upstream" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}

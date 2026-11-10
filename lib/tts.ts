// Server-side ElevenLabs configuration. Only import from API routes.

export const TTS_MAX_CHARS = 1000;

/** Low-latency ElevenLabs model, suited to conversational turn-taking. */
export const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

/** Calm, steady delivery: high stability, moderate similarity, minimal style, slightly slow. */
export const ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.7,
  similarity_boost: 0.6,
  style: 0.1,
  use_speaker_boost: true,
  speed: 0.95,
};

export function elevenLabsConfig() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  return apiKey && voiceId ? { apiKey, voiceId } : null;
}

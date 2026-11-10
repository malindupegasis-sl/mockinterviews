// Browser (speechSynthesis) voice selection.
// The interviewer offers exactly two voices: Chrome's Google UK English Male / Female.

export const VOICE_OPTIONS = ["Google UK English Male", "Google UK English Female"] as const;
export type VoiceName = (typeof VOICE_OPTIONS)[number];
export const DEFAULT_VOICE: VoiceName = "Google UK English Male";

const STORAGE_KEY = "mockinterview.voice";

export function loadVoiceChoice(): VoiceName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (VOICE_OPTIONS as readonly string[]).includes(saved)) return saved as VoiceName;
  } catch {
    /* storage unavailable (private mode, SSR) */
  }
  return DEFAULT_VOICE;
}

export function saveVoiceChoice(name: VoiceName) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Resolves with the browser's voices. Chrome loads them asynchronously, so if the
 * list is empty we wait for "voiceschanged" (with a timeout, since some browsers never fire it).
 */
export function waitForVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
}

/** Which of the two offered voices this browser actually has. */
export function availableOptions(voices: SpeechSynthesisVoice[]): VoiceName[] {
  return VOICE_OPTIONS.filter((name) => voices.some((v) => v.name === name));
}

/**
 * Picks the voice to speak with: the chosen Google UK voice, else the other one,
 * else any en-GB voice, else any English voice, else null (browser default).
 */
export function resolveVoice(
  voices: SpeechSynthesisVoice[],
  choice: VoiceName,
): SpeechSynthesisVoice | null {
  const byName = (name: string) => voices.find((v) => v.name === name);
  return (
    byName(choice) ??
    VOICE_OPTIONS.map(byName).find(Boolean) ??
    voices.find((v) => /^en[-_]GB$/i.test(v.lang)) ??
    voices.find((v) => /^en\b/i.test(v.lang)) ??
    null
  );
}

// Browser (speechSynthesis) voice selection.
//
// Chrome's "Google UK English Male / Female" come first. Elsewhere (Safari, iOS,
// Edge, Firefox) we rank the device's English voices: British first, then the
// higher-quality variants ("Premium", "Enhanced", Microsoft "Natural"), then
// well-known good voices such as Apple's Daniel and Serena. Novelty voices
// (macOS "Bubbles", "Zarvox", the robotic Eloquence voices, …) are excluded.

export const GOOGLE_VOICES = ["Google UK English Male", "Google UK English Female"];

const STORAGE_KEY = "mockinterview.voice";

/** Known good British voices on Apple devices (base name, without "(Enhanced)" etc.). */
const GOOD_GB = new Set(["Daniel", "Serena", "Arthur", "Oliver", "Kate", "Martha", "Stephanie", "Jamie"]);

/** macOS / iOS novelty and robotic voices: never offer these. */
const EXCLUDED = new Set([
  "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Deranged", "Good News", "Hysterical",
  "Jester", "Organ", "Pipe Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox",
  "Eddy", "Flo", "Grandma", "Grandpa", "Reed", "Rocko", "Sandy", "Shelley", "Fred", "Junior", "Kathy", "Ralph",
]);

/** Voice name without the trailing "(Enhanced)" / "(English (United Kingdom))" decoration. */
export function baseName(v: SpeechSynthesisVoice): string {
  return v.name.replace(/\s*\(.*\)\s*$/, "").trim();
}

/** Higher is better; null means "don't offer this voice". */
function score(v: SpeechSynthesisVoice): number | null {
  if (!/^en([-_]|$)/i.test(v.lang)) return null;
  const base = baseName(v);
  if (EXCLUDED.has(base)) return null;
  let s = 0;
  const google = GOOGLE_VOICES.indexOf(v.name);
  if (google >= 0) s += 200 - google; // Male first, then Female
  if (/^en[-_]GB/i.test(v.lang)) s += 40;
  else if (/^en[-_]US/i.test(v.lang)) s += 20;
  else s += 10;
  if (/premium/i.test(v.name)) s += 15;
  else if (/enhanced/i.test(v.name)) s += 10;
  if (/natural/i.test(v.name)) s += 12; // Microsoft Edge neural voices
  if (GOOD_GB.has(base)) s += 8;
  if (base === "Daniel") s += 2; // closest to the default Google UK Male
  return s;
}

/** The device's good English voices, best first, without duplicates (max `limit`). */
export function goodVoices(voices: SpeechSynthesisVoice[], limit = 8): SpeechSynthesisVoice[] {
  const seen = new Set<string>();
  return voices
    .map((v) => ({ v, s: score(v) }))
    .filter((x): x is { v: SpeechSynthesisVoice; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v)
    .filter((v) => {
      const key = `${v.name}|${v.lang}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/**
 * The voice to speak with: the saved choice if this device has it, else the best
 * good voice (Google UK Male, else the best en-GB voice, else the best English
 * voice), else any English voice, else null (the browser's default).
 */
export function resolveVoice(voices: SpeechSynthesisVoice[], choice: string | null): SpeechSynthesisVoice | null {
  if (choice) {
    const chosen = voices.find((v) => v.voiceURI === choice) ?? voices.find((v) => v.name === choice);
    if (chosen) return chosen;
  }
  return goodVoices(voices, 1)[0] ?? voices.find((v) => /^en\b/i.test(v.lang)) ?? null;
}

/** Short label for the picker, e.g. "Daniel (Enhanced) · UK". */
export function voiceLabel(v: SpeechSynthesisVoice): string {
  const region = /GB/i.test(v.lang) ? "UK" : /US/i.test(v.lang) ? "US" : v.lang.replace(/^en[-_]/i, "");
  const name = v.name.replace(/\s*\(English \(.*\)\)\s*$/, "").replace(/ - English \(.*\)$/, "");
  return `${name} · ${region}`;
}

/** Saved voice choice (a voiceURI, or a voice name from older versions), or null for "best available". */
export function loadVoiceChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable (private mode, SSR)
  }
}

export function saveVoiceChoice(choice: string) {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Resolves with the browser's voices. Chrome and Safari load them asynchronously,
 * so if the list is empty we wait for "voiceschanged" (with a timeout, since some
 * browsers never fire it).
 */
export function waitForVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener?.("voiceschanged", done);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener?.("voiceschanged", done);
  });
}

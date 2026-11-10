// iOS (and Safari generally) only allows audio after a user gesture. Call
// unlockAudio() synchronously inside a tap/click handler, e.g. "Start interview":
// it creates and resumes the shared AudioContext with a silent buffer, and
// speaks a silent utterance so speechSynthesis is allowed to play later.

let ctx: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** One AudioContext for the whole page (unlocked once, reused by every interview). */
export function getAudioContext(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext!;
    ctx = new Ctor();
  }
  return ctx;
}

export function unlockAudio() {
  try {
    const c = getAudioContext();
    if (c.state === "suspended") void c.resume();
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* Web Audio unavailable: browser speech still works */
  }
  try {
    if (typeof speechSynthesis !== "undefined") {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* speechSynthesis unavailable */
  }
}

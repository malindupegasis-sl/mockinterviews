// Ordered text-to-speech playback.
//
// Each sentence is sent to /api/tts the moment it's enqueued (so audio for later
// sentences downloads while earlier ones play) and clips are played strictly in
// order through Web Audio. If ElevenLabs isn't configured or a request fails, the
// sentence is spoken with the browser's speechSynthesis instead.

export type SpeakerMode = "elevenlabs" | "browser";

interface QueueItem {
  text: string;
  audio: Promise<AudioBuffer | null>; // null → speak with the browser instead
}

export class Speaker {
  readonly ctx: AudioContext;
  /** Playback runs through this node; Phase 3 reads amplitude from it for the visualiser. */
  readonly analyser: AnalyserNode;

  mode: SpeakerMode = "browser";
  browserVoiceURI: string | null = null;
  onSpeakingChange?: (speaking: boolean) => void;
  onModeChange?: (mode: SpeakerMode) => void;

  private queue: QueueItem[] = [];
  private running = false;
  private generation = 0; // bumped by stop() to cancel in-flight work
  private spokenSoFar = ""; // previous sentences of the current turn, for continuity
  private idleWaiters: (() => void)[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.connect(this.ctx.destination);
  }

  /** Asks the server whether ElevenLabs is configured and picks the mode. */
  async init(): Promise<SpeakerMode> {
    try {
      const res = await fetch("/api/tts");
      const data = await res.json();
      this.setMode(data?.configured ? "elevenlabs" : "browser");
    } catch {
      this.setMode("browser");
    }
    return this.mode;
  }

  /** Call when a new interviewer turn starts. */
  beginTurn() {
    this.spokenSoFar = "";
  }

  enqueue(text: string) {
    const previousText = this.spokenSoFar;
    this.spokenSoFar += (this.spokenSoFar ? " " : "") + text;
    const audio = this.mode === "elevenlabs" ? this.fetchAudio(text, previousText) : Promise.resolve(null);
    this.queue.push({ text, audio });
    if (!this.running) void this.run();
  }

  /** Resolves once everything queued so far has finished playing. */
  waitUntilIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stops playback immediately and drops anything queued. */
  stop() {
    this.generation++;
    this.queue = [];
    try {
      this.currentSource?.stop();
    } catch {
      /* already stopped */
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.finishRun();
  }

  dispose() {
    this.stop();
    void this.ctx.close();
  }

  private setMode(mode: SpeakerMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  private async fetchAudio(text: string, previousText: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, previousText }),
      });
      if (!res.ok) throw new Error(`TTS failed (${res.status})`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      // Don't keep hammering a failing service: use browser speech for the rest of the session.
      console.warn("[speaker] ElevenLabs failed, falling back to browser speech:", err);
      this.setMode("browser");
      return null;
    }
  }

  private async run() {
    this.running = true;
    this.onSpeakingChange?.(true);
    const gen = this.generation;
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});

    while (this.queue.length > 0 && gen === this.generation) {
      const item = this.queue.shift()!;
      const buffer = await item.audio;
      if (gen !== this.generation) return;
      if (buffer) await this.playBuffer(buffer);
      else await this.speakWithBrowser(item.text);
    }
    if (gen === this.generation) this.finishRun();
  }

  private finishRun() {
    if (!this.running) return;
    this.running = false;
    this.currentSource = null;
    this.currentUtterance = null;
    this.onSpeakingChange?.(false);
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }

  private playBuffer(buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser);
      source.onended = () => resolve();
      this.currentSource = source;
      source.start();
    });
  }

  private speakWithBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === "undefined") return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickBrowserVoice(this.browserVoiceURI);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-GB";
      }
      u.rate = 0.95;
      // Chrome occasionally never fires onend; a generous timeout keeps the queue moving.
      const timeout = setTimeout(resolve, 2000 + text.length * 120);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.currentUtterance = u; // keep a reference so it isn't garbage-collected mid-speech
      speechSynthesis.speak(u);
    });
  }
}

/** English (GB/US) voices available in this browser, en-GB first. */
export function englishVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => /^en[-_](GB|US)/i.test(v.lang))
    .sort((a, b) => Number(/GB/i.test(b.lang)) - Number(/GB/i.test(a.lang)) || a.name.localeCompare(b.name));
}

function pickBrowserVoice(uri: string | null): SpeechSynthesisVoice | null {
  const voices = englishVoices();
  return voices.find((v) => v.voiceURI === uri) ?? voices[0] ?? null;
}

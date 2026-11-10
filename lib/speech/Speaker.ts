// Ordered text-to-speech playback.
//
// Default path: the browser's speechSynthesis (Chrome's Google UK voices), spoken
// sentence by sentence. If both ELEVENLABS env vars are set on the server, each
// sentence is instead sent to /api/tts as soon as it's enqueued (so later audio
// downloads while earlier audio plays) and played strictly in order through Web
// Audio. A failed ElevenLabs sentence is retried once; auth/quota errors switch
// to browser speech immediately.

import { apiFetch } from "../api";
import { splitLongSentence } from "../sentences";
import {
  AnalyserAmplitude,
  MaxAmplitude,
  SimulatedSpeechAmplitude,
  type AmplitudeSource,
} from "../viz/amplitude";
import { getAudioContext } from "./unlock";
import { resolveVoice, waitForVoices } from "./voices";

export type SpeakerMode = "elevenlabs" | "browser";

interface QueueItem {
  text: string;
  audio: Promise<AudioBuffer | null>; // null → speak with the browser instead
}

/** Error from /api/tts that retrying won't fix. */
class FatalTtsError extends Error {}

export class Speaker {
  readonly ctx: AudioContext;
  /** ElevenLabs playback runs through this node (usable for a real-audio visualiser). */
  readonly analyser: AnalyserNode;
  /**
   * Interviewer loudness for the visualiser: simulated from utterance events for
   * browser speech, real (AnalyserNode) for ElevenLabs. Whichever is active wins.
   */
  readonly amplitude: AmplitudeSource;
  private simulated = new SimulatedSpeechAmplitude();

  mode: SpeakerMode = "browser";
  /** Saved voice (voiceURI or name); null = best available on this device. */
  voiceChoice: string | null = null;
  /** All speechSynthesis voices, loaded in init(). */
  voices: SpeechSynthesisVoice[] = [];
  onSpeakingChange?: (speaking: boolean) => void;
  onModeChange?: (mode: SpeakerMode) => void;

  private queue: QueueItem[] = [];
  private running = false;
  private generation = 0; // bumped by stop() to cancel in-flight work
  private spokenSoFar = ""; // previous sentences of the current turn, for ElevenLabs continuity
  private idleWaiters: (() => void)[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    // Shared context, unlocked by the "Start interview" tap (required on iOS).
    this.ctx = getAudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.connect(this.ctx.destination);
    this.amplitude = new MaxAmplitude([this.simulated, new AnalyserAmplitude(this.analyser)]);
  }

  /** Loads browser voices and asks the server whether ElevenLabs is configured. */
  async init(): Promise<SpeakerMode> {
    const [configured, voices] = await Promise.all([
      apiFetch("/api/tts")
        .then((r) => r.json())
        .then((d) => Boolean(d?.configured))
        .catch(() => false),
      waitForVoices(),
    ]);
    this.voices = voices;
    this.setMode(configured ? "elevenlabs" : "browser");
    return this.mode;
  }

  /** Call when a new interviewer turn starts. */
  beginTurn() {
    this.spokenSoFar = "";
  }

  enqueue(sentence: string) {
    if (this.mode === "elevenlabs") {
      const previousText = this.spokenSoFar;
      this.spokenSoFar += (this.spokenSoFar ? " " : "") + sentence;
      this.queue.push({ text: sentence, audio: this.fetchAudio(sentence, previousText) });
    } else {
      for (const piece of splitLongSentence(sentence)) {
        this.queue.push({ text: piece, audio: Promise.resolve(null) });
      }
    }
    if (!this.running) void this.run();
  }

  /** Resolves once everything queued so far has finished playing (or stop() is called). */
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
    this.simulated.utteranceEnd();
    this.finishRun();
  }

  dispose() {
    this.stop();
    this.analyser.disconnect(); // the shared AudioContext stays open for the next interview
  }

  private setMode(mode: SpeakerMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  /** Fetches one sentence from ElevenLabs; retries once unless the error is auth/quota. */
  private async fetchAudio(text: string, previousText: string): Promise<AudioBuffer | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (this.mode !== "elevenlabs") return null; // already switched by another sentence
      try {
        const res = await apiFetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, previousText }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const msg = `TTS failed (${res.status}${data?.code ? `, ${data.code}` : ""})`;
          if (data?.code === "auth" || data?.code === "quota") throw new FatalTtsError(msg);
          throw new Error(msg);
        }
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        if (err instanceof FatalTtsError || attempt === 2) {
          console.warn("[speaker] ElevenLabs unavailable, switching to browser speech:", err);
          this.setMode("browser");
          return null;
        }
        console.warn("[speaker] ElevenLabs sentence failed, retrying once:", err);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    return null;
  }

  private async run() {
    this.running = true;
    this.onSpeakingChange?.(true);
    const gen = this.generation;
    // Never wait on resume(): on iOS it can hang outside a tap, and browser speech doesn't need it.
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});

    while (this.queue.length > 0 && gen === this.generation) {
      const item = this.queue.shift()!;
      const buffer = await item.audio;
      if (gen !== this.generation) return;
      if (buffer) await this.playBuffer(buffer);
      else {
        // An ElevenLabs sentence that fell back may still be long: split it too.
        for (const piece of splitLongSentence(item.text)) {
          if (gen !== this.generation) return;
          await this.speakWithBrowser(piece);
        }
      }
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
      // Voices can finish loading after init() on some browsers; re-read if we have none yet.
      if (this.voices.length === 0) this.voices = speechSynthesis.getVoices();
      const voice = resolveVoice(this.voices, this.voiceChoice);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-GB";
      }
      u.rate = 0.95;
      // Drive the visualiser from utterance events (no audio stream is exposed).
      u.onstart = () => this.simulated.utteranceStart(text, u.rate);
      u.onboundary = (e) => {
        if (e.name !== "word") return;
        const len = e.charLength || text.slice(e.charIndex).search(/\s|$/);
        this.simulated.wordBoundary(text.slice(e.charIndex, e.charIndex + len));
      };
      // Chrome occasionally never fires onend; a generous timeout keeps the queue moving.
      const timeout = setTimeout(() => done(), 3000 + text.length * 120);
      const done = () => {
        clearTimeout(timeout);
        this.simulated.utteranceEnd();
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.currentUtterance = u; // keep a reference so it isn't garbage-collected mid-speech
      speechSynthesis.speak(u);
    });
  }
}

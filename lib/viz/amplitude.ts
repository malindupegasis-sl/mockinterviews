// Amplitude sources for the oscilloscope. Each returns a level in 0..1 per frame.
//
// The visualiser only depends on the AmplitudeSource interface, so the interviewer
// trace can be driven by simulated speech (browser speechSynthesis, which exposes
// no audio stream) or by a real AnalyserNode (ElevenLabs playback) interchangeably.

export interface AmplitudeSource {
  /** Current loudness, 0 (silent) to 1 (loud). Called once per animation frame. */
  level(): number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Real audio: RMS of an AnalyserNode's time-domain signal, with a noise gate,
 * gain, and attack/release smoothing so the trace doesn't jitter.
 */
export class AnalyserAmplitude implements AmplitudeSource {
  private buf: Float32Array<ArrayBuffer>;
  private smoothed = 0;

  constructor(
    private analyser: AnalyserNode,
    private opts = { noiseFloor: 0.01, gain: 5 },
  ) {
    this.buf = new Float32Array(analyser.fftSize);
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const target = clamp01((rms - this.opts.noiseFloor) * this.opts.gain);
    this.smoothed += (target - this.smoothed) * (target > this.smoothed ? 0.5 : 0.15);
    return this.smoothed;
  }
}

interface Pulse {
  t: number; // start time (performance.now())
  peak: number;
  estimated: boolean; // scheduled from text, not from a real boundary event
}

/**
 * Simulated speech loudness for speechSynthesis, which exposes no audio.
 *
 * Each spoken word produces a pulse: a quick attack then an exponential decay,
 * so the level rises and dips word by word. Pulses come from the utterance's
 * `boundary` events. Some voices (reportedly including Chrome's network-based
 * Google voices) don't fire boundary events, so on utterance start we
 * also schedule estimated pulses from the text at a typical speaking rate; the
 * first real boundary event replaces that estimate.
 */
export class SimulatedSpeechAmplitude implements AmplitudeSource {
  private pulses: Pulse[] = [];
  private active = false;
  private gotRealBoundary = false;

  utteranceStart(text: string, rate = 1) {
    const now = performance.now();
    this.active = true;
    this.gotRealBoundary = false;
    this.pulses = this.pulses.filter((p) => p.t <= now);

    // ~14 characters per second at rate 1, plus pauses after punctuation.
    let t = now + 40;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      this.pulses.push({ t, peak: wordPeak(word), estimated: true });
      t += (word.length * 65 + 80) / rate;
      if (/[,;:]$/.test(word)) t += 160 / rate;
      if (/[.!?]$/.test(word)) t += 280 / rate;
    }
  }

  /** Call from SpeechSynthesisUtterance.onboundary (word events). */
  wordBoundary(word: string) {
    const now = performance.now();
    if (!this.gotRealBoundary) {
      // Real timing is available: drop the estimated schedule.
      this.gotRealBoundary = true;
      this.pulses = this.pulses.filter((p) => !p.estimated || p.t <= now);
    }
    this.pulses.push({ t: now, peak: wordPeak(word), estimated: false });
  }

  utteranceEnd() {
    const now = performance.now();
    this.active = false;
    this.pulses = this.pulses.filter((p) => p.t <= now); // cancel anything not yet "spoken"
  }

  level(): number {
    const now = performance.now();
    let level = 0;
    for (const p of this.pulses) {
      const dt = now - p.t;
      if (dt < 0) continue;
      const env = dt < 45 ? dt / 45 : Math.exp(-(dt - 45) / 140);
      level = Math.max(level, p.peak * env);
    }
    // A little continuous texture while the voice is active, so gaps aren't dead flat.
    if (this.active) level = Math.max(level, 0.1 + 0.05 * Math.sin(now / 47) * Math.sin(now / 131));
    this.pulses = this.pulses.filter((p) => now - p.t < 1500 || p.t > now);
    return clamp01(level);
  }
}

/** Longer words get a slightly bigger pulse, with some randomness so it looks organic. */
function wordPeak(word: string): number {
  const len = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  return clamp01((0.45 + 0.4 * Math.min(1, len / 9)) * (0.8 + Math.random() * 0.35));
}

/** Loudest of several sources (e.g. simulated browser speech + real ElevenLabs audio). */
export class MaxAmplitude implements AmplitudeSource {
  constructor(private sources: AmplitudeSource[]) {}
  level(): number {
    return this.sources.reduce((m, s) => Math.max(m, s.level()), 0);
  }
}

/** Microphone loudness for the candidate's trace. start()/stop() open and close the mic. */
export class MicAmplitude implements AmplitudeSource {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private inner: AnalyserAmplitude | null = null;
  private session = 0;

  async start() {
    const session = ++this.session;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (session !== this.session) {
        stream.getTracks().forEach((t) => t.stop()); // stop() was called while we waited
        return;
      }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser); // not connected to speakers
      this.ctx = ctx;
      this.stream = stream;
      this.inner = new AnalyserAmplitude(analyser, { noiseFloor: 0.008, gain: 7 });
    } catch (err) {
      // Visual only: speech recognition reports mic problems to the user.
      console.warn("[mic] level meter unavailable:", err);
    }
  }

  stop() {
    this.session++;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.inner = null;
  }

  level(): number {
    return this.inner?.level() ?? 0;
  }
}

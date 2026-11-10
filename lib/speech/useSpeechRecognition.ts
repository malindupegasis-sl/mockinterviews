"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isIOS, isWebKitBrowser } from "../platform";

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // Chrome/Edge expose both; Safari 14.1+ (macOS and iOS) only the webkit-prefixed one.
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/** Lower-case, punctuation-free form for comparing transcripts. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Joins transcript pieces. Chrome sends separate segments ("I led" + "the team"),
 * but Safari on iOS often sends cumulative ones ("I led", "I led the team"), so if
 * one piece already contains the other we keep the longer instead of repeating it.
 */
function merge(acc: string, next: string): string {
  const a = acc.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  const na = norm(a);
  const nb = norm(b);
  if (nb.startsWith(na)) return b;
  if (na.endsWith(nb) || na.includes(nb)) return a;
  return `${a} ${b}`;
}

/** Plain-English fix for a recognition error, specific to the user's browser. */
function errorMessage(code: string): string {
  const ios = isIOS();
  const safari = isWebKitBrowser();
  const typeInstead = " You can type your answer instead.";
  switch (code) {
    case "not-allowed":
      return ios
        ? "Microphone access is blocked. Allow it in Settings > Safari > Microphone (or tap “aA” in the address bar > Website Settings > Microphone > Allow), then reload." + typeInstead
        : safari
          ? "Microphone access is blocked. In Safari, choose Safari > Settings for This Website > Microphone > Allow, then reload." + typeInstead
          : "Microphone access is blocked. Click the site icon in the address bar, allow the microphone, then reload." + typeInstead;
    case "service-not-allowed":
      return ios || safari
        ? "Speech recognition is turned off on this device. Turn on Dictation (on iPhone: Settings > General > Keyboard > Enable Dictation; on Mac: System Settings > Keyboard > Dictation), then reload." + typeInstead
        : "Speech recognition isn't allowed in this browser." + typeInstead;
    case "audio-capture":
      return "No microphone was found. Check it's connected and not in use by another app." + typeInstead;
    case "network":
      return "Speech recognition needs an internet connection. Check your connection and try again." + typeInstead;
    case "language-not-supported":
      return "Speech recognition for English (UK) isn't available here." + typeInstead;
    default:
      return `Speech recognition stopped (${code}).` + typeInstead;
  }
}

/**
 * Push-to-talk speech recognition (en-GB, live interim results).
 *
 * start() begins listening; stop() resolves with the final transcript. Browsers
 * end a session after a pause, so we restart transparently until stop() is
 * called. If recognition can't continue (it keeps ending immediately, or Safari
 * refuses a restart without a tap), listening stops and `onEndedEarly` receives
 * whatever was recognised, so the mic button is never left stuck.
 */
export function useSpeechRecognition(opts: { onEndedEarly?: (text: string) => void } = {}) {
  // false on the server and during hydration, then the real value in the browser.
  const supported = useSyncExternalStore(noop, () => getRecognitionCtor() !== null, () => false);

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognition | null>(null);
  const wantRef = useRef(false); // true while the user wants the mic on
  const committedRef = useRef(""); // text from earlier (auto-restarted) sessions
  const sessionRef = useRef(""); // text from the current session
  const stopResolverRef = useRef<((text: string) => void) | null>(null);
  const sessionsRef = useRef(0); // sessions in this answer (0 = the one started by the tap)
  const sessionStartRef = useRef(0);
  const sessionHadResultRef = useRef(false);
  const quickEndsRef = useRef(0); // consecutive sessions that ended at once with nothing heard
  const onEndedEarlyRef = useRef(opts.onEndedEarly);
  useEffect(() => {
    onEndedEarlyRef.current = opts.onEndedEarly;
  });

  const fullText = () => merge(committedRef.current, sessionRef.current);

  /** Stops everything and hands the text to whoever is waiting (stop() or onEndedEarly). */
  const finish = useCallback((early: boolean) => {
    const rec = recRef.current;
    recRef.current = null;
    wantRef.current = false;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
    committedRef.current = fullText();
    sessionRef.current = "";
    setListening(false);
    const text = committedRef.current;
    const resolve = stopResolverRef.current;
    stopResolverRef.current = null;
    if (resolve) resolve(text);
    else if (early) onEndedEarlyRef.current?.(text);
  }, []);

  const startSession = useCallback(
    (rec: SpeechRecognition) => {
      sessionStartRef.current = Date.now();
      sessionHadResultRef.current = false;
      try {
        rec.start();
        return true;
      } catch (err) {
        console.warn("[stt] start failed:", err);
        return false;
      }
    },
    [],
  );

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || wantRef.current) return;
    committedRef.current = "";
    sessionRef.current = "";
    sessionsRef.current = 0;
    quickEndsRef.current = 0;
    setTranscript("");
    setError(null);

    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      sessionHadResultRef.current = true;
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finals = merge(finals, t);
        else interim = merge(interim, t);
      }
      sessionRef.current = merge(finals, interim);
      setTranscript(fullText());
    };

    rec.onerror = (e) => {
      // Routine: the session ends and onend decides whether to restart.
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Safari may refuse an automatic restart without a fresh tap: not a permission problem.
      if (sessionsRef.current > 0 && (e.error === "not-allowed" || e.error === "service-not-allowed")) {
        finish(true);
        return;
      }
      setError(errorMessage(e.error));
      finish(fullText().trim() !== ""); // hand back anything already heard
    };

    rec.onend = () => {
      if (recRef.current !== rec) return; // already finished
      committedRef.current = fullText();
      sessionRef.current = "";
      if (!wantRef.current) {
        finish(false); // stop() was called: resolves its promise
        return;
      }
      // The browser ended the session on its own (usually a pause). Restart, unless
      // it keeps ending at once with nothing heard, which means it can't continue.
      const quick = Date.now() - sessionStartRef.current < 1500 && !sessionHadResultRef.current;
      quickEndsRef.current = quick ? quickEndsRef.current + 1 : 0;
      if (quickEndsRef.current >= 3) {
        finish(true);
        return;
      }
      sessionsRef.current++;
      if (!startSession(rec)) finish(true);
    };

    recRef.current = rec;
    wantRef.current = true;
    setListening(true);
    if (!startSession(rec)) {
      setError("Couldn't start the microphone. You can type your answer instead.");
      finish(false);
    }
  }, [finish, startSession]);

  /** Stops listening and resolves with everything recognised since start(). */
  const stop = useCallback((): Promise<string> => {
    const rec = recRef.current;
    wantRef.current = false;
    if (!rec) {
      setListening(false);
      return Promise.resolve(fullText());
    }
    return new Promise((resolve) => {
      stopResolverRef.current = resolve;
      try {
        rec.stop(); // final results arrive, then onend → finish()
      } catch {
        finish(false);
      }
      // Safety net: Safari sometimes never fires onend after stop().
      setTimeout(() => {
        if (stopResolverRef.current === resolve) finish(false);
      }, 2000);
    });
  }, [finish]);

  /** Stops without returning anything (e.g. on unmount). */
  const abort = useCallback(() => {
    stopResolverRef.current = null;
    onEndedEarlyRef.current = undefined;
    finish(false);
  }, [finish]);

  useEffect(() => abort, [abort]);

  return { supported, listening, transcript, error, start, stop, abort };
}

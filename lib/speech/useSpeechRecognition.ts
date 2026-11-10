"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/**
 * Push-to-talk speech recognition (en-GB, live interim results).
 * start() begins listening; stop() resolves with the final transcript.
 * Chrome ends a session after a pause in speech, so we transparently restart
 * until stop() is called, keeping what was already recognised.
 */
export function useSpeechRecognition() {
  // false on the server and during hydration, then the real value in the browser.
  const supported = useSyncExternalStore(noop, () => getRecognitionCtor() !== null, () => false);

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognition | null>(null);
  const wantRef = useRef(false); // true while the user wants the mic on
  const committedRef = useRef(""); // text finalised in earlier (auto-restarted) sessions
  const sessionFinalRef = useRef(""); // finalised text in the current session
  const interimRef = useRef("");
  const stopResolverRef = useRef<((text: string) => void) | null>(null);

  const fullText = () =>
    [committedRef.current, sessionFinalRef.current, interimRef.current]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");

  const startSession = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + " ";
        else interim += r[0].transcript + " ";
      }
      sessionFinalRef.current = finals;
      interimRef.current = interim;
      setTranscript(fullText());
    };

    rec.onerror = (e) => {
      // "no-speech" and "aborted" are routine; the session simply ends and may restart.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantRef.current = false;
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in your browser settings, or type your answer instead."
          : `Speech recognition error (${e.error}). You can type your answer instead.`,
      );
    };

    rec.onend = () => {
      // Keep whatever this session recognised, including unfinalised words.
      committedRef.current = fullText();
      sessionFinalRef.current = "";
      interimRef.current = "";

      if (wantRef.current) {
        // Chrome stopped on a pause; restart the same instance and keep listening.
        try {
          rec.start();
          return;
        } catch {
          wantRef.current = false;
        }
      }
      recRef.current = null;
      setListening(false);
      stopResolverRef.current?.(committedRef.current);
      stopResolverRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.error("[stt] start failed:", err);
      wantRef.current = false;
      recRef.current = null;
      setListening(false);
      setError("Couldn't start the microphone. You can type your answer instead.");
    }
  }, []);

  const start = useCallback(() => {
    if (!getRecognitionCtor() || wantRef.current) return;
    committedRef.current = "";
    sessionFinalRef.current = "";
    interimRef.current = "";
    setTranscript("");
    setError(null);
    wantRef.current = true;
    setListening(true);
    startSession();
  }, [startSession]);

  /** Stops listening and resolves with everything recognised since start(). */
  const stop = useCallback((): Promise<string> => {
    wantRef.current = false;
    const rec = recRef.current;
    if (!rec) {
      setListening(false);
      return Promise.resolve(fullText());
    }
    return new Promise((resolve) => {
      stopResolverRef.current = resolve;
      rec.stop(); // final results arrive, then onend resolves
      // Safety net in case onend never fires.
      setTimeout(() => {
        if (stopResolverRef.current === resolve) {
          stopResolverRef.current = null;
          recRef.current = null;
          setListening(false);
          resolve(fullText());
        }
      }, 2000);
    });
  }, []);

  /** Stops without returning anything (e.g. on unmount). */
  const abort = useCallback(() => {
    wantRef.current = false;
    stopResolverRef.current = null;
    recRef.current?.abort();
    recRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => abort, [abort]);

  return { supported, listening, transcript, error, start, stop, abort };
}

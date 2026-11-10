"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripCompletionToken } from "@/lib/completion";
import { streamInterviewerTurn } from "@/lib/interviewClient";
import { SentenceSplitter } from "@/lib/sentences";
import { Speaker, type SpeakerMode } from "@/lib/speech/Speaker";
import { useSpeechRecognition } from "@/lib/speech/useSpeechRecognition";
import type { ChatMessage } from "@/lib/types";
import { LIMITS } from "@/lib/types";
import type { InterviewConfig } from "./SetupForm";
import VoicePicker from "./VoicePicker";
import { loadVoiceChoice, type VoiceName } from "@/lib/speech/voices";

/** Whose turn it is. "interviewer" covers both waiting for Claude and speaking. */
type Turn = "interviewer" | "candidate" | "complete" | "error";

export default function InterviewScreen({
  config,
  onExit,
}: {
  config: InterviewConfig;
  onExit: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [turn, setTurn] = useState<Turn>("interviewer");
  const [speaking, setSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false); // finalising speech recognition
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [voiceMode, setVoiceMode] = useState<SpeakerMode | null>(null);
  const [voiceChoice, setVoiceChoice] = useState<VoiceName>(() => loadVoiceChoice());

  const stt = useSpeechRecognition();
  const speakerRef = useRef<Speaker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skippedRef = useRef(false); // user interrupted the current interviewer turn
  const bottomRef = useRef<HTMLDivElement>(null);

  /** Requests the interviewer's next turn and speaks it sentence by sentence as it streams. */
  const requestTurn = useCallback(
    async (history: ChatMessage[]) => {
      const speaker = speakerRef.current;
      if (!speaker) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      speaker.stop();
      speaker.beginTurn();
      skippedRef.current = false;
      const splitter = new SentenceSplitter();
      setTurn("interviewer");
      setError(null);
      setNotice(null);
      setStreamingText("");

      try {
        const raw = await streamInterviewerTurn(
          { context: config.context, numQuestions: config.numQuestions, messages: history },
          (soFar) => {
            const visible = stripCompletionToken(soFar).text;
            setStreamingText(visible);
            for (const sentence of splitter.push(visible)) {
              if (!skippedRef.current) speaker.enqueue(sentence);
            }
          },
          controller.signal,
        );
        const { text, complete } = stripCompletionToken(raw);
        for (const sentence of splitter.flush(text)) {
          if (!skippedRef.current) speaker.enqueue(sentence);
        }
        setMessages([...history, { role: "assistant", content: text }]);
        setStreamingText("");

        // Only hand the turn over (and allow the mic) once the interviewer has finished speaking.
        await speaker.waitUntilIdle();
        if (controller.signal.aborted) return;
        setTurn(complete ? "complete" : "candidate");
      } catch (err) {
        if (controller.signal.aborted) return;
        speaker.stop();
        setStreamingText("");
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setTurn("error");
      }
    },
    [config.context, config.numQuestions],
  );

  // Set up audio and start the interview. Cleanup fully tears down, so React
  // Strict Mode's mount → unmount → mount in development is harmless.
  useEffect(() => {
    const speaker = new Speaker();
    speaker.voiceChoice = loadVoiceChoice();
    speaker.onSpeakingChange = setSpeaking;
    speaker.onModeChange = setVoiceMode;
    speakerRef.current = speaker;

    let cancelled = false;
    speaker.init().then((mode) => {
      if (cancelled) return;
      setVoiceMode(mode);
      requestTurn([]);
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      speaker.dispose();
      speakerRef.current = null;
    };
  }, [requestTurn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText, stt.transcript]);

  const submitAnswer = useCallback(
    (answer: string) => {
      const trimmed = answer.trim().slice(0, LIMITS.answerMaxChars);
      if (!trimmed || turn !== "candidate") return;
      const history: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
      setMessages(history);
      setDraft("");
      requestTurn(history);
    },
    [messages, requestTurn, turn],
  );

  /** Tap to start, tap again to stop and submit. */
  const toggleMic = useCallback(async () => {
    if (turn !== "candidate" || processing) return;
    if (!stt.listening) {
      setNotice(null);
      stt.start();
      return;
    }
    setProcessing(true);
    const text = await stt.stop();
    setProcessing(false);
    if (text.trim()) submitAnswer(text);
    else setNotice("I didn't catch anything. Tap the mic and try again, or type your answer.");
  }, [turn, processing, stt, submitAnswer]);

  /** Interrupt: stop the interviewer's audio and hand over the turn (once the text has arrived). */
  const skip = useCallback(() => {
    if (turn !== "interviewer" || !speaking) return;
    skippedRef.current = true;
    speakerRef.current?.stop();
  }, [turn, speaking]);

  // Spacebar shortcut for the mic (ignored while typing or when a control has focus).
  // Space interrupts the interviewer while they're speaking; otherwise it toggles the mic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, [contenteditable]")) return;
      if (turn === "interviewer" && speaking) {
        e.preventDefault();
        skip();
      } else if (stt.supported) {
        e.preventDefault();
        void toggleMic();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stt.supported, toggleMic, skip, turn, speaking]);

  /** Retry after an error: re-send the transcript as it stands. */
  const retry = () => requestTurn(messages);

  const status =
    turn === "interviewer"
      ? speaking
        ? "Speaking"
        : "Processing"
      : turn === "candidate"
        ? processing
          ? "Processing"
          : stt.listening
            ? "Listening"
            : "Your turn"
        : turn === "complete"
          ? "Complete"
          : "Error";

  const canAnswer = turn === "candidate" && !processing;

  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-widest text-neutral-500">
        <span className="text-red-500/60">{status}</span>
        <div className="flex items-center gap-4 normal-case tracking-normal">
          {voiceMode === "browser" && (
            <VoicePicker
              value={voiceChoice}
              onChange={(name) => {
                setVoiceChoice(name);
                if (speakerRef.current) speakerRef.current.voiceChoice = name;
              }}
            />
          )}
          <button type="button" onClick={onExit} className="uppercase tracking-widest hover:text-neutral-200">
            New interview
          </button>
        </div>
      </div>

      {!stt.supported && (
        <div className="rounded-md border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          Voice answers need Chrome or Edge (this browser doesn&apos;t support speech recognition). You
          can still type your answers below.
        </div>
      )}

      {/* Transcript */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-md border border-neutral-800 p-4">
        {messages.map((m, i) => (
          <Line key={i} role={m.role} text={m.content} />
        ))}
        {turn === "interviewer" &&
          (streamingText ? (
            <Line role="assistant" text={streamingText} />
          ) : (
            <p className="text-sm text-neutral-500">Interviewer is thinking…</p>
          ))}
        {(stt.listening || processing) && (
          <Line role="user" text={stt.transcript || "…"} live />
        )}
        {turn === "error" && (
          <div className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            <p>{error}</p>
            <button type="button" onClick={retry} className="mt-2 underline">
              Try again
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {(notice || stt.error) && <p className="text-sm text-amber-300">{stt.error ?? notice}</p>}

      {turn === "complete" ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-white px-5 py-2 text-sm font-medium text-black"
            onClick={() => alert("The feedback report is built in Phase 4.")}
          >
            Get feedback
          </button>
          <span className="text-sm text-neutral-500">Interview complete.</span>
        </div>
      ) : (
        <>
          {turn === "interviewer" && speaking && (
            <button
              type="button"
              onClick={skip}
              className="self-center rounded border border-neutral-700 px-3 py-1 text-xs uppercase tracking-widest text-neutral-400 hover:text-neutral-100"
            >
              Skip (Space)
            </button>
          )}
          {stt.supported && (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleMic()}
                disabled={!canAnswer}
                aria-pressed={stt.listening}
                aria-label={stt.listening ? "Stop and send answer" : "Start answering"}
                className={`flex h-20 w-20 items-center justify-center rounded-full border-2 text-xs uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  stt.listening ? "border-red-500 bg-red-600 text-white" : "border-red-500 text-red-400"
                }`}
              >
                {stt.listening ? "Stop" : "Talk"}
              </button>
              <span className="text-xs text-neutral-500">
                Tap or press Space to {stt.listening ? "stop and send" : "start answering"}
              </span>
            </div>
          )}

          {/* Text fallback, in case the mic doesn't work */}
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitAnswer(draft);
            }}
          >
            <textarea
              className="min-h-20 resize-y rounded-md border border-neutral-800 bg-neutral-950 p-3 text-sm leading-relaxed outline-none focus:border-neutral-500 disabled:opacity-50"
              placeholder={
                stt.listening
                  ? "Listening… tap Stop (or press Space) to send"
                  : turn === "interviewer"
                  ? speaking
                    ? "Interviewer speaking…"
                    : "Interviewer thinking…"
                  : canAnswer
                  ? stt.supported
                    ? "…or type your answer (Enter to send)"
                    : "Type your answer (Enter to send, Shift+Enter for a new line)"
                  : "Processing…"
              }
              value={draft}
              maxLength={LIMITS.answerMaxChars}
              disabled={!canAnswer || stt.listening}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitAnswer(draft);
                }
              }}
            />
            <button
              type="submit"
              disabled={!canAnswer || stt.listening || !draft.trim()}
              className="self-end rounded-md bg-white px-5 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send answer
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function Line({ role, text, live }: { role: ChatMessage["role"]; text: string; live?: boolean }) {
  return (
    <div className="text-sm leading-relaxed">
      <span className={role === "assistant" ? "text-red-400" : "text-neutral-400"}>
        {role === "assistant" ? "INTERVIEWER" : "YOU"}
      </span>
      <p className={`mt-1 whitespace-pre-wrap ${live ? "text-neutral-400 italic" : "text-neutral-100"}`}>
        {text}
      </p>
    </div>
  );
}

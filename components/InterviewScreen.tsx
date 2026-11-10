"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchQuestionFeedback, visibleTurns } from "@/lib/feedbackClient";
import { streamInterviewerTurn } from "@/lib/interviewClient";
import { SentenceSplitter } from "@/lib/sentences";
import { Speaker, type SpeakerMode } from "@/lib/speech/Speaker";
import { useSpeechRecognition } from "@/lib/speech/useSpeechRecognition";
import { loadVoiceChoice, type VoiceName } from "@/lib/speech/voices";
import type { ChatMessage, Control, InterviewConfig, QuestionFeedback } from "@/lib/types";
import { LIMITS } from "@/lib/types";
import { MicAmplitude } from "@/lib/viz/amplitude";
import DebugStrip from "./DebugStrip";
import MicButton from "./MicButton";
import Oscilloscope, { type TraceMode } from "./Oscilloscope";
import QuestionFeedbackCard from "./QuestionFeedbackCard";
import Transcript, { type TranscriptLine } from "./Transcript";
import VoicePicker from "./VoicePicker";

/**
 * Whose turn it is. "interviewer" covers waiting for Claude and speaking;
 * "review" is the practice-mode pause after a question.
 */
type Turn = "interviewer" | "candidate" | "review" | "complete" | "error";

/** One attempt at one main question, derived from the server's turn metadata. */
interface Attempt {
  question: number;
  attempt: number;
  start: number; // index of the interviewer turn that asks the question
  end?: number; // index of the turn that finished it (ack / closing / next question), exclusive
}

/** Splits the conversation into question attempts using the server-issued turn kinds. */
function deriveAttempts(messages: ChatMessage[]): Attempt[] {
  const attempts: Attempt[] = [];
  messages.forEach((m, i) => {
    const kind = m.meta?.kind;
    if (!kind || kind === "follow_up") return;
    const open = attempts[attempts.length - 1];
    if (open && open.end === undefined) open.end = i; // any question / ack / closing ends the open attempt
    if (kind === "question") {
      const q = m.meta!.question;
      attempts.push({ question: q, attempt: attempts.filter((a) => a.question === q).length + 1, start: i });
    }
  });
  return attempts;
}

interface FeedbackState {
  feedback?: QuestionFeedback;
  error?: string;
}

/** What the report screen needs once the interview is over. */
export interface FinishedInterview {
  transcript: { role: ChatMessage["role"]; content: string }[];
  practice: boolean;
}

export default function InterviewScreen({
  config,
  onExit,
  onFinish,
}: {
  config: InterviewConfig;
  onExit: () => void;
  onFinish: (result: FinishedInterview) => void;
}) {
  const practice = config.mode === "practice";

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
  const [showTranscript, setShowTranscript] = useState(false);
  const [typingOpen, setTypingOpen] = useState(false);
  const [typed] = useState(() => new Map<number, number>()); // typewriter progress per line
  const [feedbacks, setFeedbacks] = useState<Record<number, FeedbackState>>({}); // keyed by attempt start

  const stt = useSpeechRecognition();
  const speakerRef = useRef<Speaker | null>(null);
  const micRef = useRef<MicAmplitude | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const feedbackAbortRef = useRef<AbortController | null>(null);
  const skippedRef = useRef(false); // user interrupted the current interviewer turn

  const attempts = deriveAttempts(messages);
  const currentAttempt = attempts[attempts.length - 1];
  const lastMeta = [...messages].reverse().find((m) => m.meta)?.meta;

  /** Practice mode: feedback on one attempt (starts while the interviewer says "Thank you."). */
  const loadFeedback = useCallback(
    async (attempt: Attempt, allMessages: ChatMessage[]) => {
      if (attempt.end === undefined) return;
      feedbackAbortRef.current?.abort();
      const controller = new AbortController();
      feedbackAbortRef.current = controller;
      setFeedbacks((prev) => ({ ...prev, [attempt.start]: {} }));
      try {
        const feedback = await fetchQuestionFeedback(
          {
            context: config.context,
            cv: config.cv,
            difficulty: config.difficulty,
            transcript: visibleTurns(allMessages.slice(attempt.start, attempt.end)),
          },
          controller.signal,
        );
        setFeedbacks((prev) => ({ ...prev, [attempt.start]: { feedback } }));
      } catch (err) {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : "Couldn't get feedback.";
        setFeedbacks((prev) => ({ ...prev, [attempt.start]: { error } }));
      }
    },
    [config.context, config.cv, config.difficulty],
  );

  /** Asks the server for the next interviewer turn and speaks it sentence by sentence as it streams. */
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
        const { text, meta } = await streamInterviewerTurn(
          {
            context: config.context,
            cv: config.cv,
            numQuestions: config.numQuestions,
            mode: config.mode,
            difficulty: config.difficulty,
            messages: history,
          },
          (soFar) => {
            setStreamingText(soFar);
            for (const sentence of splitter.push(soFar)) {
              if (!skippedRef.current) speaker.enqueue(sentence);
            }
          },
          controller.signal,
        );
        for (const sentence of splitter.flush(text)) {
          if (!skippedRef.current) speaker.enqueue(sentence);
        }
        const all: ChatMessage[] = [...history, { role: "assistant", content: text, meta }];
        setMessages(all);
        setStreamingText("");

        // Practice mode: the server finished a question, so fetch feedback on that attempt now.
        if (practice && meta.kind === "ack") {
          const finished = deriveAttempts(all).find((a) => a.end === history.length);
          if (finished) void loadFeedback(finished, all);
        }

        // Only hand the turn over (and allow the mic) once the interviewer has finished speaking.
        await speaker.waitUntilIdle();
        if (controller.signal.aborted) return;
        setTurn(meta.kind === "closing" ? "complete" : meta.kind === "ack" ? "review" : "candidate");
      } catch (err) {
        if (controller.signal.aborted) return;
        speaker.stop();
        setStreamingText("");
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setTurn("error");
      }
    },
    [config.context, config.cv, config.numQuestions, config.mode, config.difficulty, practice, loadFeedback],
  );

  // Set up audio and start the interview. Cleanup fully tears down, so React
  // Strict Mode's mount → unmount → mount in development is harmless.
  useEffect(() => {
    const speaker = new Speaker();
    speaker.voiceChoice = loadVoiceChoice();
    speaker.onSpeakingChange = setSpeaking;
    speaker.onModeChange = setVoiceMode;
    speakerRef.current = speaker;
    const mic = new MicAmplitude();
    micRef.current = mic;

    let cancelled = false;
    speaker.init().then((mode) => {
      if (cancelled) return;
      setVoiceMode(mode);
      requestTurn([]);
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      feedbackAbortRef.current?.abort();
      speaker.dispose();
      mic.stop();
      speakerRef.current = null;
      micRef.current = null;
    };
  }, [requestTurn]);

  // Open the mic level meter only while listening (so the browser's mic indicator isn't always on).
  useEffect(() => {
    const mic = micRef.current;
    if (!mic || !stt.listening) return;
    void mic.start();
    return () => mic.stop();
  }, [stt.listening]);

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

  /** Practice mode: Next / Retry. The server decides what that means for the interview. */
  const sendControl = useCallback(
    (control: Control) => {
      feedbackAbortRef.current?.abort();
      const history: ChatMessage[] = [...messages, { role: "user", content: "", control }];
      setMessages(history);
      requestTurn(history);
    },
    [messages, requestTurn],
  );

  /** Transcript for the full report: everything (full mode), or the final attempt per question (practice). */
  const finish = () => {
    const closed = attempts.filter((a) => a.end !== undefined);
    if (!practice || closed.length === 0) {
      onFinish({ transcript: visibleTurns(messages), practice: false });
      return;
    }
    const finalByQuestion = new Map<number, Attempt>();
    for (const a of closed) finalByQuestion.set(a.question, a); // later attempts overwrite earlier ones
    const transcript = [...finalByQuestion.values()]
      .sort((a, b) => a.question - b.question)
      .flatMap((a) => visibleTurns(messages.slice(a.start, a.end)));
    onFinish({ transcript, practice: true });
  };

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
    else setNotice("Didn't catch that. Tap the mic and try again, or type your answer.");
  }, [turn, processing, stt, submitAnswer]);

  /** Interrupt: stop the interviewer's audio and hand over the turn (once the text has arrived). */
  const skip = useCallback(() => {
    if (turn !== "interviewer" || !speaking) return;
    skippedRef.current = true;
    speakerRef.current?.stop();
  }, [turn, speaking]);

  // Space interrupts the interviewer while they're speaking; otherwise it toggles the mic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, [contenteditable]")) return;
      if (turn === "interviewer" && speaking) {
        e.preventDefault();
        skip();
      } else if (turn === "candidate" && stt.supported) {
        e.preventDefault();
        void toggleMic();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stt.supported, toggleMic, skip, turn, speaking]);

  /** Retry after an error: re-send the conversation as it stands (the server re-plans the turn). */
  const retry = () => requestTurn(messages);

  // ---- Derived view state ----
  const canAnswer = turn === "candidate" && !processing;
  const textOpen = typingOpen || !stt.supported;
  const currentFeedback = currentAttempt ? feedbacks[currentAttempt.start] : undefined;
  const reviewing = turn === "review" && !currentFeedback?.feedback && !currentFeedback?.error;
  const showCard = turn === "review" && !reviewing;

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
        : turn === "review"
          ? reviewing
            ? "Reviewing"
            : "Feedback"
          : turn === "complete"
            ? "Complete"
            : "Error";

  const traceMode: TraceMode =
    turn === "interviewer"
      ? speaking
        ? "interviewer"
        : "thinking"
      : turn === "candidate"
        ? stt.listening
          ? "user"
          : processing
            ? "thinking"
            : "idle"
        : reviewing
          ? "thinking"
          : "idle";

  // Amplitude for the trace: the mic while the candidate speaks, the speaker while the interviewer does.
  const level = useCallback(() => {
    if (traceMode === "user") return micRef.current?.level() ?? 0;
    if (traceMode === "interviewer") return speakerRef.current?.amplitude.level() ?? 0;
    return 0;
  }, [traceMode]);

  const caption = reviewing
    ? "Reviewing your answer…"
    : stt.listening || processing
      ? stt.transcript || "…"
      : (stt.error ?? notice ?? "");

  const hint =
    turn === "interviewer" && speaking
      ? "Space to skip"
      : canAnswer && stt.supported
        ? stt.listening
          ? "Tap or press Space to send"
          : "Tap or press Space to answer"
        : "";

  // Transcript lines (control turns hidden), with attempt labels in practice mode.
  const transcriptLines: TranscriptLine[] = [];
  messages.forEach((m, i) => {
    if (m.control) return;
    const a = practice ? attempts.find((x) => x.start === i) : undefined;
    const multiple = a && attempts.some((x) => x.question === a.question && x.attempt > 1);
    transcriptLines.push({
      role: m.role,
      content: m.content,
      label: a ? `Question ${a.question}${multiple ? ` · Attempt ${a.attempt}` : ""}` : undefined,
    });
  });
  if (turn === "interviewer" && streamingText) transcriptLines.push({ role: "assistant", content: streamingText });

  return (
    <div className="fixed inset-0 flex flex-col bg-void">
      {/* Top bar: minimal chrome */}
      <header className="flex items-center justify-between gap-4 px-5 py-4 text-[10px] uppercase tracking-[0.3em] text-neutral-600">
        <span className="hidden sm:inline">
          Mock interview
          <span className="text-neutral-700">
            {practice && " · Practice"} · {config.difficulty}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-5 normal-case tracking-normal">
          {voiceMode === "browser" && (
            <VoicePicker
              compact
              value={voiceChoice}
              onChange={(name) => {
                setVoiceChoice(name);
                if (speakerRef.current) speakerRef.current.voiceChoice = name;
              }}
            />
          )}
          <button
            type="button"
            onClick={onExit}
            className="text-[10px] uppercase tracking-[0.3em] transition-colors hover:text-neutral-200"
          >
            New interview
          </button>
        </div>
      </header>

      {!stt.supported && (
        <div className="mx-5 border border-signal/30 px-4 py-2 text-center text-xs text-neutral-300">
          Voice answers need Chrome or Edge. You can still type your answers below.
        </div>
      )}

      {/* Centrepiece: the trace and status readout (and the practice feedback card) */}
      <main
        className={`flex min-h-0 flex-1 flex-col items-center ${showCard ? "overflow-y-auto pb-6" : "justify-center"}`}
      >
        <div className={`w-full shrink-0 ${showCard ? "h-[12vh] min-h-16" : "h-[33vh] max-h-80 min-h-32"}`}>
          <Oscilloscope mode={traceMode} level={level} />
        </div>
        <div
          aria-live="polite"
          className={`mt-6 text-[11px] uppercase tracking-[0.4em] ${
            turn === "complete" ? "font-medium text-signal" : "text-signal/60"
          }`}
        >
          {status}
        </div>
        {showCard && currentAttempt ? (
          <div className="mt-6 flex w-full justify-center px-5">
            <QuestionFeedbackCard
              question={currentAttempt.question}
              attempt={currentAttempt.attempt}
              feedback={currentFeedback?.feedback}
              error={currentFeedback?.error}
              isLast={currentAttempt.question >= config.numQuestions}
              onRetry={() => sendControl("retry")}
              onNext={() => sendControl("next")}
              onReload={() => void loadFeedback(currentAttempt, messages)}
            />
          </div>
        ) : (
          <p
            className={`mt-4 min-h-[3.5em] max-w-xl px-6 text-center text-sm leading-relaxed ${
              stt.listening || processing || reviewing ? "text-neutral-400" : "text-neutral-500"
            }`}
          >
            {caption}
          </p>
        )}
      </main>

      {/* Controls */}
      <section className="flex flex-col items-center gap-4 px-5 pb-6">
        {turn === "error" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="max-w-md text-sm text-signal">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="border border-signal/60 px-5 py-2 text-[11px] uppercase tracking-[0.3em] text-signal transition-colors hover:bg-signal hover:text-void"
            >
              Try again
            </button>
          </div>
        )}

        {turn === "complete" && (
          <button
            type="button"
            onClick={finish}
            className="border border-signal px-6 py-3 text-[11px] uppercase tracking-[0.35em] text-signal shadow-[0_0_24px_rgba(255,26,26,0.15)] transition-colors hover:bg-signal hover:text-void"
          >
            Get feedback
          </button>
        )}

        {(turn === "interviewer" || turn === "candidate") && (
          <>
            <div className="grid grid-cols-[6rem_auto_6rem] items-center gap-6">
              <div className="flex justify-end">
                {turn === "interviewer" && speaking && (
                  <button
                    type="button"
                    onClick={skip}
                    className="text-[10px] uppercase tracking-[0.3em] text-neutral-500 transition-colors hover:text-signal"
                  >
                    Skip
                  </button>
                )}
              </div>
              {stt.supported ? (
                <MicButton
                  active={stt.listening}
                  busy={processing}
                  disabled={!canAnswer}
                  onClick={() => void toggleMic()}
                />
              ) : (
                <div className="h-20 w-20" />
              )}
              <div />
            </div>
            <div className="h-4 text-[10px] uppercase tracking-[0.25em] text-neutral-600">{hint}</div>

            {textOpen && (
              <form
                className="flex w-full max-w-2xl items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitAnswer(draft);
                }}
              >
                <textarea
                  rows={2}
                  className="min-h-12 flex-1 resize-none border border-neutral-800 bg-transparent px-3 py-2 text-sm leading-relaxed text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-signal/50 disabled:opacity-40"
                  placeholder={
                    stt.listening
                      ? "Listening… tap the mic (or press Space) to send"
                      : turn === "interviewer"
                        ? speaking
                          ? "Interviewer speaking…"
                          : "Interviewer thinking…"
                        : canAnswer
                          ? "Type your answer (Enter to send, Shift+Enter for a new line)"
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
                  className="h-12 border border-signal/60 px-4 text-[10px] uppercase tracking-[0.3em] text-signal transition-colors hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-signal"
                >
                  Send
                </button>
              </form>
            )}
          </>
        )}

        <div className="flex gap-6 text-[10px] uppercase tracking-[0.3em] text-neutral-600">
          {stt.supported && (turn === "interviewer" || turn === "candidate") && (
            <button
              type="button"
              onClick={() => setTypingOpen((o) => !o)}
              className="transition-colors hover:text-neutral-300"
            >
              {typingOpen ? "Hide keyboard" : "Type instead"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowTranscript((o) => !o)}
            aria-expanded={showTranscript}
            className="transition-colors hover:text-neutral-300"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
        </div>
      </section>

      <DebugStrip difficulty={config.difficulty} total={config.numQuestions} meta={lastMeta} />

      {showTranscript && (
        <aside className="max-h-[38vh] overflow-y-auto border-t border-neutral-900 px-5 py-5">
          <div className="mx-auto max-w-2xl">
            <Transcript lines={transcriptLines} typed={typed} />
          </div>
        </aside>
      )}
    </div>
  );
}

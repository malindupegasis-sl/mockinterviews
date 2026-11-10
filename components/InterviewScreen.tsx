"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripCompletionToken } from "@/lib/completion";
import { streamInterviewerTurn } from "@/lib/interviewClient";
import type { ChatMessage } from "@/lib/types";
import { LIMITS } from "@/lib/types";
import type { InterviewConfig } from "./SetupForm";

type Status = "thinking" | "your-turn" | "complete" | "error";

export default function InterviewScreen({
  config,
  onExit,
}: {
  config: InterviewConfig;
  onExit: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [status, setStatus] = useState<Status>("thinking");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Requests the interviewer's next turn for the given transcript. */
  const requestTurn = useCallback(
    async (history: ChatMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("thinking");
      setError(null);
      setStreamingText("");

      try {
        const raw = await streamInterviewerTurn(
          { context: config.context, numQuestions: config.numQuestions, messages: history },
          (soFar) => setStreamingText(stripCompletionToken(soFar).text),
          controller.signal,
        );
        const { text, complete } = stripCompletionToken(raw);
        setMessages([...history, { role: "assistant", content: text }]);
        setStreamingText("");
        setStatus(complete ? "complete" : "your-turn");
      } catch (err) {
        if (controller.signal.aborted) return;
        setStreamingText("");
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setStatus("error");
      }
    },
    [config.context, config.numQuestions],
  );

  // Kick off the interview once (guarded against React Strict Mode double-run).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    requestTurn([]);
  }, [requestTurn]);

  // Abort any in-flight request when leaving the screen.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the latest line in view and focus the input when it's the user's turn.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText]);
  useEffect(() => {
    if (status === "your-turn") inputRef.current?.focus();
  }, [status]);

  function submitAnswer() {
    const answer = draft.trim();
    if (!answer || status !== "your-turn") return;
    const history: ChatMessage[] = [...messages, { role: "user", content: answer }];
    setMessages(history);
    setDraft("");
    requestTurn(history);
  }

  /** Retry after an error: re-send the transcript as it stands. */
  function retry() {
    // An error on the very first turn leaves an empty transcript; otherwise the
    // last message is the candidate's answer that didn't get a reply.
    requestTurn(messages);
  }

  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col gap-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-neutral-500">
        <span>Interview in progress</span>
        <button type="button" onClick={onExit} className="hover:text-neutral-200">
          New interview
        </button>
      </div>

      {/* Transcript */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-md border border-neutral-800 p-4">
        {messages.map((m, i) => (
          <Line key={i} role={m.role} text={m.content} />
        ))}
        {status === "thinking" &&
          (streamingText ? (
            <Line role="assistant" text={streamingText} />
          ) : (
            <p className="text-sm text-neutral-500">Interviewer is thinking…</p>
          ))}
        {status === "error" && (
          <div className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            <p>{error}</p>
            <button type="button" onClick={retry} className="mt-2 underline">
              Try again
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Answer input / completion */}
      {status === "complete" ? (
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
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitAnswer();
          }}
        >
          <textarea
            ref={inputRef}
            className="min-h-24 resize-y rounded-md border border-neutral-700 bg-neutral-950 p-3 text-sm leading-relaxed outline-none focus:border-neutral-400 disabled:opacity-50"
            placeholder={status === "your-turn" ? "Type your answer… (Enter to send, Shift+Enter for a new line)" : "Wait for the interviewer…"}
            value={draft}
            maxLength={LIMITS.answerMaxChars}
            disabled={status !== "your-turn"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitAnswer();
              }
            }}
          />
          <button
            type="submit"
            disabled={status !== "your-turn" || !draft.trim()}
            className="self-end rounded-md bg-white px-5 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send answer
          </button>
        </form>
      )}
    </div>
  );
}

function Line({ role, text }: { role: ChatMessage["role"]; text: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <span className={role === "assistant" ? "text-red-400" : "text-neutral-400"}>
        {role === "assistant" ? "INTERVIEWER" : "YOU"}
      </span>
      <p className="mt-1 whitespace-pre-wrap text-neutral-100">{text}</p>
    </div>
  );
}

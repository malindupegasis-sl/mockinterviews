"use client";

import type { QuestionFeedback } from "@/lib/types";
import Score from "./Score";

const label = "mb-1 text-[10px] uppercase tracking-[0.3em] text-neutral-500";

/** Practice-mode feedback for one question. For reading only, never spoken. */
export default function QuestionFeedbackCard({
  question,
  attempt,
  feedback,
  error,
  isLast,
  onRetry,
  onNext,
  onReload,
}: {
  question: number;
  attempt: number;
  feedback?: QuestionFeedback;
  error?: string;
  isLast: boolean;
  onRetry: () => void;
  onNext: () => void;
  onReload: () => void;
}) {
  return (
    <section className="w-full max-w-2xl border border-signal/25 bg-void/80 p-5 text-sm leading-relaxed sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <span className="text-[10px] uppercase tracking-[0.35em] text-signal/80">
          Question {question}
          {attempt > 1 && ` · Attempt ${attempt}`}
        </span>
        {feedback && <Score value={feedback.score} max={5} />}
      </div>

      {error && (
        <div className="mb-5">
          <p className="text-signal">{error}</p>
          <button type="button" onClick={onReload} className="mt-2 text-xs uppercase tracking-[0.25em] text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline">
            Try again
          </button>
        </div>
      )}

      {feedback && (
        <dl className="flex flex-col gap-4">
          <div>
            <dt className={label}>What worked</dt>
            <dd className="text-neutral-200">{feedback.what_worked}</dd>
          </div>
          <div>
            <dt className={label}>Biggest weakness</dt>
            <dd className="text-neutral-200">{feedback.biggest_weakness}</dd>
          </div>
          <div>
            <dt className={label}>A stronger answer would include</dt>
            <dd className="text-neutral-200">{feedback.stronger_answer}</dd>
          </div>
          <div>
            <dt className={label}>Rewrite, using only what you said</dt>
            <dd className="border-l border-signal/40 pl-4 text-neutral-300">{feedback.rewrite}</dd>
          </div>
        </dl>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="border border-neutral-700 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-neutral-300 transition-colors hover:border-neutral-400 hover:text-neutral-100"
        >
          Retry this question
        </button>
        <button
          type="button"
          onClick={onNext}
          className="border border-signal px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-signal transition-colors hover:bg-signal hover:text-void"
        >
          {isLast ? "Finish interview" : "Next question"}
        </button>
      </div>
    </section>
  );
}

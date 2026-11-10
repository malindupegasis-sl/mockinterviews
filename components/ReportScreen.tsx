"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchFullReport } from "@/lib/feedbackClient";
import type { FullReport, InterviewConfig } from "@/lib/types";
import type { FinishedInterview } from "./InterviewScreen";
import Oscilloscope from "./Oscilloscope";
import Score from "./Score";

const label = "text-[10px] uppercase tracking-[0.3em] text-neutral-500";
const sectionTitle = "mb-6 text-[11px] uppercase tracking-[0.4em] text-signal";

/** Full feedback report. Fetched once on mount; never spoken aloud. */
export default function ReportScreen({
  config,
  finished,
  onPractiseAgain,
  onNew,
}: {
  config: InterviewConfig;
  finished: FinishedInterview;
  onPractiseAgain: () => void;
  onNew: () => void;
}) {
  const [report, setReport] = useState<FullReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bump to retry
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchFullReport(
      {
        context: config.context,
        cv: config.cv,
        difficulty: config.difficulty,
        transcript: finished.transcript,
        practice: finished.practice,
      },
      controller.signal,
    )
      .then(setReport)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn't produce the report.");
      });
    return () => controller.abort();
  }, [config.context, config.cv, config.difficulty, finished, attempt]);

  const copy = useCallback(async () => {
    if (!report) return;
    const text = reportToText(report, finished);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers that block the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [report, finished]);

  // ---- Loading / error: same full-screen language as the interview ----
  if (!report) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-void">
        <div className="h-[33vh] max-h-80 min-h-32 w-full">
          <Oscilloscope mode={error ? "idle" : "thinking"} />
        </div>
        <div aria-live="polite" className="mt-6 text-[11px] uppercase tracking-[0.4em] text-signal/60">
          {error ? "Error" : "Reviewing"}
        </div>
        {error ? (
          <div className="mt-4 flex flex-col items-center gap-4 px-6 text-center">
            <p className="max-w-md text-sm text-signal">{error}</p>
            <div className="flex gap-3">
              <Button
                primary
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
              <Button onClick={onNew}>New interview</Button>
            </div>
          </div>
        ) : (
          <p className="mt-4 px-6 text-center text-sm text-neutral-400">
            Reviewing your interview…
            <span className="mt-2 block text-xs text-neutral-600">This can take up to a minute.</span>
          </p>
        )}
      </div>
    );
  }

  const weakest = report.questions[report.weakest_answer.question_index];

  return (
    <div className="min-h-dvh bg-void">
      <div className="h-[10vh] min-h-14 w-full">
        <Oscilloscope mode="idle" />
      </div>

      <article className="mx-auto flex max-w-3xl flex-col gap-14 px-5 pb-16 pt-4">
        <header className="flex flex-col gap-2">
          <h1 className="text-sm uppercase tracking-[0.5em] text-signal">Feedback report</h1>
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-600">
            {config.difficulty} · {finished.practice ? "practice" : "full interview"}
          </p>
          {finished.practice && (
            <p className="text-xs text-neutral-500">Based on your final attempt at each question.</p>
          )}
        </header>

        {/* Overall */}
        <section>
          <h2 className={sectionTitle}>Overall</h2>
          <Score value={report.overall_score} max={10} size="lg" />
          <p className="mt-6 text-base leading-relaxed text-neutral-100">{report.verdict}</p>
        </section>

        {/* Per question */}
        <section>
          <h2 className={sectionTitle}>Question by question</h2>
          <ol className="flex flex-col gap-10">
            {report.questions.map((q, i) => (
              <li key={i} className="border-l border-neutral-800 pl-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="text-sm text-neutral-100">
                    <span className="mr-3 text-signal/80">Q{i + 1}</span>
                    {q.question}
                  </p>
                  <Score value={q.score} max={5} />
                </div>
                <dl className="mt-4 flex flex-col gap-3 text-sm leading-relaxed">
                  <Row term="Your answer, in a line">{q.answer_summary}</Row>
                  <Row term="Biggest weakness">{q.biggest_weakness}</Row>
                  <Row term="A stronger answer would include">{q.stronger_answer}</Row>
                </dl>
                <AnswerText turns={q.answer_turns.map((n) => finished.transcript[n - 1]?.content).filter(Boolean)} />
              </li>
            ))}
          </ol>
        </section>

        {/* Weakest answer rewrite */}
        {weakest && (
          <section>
            <h2 className={sectionTitle}>Weakest answer, rewritten</h2>
            <p className="text-sm text-neutral-300">
              <span className="mr-3 text-signal/80">Q{report.weakest_answer.question_index + 1}</span>
              {weakest.question}
            </p>
            <blockquote className="mt-4 border-l border-signal/50 pl-5 text-sm leading-relaxed text-neutral-200">
              {report.weakest_answer.rewrite}
            </blockquote>
            <p className="mt-3 text-[11px] text-neutral-600">Uses only facts you actually stated.</p>
          </section>
        )}

        {/* Patterns */}
        <section>
          <h2 className={sectionTitle}>Top 3 patterns to fix</h2>
          <ol className="flex flex-col gap-6">
            {report.patterns.map((p, i) => (
              <li key={i} className="flex gap-5">
                <span className="text-sm tabular-nums text-signal">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-sm uppercase tracking-[0.15em] text-neutral-100">{p.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-400">{p.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="flex flex-wrap gap-3 border-t border-neutral-900 pt-8">
          <Button onClick={copy}>{copied ? "Copied" : "Copy report"}</Button>
          <Button primary onClick={onPractiseAgain}>
            Practise again with the same context
          </Button>
          <Button onClick={onNew}>New interview</Button>
        </footer>
      </article>
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={`${label} mb-1`}>{term}</dt>
      <dd className="text-neutral-300">{children}</dd>
    </div>
  );
}

/** The candidate's verbatim answer(s), collapsed by default. */
function AnswerText({ turns }: { turns: string[] }) {
  if (turns.length === 0) return null;
  return (
    <details className="group mt-4">
      <summary className={`${label} cursor-pointer list-none select-none hover:text-neutral-300 [&::-webkit-details-marker]:hidden`}>
        <span className="mr-2 inline-block w-3 text-signal/70 group-open:hidden">+</span>
        <span className="mr-2 hidden w-3 text-signal/70 group-open:inline-block">−</span>
        Your answer
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-neutral-400">
        {turns.map((t, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {t}
          </p>
        ))}
      </div>
    </details>
  );
}

function Button({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-5 py-3 text-[10px] uppercase tracking-[0.3em] transition-colors ${
        primary
          ? "border-signal text-signal hover:bg-signal hover:text-void"
          : "border-neutral-700 text-neutral-300 hover:border-neutral-400 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

/** Plain-text version for "Copy report". */
function reportToText(r: FullReport, finished: FinishedInterview): string {
  const lines: string[] = [];
  lines.push("MOCK INTERVIEW: FEEDBACK REPORT");
  if (finished.practice) lines.push("(Based on the final attempt at each question.)");
  lines.push("", `Overall: ${r.overall_score}/10`, r.verdict, "", "QUESTION BY QUESTION");
  r.questions.forEach((q, i) => {
    lines.push(
      "",
      `Q${i + 1}. ${q.question} (${q.score}/5)`,
      `Answer: ${q.answer_summary}`,
      `Biggest weakness: ${q.biggest_weakness}`,
      `A stronger answer would include: ${q.stronger_answer}`,
    );
  });
  const w = r.questions[r.weakest_answer.question_index];
  if (w) lines.push("", "WEAKEST ANSWER, REWRITTEN", `Q${r.weakest_answer.question_index + 1}. ${w.question}`, r.weakest_answer.rewrite);
  lines.push("", "TOP 3 PATTERNS TO FIX");
  r.patterns.forEach((p, i) => lines.push(`${i + 1}. ${p.title}: ${p.detail}`));
  return lines.join("\n");
}

"use client";

import { useState } from "react";
import { unlockAudio } from "@/lib/speech/unlock";
import { loadVoiceChoice } from "@/lib/speech/voices";
import { LIMITS, type Difficulty, type InterviewConfig, type InterviewMode } from "@/lib/types";
import { Footer } from "./AccessGate";
import Oscilloscope from "./Oscilloscope";
import VoicePicker from "./VoicePicker";

export type { InterviewConfig };

const CONTEXT_PLACEHOLDER = `e.g. Senior Product Manager at Monzo. Behavioural + product sense interview, second round.

Job description: Own the savings product roadmap, work with design and engineering, define success metrics...`;

const CV_PLACEHOLDER = `Optional. Paste your CV or a summary of your experience. The interviewer uses it to ask sharper follow-ups, but never reads it back.`;

const MODES: { value: InterviewMode; title: string; blurb: string }[] = [
  { value: "full", title: "Full interview", blurb: "Uninterrupted. Full report at the end." },
  { value: "practice", title: "Practice", blurb: "Feedback after each question. Retry as needed." },
];

const DIFFICULTIES: { value: Difficulty; title: string; blurb: string }[] = [
  { value: "easy", title: "Easy", blurb: "No follow-ups." },
  { value: "medium", title: "Medium", blurb: "One follow-up per question." },
  { value: "hard", title: "Hard", blurb: "Up to two follow-ups. Tougher, stricter scoring." },
];

const label = "text-[10px] uppercase tracking-[0.3em] text-neutral-500";
// text-base (16px) on phones: iOS Safari zooms the page into smaller inputs.
const field =
  "resize-y border border-neutral-800 bg-transparent p-4 text-base sm:text-sm leading-relaxed text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-signal/50";

export default function SetupForm({
  initial,
  onStart,
}: {
  initial?: InterviewConfig;
  onStart: (config: InterviewConfig) => void;
}) {
  const [context, setContext] = useState(initial?.context ?? "");
  const [cv, setCv] = useState(initial?.cv ?? "");
  const [numQuestions, setNumQuestions] = useState(initial?.numQuestions ?? LIMITS.defaultQuestions);
  const [mode, setMode] = useState<InterviewMode>(initial?.mode ?? "full");
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? "medium");
  const [voice, setVoice] = useState<string | null>(() => loadVoiceChoice());

  const trimmed = context.trim();
  const valid =
    trimmed.length > 0 &&
    context.length <= LIMITS.contextMaxChars &&
    cv.length <= LIMITS.cvMaxChars &&
    numQuestions >= LIMITS.minQuestions &&
    numQuestions <= LIMITS.maxQuestions;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Idle trace, breathing */}
      <div className="h-[16vh] min-h-20 w-full">
        <Oscilloscope mode="idle" />
      </div>

      <form
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 pb-12 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          // Must run inside the tap: iOS only allows audio that a user gesture started.
          unlockAudio();
          onStart({ context: trimmed, cv: cv.trim(), numQuestions, mode, difficulty });
        }}
      >
        <header className="space-y-3">
          <h1 className="text-sm uppercase tracking-[0.5em] text-signal">Mock interview</h1>
          <p className="text-sm leading-relaxed text-neutral-500">
            Describe the interview you&apos;re preparing for. You&apos;ll be interviewed by voice,
            one question at a time, then given a direct feedback report.
          </p>
        </header>

        <label className="flex flex-col gap-3">
          <span className={label}>Interview context</span>
          <textarea
            className={`min-h-52 ${field}`}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={LIMITS.contextMaxChars}
            placeholder={CONTEXT_PLACEHOLDER}
            required
          />
          <Counter hint="Role, company, job description, interview type, seniority" n={context.length} max={LIMITS.contextMaxChars} />
        </label>

        <label className="flex flex-col gap-3">
          <span className={label}>
            Your background / CV <span className="normal-case tracking-normal text-neutral-700">(optional)</span>
          </span>
          <textarea
            className={`min-h-32 ${field}`}
            value={cv}
            onChange={(e) => setCv(e.target.value)}
            maxLength={LIMITS.cvMaxChars}
            placeholder={CV_PLACEHOLDER}
          />
          <Counter hint="Used privately for follow-ups and feedback" n={cv.length} max={LIMITS.cvMaxChars} />
        </label>

        <Choice legend="Mode" name="mode" options={MODES} value={mode} onChange={setMode} />
        <Choice legend="Difficulty" name="difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} cols={3} />

        <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
          <label className="flex items-center gap-4">
            <span className={label}>Questions</span>
            <input
              type="number"
              className="w-16 border border-neutral-800 bg-transparent px-2 py-1.5 text-center text-base sm:text-sm text-neutral-200 outline-none transition-colors focus:border-signal/50"
              min={LIMITS.minQuestions}
              max={LIMITS.maxQuestions}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
            />
          </label>
          <VoicePicker value={voice} onChange={setVoice} />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button
            type="submit"
            disabled={!valid}
            className="border border-signal px-6 py-3 text-[11px] uppercase tracking-[0.35em] text-signal transition-colors hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-700 disabled:hover:bg-transparent"
          >
            Start interview
          </button>
          <p className="text-xs text-neutral-500">Nothing you enter is saved.</p>
        </div>
      </form>
      <Footer />
    </div>
  );
}

function Counter({ hint, n, max }: { hint: string; n: number; max: number }) {
  return (
    <span className="flex justify-between gap-4 text-[11px] text-neutral-600">
      <span>{hint}</span>
      <span className={n > max * 0.9 ? "text-signal/80" : ""}>
        {n}/{max}
      </span>
    </span>
  );
}

function Choice<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  cols = 2,
}: {
  legend: string;
  name: string;
  options: { value: T; title: string; blurb: string }[];
  value: T;
  onChange: (v: T) => void;
  cols?: 2 | 3;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={`${label} mb-3`}>{legend}</legend>
      <div className={`grid gap-3 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer border px-4 py-3 transition-colors has-[:focus-visible]:border-signal ${
              value === o.value ? "border-signal/70" : "border-neutral-800 hover:border-neutral-600"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className={`block text-xs uppercase tracking-[0.25em] ${value === o.value ? "text-signal" : "text-neutral-300"}`}>
              {o.title}
            </span>
            <span className="mt-1 block text-xs text-neutral-500">{o.blurb}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

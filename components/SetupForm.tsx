"use client";

import { useState } from "react";
import { loadVoiceChoice, type VoiceName } from "@/lib/speech/voices";
import { LIMITS } from "@/lib/types";
import Oscilloscope from "./Oscilloscope";
import VoicePicker from "./VoicePicker";

export interface InterviewConfig {
  context: string;
  numQuestions: number;
}

const PLACEHOLDER = `e.g. Senior Product Manager at Monzo. Behavioural + product sense interview, second round.

Job description: Own the savings product roadmap, work with design and engineering, define success metrics...`;

const label = "text-[10px] uppercase tracking-[0.3em] text-neutral-500";

export default function SetupForm({
  initial,
  onStart,
}: {
  initial?: InterviewConfig;
  onStart: (config: InterviewConfig) => void;
}) {
  const [context, setContext] = useState(initial?.context ?? "");
  const [numQuestions, setNumQuestions] = useState(
    initial?.numQuestions ?? LIMITS.defaultQuestions,
  );
  const [voice, setVoice] = useState<VoiceName>(() => loadVoiceChoice());

  const trimmed = context.trim();
  const valid =
    trimmed.length > 0 &&
    context.length <= LIMITS.contextMaxChars &&
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
          if (valid) onStart({ context: trimmed, numQuestions });
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
            className="min-h-60 resize-y border border-neutral-800 bg-transparent p-4 text-sm leading-relaxed text-neutral-200 outline-none transition-colors placeholder:text-neutral-700 focus:border-signal/50"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={LIMITS.contextMaxChars}
            placeholder={PLACEHOLDER}
            required
          />
          <span className="flex justify-between gap-4 text-[11px] text-neutral-600">
            <span>Role, company, job description, interview type, seniority</span>
            <span className={context.length > LIMITS.contextMaxChars * 0.9 ? "text-signal/80" : ""}>
              {context.length}/{LIMITS.contextMaxChars}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
          <label className="flex items-center gap-4">
            <span className={label}>Questions</span>
            <input
              type="number"
              className="w-16 border border-neutral-800 bg-transparent px-2 py-1.5 text-center text-sm text-neutral-200 outline-none transition-colors focus:border-signal/50"
              min={LIMITS.minQuestions}
              max={LIMITS.maxQuestions}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
            />
          </label>
          <VoicePicker value={voice} onChange={setVoice} />
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="self-start border border-signal px-6 py-3 text-[11px] uppercase tracking-[0.35em] text-signal transition-colors hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-700 disabled:hover:bg-transparent"
        >
          Start interview
        </button>
      </form>
    </div>
  );
}

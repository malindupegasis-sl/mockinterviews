"use client";

import { useState } from "react";
import { loadVoiceChoice, type VoiceName } from "@/lib/speech/voices";
import { LIMITS } from "@/lib/types";
import VoicePicker from "./VoicePicker";

export interface InterviewConfig {
  context: string;
  numQuestions: number;
}

const PLACEHOLDER = `e.g. Senior Product Manager at Monzo. Behavioural + product sense interview, second round.

Job description: Own the savings product roadmap, work with design and engineering, define success metrics...`;

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
    <form
      className="flex w-full max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onStart({ context: trimmed, numQuestions });
      }}
    >
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Mock interview</h1>
        <p className="text-sm text-neutral-400">
          Describe the interview you&apos;re preparing for. The interviewer asks one
          question at a time, then gives you a feedback report at the end.
        </p>
      </header>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Interview context</span>
        <textarea
          className="min-h-56 resize-y rounded-md border border-neutral-700 bg-neutral-950 p-3 text-sm leading-relaxed outline-none focus:border-neutral-400"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          maxLength={LIMITS.contextMaxChars}
          placeholder={PLACEHOLDER}
          required
        />
        <span className="self-end text-xs text-neutral-500">
          Role, company, job description, interview type (behavioural / case /
          technical), seniority · {context.length}/{LIMITS.contextMaxChars}
        </span>
      </label>

      <label className="flex items-center gap-3">
        <span className="text-sm font-medium">Number of questions</span>
        <input
          type="number"
          className="w-20 rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm outline-none focus:border-neutral-400"
          min={LIMITS.minQuestions}
          max={LIMITS.maxQuestions}
          value={numQuestions}
          onChange={(e) => setNumQuestions(Number(e.target.value))}
        />
      </label>

      <VoicePicker value={voice} onChange={setVoice} />

      <button
        type="submit"
        disabled={!valid}
        className="self-start rounded-md bg-white px-5 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start interview
      </button>
    </form>
  );
}

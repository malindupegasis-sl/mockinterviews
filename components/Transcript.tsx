"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/types";

export interface TranscriptLine {
  role: Role;
  content: string;
  /** Optional divider shown above the line, e.g. "Question 2 · Attempt 1". */
  label?: string;
}
import { useReducedMotion } from "@/lib/viz/useReducedMotion";

const CHARS_PER_SECOND = 40;

/**
 * Transcript drawer. Each line types out character by character the first time
 * it's shown; `typed` (owned by the parent) remembers how far each line got, so
 * closing and reopening the drawer doesn't retype lines already shown.
 */
export default function Transcript({
  lines,
  typed,
}: {
  lines: TranscriptLine[];
  typed: Map<number, number>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const scrollToEnd = useCallback(() => bottomRef.current?.scrollIntoView({ block: "end" }), []);

  return (
    <div className="flex flex-col gap-5 text-[13px] leading-relaxed">
      {lines.length === 0 && <p className="text-neutral-600">Nothing yet.</p>}
      {lines.map((line, i) => (
        <div key={i}>
          {line.label && (
            <div className="mb-4 mt-2 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-neutral-600">
              <span>{line.label}</span>
              <span className="h-px flex-1 bg-neutral-900" />
            </div>
          )}
          <div
            className={`mb-1 text-[10px] uppercase tracking-[0.25em] ${
              line.role === "assistant" ? "text-signal/70" : "text-neutral-500"
            }`}
          >
            {line.role === "assistant" ? "Interviewer" : "You"}
          </div>
          <TypeLine
            text={line.content}
            index={i}
            typed={typed}
            instant={reducedMotion}
            onProgress={scrollToEnd}
            className={line.role === "assistant" ? "text-neutral-100" : "text-neutral-400"}
          />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function TypeLine({
  text,
  index,
  typed,
  instant,
  onProgress,
  className,
}: {
  text: string;
  index: number;
  typed: Map<number, number>;
  instant: boolean;
  onProgress: () => void;
  className: string;
}) {
  const [shown, setShown] = useState(() => (instant ? text.length : Math.min(typed.get(index) ?? 0, text.length)));
  const shownRef = useRef(shown);
  const done = shown >= text.length;

  // Advance with requestAnimationFrame until caught up with the (possibly still growing) text.
  useEffect(() => {
    if (instant) {
      typed.set(index, text.length);
      return;
    }
    if (shownRef.current >= text.length) return; // nothing new to type
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      carry += ((now - last) / 1000) * CHARS_PER_SECOND;
      last = now;
      const step = Math.floor(carry);
      if (step > 0) {
        carry -= step;
        const behind = text.length - shownRef.current;
        // Catch up faster when far behind (e.g. opening the drawer mid-interview).
        const next = Math.min(text.length, shownRef.current + Math.max(step, Math.ceil(behind / 60)));
        shownRef.current = next;
        typed.set(index, next);
        setShown(next);
        onProgress();
        if (next >= text.length) return; // caught up: stop until the text grows
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, index, typed, instant, onProgress]);

  const visible = instant ? text : text.slice(0, shown);
  return <p className={`whitespace-pre-wrap ${done || instant ? "" : "caret"} ${className}`}>{visible}</p>;
}

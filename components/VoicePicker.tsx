"use client";

import { useEffect, useState } from "react";
import {
  availableOptions,
  saveVoiceChoice,
  waitForVoices,
  type VoiceName,
} from "@/lib/speech/voices";

/**
 * Interviewer voice picker: offers only Chrome's Google UK English Male / Female.
 * If neither exists in this browser, shows a note instead (speech falls back to
 * another English voice automatically).
 */
export default function VoicePicker({
  value,
  onChange,
  className = "",
  compact = false,
}: {
  value: VoiceName;
  onChange: (name: VoiceName) => void;
  className?: string;
  /** Hide the "Voice" label on narrow screens and use short option names. */
  compact?: boolean;
}) {
  // null until the browser has loaded its voice list.
  const [options, setOptions] = useState<VoiceName[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Resolves with [] where speechSynthesis doesn't exist.
    waitForVoices().then((voices) => !cancelled && setOptions(availableOptions(voices)));
    if (typeof speechSynthesis === "undefined") return;
    // Chrome may add voices later (e.g. after network voices load).
    const update = () => setOptions(availableOptions(speechSynthesis.getVoices()));
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => {
      cancelled = true;
      speechSynthesis.removeEventListener("voiceschanged", update);
    };
  }, []);

  if (options === null) return null;
  if (options.length === 0)
    return <p className={`text-[11px] text-neutral-500 ${className}`}>For the best voice, use Chrome.</p>;

  // If the saved choice isn't available here, show the voice that will actually be used.
  const selected = options.includes(value) ? value : options[0];

  return (
    <label className={`flex items-center gap-4 ${className}`}>
      <span className={`text-[10px] uppercase tracking-[0.3em] text-neutral-500 ${compact ? "hidden sm:inline" : ""}`}>
        Voice
      </span>
      <select
        className="border border-neutral-800 bg-void px-2 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-signal/50"
        value={selected}
        onChange={(e) => {
          const name = e.target.value as VoiceName;
          saveVoiceChoice(name);
          onChange(name);
        }}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {compact ? name.replace("Google UK English ", "UK ") : name}
          </option>
        ))}
      </select>
    </label>
  );
}

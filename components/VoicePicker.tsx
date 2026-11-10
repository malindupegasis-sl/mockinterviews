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
}: {
  value: VoiceName;
  onChange: (name: VoiceName) => void;
  className?: string;
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
    return <p className={`text-xs text-neutral-500 ${className}`}>For the best voice, use Chrome.</p>;

  // If the saved choice isn't available here, show the voice that will actually be used.
  const selected = options.includes(value) ? value : options[0];

  return (
    <label className={`flex items-center gap-2 text-xs text-neutral-400 ${className}`}>
      Voice
      <select
        className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200"
        value={selected}
        onChange={(e) => {
          const name = e.target.value as VoiceName;
          saveVoiceChoice(name);
          onChange(name);
        }}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

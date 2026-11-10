"use client";

import { useEffect, useState } from "react";
import { usePlatform } from "@/lib/platform";
import {
  GOOGLE_VOICES,
  goodVoices,
  resolveVoice,
  saveVoiceChoice,
  voiceLabel,
  waitForVoices,
} from "@/lib/speech/voices";

/**
 * Interviewer voice picker. Lists this device's good English voices, best first:
 * Chrome's Google UK voices, otherwise e.g. Daniel / Serena on Apple devices.
 */
export default function VoicePicker({
  value,
  onChange,
  className = "",
  compact = false,
}: {
  value: string | null;
  onChange: (choice: string) => void;
  className?: string;
  /** Hide the "Voice" label on narrow screens. */
  compact?: boolean;
}) {
  const { ios } = usePlatform();
  // null until the browser has loaded its voice list.
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Resolves with [] where speechSynthesis doesn't exist.
    waitForVoices().then((v) => !cancelled && setVoices(v));
    if (typeof speechSynthesis === "undefined") return;
    // Voices can arrive late (Chrome network voices, Safari).
    const update = () => setVoices(speechSynthesis.getVoices());
    speechSynthesis.addEventListener?.("voiceschanged", update);
    return () => {
      cancelled = true;
      speechSynthesis.removeEventListener?.("voiceschanged", update);
    };
  }, []);

  if (voices === null) return null;
  const options = goodVoices(voices);
  if (options.length === 0) {
    return <p className={`text-[11px] text-neutral-500 ${className}`}>No English voice found on this device.</p>;
  }

  const selected = resolveVoice(options, value) ?? options[0];
  const hasGoogle = voices.some((v) => GOOGLE_VOICES.includes(v.name));
  const hasBritish = options.some((v) => /^en[-_]GB/i.test(v.lang));
  // Nudge desktop users without a good British voice towards Chrome (pointless on iOS).
  const showChromeHint = !ios && !hasGoogle && !hasBritish;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="flex items-center gap-4">
        <span className={`text-[10px] uppercase tracking-[0.3em] text-neutral-500 ${compact ? "hidden sm:inline" : ""}`}>
          Voice
        </span>
        <select
          className="max-w-[14rem] border border-neutral-800 bg-void px-2 py-1.5 text-base text-neutral-200 outline-none transition-colors focus:border-signal/50 sm:text-xs"
          value={selected.voiceURI}
          onChange={(e) => {
            saveVoiceChoice(e.target.value);
            onChange(e.target.value);
          }}
        >
          {options.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {compact ? voiceLabel(v).replace("Google UK English ", "Google ") : voiceLabel(v)}
            </option>
          ))}
        </select>
      </label>
      {showChromeHint && <p className="text-[11px] text-neutral-600">For the best voice, use Chrome.</p>}
    </div>
  );
}

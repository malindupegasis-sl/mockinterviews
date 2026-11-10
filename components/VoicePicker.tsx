"use client";

import { useEffect, useState } from "react";
import { englishVoices } from "@/lib/speech/Speaker";

const STORAGE_KEY = "mockinterview.browserVoice";

export function loadSavedVoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Picker for the browser speechSynthesis voice (used when ElevenLabs is unavailable). */
export default function VoicePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (voiceURI: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Voices load asynchronously in most browsers.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const update = () => setVoices(englishVoices());
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  if (voices.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-xs text-neutral-400">
      Browser voice
      <select
        className="max-w-56 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200"
        value={value ?? voices[0].voiceURI}
        onChange={(e) => {
          try {
            localStorage.setItem(STORAGE_KEY, e.target.value);
          } catch {
            /* storage unavailable */
          }
          onChange(e.target.value);
        }}
      >
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
    </label>
  );
}

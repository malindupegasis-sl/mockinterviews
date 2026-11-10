"use client";

import { useState } from "react";
import InterviewScreen from "@/components/InterviewScreen";
import SetupForm, { type InterviewConfig } from "@/components/SetupForm";

export default function Home() {
  const [config, setConfig] = useState<InterviewConfig | null>(null);
  // Remember the last context so "New interview" pre-fills the form.
  const [lastConfig, setLastConfig] = useState<InterviewConfig | undefined>();
  // Bumped on every start so each interview gets a fresh component and state.
  const [sessionId, setSessionId] = useState(0);

  return (
    <main className="min-h-dvh">
      {config ? (
        <InterviewScreen key={sessionId} config={config} onExit={() => setConfig(null)} />
      ) : (
        <SetupForm
          initial={lastConfig}
          onStart={(c) => {
            setLastConfig(c);
            setSessionId((n) => n + 1);
            setConfig(c);
          }}
        />
      )}
    </main>
  );
}

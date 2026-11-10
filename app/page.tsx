"use client";

import { useState } from "react";
import InterviewScreen, { type FinishedInterview } from "@/components/InterviewScreen";
import ReportScreen from "@/components/ReportScreen";
import SetupForm from "@/components/SetupForm";
import type { InterviewConfig } from "@/lib/types";

type View =
  | { name: "setup" }
  | { name: "interview"; config: InterviewConfig }
  | { name: "report"; config: InterviewConfig; finished: FinishedInterview };

export default function Home() {
  const [view, setView] = useState<View>({ name: "setup" });
  // Remember the last setup so "New interview" pre-fills the form.
  const [lastConfig, setLastConfig] = useState<InterviewConfig | undefined>();
  // Bumped on every start so each interview gets a fresh component and state.
  const [sessionId, setSessionId] = useState(0);

  const start = (config: InterviewConfig) => {
    setLastConfig(config);
    setSessionId((n) => n + 1);
    setView({ name: "interview", config });
  };

  return (
    <main className="min-h-dvh">
      {view.name === "setup" && <SetupForm initial={lastConfig} onStart={start} />}
      {view.name === "interview" && (
        <InterviewScreen
          key={sessionId}
          config={view.config}
          onExit={() => setView({ name: "setup" })}
          onFinish={(finished) => setView({ name: "report", config: view.config, finished })}
        />
      )}
      {view.name === "report" && (
        <ReportScreen
          key={sessionId}
          config={view.config}
          finished={view.finished}
          onPractiseAgain={() => start(view.config)}
          onNew={() => setView({ name: "setup" })}
        />
      )}
    </main>
  );
}

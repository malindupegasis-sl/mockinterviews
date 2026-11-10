"use client";

import { useState } from "react";
import { setAccessCode } from "@/lib/api";
import { usePlatform } from "@/lib/platform";
import Oscilloscope from "./Oscilloscope";

/** Asks for the access code (checked server-side) before anything else. */
export default function AccessGate() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setAccessCode(code.trim() || "dev");
      else setError(data?.error ?? "Couldn't check the code. Try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="h-[16vh] min-h-20 w-full">
        <Oscilloscope mode="idle" />
      </div>
      <form
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 pt-10"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-sm uppercase tracking-[0.5em] text-signal">Mock interview</h1>
        <label className="flex flex-col gap-3">
          <span className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">Access code</span>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="border border-neutral-800 bg-transparent px-4 py-3 text-base tracking-widest sm:text-sm text-neutral-200 outline-none transition-colors focus:border-signal/50"
          />
        </label>
        {error && <p className="text-sm text-signal">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="self-start border border-signal px-6 py-3 text-[11px] uppercase tracking-[0.35em] text-signal transition-colors hover:bg-signal hover:text-void disabled:opacity-40"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
      <Footer />
    </div>
  );
}

/** "Best in Chrome." — hidden on iPhone/iPad, where every browser uses Safari's engine. */
export function Footer() {
  const { ios } = usePlatform();
  if (ios) return <footer className="py-6" />;
  return (
    <footer className="px-5 py-6 text-center text-[10px] uppercase tracking-[0.3em] text-neutral-600">
      Best in Chrome.
    </footer>
  );
}

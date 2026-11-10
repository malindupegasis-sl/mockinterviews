import type { Difficulty, TurnMeta } from "@/lib/types";

/**
 * Local-development readout of the server-owned interview state.
 * Rendered only when NODE_ENV !== "production" (so never on Vercel).
 */
export default function DebugStrip({
  difficulty,
  total,
  meta,
}: {
  difficulty: Difficulty;
  total: number;
  meta?: TurnMeta;
}) {
  if (process.env.NODE_ENV === "production") return null;
  const action = meta
    ? meta.action
      ? `${meta.action}${meta.forced ? " (forced)" : ""}`
      : meta.directive.type
    : "—";
  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-50 border border-neutral-800 bg-black/80 px-2 py-1 font-mono text-[10px] text-neutral-500">
      dev · {difficulty} · Q {meta?.question ?? "–"} of {total} · follow-ups {meta?.followUps ?? 0} · last: {action}
      {meta && <> · turn: {meta.kind}</>}
    </div>
  );
}

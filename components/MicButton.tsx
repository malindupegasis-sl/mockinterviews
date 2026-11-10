"use client";

/** Push-to-talk button: a thin red ring that fills when the mic is live. */
export default function MicButton({
  active,
  disabled,
  busy,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  busy?: boolean; // finalising the transcript
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={active ? "Stop and send answer" : "Start answering"}
      className="group relative flex h-20 w-20 items-center justify-center rounded-full border border-signal/80 transition-opacity duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal focus-visible:ring-offset-4 focus-visible:ring-offset-void disabled:cursor-not-allowed disabled:opacity-25"
    >
      {/* Fill: grows from the centre when active. */}
      <span
        className={`absolute inset-0 rounded-full bg-signal transition-transform duration-300 ease-out motion-reduce:transition-none ${
          active ? "scale-100" : "scale-0"
        }`}
      />
      {/* Soft glow when live or hovered. */}
      <span
        className={`absolute inset-0 rounded-full transition-shadow duration-300 ${
          active
            ? "shadow-[0_0_28px_rgba(255,26,26,0.55)]"
            : "group-enabled:group-hover:shadow-[0_0_16px_rgba(255,26,26,0.3)]"
        } ${busy ? "animate-pulse" : ""}`}
      />
      <svg
        viewBox="0 0 24 24"
        className={`relative h-6 w-6 transition-colors duration-300 ${active ? "text-void" : "text-signal"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    </button>
  );
}

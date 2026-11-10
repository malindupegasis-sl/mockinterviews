/** Score as "n/max" with a row of thin segments, filled in red. */
export default function Score({ value, max, size = "sm" }: { value: number; max: number; size?: "sm" | "lg" }) {
  return (
    <div className="flex items-center gap-3" aria-label={`Score ${value} out of ${max}`}>
      <span className={`tabular-nums text-signal ${size === "lg" ? "text-4xl" : "text-sm"}`}>
        {value}
        <span className="text-neutral-600">/{max}</span>
      </span>
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`${size === "lg" ? "h-2 w-4" : "h-1.5 w-3"} ${
              i < value ? "bg-signal shadow-[0_0_6px_rgba(255,26,26,0.5)]" : "bg-neutral-800"
            }`}
          />
        ))}
      </span>
    </div>
  );
}

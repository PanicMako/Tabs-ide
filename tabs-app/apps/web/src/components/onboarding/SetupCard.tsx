import "./setup-typography.css";
import type { ReactNode } from "react";

export function SetupCard({
  children,
  labelledBy,
  step,
}: {
  readonly children: ReactNode;
  readonly labelledBy: string;
  readonly step: 1 | 2 | 3;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="w-full max-w-5xl rounded-lg border border-white/20 bg-black/50 p-6 shadow-2xl shadow-black/60 backdrop-blur-3xl sm:rounded-lg sm:p-10"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div role="img" aria-label={`Setup step ${step} of 3`} className="mb-7 flex max-w-24 gap-1.5">
        {[1, 2, 3].map((position) => (
          <span
            key={position}
            aria-hidden="true"
            className={`h-1 flex-1 rounded-full ${position <= step ? "bg-[#dce4ff]" : "bg-white/20"}`}
          />
        ))}
      </div>
      {children}
    </section>
  );
}

export const SETUP_ACTION_CLASS =
  "inline-flex items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-60";
export const SETUP_BACK_CLASS =
  "inline-flex items-center gap-2 rounded-full px-3 py-3 text-xs text-white/95 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

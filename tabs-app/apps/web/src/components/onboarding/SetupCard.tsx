import type { ReactNode } from "react";

export function SetupCard({
  children,
  labelledBy,
}: {
  readonly children: ReactNode;
  readonly labelledBy: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="w-full max-w-5xl rounded-[36px] border border-white/20 bg-black/50 p-6 shadow-2xl shadow-black/60 backdrop-blur-3xl sm:rounded-[48px] sm:p-10"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      {children}
    </section>
  );
}

export const SETUP_ACTION_CLASS =
  "inline-flex items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-60";
export const SETUP_BACK_CLASS =
  "inline-flex items-center gap-2 rounded-full px-3 py-3 text-xs text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

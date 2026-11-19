import { useEffect } from "react";
import { APP_DISPLAY_NAME } from "~/branding";

export type WindowTitleStatus = "working" | "needs-input" | null;

const MAX_THREAD_TITLE = 60;

/**
 * "Needs your input · Fix the sidebar — Tabs". The status comes first so it survives a narrow
 * title bar or a window switcher that cuts the end off, and screen readers announce it on focus.
 */
export function windowTitleFor(input: {
  readonly threadTitle?: string | null | undefined;
  readonly status?: WindowTitleStatus | undefined;
  readonly appName?: string | undefined;
}): string {
  const app = input.appName ?? APP_DISPLAY_NAME;
  const raw = input.threadTitle?.trim() ?? "";
  if (raw.length === 0 && !input.status) return app;
  const title = raw.length > MAX_THREAD_TITLE ? `${raw.slice(0, MAX_THREAD_TITLE - 1)}…` : raw;
  const status =
    input.status === "needs-input"
      ? "Needs your input"
      : input.status === "working"
        ? "Working"
        : "";
  const lead = [status, title].filter((part) => part.length > 0).join(" · ");
  return `${lead} — ${app}`;
}

/** Keeps the window title on the thread being looked at, and puts it back when it goes away. */
export function useWindowTitle(title: string | null, active = true): void {
  useEffect(() => {
    if (!active || title === null) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title, active]);
}

import type { DesktopBrowserSessionState, PreviewAnnotationPayload } from "@tabs/contracts";
import { BugIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type PageErrors = NonNullable<DesktopBrowserSessionState["pageErrors"]>;

/**
 * The page's latest console error as preview context for the composer, so an
 * agent gets the message, where it came from and the page it happened on.
 */
export function pageErrorAnnotation(input: {
  readonly errors: PageErrors;
  readonly pageUrl: string;
  readonly pageTitle: string | null;
}): PreviewAnnotationPayload {
  const { errors } = input;
  const lines = [
    `Console error on this page${errors.count > 1 ? ` (${errors.count} so far; latest shown)` : ""}:`,
    errors.latest.text,
  ];
  if (errors.latest.source) lines.push(`Source: ${errors.latest.source}`);
  lines.push("Find the cause and fix it.");
  return {
    id: `page-error-${Date.parse(errors.latest.at) || Date.now()}`,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    comment: lines.join("\n"),
    elements: [],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * A quiet count of page errors in the browser toolbar. One click hands the
 * latest one to the agent as context to review before sending.
 */
export function PageErrorsChip({
  errors,
  onSend,
}: {
  readonly errors: PageErrors;
  readonly onSend: () => void;
}) {
  const label = `${errors.count} page ${errors.count === 1 ? "error" : "errors"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onSend}
            aria-label={`${label}. Send the latest to the agent`}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/8 px-2 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <BugIcon className="size-3" aria-hidden />
            <span className="tabular-nums">{label}</span>
            <span className="text-destructive/70">· Fix with agent</span>
          </button>
        }
      />
      <TooltipPopup side="bottom" align="end" className="max-w-sm">
        <span className="line-clamp-4 font-mono text-[11px]">{errors.latest.text}</span>
        {errors.latest.source ? (
          <span className="mt-1 block text-[10px] opacity-70">{errors.latest.source}</span>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}

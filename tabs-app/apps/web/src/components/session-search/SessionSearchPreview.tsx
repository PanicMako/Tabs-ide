// Right-hand pane of Session Search: the transcript around the selected hit, with matches marked.
import type { SessionSearchHit, SessionSearchPreviewResult } from "@tabs/contracts";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import { highlightTerms, SESSION_SEARCH_AGENT_LABELS } from "./sessionSearchLogic";

export type PreviewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: SessionSearchPreviewResult }
  | { readonly status: "error"; readonly message: string };

export function SessionSearchPreview(props: {
  readonly hit: SessionSearchHit;
  readonly state: PreviewState;
}) {
  const firstMatch = useRef<HTMLDivElement | null>(null);
  const { state } = props;
  useEffect(() => {
    if (state.status === "ready") firstMatch.current?.scrollIntoView({ block: "center" });
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading transcript">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="p-5 text-sm text-muted-foreground">
        Could not load this transcript. {state.message}
      </p>
    );
  }
  const { data } = state;
  const firstMatchIndex = data.messages.findIndex((message) => message.matched);
  return (
    <div className="space-y-1 p-5" data-testid="session-search-preview">
      {data.hiddenBefore > 0 ? (
        <p
          className="pb-1 text-center text-[11px] text-muted-foreground/80"
          style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
        >
          {data.hiddenBefore} earlier message{data.hiddenBefore === 1 ? "" : "s"}
        </p>
      ) : null}
      {data.messages.map((message, index) => (
        <div
          key={index}
          ref={index === firstMatchIndex ? firstMatch : undefined}
          className={cn(
            "rounded-[var(--radius-control)] px-3 py-2",
            message.matched ? "bg-foreground/6" : "",
          )}
        >
          <div
            className="mb-0.5 text-[11px] text-muted-foreground"
            style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
          >
            {message.role === "user" ? "You" : SESSION_SEARCH_AGENT_LABELS[props.hit.agent]}
          </div>
          <p
            className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90"
            style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
          >
            {highlightTerms(message.text, data.terms).map((segment, at) =>
              segment.match ? (
                <mark key={at} className="rounded-[2px] bg-foreground/20 px-0.5 text-foreground">
                  {segment.text}
                </mark>
              ) : (
                <span key={at}>{segment.text}</span>
              ),
            )}
          </p>
        </div>
      ))}
      {data.hiddenAfter > 0 ? (
        <p
          className="pt-1 text-center text-[11px] text-muted-foreground/80"
          style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
        >
          {data.hiddenAfter} more message{data.hiddenAfter === 1 ? "" : "s"} in the session
        </p>
      ) : null}
    </div>
  );
}

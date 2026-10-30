import { memo, useRef, type ReactNode } from "react";
import { useScrollRail } from "./useScrollRail";

/** The lit segment follows the visible part of a response, including while it streams. */
export const AssistantMessageBorder = memo(function AssistantMessageBorder({
  scrollContainer,
  children,
}: {
  scrollContainer: HTMLDivElement | null;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  useScrollRail(root, beam, scrollContainer, "progress");
  return (
    <div ref={root} className="group relative min-w-0 pl-4" data-assistant-rail>
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-border/40" />
      <div
        ref={beam}
        data-assistant-rail-beam
        className="pointer-events-none absolute left-0 top-0 w-px opacity-0 bg-gradient-to-b from-foreground/95 via-foreground/60 to-foreground/20"
      />
      {children}
    </div>
  );
});

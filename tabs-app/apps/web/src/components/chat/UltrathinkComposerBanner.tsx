import { BrainIcon } from "lucide-react";

import { UltrathinkBannerArt } from "./UltrathinkBannerArt";

/**
 * Set into the top of the composer while the message runs at ultrathink: the
 * whole bar is a live field of violet ripples and dots with the label on it.
 */
export function UltrathinkComposerBanner() {
  return (
    <div
      data-ultrathink-banner="true"
      className="overmind-banner relative flex h-14 shrink-0 items-center overflow-hidden border-b border-border/40 bg-muted/20 pl-3"
    >
      <UltrathinkBannerArt />
      <div className="pointer-events-none relative z-10 flex items-center gap-2 text-foreground">
        <BrainIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="text-xs font-semibold tracking-wide">Ultrathink</span>
      </div>
    </div>
  );
}

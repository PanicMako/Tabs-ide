import type { ServerProvider } from "@tabs/contracts";
import { BrainIcon, ChevronDownIcon, NetworkIcon } from "lucide-react";
import { useState } from "react";

import { useSubagentModels } from "../../state/overmindSettings";
import { OvermindBannerArt } from "./OvermindBannerArt";
import {
  SubagentTeamDialog,
  summarizeSubagentModels,
  type TeamModel,
} from "./OvermindWorkerPicker";

/**
 * Label set into the composer frame while a message is an `/overmind` goal. It
 * says who will run the tasks and opens the team without leaving the composer.
 * At ultrathink it stands for both: the lead plans at ultrathink, so the label
 * says so and the violet ripples run under the workers' colours.
 */
export function OvermindComposerChip(props: {
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly lead?: TeamModel | null | undefined;
  readonly ultrathink?: boolean;
}) {
  const settings = useSubagentModels();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        data-overmind-banner="true"
        data-ultrathink={props.ultrathink ? "true" : undefined}
        className="overmind-banner relative flex h-14 shrink-0 items-stretch overflow-hidden border-b border-border/40 bg-muted/20 pl-3"
      >
        <button
          type="button"
          aria-label={props.ultrathink ? "Overmind team, lead at Ultrathink" : "Overmind team"}
          onClick={() => setOpen(true)}
          className="relative z-10 flex min-w-0 shrink items-center gap-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <NetworkIcon
            aria-hidden="true"
            className="overmind-chip-mark size-3.5 shrink-0 text-foreground"
          />
          <span className="text-xs font-semibold tracking-wide text-foreground">Overmind</span>
          {props.ultrathink && (
            <span
              title="The lead plans at Ultrathink"
              className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-foreground"
            >
              <span aria-hidden="true" className="font-normal text-muted-foreground">
                +
              </span>
              <BrainIcon aria-hidden="true" className="size-3.5 shrink-0" />
              Ultrathink
            </span>
          )}
          <span className="truncate">{summarizeSubagentModels(settings, props.providers)}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
        </button>
        <div className="relative ml-1 min-w-0 flex-1">
          <OvermindBannerArt ultrathink={props.ultrathink ?? false} />
        </div>
      </div>
      <SubagentTeamDialog
        open={open}
        onOpenChange={setOpen}
        providers={props.providers}
        lead={props.lead ?? null}
      />
    </>
  );
}

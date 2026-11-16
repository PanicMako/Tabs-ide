import { useId, useState } from "react";

import { Button } from "../ui/button";
import type { ServerProvider } from "@tabs/contracts";

import { SubagentTeamCard, type TeamModel } from "./OvermindWorkerPicker";

export interface WorkspaceAgentsEmptyProps {
  /**
   * Hands the goal to the new conversation's composer so it can be reviewed and
   * sent. Absent where there is no composer to receive it.
   */
  readonly onStartOvermind?: ((goal: string) => void) | undefined;
  /** Providers sub-tasks may run on; the picker is hidden when empty. */
  readonly providers?: ReadonlyArray<ServerProvider> | undefined;
  /** The composer's model, which will lead. */
  readonly lead?: TeamModel | null | undefined;
}

/**
 * Agents pane for a conversation that has not started yet. Overmind needs a
 * lead thread, so instead of a dead end this lets the user write the goal now;
 * it lands in the composer, ready to send.
 */
export function WorkspaceAgentsEmpty({
  onStartOvermind,
  providers,
  lead,
}: WorkspaceAgentsEmptyProps) {
  const goalId = useId();
  const [goal, setGoal] = useState("");
  const ready = goal.trim().length > 0;

  return (
    <div className="space-y-4 p-3" aria-label="Start with agents">
      <section aria-label="Team overview" className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">Team</p>
        <SubagentTeamCard providers={providers} lead={lead ?? null} />
      </section>

      <section aria-label="About sub-agents" className="space-y-0.5 border-t border-border/50 pt-3">
        <p className="text-sm font-semibold">Sub-agents</p>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Quick helpers for a focused job, like a review or a bit of research. Ask for one in your
          message, or delegate from here once the chat is running. They work beside the chat and
          report back.
        </p>
      </section>

      <section aria-label="Overmind" className="space-y-2 border-t border-border/50 pt-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Overmind</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            For a big goal: this thread splits it into tasks, runs each as its own thread in
            parallel, then merges and reports back.
          </p>
        </div>
        {onStartOvermind ? (
          <>
            <label className="sr-only" htmlFor={goalId}>
              Goal
            </label>
            <textarea
              id={goalId}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="What should Overmind get done?"
              className="min-h-24 w-full resize-none rounded-[var(--radius-control)] border border-border/60 bg-background/40 p-2.5 text-xs placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!ready}
              onClick={() => {
                onStartOvermind(goal);
                setGoal("");
              }}
            >
              Plan with Overmind
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Or type <span className="font-mono">/overmind</span> in the composer.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Send a first message to manage this conversation’s agents and automations.
          </p>
        )}
      </section>
    </div>
  );
}

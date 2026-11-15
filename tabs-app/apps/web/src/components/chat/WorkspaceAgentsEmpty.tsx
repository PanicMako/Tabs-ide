import { useId, useState } from "react";

import { Button } from "../ui/button";

export interface WorkspaceAgentsEmptyProps {
  /**
   * Hands the goal to the new conversation's composer so it can be reviewed and
   * sent. Absent where there is no composer to receive it.
   */
  readonly onStartOvermind?: ((goal: string) => void) | undefined;
}

/**
 * Agents pane for a conversation that has not started yet. Overmind needs a
 * lead thread, so instead of a dead end this lets the user write the goal now;
 * it lands in the composer, ready to send.
 */
export function WorkspaceAgentsEmpty({ onStartOvermind }: WorkspaceAgentsEmptyProps) {
  const goalId = useId();
  const [goal, setGoal] = useState("");
  const ready = goal.trim().length > 0;

  return (
    <div className="space-y-3 p-3" aria-label="Start with agents">
      <div className="space-y-1">
        <p className="text-xs font-semibold">Run a big goal in parallel</p>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Overmind splits a goal into tasks and runs them as parallel sub-threads, each in its own
          git worktree. Delegating a single task is available once the conversation has started.
        </p>
      </div>
      {onStartOvermind ? (
        <div className="space-y-2">
          <label className="sr-only" htmlFor={goalId}>
            Goal
          </label>
          <textarea
            id={goalId}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Describe the large piece of work…"
            className="min-h-20 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background p-2 text-xs focus:border-ring focus:outline-none"
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
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Send a first message to manage this conversation’s agents and automations.
        </p>
      )}
    </div>
  );
}

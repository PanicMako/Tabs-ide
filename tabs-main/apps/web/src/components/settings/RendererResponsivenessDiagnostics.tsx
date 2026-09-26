import { useSyncExternalStore } from "react";
import { ActivityIcon, Trash2Icon } from "lucide-react";

import {
  clearRendererPerformanceSamples,
  getRendererPerformanceSnapshot,
  subscribeToRendererPerformance,
} from "../../lib/rendererPerformance";
import { Button } from "../ui/button";
import { SettingsSection } from "./SettingsLayout";

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs)} ms`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export function RendererResponsivenessDiagnostics() {
  const snapshot = useSyncExternalStore(
    subscribeToRendererPerformance,
    getRendererPerformanceSnapshot,
    getRendererPerformanceSnapshot,
  );
  const interactions = [...snapshot.interactions].reverse();
  const longTasks = [...snapshot.longTasks].reverse();
  const hasSamples = interactions.length > 0 || longTasks.length > 0;

  return (
    <SettingsSection
      title="Renderer responsiveness"
      description="Recent slow interactions and main-thread tasks in this app window. Samples stay in memory and do not include message or input contents."
      headerAction={
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={clearRendererPerformanceSamples}
          disabled={!hasSamples}
          aria-label="Clear renderer performance samples"
        >
          <Trash2Icon className="mr-1 size-3.5" aria-hidden="true" />
          Clear samples
        </Button>
      }
    >
      <div className="space-y-4 p-4 sm:p-5">
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <ActivityIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {snapshot.supported === null
            ? "Starting renderer performance capture…"
            : snapshot.supported
              ? `${interactions.length} slow interaction${interactions.length === 1 ? "" : "s"} and ${longTasks.length} main-thread task${longTasks.length === 1 ? "" : "s"} recorded in this window.`
              : "This Chromium build does not expose renderer performance entries."}
        </p>

        {interactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <caption className="sr-only">Slow renderer interactions</caption>
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Time
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Event
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Total
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Input delay
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Handler
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Next paint
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {interactions.map((interaction) => (
                  <tr key={interaction.id}>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">
                      {formatTime(interaction.occurredAt)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{interaction.event}</td>
                    <td className="py-2 pr-3 font-mono">
                      {formatDuration(interaction.durationMs)}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {formatDuration(interaction.inputDelayMs)}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {formatDuration(interaction.processingMs)}
                    </td>
                    <td className="py-2 font-mono">
                      {formatDuration(interaction.presentationDelayMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {longTasks.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-foreground">Main-thread tasks over 50 ms</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {longTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs"
                >
                  <span className="font-mono text-muted-foreground">
                    {formatTime(task.occurredAt)}
                  </span>
                  <span className="font-mono font-semibold">{formatDuration(task.durationMs)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!hasSamples && snapshot.supported ? (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
            Slow renderer activity will appear here while this window is open.
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}

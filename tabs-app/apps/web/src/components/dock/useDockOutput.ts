import { useEffect, useRef, useState } from "react";
import type { EnvironmentApi, TerminalAttachStreamEvent } from "@tabs/contracts";
export interface DockOutput {
  text: string;
  label: string;
  pid: number | null;
  exitCode: number | null;
  error: string | null;
  updated: number;
}
const EMPTY: DockOutput = {
  text: "",
  label: "",
  pid: null,
  exitCode: null,
  error: null,
  updated: 0,
};
const LIMIT = 128_000;
export function cleanDockOutput(text: string) {
  // Terminal control sequences belong in xterm; exported log context is plain text.
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}
export function reduceDockOutput(
  previous: DockOutput = EMPTY,
  event: TerminalAttachStreamEvent,
): DockOutput {
  if (event.type === "snapshot" || event.type === "restarted")
    return {
      text: cleanDockOutput(event.snapshot.history).slice(-LIMIT),
      label: event.snapshot.label,
      pid: event.snapshot.pid,
      exitCode: event.snapshot.exitCode,
      error: null,
      updated: Date.now(),
    };
  if (event.type === "output")
    return {
      ...previous,
      text: (previous.text + cleanDockOutput(event.data)).slice(-LIMIT),
      updated: Date.now(),
    };
  if (event.type === "activity") return { ...previous, label: event.label };
  if (event.type === "cleared") return { ...previous, text: "" };
  if (event.type === "exited") return { ...previous, pid: null, exitCode: event.exitCode };
  if (event.type === "error") return { ...previous, error: event.message };
  return previous;
}
export function useDockOutput(
  api: Pick<EnvironmentApi, "terminal"> | null,
  threadId: string | null,
  terminalIds: readonly string[],
) {
  const [output, setOutput] = useState<Record<string, DockOutput>>({});
  const retained = useRef<Record<string, DockOutput>>({});
  const ids = JSON.stringify([...terminalIds].sort());
  useEffect(() => {
    retained.current = {};
    setOutput({});
  }, [api, threadId]);
  useEffect(() => {
    if (!api || !threadId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const buffer = retained.current;
    const stops = (JSON.parse(ids) as string[]).map((terminalId) =>
      api.terminal.attach({ threadId, terminalId, restartIfNotRunning: false }, (event) => {
        if (!alive) return;
        buffer[terminalId] = reduceDockOutput(buffer[terminalId], event);
        if (event.type === "exited" || event.type === "error") setOutput({ ...buffer });
        if (timer === null)
          timer = setTimeout(() => {
            timer = null;
            if (alive) setOutput({ ...buffer });
          }, 80);
      }),
    );
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      stops.forEach((stop) => stop());
    };
  }, [api, threadId, ids]);
  return output;
}

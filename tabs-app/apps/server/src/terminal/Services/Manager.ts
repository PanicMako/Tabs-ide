import * as Context from "effect/Context";
/**
 * TerminalManager - Terminal session orchestration service interface.
 *
 * Owns terminal lifecycle operations, output fanout, and session state
 * transitions for thread-scoped terminals.
 *
 * @module TerminalManager
 */
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalWriteInput,
} from "@tabs/contracts";
import { PtyProcess } from "./PTY";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class TerminalError extends Schema.TaggedError<TerminalError>()("TerminalError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export interface TerminalSessionState {
  threadId: string;
  terminalId: string;
  cwd: string;
  status: TerminalSessionStatus;
  pid: number | null;
  history: string;
  pendingHistoryControlSequence: string;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
  cols: number;
  rows: number;
  process: PtyProcess | null;
  unsubscribeData: (() => void) | null;
  unsubscribeExit: (() => void) | null;
  hasRunningSubprocess: boolean;
  childCommandLabel: string | null;
  runtimeEnv: Record<string, string> | null;
}

export interface ShellCandidate {
  shell: string;
  args?: string[];
}

export interface TerminalStartInput extends TerminalOpenInput {
  cols: number;
  rows: number;
}

export { TerminalManager, type TerminalManagerShape } from "../Manager.ts";

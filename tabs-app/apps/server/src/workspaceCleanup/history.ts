// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/workspaces/cleanup/workspace-cleanup-run-history.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkspaceCleanupRun } from "@tabs/contracts";

export const HISTORY_LIMIT = 100;

const writes = new Map<string, Promise<unknown>>();

export async function readRuns(file: string): Promise<WorkspaceCleanupRun[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as WorkspaceCleanupRun[]) : [];
  } catch {
    // Missing or corrupt history is not worth failing a cleanup over.
    return [];
  }
}

/** Newest first. Writes to one file are serialized and land atomically. */
export function appendRun(file: string, run: WorkspaceCleanupRun): Promise<void> {
  const previous = writes.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const runs = [run, ...(await readRuns(file))].slice(0, HISTORY_LIMIT);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(runs), "utf8");
      await fs.rename(temp, file);
    });
  writes.set(file, next);
  return next;
}

export async function listRuns(file: string, limit = 20): Promise<WorkspaceCleanupRun[]> {
  return (await readRuns(file)).slice(0, limit);
}

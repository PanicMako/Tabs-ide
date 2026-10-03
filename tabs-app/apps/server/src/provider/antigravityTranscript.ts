import { open } from "node:fs/promises";

export interface AntigravityTranscriptStep {
  readonly type?: string;
  readonly step_index?: number;
  readonly content?: string;
  readonly thinking?: string;
  readonly thought?: string;
  readonly tool_calls?: ReadonlyArray<{
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  }> | null;
  readonly [key: string]: unknown;
}

export interface AntigravityTranscriptBatch {
  readonly steps: ReadonlyArray<AntigravityTranscriptStep>;
  readonly nextOffset: number;
}

export function parseAntigravityTranscriptLines(
  lines: ReadonlyArray<string>,
): ReadonlyArray<AntigravityTranscriptStep> {
  return lines.flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? [value as AntigravityTranscriptStep]
        : [];
    } catch {
      return [];
    }
  });
}

/** Reads only complete JSONL records so a polling session never consumes a partial write. */
export async function readAntigravityTranscript(
  path: string,
  offset: number,
): Promise<AntigravityTranscriptBatch> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (stat.size <= offset) return { steps: [], nextOffset: offset };
    const bytes = Buffer.alloc(stat.size - offset);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
    const chunk = bytes.subarray(0, bytesRead).toString("utf8");
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline < 0) return { steps: [], nextOffset: offset };
    const complete = chunk.slice(0, lastNewline);
    return {
      steps: parseAntigravityTranscriptLines(complete.split(/\r?\n/u)),
      nextOffset: offset + Buffer.byteLength(chunk.slice(0, lastNewline + 1)),
    };
  } finally {
    await file.close();
  }
}

import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { createTwoFilesPatch } from "diff";

const MAX_TEXT_BYTES = 32 * 1024;
const MAX_PATCH_BYTES = 16 * 1024;
const MAX_TOTAL_PATCH_BYTES = 128 * 1024;
const MAX_CHANGED_FILES = 40;

export interface ReviewDiffEntry {
  readonly file: string;
  readonly change: "added" | "modified" | "removed";
  readonly patch?: string;
  readonly omitted?: "binary-or-large" | "diff-too-complex" | "output-limit";
}

export interface ReviewDiff {
  readonly entries: ReadonlyArray<ReviewDiffEntry>;
  readonly truncated: boolean;
}

async function readText(root: string, file: string): Promise<string | null> {
  const path = Path.join(root, file);
  const stat = await FS.stat(path);
  if (stat.size > MAX_TEXT_BYTES || !stat.isFile()) return null;
  const bytes = await FS.readFile(path);
  if (bytes.includes(0)) return null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Array.from(decoded).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
      ? null
      : decoded;
  } catch {
    return null;
  }
}

/** A bounded reviewer aid. The exact archives remain available for full inspection. */
export async function buildReviewDiff(input: {
  readonly currentDirectory: string;
  readonly currentFiles: ReadonlyArray<string>;
  readonly priorDirectory?: string;
  readonly priorFiles?: ReadonlyArray<string>;
  readonly changedFiles: ReadonlyArray<string>;
}): Promise<ReviewDiff> {
  const current = new Set(input.currentFiles);
  const prior = new Set(input.priorFiles ?? []);
  const changed = [...new Set(input.changedFiles)].toSorted();
  const entries: ReviewDiffEntry[] = [];
  let totalBytes = 0;
  let truncated = changed.length > MAX_CHANGED_FILES;
  for (const file of changed.slice(0, MAX_CHANGED_FILES)) {
    const previous =
      prior.has(file) && input.priorDirectory ? await readText(input.priorDirectory, file) : "";
    const next = current.has(file) ? await readText(input.currentDirectory, file) : "";
    const change = !prior.has(file) ? "added" : !current.has(file) ? "removed" : "modified";
    if (previous === null || next === null) {
      entries.push({ file, change, omitted: "binary-or-large" });
      continue;
    }
    if (previous === next) continue;
    const patch = createTwoFilesPatch(
      `previous/${file}`,
      `submitted/${file}`,
      previous,
      next,
      undefined,
      undefined,
      {
        context: 3,
        maxEditLength: 1000,
        timeout: 50,
      },
    );
    if (patch === undefined) {
      entries.push({ file, change, omitted: "diff-too-complex" });
      continue;
    }
    const bytes = Buffer.byteLength(patch);
    if (bytes > MAX_PATCH_BYTES || totalBytes + bytes > MAX_TOTAL_PATCH_BYTES) {
      entries.push({ file, change, omitted: "output-limit" });
      truncated = true;
      continue;
    }
    totalBytes += bytes;
    entries.push({ file, change, patch });
  }
  return { entries, truncated };
}

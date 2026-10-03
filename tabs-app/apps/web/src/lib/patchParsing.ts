import { parsePatchFiles, type FileDiffMetadata, type Hunk } from "@pierre/diffs";
import { buildPatchCacheKey } from "./diffRendering";

export type RenderablePatch =
  | { kind: "files"; files: FileDiffMetadata[] }
  | { kind: "raw"; text: string; reason: string };

export function getRenderablePatch(patch: string, cacheScope: string): RenderablePatch | null {
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function buildHunkHeader(hunk: Hunk): string {
  if (hunk.hunkSpecs?.trim()) {
    return hunk.hunkContext?.trim()
      ? `${hunk.hunkSpecs.trim()} ${hunk.hunkContext.trim()}`
      : hunk.hunkSpecs.trim();
  }

  const deletionCount = Math.max(hunk.deletionCount, 0);
  const additionCount = Math.max(hunk.additionCount, 0);
  const deletionSegment =
    deletionCount === 1 ? `${hunk.deletionStart}` : `${hunk.deletionStart},${deletionCount}`;
  const additionSegment =
    additionCount === 1 ? `${hunk.additionStart}` : `${hunk.additionStart},${additionCount}`;
  return `@@ -${deletionSegment} +${additionSegment} @@${hunk.hunkContext?.trim() ? ` ${hunk.hunkContext.trim()}` : ""}`;
}

export function buildSingleHunkPatch(fileDiff: FileDiffMetadata, hunk: Hunk): string {
  const previousPath = fileDiff.prevName ?? fileDiff.name;
  const nextPath = fileDiff.name;
  const deletionFilePath = fileDiff.type === "new" ? "/dev/null" : `a/${previousPath}`;
  const additionFilePath = fileDiff.type === "deleted" ? "/dev/null" : `b/${nextPath}`;
  const patchLines = [
    `diff --git a/${previousPath} b/${nextPath}`,
    ...(fileDiff.prevObjectId && fileDiff.newObjectId
      ? [
          `index ${fileDiff.prevObjectId}${fileDiff.newObjectId ? `..${fileDiff.newObjectId}` : ""}${fileDiff.mode ? ` ${fileDiff.mode}` : ""}`,
        ]
      : []),
    `--- ${deletionFilePath}`,
    `+++ ${additionFilePath}`,
    buildHunkHeader(hunk),
  ];

  for (const segment of hunk.hunkContent) {
    if (segment.type === "context") {
      for (let index = 0; index < segment.lines; index += 1) {
        const line =
          fileDiff.deletionLines[segment.deletionLineIndex + index] ??
          fileDiff.additionLines[segment.additionLineIndex + index] ??
          "";
        patchLines.push(` ${line}`);
      }
      continue;
    }

    for (let index = 0; index < segment.deletions; index += 1) {
      const line = fileDiff.deletionLines[segment.deletionLineIndex + index] ?? "";
      patchLines.push(`-${line}`);
    }
    for (let index = 0; index < segment.additions; index += 1) {
      const line = fileDiff.additionLines[segment.additionLineIndex + index] ?? "";
      patchLines.push(`+${line}`);
    }
  }

  if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
    patchLines.push("\\ No newline at end of file");
  }

  return `${patchLines.join("\n")}\n`;
}

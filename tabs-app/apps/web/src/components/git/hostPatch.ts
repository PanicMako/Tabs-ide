export interface PatchFile {
  /** The path the change leaves behind (the new name, or the old one for a deletion). */
  readonly path: string;
  readonly text: string;
  readonly additions: number;
  readonly deletions: number;
}

/** Splits a unified patch into the files it changes, in order. */
export function splitPatchByFile(patch: string): ReadonlyArray<PatchFile> {
  const files: Array<{ header: string; lines: Array<string> }> = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) files.push({ header: line, lines: [line] });
    else files.at(-1)?.lines.push(line);
  }
  return files.map(({ header, lines }) => {
    const plus = lines.find((line) => line.startsWith("+++ "));
    const minus = lines.find((line) => line.startsWith("--- "));
    const named = (value: string | undefined) => {
      const name = value?.slice(4).split("\t")[0]?.trim() ?? "";
      return name === "/dev/null" || name.length === 0 ? null : name.replace(/^[ab]\//u, "");
    };
    const path =
      named(plus) ??
      named(minus) ??
      /^diff --git a\/(.+?) b\/.+$/u.exec(header)?.[1] ??
      header.slice("diff --git ".length);
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) inHunk = true;
      else if (inHunk && line.startsWith("+")) additions += 1;
      else if (inHunk && line.startsWith("-")) deletions += 1;
    }
    return { path, text: lines.join("\n"), additions, deletions };
  });
}

/** The line numbers a file's patch shows on each side, which is where a line comment can go. */
export function patchLineNumbers(text: string): {
  readonly added: ReadonlySet<number>;
  readonly removed: ReadonlySet<number>;
  /** New line number → the line it was before the change. */
  readonly context: ReadonlyMap<number, number>;
} {
  const added = new Set<number>();
  const removed = new Set<number>();
  const context = new Map<number, number>();
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (!inHunk || line.startsWith("\\")) {
      continue;
    } else if (line.startsWith("+")) {
      added.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      removed.add(oldLine);
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      context.set(newLine, oldLine);
      oldLine += 1;
      newLine += 1;
    }
  }
  return { added, removed, context };
}

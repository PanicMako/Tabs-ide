import type { PullRequestFileViewedState, PullRequestFilesViewedResult } from "@tabs/contracts";

/** What the host remembers of the reader's progress through a change request's files. */
export type FileViewedStates = ReadonlyMap<string, PullRequestFileViewedState>;

export function toFileViewedStates(
  result: PullRequestFilesViewedResult | null | undefined,
): FileViewedStates | null {
  if (result === null || result === undefined) return null;
  return new Map(result.files.map((file) => [file.path, file.state]));
}

/** A file that was cleared and has since been pushed to: worth telling apart from never viewed. */
export function isStaleViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "dismissed";
}

export function isFileViewed(path: string, states: FileViewedStates | null): boolean {
  return states?.get(path) === "viewed";
}

/** The result after one press, as the page shows it before the host has answered. */
export function withFileViewed(
  result: PullRequestFilesViewedResult | undefined,
  path: string,
  viewed: boolean,
): PullRequestFilesViewedResult {
  const files = (result?.files ?? []).filter((file) => file.path !== path);
  return {
    files: [...files, { path, state: viewed ? "viewed" : "unviewed" }],
    truncated: result?.truncated ?? false,
  };
}

export function countViewed(paths: ReadonlyArray<string>, states: FileViewedStates | null): number {
  return paths.reduce((count, path) => count + (isFileViewed(path, states) ? 1 : 0), 0);
}

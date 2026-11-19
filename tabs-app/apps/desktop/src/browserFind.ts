/** What one find-in-page request found. */
export interface BrowserFindResult {
  readonly matches: number;
  readonly activeMatch: number;
}

/** The slice of an Electron `WebContents` that finding needs, so it can be tested without one. */
export interface FindableContents {
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  on(
    event: "found-in-page",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (
      event: any,
      result: {
        requestId: number;
        activeMatchOrdinal: number;
        matches: number;
        finalUpdate: boolean;
      },
    ) => void,
  ): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener(event: "found-in-page", listener: (...args: any[]) => void): unknown;
}

export const FIND_TIMEOUT_MS = 1500;

/**
 * Starts or steps a search and resolves with the final count for that request.
 * An empty search clears the highlights instead of searching for nothing.
 */
export function findInPage(
  contents: FindableContents,
  text: string,
  options: { forward?: boolean; findNext?: boolean } = {},
  timeoutMs = FIND_TIMEOUT_MS,
): Promise<BrowserFindResult> {
  if (text.length === 0) {
    contents.stopFindInPage("clearSelection");
    return Promise.resolve({ matches: 0, activeMatch: 0 });
  }
  return new Promise((resolve) => {
    let requestId = -1;
    let latest: BrowserFindResult = { matches: 0, activeMatch: 0 };
    const finish = (result: BrowserFindResult) => {
      clearTimeout(timer);
      contents.removeListener("found-in-page", listener);
      resolve(result);
    };
    const listener = (
      _event: unknown,
      result: {
        requestId: number;
        activeMatchOrdinal: number;
        matches: number;
        finalUpdate: boolean;
      },
    ) => {
      if (requestId !== -1 && result.requestId !== requestId) return;
      latest = { matches: result.matches, activeMatch: result.activeMatchOrdinal };
      if (result.finalUpdate) finish(latest);
    };
    const timer = setTimeout(() => finish(latest), timeoutMs);
    contents.on("found-in-page", listener);
    requestId = contents.findInPage(text, {
      forward: options.forward !== false,
      findNext: options.findNext === true,
    });
  });
}

export function stopFindInPage(contents: FindableContents): void {
  contents.stopFindInPage("clearSelection");
}

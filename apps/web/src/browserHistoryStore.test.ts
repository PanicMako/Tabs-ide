import { beforeEach, describe, expect, it } from "vitest";

import { MAX_BROWSER_HISTORY_ENTRIES, useBrowserHistoryStore } from "./browserHistoryStore";

describe("browserHistoryStore", () => {
  beforeEach(() => useBrowserHistoryStore.setState({ entries: [] }));

  it("deduplicates URLs and moves the newest visit to the front", () => {
    const store = useBrowserHistoryStore.getState();
    store.record({ url: "https://one.test", title: "One", visitedAt: "1" });
    store.record({ url: "https://two.test", title: "Two", visitedAt: "2" });
    store.record({ url: "https://one.test", title: "One again", visitedAt: "3" });
    expect(useBrowserHistoryStore.getState().entries.map(({ url }) => url)).toEqual([
      "https://one.test",
      "https://two.test",
    ]);
  });

  it("rejects non-web URLs and caps retained history", () => {
    const store = useBrowserHistoryStore.getState();
    store.record({ url: "file:///secret", title: "Secret", visitedAt: "0" });
    for (let index = 0; index <= MAX_BROWSER_HISTORY_ENTRIES; index += 1) {
      store.record({
        url: `https://${index}.test`,
        title: String(index),
        visitedAt: String(index),
      });
    }
    expect(useBrowserHistoryStore.getState().entries).toHaveLength(MAX_BROWSER_HISTORY_ENTRIES);
    expect(
      useBrowserHistoryStore.getState().entries.some(({ url }) => url.startsWith("file:")),
    ).toBe(false);
  });
});

import { beforeEach, expect, it } from "vitest";
import { useCompanionSurfaceStore as store } from "./companionSurfaceStore";
beforeEach(() => store.setState({ workspaces: {} }));
it("opens independent browsers while reusing singleton tools within each thread", () => {
  const a = store.getState().open("thread-a", "browser");
  const b = store.getState().open("thread-a", "browser");
  expect(a).not.toBe(b);
  const files = store.getState().open("thread-a", "files");
  expect(store.getState().open("thread-a", "files")).toBe(files);
  store.getState().update("thread-a", a, { url: "https://one.test", title: "One" });
  store.getState().update("thread-a", b, { url: "https://two.test" });
  store.getState().open("thread-b", "browser");
  expect(store.getState().workspaces["thread-a"]?.tabs.map((tab) => tab.url)).toEqual([
    "https://one.test",
    "https://two.test",
    undefined,
  ]);
  expect(store.getState().workspaces["thread-b"]?.tabs).toHaveLength(1);
});
it("closing selects a neighbor without changing another thread or losing a file draft", () => {
  const a = store.getState().open("a", "browser");
  const b = store.getState().open("a", "files");
  const c = store.getState().open("a", "queue");
  store.getState().update("a", b, { selectedPath: "src/main.ts", draftContents: "unsaved" });
  store.getState().activate("a", b);
  store.getState().close("a", a);
  expect(store.getState().workspaces.a?.activeId).toBe(b);
  expect(store.getState().workspaces.a?.tabs[0]?.draftContents).toBe("unsaved");
  store.getState().close("a", b);
  expect(store.getState().workspaces.a?.activeId).toBe(c);
  store.getState().close("a", c);
  expect(store.getState().workspaces.a).toEqual({ tabs: [], activeId: null });
});

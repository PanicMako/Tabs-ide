import { describe, expect, it, vi } from "vitest";
import {
  CompanionBrowserSession,
  emptyBrowserState,
  normalizeCompanionUrl,
  type BrowserBridge,
} from "./browserSession";
function fixture() {
  let listener = (_state: ReturnType<typeof emptyBrowserState>) => {};
  const off = vi.fn();
  const bridge = {
    onBrowserSessionState: vi.fn((next) => {
      listener = next;
      return off;
    }),
    getBrowserHostState: vi.fn(async () => ({ available: true })),
    ensureBrowserSession: vi.fn(async () => {}),
    getBrowserSessionState: vi.fn(async () => ({
      ...emptyBrowserState("project", "one"),
      currentUrl: "https://first.test/",
    })),
    activateBrowserSession: vi.fn(async () => {}),
    navigateBrowserSession: vi.fn(async () => {}),
    goBackBrowserSession: vi.fn(async () => {}),
    goForwardBrowserSession: vi.fn(async () => {}),
    setBrowserBounds: vi.fn(async () => {}),
  };
  const onState = vi.fn();
  const session = new CompanionBrowserSession(
    bridge as unknown as BrowserBridge,
    "project",
    "one",
    onState,
  );
  return {
    session,
    bridge,
    off,
    onState,
    emit: (state: ReturnType<typeof emptyBrowserState>) => listener(state),
  };
}
describe("companion browser", () => {
  it("normalizes websites and local development URLs and rejects unsafe schemes", () => {
    expect(normalizeCompanionUrl(" google.com ")).toBe("https://google.com/");
    expect(normalizeCompanionUrl("localhost:3000/demo")).toBe("http://localhost:3000/demo");
    expect(normalizeCompanionUrl("[::1]:8080")).toBe("http://[::1]:8080/");
    for (const url of [
      "",
      "javascript:alert(1)",
      "file:///tmp/test",
      "https://user:pass@example.com",
    ])
      expect(() => normalizeCompanionUrl(url)).toThrow();
  });
  it("uses native history events without issuing a replacement navigation", async () => {
    const f = fixture();
    await f.session.start("google.com");
    await f.session.navigate("second.test");
    await f.session.back();
    f.emit({
      ...emptyBrowserState("project", "one"),
      currentUrl: "https://first.test/",
      canGoForward: true,
    });
    expect(f.onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentUrl: "https://first.test/", canGoForward: true }),
    );
    expect(f.bridge.navigateBrowserSession).toHaveBeenCalledTimes(1);
    expect(f.bridge.goBackBrowserSession).toHaveBeenCalledWith({
      projectId: "project",
      sessionId: "one",
    });
    await f.session.forward();
    expect(f.bridge.goForwardBrowserSession).toHaveBeenCalledTimes(1);
    f.session.dispose();
  });
  it("isolates events and unsubscribes when switched or closed", async () => {
    const f = fixture();
    await f.session.start("first.test");
    f.onState.mockClear();
    f.emit(emptyBrowserState("project", "two"));
    f.emit(emptyBrowserState("another", "one"));
    expect(f.onState).not.toHaveBeenCalled();
    f.session.dispose();
    f.emit(emptyBrowserState("project", "one"));
    expect(f.onState).not.toHaveBeenCalled();
    expect(f.off).toHaveBeenCalledOnce();
    expect(f.bridge.setBrowserBounds).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "one", visible: false }),
    );
  });
  it("does not activate a session after it was disposed during startup", async () => {
    const f = fixture();
    let finish!: () => void;
    f.bridge.ensureBrowserSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.session.start("first.test");
    await vi.waitFor(() => expect(finish).toBeDefined());
    f.session.dispose();
    finish();
    await pending;
    expect(f.bridge.activateBrowserSession).not.toHaveBeenCalled();
  });
  it("retry replaces its subscription instead of leaking listeners", async () => {
    const f = fixture();
    await f.session.start("first.test");
    await f.session.start("first.test");
    expect(f.off).toHaveBeenCalledOnce();
    f.session.dispose();
    expect(f.off).toHaveBeenCalledTimes(2);
  });
});

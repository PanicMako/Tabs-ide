import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createDebouncedSettingsUpdater,
  flushAllDebouncedSettings,
  registerDebouncedUpdater,
  ensureShutdownListeners,
  resetSettingsStateForTesting,
  type DebouncedSettingsUpdater,
} from "./useSettings";
import { DebouncedSettingsInput } from "../components/settings/DebouncedSettingsInput";

describe("Debounced Settings Persistence", () => {
  beforeEach(() => {
    resetSettingsStateForTesting();
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.addEventListener = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("typing 20 characters rapidly debounces to exactly one final write", async () => {
    const mockUpdater = vi.fn().mockResolvedValue(true);
    const debounced = createDebouncedSettingsUpdater(mockUpdater, 300);

    for (let i = 1; i <= 20; i++) {
      debounced.updateSettings({ text: `hello${i}` });
      vi.advanceTimersByTime(20); // 20ms between keystrokes
    }

    // While typing rapidly, no write has fired yet
    expect(mockUpdater).not.toHaveBeenCalled();

    // Advance remaining debounce delay
    vi.advanceTimersByTime(300);

    expect(mockUpdater).toHaveBeenCalledTimes(1);
    expect(mockUpdater).toHaveBeenCalledWith({ text: "hello20" });
  });

  it("flush executes immediately without waiting for delay", async () => {
    const mockUpdater = vi.fn().mockResolvedValue(true);
    const debounced = createDebouncedSettingsUpdater(mockUpdater, 400);

    debounced.updateSettings({ search: "query" });
    expect(mockUpdater).not.toHaveBeenCalled();

    const ok = await debounced.flush();
    expect(ok).toBe(true);
    expect(mockUpdater).toHaveBeenCalledTimes(1);
    expect(mockUpdater).toHaveBeenCalledWith({ search: "query" });

    // Subsequent timer expiry does not fire a second time
    vi.advanceTimersByTime(400);
    expect(mockUpdater).toHaveBeenCalledTimes(1);
  });

  it("cancel discards pending patch and prevents persistence", async () => {
    const mockUpdater = vi.fn().mockResolvedValue(true);
    const debounced = createDebouncedSettingsUpdater(mockUpdater, 300);

    debounced.updateSettings({ draft: "temporary" });
    debounced.cancel();

    vi.advanceTimersByTime(500);
    expect(mockUpdater).not.toHaveBeenCalled();
    expect(debounced.hasPending()).toBe(false);
  });

  it("multiple debounced controls deeply merge nested patches without clobbering", async () => {
    const mockUpdater = vi.fn().mockResolvedValue(true);
    const debounced = createDebouncedSettingsUpdater(mockUpdater, 300);

    // Control 1 edits codex binary path
    debounced.updateSettings({
      providers: {
        codex: { binaryPath: "/usr/local/bin/codex" },
      },
    });

    // Control 2 edits codex home path
    debounced.updateSettings({
      providers: {
        codex: { homePath: "/Users/dev/.codex" },
      },
    });

    // Flush and check merged result
    await debounced.flush();

    expect(mockUpdater).toHaveBeenCalledWith({
      providers: {
        codex: {
          binaryPath: "/usr/local/bin/codex",
          homePath: "/Users/dev/.codex",
        },
      },
    });
  });

  it("flushAllDebouncedSettings flushes all active registered updaters", async () => {
    const mock1 = vi.fn().mockResolvedValue(true);
    const mock2 = vi.fn().mockResolvedValue(true);

    const u1 = createDebouncedSettingsUpdater(mock1, 300);
    const u2 = createDebouncedSettingsUpdater(mock2, 300);

    const unreg1 = registerDebouncedUpdater(u1);
    const unreg2 = registerDebouncedUpdater(u2);

    u1.updateSettings({ control1: "value1" });
    u2.updateSettings({ control2: "value2" });

    expect(mock1).not.toHaveBeenCalled();
    expect(mock2).not.toHaveBeenCalled();

    const success = await flushAllDebouncedSettings();
    expect(success).toBe(true);
    expect(mock1).toHaveBeenCalledWith({ control1: "value1" });
    expect(mock2).toHaveBeenCalledWith({ control2: "value2" });

    unreg1();
    unreg2();
  });

  it("desktopBridge.onAppClosing triggers flush of all pending settings", async () => {
    let closingListener: (() => void) | null = null;
    const notifySettingsFlushDone = vi.fn();
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.desktopBridge = {
      onAppClosing: (cb: () => void) => {
        closingListener = cb;
        return () => {};
      },
      notifySettingsFlushDone,
    };

    ensureShutdownListeners();

    const mockPersist = vi.fn().mockResolvedValue(true);
    const updater = createDebouncedSettingsUpdater(mockPersist, 500);
    const unreg = registerDebouncedUpdater(updater);

    updater.updateSettings({ unsavedBeforeQuit: "mustPersist" });
    expect(mockPersist).not.toHaveBeenCalled();

    // Simulate Electron app closing event
    expect(closingListener).toBeDefined();
    closingListener!();

    // Await microtasks for flushAllDebouncedSettings
    await Promise.resolve();
    expect(mockPersist).toHaveBeenCalledWith({ unsavedBeforeQuit: "mustPersist" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(notifySettingsFlushDone).toHaveBeenCalledTimes(1);

    unreg();
  });

  it("beforeunload event triggers flush of all pending settings", async () => {
    let beforeUnloadListener: (() => void) | null = null;
    const originalAddEventListener = globalThis.window.addEventListener;
    globalThis.window.addEventListener = vi.fn((event: string, cb: any) => {
      if (event === "beforeunload") {
        beforeUnloadListener = cb;
      }
    });

    ensureShutdownListeners();

    const mockPersist = vi.fn().mockResolvedValue(true);
    const updater = createDebouncedSettingsUpdater(mockPersist, 500);
    const unreg = registerDebouncedUpdater(updater);

    updater.updateSettings({ pendingWindowClose: "persisted" });
    expect(mockPersist).not.toHaveBeenCalled();

    // Trigger beforeunload
    if (beforeUnloadListener) {
      (beforeUnloadListener as () => void)();
    }
    await Promise.resolve();

    expect(mockPersist).toHaveBeenCalledWith({ pendingWindowClose: "persisted" });

    unreg();
    globalThis.window.addEventListener = originalAddEventListener;
  });

  it("DebouncedSettingsInput renders input with initial value and correct attributes", () => {
    const html = renderToStaticMarkup(
      <DebouncedSettingsInput
        id="test-input"
        value="initial value"
        onPersist={() => {}}
        placeholder="Enter something..."
      />,
    );

    expect(html).toContain('id="test-input"');
    expect(html).toContain('value="initial value"');
    expect(html).toContain('placeholder="Enter something..."');
  });
});

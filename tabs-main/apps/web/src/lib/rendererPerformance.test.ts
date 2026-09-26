import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRendererPerformanceSamples,
  getRendererPerformanceSnapshot,
  startRendererPerformanceCapture,
} from "./rendererPerformance";

class TestPerformanceObserver {
  static supportedEntryTypes = ["event", "longtask"];
  static instances: TestPerformanceObserver[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: PerformanceObserverCallback) {
    TestPerformanceObserver.instances.push(this);
  }

  emit(entries: ReadonlyArray<Partial<PerformanceEntry>>) {
    this.callback(
      { getEntries: () => entries as PerformanceEntry[] } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

describe("renderer performance capture", () => {
  let stopCapture: (() => void) | undefined;

  beforeEach(() => {
    TestPerformanceObserver.instances = [];
    vi.stubGlobal("PerformanceObserver", TestPerformanceObserver);
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    clearRendererPerformanceSamples();
  });

  afterEach(() => {
    stopCapture?.();
    stopCapture = undefined;
    clearRendererPerformanceSamples();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("records slow interactions and long tasks without keeping fast entries", () => {
    stopCapture = startRendererPerformanceCapture();
    const eventObserver = TestPerformanceObserver.instances[0];
    const longTaskObserver = TestPerformanceObserver.instances[1];

    eventObserver?.emit([
      {
        name: "click",
        startTime: 850,
        duration: 100,
        processingStart: 870,
        processingEnd: 920,
        interactionId: 42,
      } as Partial<PerformanceEventTiming>,
      {
        name: "keydown",
        startTime: 950,
        duration: 40,
      },
    ]);
    longTaskObserver?.emit([
      { startTime: 880, duration: 40 },
      { startTime: 900, duration: 75 },
    ]);

    const snapshot = getRendererPerformanceSnapshot();
    expect(snapshot.supported).toBe(true);
    expect(snapshot.interactions).toEqual([
      {
        id: "interaction-42",
        event: "click",
        occurredAt: 999_850,
        durationMs: 100,
        inputDelayMs: 20,
        processingMs: 50,
        presentationDelayMs: 30,
      },
    ]);
    expect(snapshot.longTasks).toEqual([{ id: "task-900", occurredAt: 999_900, durationMs: 75 }]);
  });

  it("keeps only the slowest entry for an interaction id and clears samples", () => {
    stopCapture = startRendererPerformanceCapture();
    const eventObserver = TestPerformanceObserver.instances[0];

    eventObserver?.emit([
      {
        name: "pointerdown",
        startTime: 800,
        duration: 120,
        processingStart: 810,
        processingEnd: 860,
        interactionId: 9,
      } as Partial<PerformanceEventTiming>,
    ]);
    eventObserver?.emit([
      {
        name: "click",
        startTime: 820,
        duration: 90,
        processingStart: 830,
        processingEnd: 870,
        interactionId: 9,
      } as Partial<PerformanceEventTiming>,
    ]);

    expect(getRendererPerformanceSnapshot().interactions).toHaveLength(1);
    expect(getRendererPerformanceSnapshot().interactions[0]?.durationMs).toBe(120);
    clearRendererPerformanceSamples();
    expect(getRendererPerformanceSnapshot().interactions).toEqual([]);
    expect(getRendererPerformanceSnapshot().longTasks).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as DateTime from "effect/DateTime";

import {
  createActivityReporterQueue,
  getOrCreateClientId,
  resolveCurrentScopes,
  wasRecentlyInteracted,
} from "./BackgroundActivityReporter.logic";

describe("BackgroundActivityReporter.logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getOrCreateClientId", () => {
    it("creates and persists a client ID if none exists", () => {
      const store = new Map<string, string>();
      const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      };

      const id1 = getOrCreateClientId(storage);
      expect(id1).toBeDefined();
      expect(typeof id1).toBe("string");

      const id2 = getOrCreateClientId(storage);
      expect(id2).toBe(id1);
    });
  });

  describe("wasRecentlyInteracted", () => {
    it("returns true within interaction window and false after", () => {
      expect(wasRecentlyInteracted(10_000, 20_000)).toBe(true);
      expect(wasRecentlyInteracted(10_000, 69_999)).toBe(true);
      expect(wasRecentlyInteracted(10_000, 70_000)).toBe(false);
      expect(wasRecentlyInteracted(10_000, 100_000)).toBe(false);
    });
  });

  describe("resolveCurrentScopes", () => {
    it("includes baseline scopes and thread scope for current and legacy thread routes", () => {
      const base = resolveCurrentScopes("/settings");
      expect(base).toEqual([{ type: "server-config" }, { type: "provider-status" }]);

      expect(resolveCurrentScopes("/local/thread-123")).toEqual([
        { type: "server-config" },
        { type: "provider-status" },
        { type: "thread", threadId: "thread-123" },
      ]);
      expect(resolveCurrentScopes("/thread-legacy")).toEqual([
        { type: "server-config" },
        { type: "provider-status" },
        { type: "thread", threadId: "thread-legacy" },
      ]);
      expect(resolveCurrentScopes("/chat/thread%20encoded")).toEqual([
        { type: "server-config" },
        { type: "provider-status" },
        { type: "thread", threadId: "thread encoded" },
      ]);
    });

    it("does not crash on malformed URL encoding", () => {
      expect(resolveCurrentScopes("/environment/%E0%A4%A")).toContainEqual({
        type: "thread",
        threadId: "%E0%A4%A",
      });
    });
  });

  describe("createActivityReporterQueue", () => {
    const makeInput = (recentlyInteracted: boolean) => ({
      clientId: "test-client",
      clientKind: "web" as const,
      visible: true,
      focused: true,
      recentlyInteracted,
      scopes: [{ type: "provider-status" as const }],
      ttlMs: 45_000,
      observedAt: DateTime.nowUnsafe(),
    });

    it("debounces rapid repeated report requests into a single execution", async () => {
      const sendReport = vi.fn(async () => undefined);
      const queue = createActivityReporterQueue({
        sendReport,
        getReportInput: makeInput,
        debounceMs: 200,
      });

      queue.requestReport(false);
      queue.requestReport(false);
      queue.requestReport(false);

      expect(sendReport).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(sendReport).toHaveBeenCalledTimes(1);

      queue.dispose();
    });

    it("coalesces reports while one is already in flight and fires trailing report", async () => {
      let resolveFirst!: () => void;
      const firstPromise = new Promise<void>((res) => {
        resolveFirst = res;
      });

      const sendReport = vi
        .fn()
        .mockImplementationOnce(() => firstPromise)
        .mockImplementationOnce(async () => undefined);

      const queue = createActivityReporterQueue({
        sendReport,
        getReportInput: makeInput,
        debounceMs: 200,
      });

      // Fire initial immediate report
      queue.requestReport(true);
      expect(sendReport).toHaveBeenCalledTimes(1);
      expect(queue.isInFlight()).toBe(true);

      // Trigger multiple reports while in flight
      queue.requestReport(false);
      queue.requestReport(false);
      expect(queue.isPending()).toBe(true);

      // Advance debounce timer (should mark pending because in-flight)
      await vi.advanceTimersByTimeAsync(200);
      expect(sendReport).toHaveBeenCalledTimes(1);

      // Resolve the first report
      resolveFirst();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      // Trailing report should now execute
      expect(sendReport).toHaveBeenCalledTimes(2);
      expect(queue.isInFlight()).toBe(false);
      expect(queue.isPending()).toBe(false);

      queue.dispose();
    });

    it("handles slow or failing server without crashing or leaving leaked promises", async () => {
      const sendReport = vi.fn(async () => {
        throw new Error("Server disconnected");
      });

      const queue = createActivityReporterQueue({
        sendReport,
        getReportInput: makeInput,
        debounceMs: 100,
      });

      queue.requestReport(true);
      await vi.runAllTicks();

      expect(sendReport).toHaveBeenCalledTimes(1);
      expect(queue.isInFlight()).toBe(false);

      // Can report again after failure
      queue.requestReport(true);
      await vi.runAllTicks();
      expect(sendReport).toHaveBeenCalledTimes(2);

      queue.dispose();
    });

    it("cancels pending debounced reports on dispose", async () => {
      const sendReport = vi.fn(async () => undefined);
      const queue = createActivityReporterQueue({
        sendReport,
        getReportInput: makeInput,
        debounceMs: 200,
      });

      queue.requestReport(false);
      queue.dispose();

      await vi.advanceTimersByTimeAsync(300);
      expect(sendReport).not.toHaveBeenCalled();
    });

    it("records interaction and requests report only when transitioning from inactive", async () => {
      const sendReport = vi.fn(async () => undefined);
      const queue = createActivityReporterQueue({
        sendReport,
        getReportInput: makeInput,
        debounceMs: 100,
      });

      // Initial interaction within recent window does not request report
      queue.recordInteraction(10_000);
      expect(sendReport).not.toHaveBeenCalled();

      // Interaction after 60s inactivity window triggers report request
      queue.recordInteraction(80_000);
      await vi.advanceTimersByTimeAsync(100);
      expect(sendReport).toHaveBeenCalledTimes(1);

      queue.dispose();
    });
  });
});

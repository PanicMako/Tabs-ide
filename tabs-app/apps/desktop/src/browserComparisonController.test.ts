import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserComparisonInput } from "@tabs/contracts";
import { BrowserComparisonController } from "./browserComparisonController";

const input: BrowserComparisonInput = {
  projectId: "project",
  comparisonId: "pair",
  sourceSessionId: "original",
  syncNavigation: true,
  syncScroll: true,
  panes: [
    {
      url: "https://example.test/a",
      profileId: "personal",
      viewport: { width: 375, height: 667 },
      bounds: { x: 0, y: 50, width: 300, height: 500 },
    },
    {
      url: "https://example.test/b",
      profileId: "work",
      viewport: { width: 1366, height: 768 },
      bounds: { x: 310, y: 50, width: 600, height: 500 },
    },
  ],
};
function fixture() {
  const positions = new Map<string, { x: number; y: number }>();
  const adapter = {
    configure: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    capture: vi.fn(async (_project: string, id: string) => ({
      id,
      tabId: id,
      path: `/tmp/${id}.png`,
      mimeType: "image/png" as const,
      sizeBytes: 5,
      createdAt: "now",
    })),
    destroy: vi.fn(),
    restore: vi.fn(async () => undefined),
    scroll: vi.fn(async (_project: string, id: string, position?: { x: number; y: number }) => {
      if (position) positions.set(id, position);
      return positions.get(id) ?? { x: 0, y: 0 };
    }),
  };
  return { adapter, positions, controller: new BrowserComparisonController(adapter) };
}
afterEach(() => vi.useRealTimers());
describe("native browser comparison lifecycle", () => {
  it("configures both real sessions with their profiles and captures the displayed session identities", async () => {
    const { controller, adapter } = fixture();
    await controller.configure(input);
    expect(adapter.configure).toHaveBeenCalledWith(
      "project",
      "comparison-pair-a",
      input.panes[0],
      "original",
    );
    expect(adapter.configure).toHaveBeenCalledWith(
      "project",
      "comparison-pair-b",
      input.panes[1],
      "original",
    );
    expect((await controller.capture("project", "pair")).map((artifact) => artifact.tabId)).toEqual(
      ["comparison-pair-a", "comparison-pair-b"],
    );
    await controller.close("project", "pair");
    expect(adapter.destroy.mock.calls).toEqual([
      ["project", "comparison-pair-a"],
      ["project", "comparison-pair-b"],
    ]);
    expect(adapter.restore).toHaveBeenCalledWith("project", "original");
  });
  it("synchronizes navigation without reflecting the same URL back indefinitely", async () => {
    const { controller, adapter } = fixture();
    await controller.configure(input);
    controller.navigated("project", "comparison-pair-a", "https://example.test/new");
    await controller.capture("project", "pair"); // drain serialized navigation
    controller.navigated("project", "comparison-pair-b", "https://example.test/new");
    await controller.capture("project", "pair");
    expect(adapter.navigate).toHaveBeenCalledTimes(1);
    expect(adapter.navigate).toHaveBeenCalledWith(
      "project",
      "comparison-pair-b",
      "https://example.test/new",
    );
    await controller.close("project", "pair");
  });
  it("synchronizes normalized scroll positions and stops sampling on close", async () => {
    vi.useFakeTimers();
    const { controller, adapter, positions } = fixture();
    await controller.configure(input);
    await vi.advanceTimersByTimeAsync(160);
    positions.set("comparison-pair-b", { x: 0, y: 0.7 });
    await vi.advanceTimersByTimeAsync(160);
    expect(positions.get("comparison-pair-a")?.y).toBe(0.7);
    await controller.close("project", "pair");
    const count = adapter.scroll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.scroll).toHaveBeenCalledTimes(count);
  });
  it("does not undo guest navigation when stale geometry updates arrive", async () => {
    const { controller, adapter } = fixture();
    const independent = { ...input, syncNavigation: false };
    await controller.configure(independent);
    controller.navigated("project", "comparison-pair-a", "https://example.test/new");
    await controller.configure(independent);
    expect(adapter.configure.mock.calls.at(-2)).toEqual([
      "project",
      "comparison-pair-a",
      { ...input.panes[0], url: "https://example.test/new" },
      "original",
    ]);
    await controller.close("project", "pair");
  });
  it("cleans both owned sessions after a partial configuration failure", async () => {
    const { controller, adapter } = fixture();
    adapter.configure.mockRejectedValueOnce(new Error("load failed"));
    await expect(controller.configure(input)).rejects.toThrow("load failed");
    expect(adapter.destroy).toHaveBeenCalledTimes(2);
    await expect(controller.capture("project", "pair")).rejects.toThrow("closed");
  });
});

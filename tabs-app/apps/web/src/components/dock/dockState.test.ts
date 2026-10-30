import { describe, expect, it } from "vitest";
import { assignDockSlot, DEFAULT_DOCK_VIEW, useDockState } from "./dockState";
import { cleanDockOutput, reduceDockOutput } from "./useDockOutput";
describe("Dock arrangement", () => {
  it("opens presets by default and remembers an explicit collapse per project", () => {
    expect(DEFAULT_DOCK_VIEW.services).toBe(true);
    useDockState.setState({ views: {} });
    useDockState.getState().update("rail", { services: false });
    expect(useDockState.getState().views.rail?.services).toBe(false);
  });
  it("opens the upgraded preset sidebar without losing saved terminal arrangements", async () => {
    const migrate = useDockState.persist.getOptions().migrate!;
    const migrated = await migrate(
      {
        views: {
          project: { ...DEFAULT_DOCK_VIEW, layout: "columns", services: false, selected: "fe" },
        },
      },
      0,
    );
    expect(migrated).toMatchObject({
      views: { project: { layout: "columns", services: true, selected: "fe" } },
    });
  });
  it("swaps existing panes without duplicating a terminal or losing the destination", () => {
    expect(assignDockSlot(["fe", "be", "db", null], "fe", 1)).toEqual(["be", "fe", "db", null]);
    expect(assignDockSlot(["fe", null, null, null], "be", 1)).toEqual(["fe", "be", null, null]);
  });
  it("keeps layouts and assignments scoped to their project", () => {
    useDockState.setState({ views: {} });
    useDockState.getState().update("a", { layout: "quad", slots: ["fe", "be", null, null] });
    useDockState.getState().update("b", { selected: "other" });
    expect(useDockState.getState().views.a?.layout).toBe("quad");
    expect(useDockState.getState().views.b?.layout).toBe(DEFAULT_DOCK_VIEW.layout);
  });
});
describe("Dock captured output", () => {
  it("strips terminal controls and bounds retained output", () => {
    expect(cleanDockOutput("\x1b[31mError\x1b[0m\r\n")).toBe("Error\n");
    const output = reduceDockOutput(undefined, {
      type: "output",
      threadId: "dock",
      terminalId: "fe",
      data: "x".repeat(200000),
    });
    expect(output.text).toHaveLength(128000);
    const stopped = reduceDockOutput(output, {
      type: "exited",
      threadId: "dock",
      terminalId: "fe",
      exitCode: 1,
      exitSignal: null,
    });
    expect(stopped.exitCode).toBe(1);
    expect(stopped.text).toBe(output.text);
  });
});

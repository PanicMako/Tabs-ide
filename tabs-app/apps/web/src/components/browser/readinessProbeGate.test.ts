import { describe, expect, it } from "vitest";
import { ReadinessProbeGate } from "./readinessProbeGate";
describe("readiness result ownership", () => {
  it("discards a delayed response after target changes and permits one request per target", () => {
    const gate = new ReadinessProbeGate();
    gate.reset("old");
    const old = gate.start("old")!;
    expect(gate.start("old")).toBeNull();
    gate.reset("new");
    const next = gate.start("new")!;
    expect(gate.finish(old, "old", "ready")).toEqual({ accepted: false, recovered: false });
    expect(gate.finish(next, "new", "ready")).toEqual({ accepted: true, recovered: false });
  });
  it("reloads only after offline to ready on the same target", () => {
    const gate = new ReadinessProbeGate();
    gate.reset("page");
    const apply = (state: "offline" | "ready" | "unhealthy") =>
      gate.finish(gate.start("page")!, "page", state).recovered;
    expect(apply("ready")).toBe(false);
    expect(apply("unhealthy")).toBe(false);
    expect(apply("ready")).toBe(false);
    expect(apply("offline")).toBe(false);
    expect(apply("ready")).toBe(true);
    expect(apply("ready")).toBe(false);
    gate.reset("page");
    expect(apply("ready")).toBe(false);
  });
});

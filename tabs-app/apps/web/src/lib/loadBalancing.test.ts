import { describe, expect, it } from "vitest";
import {
  justSwitchedMachine,
  markMachineSwitch,
  pickBalancedEnvironment,
  resetMachineSwitch,
  weightFor,
} from "./loadBalancing";

const candidates = [
  { environmentId: "a", weight: 80 },
  { environmentId: "b", weight: 20 },
  { environmentId: "off", weight: 0 },
];

describe("pickBalancedEnvironment", () => {
  it("splits in proportion to the weights", () => {
    expect(pickBalancedEnvironment(candidates, 0)).toBe("a");
    expect(pickBalancedEnvironment(candidates, 0.79)).toBe("a");
    expect(pickBalancedEnvironment(candidates, 0.81)).toBe("b");
    expect(pickBalancedEnvironment(candidates, 0.999)).toBe("b");
    let a = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (pickBalancedEnvironment(candidates, i / 1000) === "a") a += 1;
    }
    expect(a).toBe(800);
  });
  it("never picks a machine with weight zero, and returns null when none is left", () => {
    for (let i = 0; i < 100; i += 1)
      expect(pickBalancedEnvironment(candidates, i / 100)).not.toBe("off");
    expect(pickBalancedEnvironment([{ environmentId: "x", weight: 0 }], 0.5)).toBeNull();
    expect(pickBalancedEnvironment([], 0.5)).toBeNull();
  });
});

describe("weightFor", () => {
  it("falls back to the default and keeps saved values within range", () => {
    expect(weightFor({}, "a")).toBe(50);
    expect(weightFor({ a: 80 }, "a")).toBe(80);
    expect(weightFor({ a: 500 }, "a")).toBe(100);
    expect(weightFor({ a: -3 }, "a")).toBe(0);
    expect(weightFor({ a: Number.NaN }, "a")).toBe(50);
  });
});

describe("machine switch memory", () => {
  it("is quiet for a few seconds after a switch and then lets balancing run again", () => {
    resetMachineSwitch();
    expect(justSwitchedMachine(1_000)).toBe(false);
    markMachineSwitch(1_000);
    expect(justSwitchedMachine(2_000)).toBe(true);
    expect(justSwitchedMachine(7_000)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  advanceRunner,
  jumpRunner,
  newRunner,
  runnerEncounter,
  stepRunner,
} from "../../../packages/site-ui/src/workspaceRunnerModel";
describe("shared website runner", () => {
  it("untimed play collects all four tools through deliberate actions", () => {
    let state = newRunner();
    for (let tool = 0; tool < 4; tool++) {
      expect(runnerEncounter(state)).toBe("window");
      state = advanceRunner(state, true);
      expect(runnerEncounter(state)).toBe("tool");
      state = advanceRunner(state, false);
    }
    expect(state.tools).toBe(4);
    expect(state.outcome).toBe("complete");
    expect(advanceRunner(state, true)).toBe(state);
  });
  it("untimed obstacles cannot be passed without jumping", () => {
    expect(advanceRunner(newRunner(), false).outcome).toBe("collision");
  });
  it("bounds long frames and rejects invalid time deltas", () => {
    const initial = newRunner();
    expect(stepRunner(initial, 10000).distance).toBe(9);
    for (const delta of [NaN, Infinity, -1, 0]) expect(stepRunner(initial, delta)).toBe(initial);
  });
  it("supports jump physics and denies midair double jumps", () => {
    const jumped = stepRunner(jumpRunner(newRunner()), 50);
    expect(jumped.height).toBeGreaterThan(0);
    expect(jumpRunner(jumped)).toBe(jumped);
    let grounded = jumped;
    for (let frame = 0; frame < 20; frame++) grounded = stepRunner(grounded, 50);
    expect(grounded.height).toBe(0);
  });
  it("animated encounters detect collisions and successful jumps", () => {
    const near = { ...newRunner(), distance: 425 };
    expect(stepRunner(near, 50).outcome).toBe("collision");
    expect(stepRunner({ ...near, height: 60, velocity: 0 }, 50).encounter).toBe(1);
  });
});

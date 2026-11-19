import { describe, expect, it } from "vitest";
import {
  INITIAL_QUIT_CONFIRMATION,
  quitKeyDown,
  quitKeyUp,
  type QuitConfirmationState,
} from "./quitConfirmation";

describe("direct", () => {
  it("quits on the first press", () => {
    expect(quitKeyDown("direct", INITIAL_QUIT_CONFIRMATION, 0).quit).toBe(true);
  });
});

describe("hold", () => {
  it("ignores a tap", () => {
    const down = quitKeyDown("hold", INITIAL_QUIT_CONFIRMATION, 0);
    expect(down.quit).toBe(false);
    const up = quitKeyUp("hold", down.state, 100);
    expect(up.state).toEqual(INITIAL_QUIT_CONFIRMATION);
    expect(up.progress).toBeNull();
  });

  it("fills while held, using repeats as ticks, then quits", () => {
    let state: QuitConfirmationState = INITIAL_QUIT_CONFIRMATION;
    const progress: number[] = [];
    let quit = false;
    for (const at of [0, 300, 600, 900]) {
      const next = quitKeyDown("hold", state, at, { holdMs: 900 });
      state = next.state;
      progress.push(next.progress ?? -1);
      quit = next.quit;
    }
    expect(progress).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(quit).toBe(true);
  });

  it("starts over after the key is released early", () => {
    const first = quitKeyDown("hold", INITIAL_QUIT_CONFIRMATION, 0);
    const released = quitKeyUp("hold", first.state, 500);
    const second = quitKeyDown("hold", released.state, 1000, { holdMs: 900 });
    expect(second.progress).toBe(0);
    expect(second.quit).toBe(false);
  });
});

describe("double-click", () => {
  it("quits on a second press within the window", () => {
    const first = quitKeyDown("double-click", INITIAL_QUIT_CONFIRMATION, 0);
    expect(first.quit).toBe(false);
    expect(first.armed).toBe(true);
    const released = quitKeyUp("double-click", first.state, 100);
    expect(released.armed).toBe(true);
    expect(quitKeyDown("double-click", released.state, 800).quit).toBe(true);
  });

  it("forgets the first press after the window", () => {
    const first = quitKeyDown("double-click", INITIAL_QUIT_CONFIRMATION, 0);
    const released = quitKeyUp("double-click", first.state, 100);
    const late = quitKeyDown("double-click", released.state, 5000);
    expect(late.quit).toBe(false);
    expect(late.armed).toBe(true);
  });

  it("does not count key repeat from one long press as a second press", () => {
    const first = quitKeyDown("double-click", INITIAL_QUIT_CONFIRMATION, 0);
    expect(quitKeyDown("double-click", first.state, 100).quit).toBe(false);
    expect(quitKeyDown("double-click", first.state, 200).quit).toBe(false);
  });
});

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

import { createQuitKeyGate, isQuitChord } from "./quitConfirmation";

describe("isQuitChord", () => {
  it("is Cmd+Q on macOS and Ctrl+Q elsewhere, with nothing else held", () => {
    expect(isQuitChord({ type: "keyDown", key: "q", meta: true }, "darwin")).toBe(true);
    expect(isQuitChord({ type: "keyDown", key: "Q", meta: true }, "darwin")).toBe(true);
    expect(isQuitChord({ type: "keyDown", key: "q", control: true }, "darwin")).toBe(false);
    expect(isQuitChord({ type: "keyDown", key: "q", control: true }, "linux")).toBe(true);
    expect(isQuitChord({ type: "keyDown", key: "q", meta: true, shift: true }, "darwin")).toBe(
      false,
    );
    expect(isQuitChord({ type: "keyDown", key: "w", meta: true }, "darwin")).toBe(false);
  });
});

describe("createQuitKeyGate", () => {
  const harness = (mode: "hold" | "double-click" | "direct") => {
    let clock = 0;
    let tick: (() => void) | null = null;
    const events: string[] = [];
    const gate = createQuitKeyGate({
      mode: () => mode,
      now: () => clock,
      onProgress: (p, armed) => events.push(`p:${p === null ? "-" : p.toFixed(2)}:${armed}`),
      onQuit: () => events.push("quit"),
      holdMs: 1000,
      setInterval: (cb) => ((tick = cb), 1),
      clearInterval: () => {
        tick = null;
      },
    });
    return {
      gate,
      events,
      advance: (ms: number) => {
        clock += ms;
        tick?.();
      },
      hasTimer: () => tick !== null,
    };
  };

  it("quits once after a full hold and stops its timer", () => {
    const h = harness("hold");
    h.gate.keyDown();
    h.advance(500);
    expect(h.events).not.toContain("quit");
    h.advance(500);
    h.advance(500);
    expect(h.events.filter((e) => e === "quit")).toHaveLength(1);
    expect(h.hasTimer()).toBe(false);
  });

  it("does not quit when released early and clears the overlay", () => {
    const h = harness("hold");
    h.gate.keyDown();
    h.advance(400);
    h.gate.keyUp();
    h.advance(2000);
    expect(h.events).not.toContain("quit");
    expect(h.events.at(-1)).toBe("p:-:false");
  });

  it("quits at once in direct mode and on a second tap in double-click mode", () => {
    const direct = harness("direct");
    direct.gate.keyDown();
    expect(direct.events).toContain("quit");

    const dbl = harness("double-click");
    dbl.gate.keyDown();
    dbl.gate.keyUp();
    dbl.advance(300);
    dbl.gate.keyDown();
    expect(dbl.events).toContain("quit");
  });
});

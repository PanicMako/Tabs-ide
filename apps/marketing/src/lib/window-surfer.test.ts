import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class Control {
  disabled = false;
  hidden = false;
  textContent = "";
  dataset: Record<string, string> = {};
  firstChild = { textContent: "" };
  attributes = new Map<string, string>();
  handlers = new Map<string, (event: unknown) => void>();
  style = { setProperty: vi.fn() };
  classList = { toggle: vi.fn() };
  focus = vi.fn();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  addEventListener(name: string, handler: (event: unknown) => void) {
    this.handlers.set(name, handler);
  }
  click() {
    if (!this.disabled) this.handlers.get("click")?.({});
  }
}

describe("Window Surfer pace controls", () => {
  let controls: Map<string, Control>;
  let levels: Control[];
  let frame: (time: number) => void;
  let root: Control;
  let drawText: ReturnType<typeof vi.fn>;
  const control = (selector: string) => controls.get(selector)!;
  const stats = () =>
    ["[data-score]", "[data-time]", "[data-lives]"].map(
      (selector) => control(selector).textContent,
    );

  beforeEach(async () => {
    vi.resetModules();
    controls = new Map();
    const lanes = Array.from({ length: 3 }, () => new Control());
    lanes.forEach((button, i) => controls.set(`[data-lane="${i}"]`, button));
    const counts = Array.from({ length: 3 }, () => new Control());
    levels = ["chill", "flow", "turbo"].map((level) => {
      const button = new Control();
      button.dataset.level = level;
      button.firstChild.textContent = level;
      return button;
    });
    const get = (selector: string) => {
      if (!controls.has(selector)) controls.set(selector, new Control());
      return controls.get(selector)!;
    };
    root = Object.assign(new Control(), {
      querySelector: get,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-level]") return levels;
        if (selector === "[data-lane]") return lanes;
        if (selector === "[data-lane-count]") return counts;
        return [];
      },
    });
    const noop = () => {};
    drawText = vi.fn();
    const context = new Proxy(
      {},
      {
        get: (_, name) => {
          if (name === "fillText") return drawText;
          return name === "createLinearGradient" ? () => ({ addColorStop: noop }) : noop;
        },
      },
    );
    Object.assign(get("[data-canvas]"), {
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 1200, height: 480 }),
    });
    Object.assign(get("[data-pause]"), { querySelector: get });
    vi.stubGlobal("document", { querySelector: () => root, addEventListener: noop });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 });
    vi.stubGlobal("Image", class {});
    const observer = class {
      observe() {}
      disconnect() {}
    };
    vi.stubGlobal("IntersectionObserver", observer);
    vi.stubGlobal("ResizeObserver", observer);
    vi.stubGlobal("requestAnimationFrame", (callback: typeof frame) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(0);
    await import("./window-surfer");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("changes pace during a ride without resetting its timer, hearts, or goal", () => {
    control("[data-start]").click();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    control('[data-lane="2"]').click();
    for (let time = 40; time <= 5000; time += 40) frame(time);
    const before = stats();
    expect(before[0]).not.toBe("BAG 00 / 15");
    expect(before[1]).toBe("1:35");
    expect(levels.every((button) => !button.disabled)).toBe(true);
    levels[2].click();
    expect(levels[2].attributes.get("aria-pressed")).toBe("true");
    expect(stats()).toEqual(before);
    expect(control("[data-level-note]").textContent).toContain("Pace changes live");
  });

  it("keeps a paused ride paused and uses the selected challenge on restart", () => {
    control("[data-start]").click();
    control("[data-pause]").click();
    const before = stats();
    levels[1].click();
    expect(stats()).toEqual(before);
    expect(control("[data-pause]").attributes.get("aria-label")).toBe("Resume game");
    control("[data-restart]").click();
    expect(stats()[0]).toBe("BAG 00 / 20");
    expect(stats()[1]).toBe("1:20");
    expect(stats()[2]).toBe("♥ ♥ ♥ ");
    expect(control("[data-pause]").attributes.get("aria-label")).toBe("Pause game");
  });

  it("records repeated tools in the collection shelf and clears it on restart", () => {
    control("[data-start]").click();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    control('[data-lane="2"]').click();
    for (let time = 40; time <= 5000; time += 40) frame(time);
    expect(drawText).toHaveBeenCalledWith("ON BOARD / YOUR TOOLS", expect.any(Number), 15);
    expect(drawText).toHaveBeenCalledWith("1", 17.5, -19);
    expect(drawText).toHaveBeenCalledWith("2", 17.5, -19);
    control("[data-restart]").click();
    drawText.mockClear();
    frame(40);
    expect(drawText).not.toHaveBeenCalledWith("1", 17.5, -19);
    expect(drawText).not.toHaveBeenCalledWith("2", 17.5, -19);
  });

  it("leaves native button keyboard activation available during a ride", () => {
    control("[data-start]").click();
    const preventDefault = vi.fn();
    root.handlers.get("keydown")?.({ target: levels[1], key: " ", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    root.handlers.get("keydown")?.({ target: control("[data-canvas]"), key: " ", preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

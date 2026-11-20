import { describe, expect, it } from "vitest";
import { blankBrowserStartUrl, DEFAULT_BLANK_BROWSER } from "./actions";
import { subPanelPlacement } from "./RadialActions";
import { BAND_RADIUS, CURVE_RADIUS, curvedMenuLayout } from "./CurvedMenu";

const size = { width: 178, height: 120 };

describe("subPanelPlacement", () => {
  it("opens below the bottom action, centered under it", () => {
    const placement = subPanelPlacement({ angle: 180, ...size });
    expect(placement.left).toBeCloseTo(-89);
    expect(placement.top).toBeCloseTo(180);
  });

  it("opens above the top action and beside a side action", () => {
    const top = subPanelPlacement({ angle: 0, ...size });
    expect(top.top + size.height).toBeCloseTo(-180);
    const right = subPanelPlacement({ angle: 90, ...size });
    expect(right.left).toBeCloseTo(180);
    expect(right.top).toBeCloseTo(-60);
  });

  it("meets a diagonal action with its nearest corner", () => {
    const placement = subPanelPlacement({ angle: 315, ...size });
    // Up and to the left: the panel's bottom-right corner sits on the ring.
    expect(placement.left + size.width).toBeLessThan(0);
    expect(placement.top + size.height).toBeLessThan(0);
  });
});

describe("blankBrowserStartUrl", () => {
  it("opens an empty page by default and a chosen page otherwise", () => {
    expect(blankBrowserStartUrl(undefined)).toBe("about:blank");
    expect(blankBrowserStartUrl(DEFAULT_BLANK_BROWSER)).toBe("about:blank");
    expect(blankBrowserStartUrl({ startUrl: "example.com", keepControlsOpen: true })).toBe(
      "https://example.com/",
    );
  });
});

describe("curved menu", () => {
  const centerOf = (layout: ReturnType<typeof curvedMenuLayout>) => ({
    x: layout.left + layout.width / 2,
    y: layout.top + layout.height / 2,
  });

  it("opens centred on its action, straight out from the blue band", () => {
    // Above and below the ring, the whole panel is centred on the action.
    for (const angle of [0, 180]) {
      const layout = curvedMenuLayout(angle, 3);
      const { x, y } = centerOf(layout);
      const radians = (angle * Math.PI) / 180;
      // The panel's middle lies on the line from the ring's center through the action.
      const across = x * Math.cos(radians) + y * Math.sin(radians);
      expect(Math.abs(across)).toBeLessThan(1);
      expect(x * Math.sin(radians) - y * Math.cos(radians)).toBeGreaterThan(CURVE_RADIUS);
    }
    // Beside the ring (New chat, Clipboard…), the rows' middle is level with the action.
    for (const [angle, rows] of [
      [45, 2],
      [90, 3],
      [270, 3],
    ] as const) {
      const layout = curvedMenuLayout(angle, rows);
      const actionY = -Math.cos((angle * Math.PI) / 180) * BAND_RADIUS;
      const first = layout.rows[0]!,
        last = layout.rows[layout.rows.length - 1]!;
      const rowsMiddle = layout.top + (first.top + last.top + layout.rowHeight) / 2;
      expect(rowsMiddle).toBeCloseTo(actionY, 0);
      expect(Math.sign(layout.left + layout.width / 2)).toBe(angle > 180 ? -1 : 1);
    }
  });

  it("wraps More's long list around the ring's side, following its curve", () => {
    const more = curvedMenuLayout(315, 9, null, true);
    expect(more.left + more.width / 2).toBeLessThan(0);
    // Kept to the ring's gentle middle: it never runs past the ring's top or bottom.
    expect(more.top).toBeGreaterThanOrEqual(-CURVE_RADIUS);
    expect(more.top + more.height).toBeLessThanOrEqual(CURVE_RADIUS);
    // Rows nearest the ring's middle sit furthest out, following the curve.
    const lefts = more.rows.map((row) => row.left);
    const middle = Math.min(...lefts);
    expect(middle).toBeLessThan(lefts[0]!);
    expect(middle).toBeLessThan(lefts[lefts.length - 1]!);
  });

  it("steps rows evenly, without a jump or a straight-up run", () => {
    const layout = curvedMenuLayout(315, 9);
    const steps = layout.rows.slice(1).map((row, i) => row.left - layout.rows[i]!.left);
    // Every step moves the same way (out, away from the ring, going up), none jumps far.
    for (const step of steps) expect(Math.abs(step)).toBeLessThanOrEqual(30 * 0.8 + 1);
    expect(steps.filter((step) => step > 0.5)).toHaveLength(0);
  });

  it("never truncates a row to fit the curve", () => {
    for (const angle of [0, 45, 90, 180, 315]) {
      const widths = new Set(curvedMenuLayout(angle, 9).rows.map((row) => row.width));
      expect(widths.size).toBe(1);
    }
  });

  it("tucks its near edge into the ring's curve, above the New tab action", () => {
    const layout = curvedMenuLayout(0, 2);
    // The bottom edge dips below the top of the ring: the curve bites into it.
    expect(layout.top + layout.height).toBeGreaterThan(-CURVE_RADIUS);
  });

  it("keeps every row level and clear of the ring", () => {
    for (const angle of [0, 45, 90, 180, 315]) {
      const layout = curvedMenuLayout(angle, 9);
      expect(layout.rows).toHaveLength(9);
      for (const row of layout.rows) {
        for (const [dx, dy] of [
          [0, 0],
          [row.width, 0],
          [0, layout.rowHeight],
          [row.width, layout.rowHeight],
        ] as const) {
          const x = layout.left + row.left + dx,
            y = layout.top + row.top + dy;
          expect(Math.hypot(x, y)).toBeGreaterThan(CURVE_RADIUS);
        }
      }
      const tops = layout.rows.map((row) => row.top);
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    }
  });

  it("rounds every corner, including where the edge meets the curve", () => {
    for (const angle of [0, 90, 315]) {
      const { outline } = curvedMenuLayout(angle, 4);
      // The far corners, and both joins where the edge meets the curve (near corners that fall
      // inside the curve become part of it).
      expect(outline.match(/Q/g)?.length).toBeGreaterThanOrEqual(4);
    }
    const { outline } = curvedMenuLayout(90, 4);
    expect(outline.endsWith("Z")).toBe(true);
  });

  it("turns along the ring when the screen edge is too close", () => {
    // Opened near the right edge of the window: there is no room to the right.
    const bounds = { left: -900, top: -500, right: 220, bottom: 500 };
    const layout = curvedMenuLayout(90, 3, bounds);
    expect(layout.left + layout.width).toBeLessThanOrEqual(bounds.right);
    expect(layout.angle).not.toBe(90);
    // With room, it stays straight out from the action.
    expect(curvedMenuLayout(90, 3, { left: -900, top: -900, right: 900, bottom: 900 }).angle).toBe(
      90,
    );
  });
});

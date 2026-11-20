import type { ComponentType, CSSProperties, ReactNode } from "react";

/**
 * A sub-menu whose panel bends around the launcher's plate. It opens centred on its action, and
 * the edge facing the ring curves along the ring, so the blue band sits at the middle of that
 * curve. The rows inside stay level and step clear of the curve; every corner is rounded.
 */

/** Just past the plate (170) and its blue band. */
export const CURVE_RADIUS = 182;
export const CURVED_MENU_WIDTH = 212;
const ROW_HEIGHT = 34;
const TITLE_HEIGHT = 24;
const PADDING = 6;
/** Every corner is rounded, like the launcher's other surfaces. */
const CORNER = 16;

type Point = { x: number; y: number };
const fmt = (value: number) => value.toFixed(2);

/**
 * A closed outline through `points` with the vertices in `corners` rounded off by `radius`. Each
 * corner starts and ends `radius` away from its vertex along the outline, joined by a curve
 * through the vertex, so the shape never shows a sharp point.
 */
export function roundedOutline(
  points: readonly Point[],
  corners: readonly number[],
  radius: number,
) {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n]!;
  const walk = (i: number, direction: 1 | -1, distance: number): Point => {
    let remaining = distance;
    let index = i;
    let point = at(i);
    for (let guard = 0; guard < n; guard++) {
      const next = at(index + direction);
      const length = Math.hypot(next.x - point.x, next.y - point.y);
      if (length >= remaining) {
        const t = length === 0 ? 0 : remaining / length;
        return { x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t };
      }
      remaining -= length;
      point = next;
      index += direction;
    }
    return point;
  };
  const cornerSet = new Set(corners);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const vertex = at(i);
    const move = out.length ? "L" : "M";
    if (!cornerSet.has(i)) {
      out.push(`${move}${fmt(vertex.x)} ${fmt(vertex.y)}`);
      continue;
    }
    const before = walk(i, -1, radius);
    const after = walk(i, 1, radius);
    out.push(`${move}${fmt(before.x)} ${fmt(before.y)}`);
    out.push(`Q${fmt(vertex.x)} ${fmt(vertex.y)} ${fmt(after.x)} ${fmt(after.y)}`);
  }
  return `${out.join("")}Z`;
}

export interface CurvedMenuLayout {
  /** The direction the panel opened in, degrees from the top, clockwise. */
  angle: number;
  /** The panel's bounding box, from the ring's center. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The panel's outline in its own coordinates, rounded at every corner. */
  outline: string;
  /** Where the title and each row sit, in the panel's own coordinates. */
  title: { left: number; top: number; width: number };
  rows: ReadonlyArray<{ left: number; top: number; width: number }>;
  /** Each row's slot height; rows keep a small gap inside it. */
  rowHeight: number;
}

/** The space the panel may use, from the ring's center (the visible window, less a margin). */
export interface CurvedMenuBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How deep the ring's curve bites into the panel, at the middle of its near edge. */
const TUCK = 26;
/** The gap a row keeps from the curve. */
const ROW_CLEARANCE = 6;

type Slot = { left: number; width: number };

/**
 * Where a full-width row from `y0` to `y1` (ring coordinates) sits inside a panel starting at
 * `x0`: where it would naturally be, or stepped sideways, away from the ring, just far enough to
 * clear it. `towards` is the side of the ring the panel is on. Null when the step would be too
 * big for the row to still read as part of the list.
 */
function rowSlot(
  x0: number,
  y0: number,
  y1: number,
  rowWidth: number,
  towards: -1 | 1,
  maxStep: number,
): Slot | null {
  const reach = CURVE_RADIUS + ROW_CLEARANCE;
  let blocked = -Infinity;
  for (let i = 0; i <= 6; i++) {
    const y = y0 + ((y1 - y0) * i) / 6;
    if (Math.abs(y) < reach) blocked = Math.max(blocked, Math.sqrt(reach ** 2 - y ** 2));
  }
  const natural = x0 + PADDING;
  const clear = blocked === -Infinity || natural >= blocked || natural + rowWidth <= -blocked;
  if (clear) return { left: natural, width: rowWidth };
  const stepped = towards === 1 ? blocked : -blocked - rowWidth;
  if (Math.abs(stepped - natural) > maxStep) return null;
  return { left: stepped, width: rowWidth };
}

/**
 * A panel straight out above or below the ring (for an action at its top or bottom), centred on
 * the action, with the ring's curve biting into the edge that faces it.
 */
function placeAlong(angle: number, count: number): CurvedMenuLayout {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians),
    dy = -Math.cos(radians);
  const baseWidth = CURVED_MENU_WIDTH;
  const rowWidth = baseWidth - PADDING * 2;
  const towards: -1 | 1 = dx < -0.05 ? -1 : 1;
  // Above or below the ring, rows never step sideways (that would push the panel off-centre);
  // the ones over the curve move down past it instead.
  const maxStep = 0;
  let height = PADDING * 2 + TITLE_HEIGHT + count * ROW_HEIGHT;
  let fitted: { top: number; left: number; slots: (Slot & { top: number })[] } | null = null;
  // Grow the panel a little at a time until every row has a place clear of the curve.
  for (let attempt = 0; attempt < 120 && !fitted; attempt++) {
    // Centre the panel on the action, its near edge tucked into the ring's curve.
    const reach = Math.abs(dx) * (baseWidth / 2) + Math.abs(dy) * (height / 2);
    const distance = CURVE_RADIUS - TUCK + reach;
    const left = dx * distance - baseWidth / 2,
      top = dy * distance - height / 2;
    const slots: (Slot & { top: number })[] = [];
    for (let y = top + PADDING; ; ) {
      const depth = slots.length === 0 ? TITLE_HEIGHT : ROW_HEIGHT;
      if (y + depth > top + height - PADDING + 0.5) break;
      const slot = rowSlot(left, y, y + depth, rowWidth, towards, maxStep);
      if (slot) {
        slots.push({ ...slot, top: y });
        y += depth;
        if (slots.length === count + 1) break;
      } else y += 4;
    }
    if (slots.length === count + 1) fitted = { top, left, slots };
    else height += 4;
  }
  const { top, slots } = fitted!;
  const bottom = top + height;
  // Stepped rows widen the panel on the side away from the ring, so none is cut short.
  const left = Math.min(fitted!.left, ...slots.map((slot) => slot.left - PADDING));
  const right = Math.max(
    fitted!.left + baseWidth,
    ...slots.map((slot) => slot.left + slot.width + PADDING),
  );
  const width = right - left;

  // The outline: the panel's rectangle, with the part inside the ring's curve pushed out onto it.
  const perimeter: Point[] = [];
  const edge = (from: Point, to: Point) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 3));
    for (let i = 0; i < steps; i++)
      perimeter.push({
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      });
  };
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const cornerIndex: number[] = [];
  corners.forEach((corner, i) => {
    cornerIndex.push(perimeter.length);
    edge(corner, corners[(i + 1) % 4]!);
  });
  const inside = perimeter.map((p) => Math.hypot(p.x, p.y) < CURVE_RADIUS);
  const points = perimeter.map((p, i) => {
    if (!inside[i]) return p;
    const scale = CURVE_RADIUS / (Math.hypot(p.x, p.y) || 1);
    return { x: p.x * scale, y: p.y * scale };
  });
  const n = points.length;
  const rounded = new Set<number>(cornerIndex.filter((i) => !inside[i]));
  // Where the panel's edge meets the curve, round that join too.
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (inside[i] !== inside[next]) rounded.add(inside[i] ? next : i);
  }
  const local = points.map((p) => ({ x: p.x - left, y: p.y - top }));
  const outline = roundedOutline(
    local,
    [...rounded].sort((a, b) => a - b),
    CORNER,
  );

  const [title, ...rows] = slots.map((slot) => ({
    left: slot.left - left,
    top: slot.top - top,
    width: slot.width,
  }));
  return {
    angle,
    left,
    top,
    width,
    height: bottom - top,
    outline,
    title: title!,
    rows,
    rowHeight: ROW_HEIGHT,
  };
}

/** Rows a long list uses, so it stays compact beside the ring. */
const COMPACT_ROW_HEIGHT = 30;
/** The steepest the stepped edge gets: how far a row moves sideways for each pixel it is lower. */
const STEP_SLOPE = 0.8;
/** The blue selection band's radius: a side panel's rows are centred on it. */
export const BAND_RADIUS = 159;
/** Where the ring's curve reaches that slope; past it the edge carries on in a straight line. */
const STEP_TURN = (STEP_SLOPE * CURVE_RADIUS) / Math.hypot(1, STEP_SLOPE);

/** A wrapping panel stays within this far of the ring's middle, where its curve is gentle. */
const WRAP_REACH = CURVE_RADIUS * 0.86;

/** The ring's own edge at height `y`. */
function ringEdge(y: number): number {
  return Math.sqrt(Math.max(0, CURVE_RADIUS ** 2 - y ** 2));
}

/**
 * How far out a side panel's near edge is at height `y`: along the ring's curve through the
 * middle, then a straight line at the same slope past it. The ring itself turns steeply near its
 * top and bottom, which made the rows there jump, stack straight up, and kink the edge; the line
 * keeps every step the same, and still never touches the ring (a tangent stays outside a circle).
 */
function stepEdge(y: number): number {
  const distance = Math.abs(y);
  if (distance <= STEP_TURN) return Math.sqrt(CURVE_RADIUS ** 2 - distance ** 2);
  return Math.sqrt(CURVE_RADIUS ** 2 - STEP_TURN ** 2) - STEP_SLOPE * (distance - STEP_TURN);
}

/**
 * A panel beside the ring (for an action on its left or right). Both its edges follow the ring,
 * one hugging it and one parallel to it, and each level row steps along the curve. Its rows'
 * middle is level with the action.
 */
function besideRing(angle: number, count: number, wrap: boolean): CurvedMenuLayout {
  const radians = (angle * Math.PI) / 180;
  const sign = Math.sin(radians) < 0 ? -1 : 1;
  const rowHeight = count > 6 ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  const height = PADDING * 2 + TITLE_HEIGHT + count * rowHeight;
  // Wrapping (More): the panel wraps the ring's side, kept to the gentle middle of its curve and
  // following it all the way. Otherwise the rows' middle is level with the action's blue band,
  // with the title above them, and the edge steps evenly past the steep part of the curve.
  const anchorY = -Math.cos(radians) * BAND_RADIUS;
  const top = wrap
    ? height >= WRAP_REACH * 2
      ? -height / 2
      : Math.min(Math.max(anchorY - height / 2, -WRAP_REACH), WRAP_REACH - height)
    : anchorY - PADDING - TITLE_HEIGHT - (count * rowHeight) / 2;
  const ringAt = wrap ? ringEdge : stepEdge;
  // The edge that faces the ring, and the far edge, eased toward the middle by a row so every
  // row keeps its full width as the edge steps.
  const near = (y: number) => sign * ringAt(y);
  const far = (y: number) =>
    sign * (ringAt(Math.sign(y) * Math.max(0, Math.abs(y) - rowHeight)) + CURVED_MENU_WIDTH);
  const samples = Math.max(16, Math.ceil(height / 4));
  const ys = Array.from({ length: samples + 1 }, (_, i) => top + (height * i) / samples);
  const xs = ys.flatMap((y) => [near(y), far(y)]);
  const left = Math.floor(Math.min(...xs)) - 1;
  const right = Math.ceil(Math.max(...xs)) + 1;
  const local = (x: number, y: number): Point => ({ x: x - left, y: y - top });
  const points: Point[] = [
    ...ys.map((y) => local(near(y), y)),
    ...ys.toReversed().map((y) => local(far(y), y)),
  ];
  const outline = roundedOutline(points, [0, samples, samples + 1, points.length - 1], CORNER);

  // Each row sits flush against the curve, just clear of it along its whole height.
  const rowWidth = CURVED_MENU_WIDTH - PADDING * 2;
  const place = (y0: number, y1: number) => {
    let closest = -Infinity;
    for (let i = 0; i <= 4; i++) closest = Math.max(closest, ringAt(y0 + ((y1 - y0) * i) / 4));
    const x = sign === 1 ? closest + ROW_CLEARANCE : -closest - ROW_CLEARANCE - rowWidth;
    return { left: x - left, width: rowWidth };
  };
  const titleTop = top + PADDING;
  const rows = Array.from({ length: count }, (_, i) => {
    const y0 = top + PADDING + TITLE_HEIGHT + i * rowHeight;
    return { ...place(y0, y0 + rowHeight), top: y0 - top };
  });
  return {
    angle,
    left,
    top,
    width: right - left,
    height,
    outline,
    title: { ...place(titleTop, titleTop + TITLE_HEIGHT), top: PADDING },
    rows,
    rowHeight,
  };
}

/** Beside the ring for actions on its sides; straight out above or below it otherwise. */
function layoutFor(angle: number, count: number, wrap: boolean): CurvedMenuLayout {
  const sideways = Math.abs(Math.sin((angle * Math.PI) / 180)) >= 0.5;
  return sideways ? besideRing(angle, count, wrap) : placeAlong(angle, count);
}

function overflow(layout: CurvedMenuLayout, bounds: CurvedMenuBounds): number {
  return (
    Math.max(0, bounds.left - layout.left) +
    Math.max(0, layout.left + layout.width - bounds.right) +
    Math.max(0, bounds.top - layout.top) +
    Math.max(0, layout.top + layout.height - bounds.bottom)
  );
}

/**
 * Lays out a curved menu for the action at `angle` (degrees from the top, clockwise) with
 * `count` rows: centred on the action, so the blue band sits at the middle of the edge that
 * faces the ring. When that would run off the screen, the panel turns along the ring, a step at
 * a time, to the nearest direction where it fits.
 */
export function curvedMenuLayout(
  angle: number,
  count: number,
  bounds?: CurvedMenuBounds | null,
  /** Wrap the ring's side instead of centring on the action (the More menu). */
  wrap = false,
): CurvedMenuLayout {
  const straight = layoutFor(angle, count, wrap);
  if (!bounds || overflow(straight, bounds) === 0) return straight;
  let best = straight;
  let bestOverflow = overflow(straight, bounds);
  // First the same height on the other side of the ring, then a turn along it.
  const mirrored = layoutFor(360 - angle, count, wrap);
  if (overflow(mirrored, bounds) === 0) return mirrored;
  for (let turn = 15; turn <= 135; turn += 15) {
    for (const direction of [1, -1]) {
      const candidate = layoutFor(angle + direction * turn, count, wrap);
      const spill = overflow(candidate, bounds);
      if (spill === 0) return candidate;
      if (spill < bestOverflow) {
        best = candidate;
        bestOverflow = spill;
      }
    }
  }
  return best;
}

export interface CurvedMenuRow {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | null | undefined;
  readonly icon: ComponentType<{
    "aria-hidden"?: boolean | "true";
    size?: number;
    width?: number;
    height?: number;
  }>;
  readonly disabledReason?: string | undefined;
  readonly title?: string | undefined;
}

export function CurvedMenu(props: {
  /** The action's angle on the ring, degrees from the top, clockwise. */
  angle: number;
  /** The ring's center inside the launcher's canvas. */
  center: number;
  title: string;
  label: string;
  rows: readonly CurvedMenuRow[];
  current: number;
  busy: boolean;
  onHover: (index: number) => void;
  onRun: (index: number) => void;
  /** Wrap the ring's side, following its curve, instead of centring on the action. */
  wrap?: boolean | undefined;
  /** Where the panel may go, from the ring's center; it turns along the ring to stay inside. */
  bounds?: CurvedMenuBounds | null | undefined;
}): ReactNode {
  const layout = curvedMenuLayout(props.angle, props.rows.length, props.bounds, props.wrap);
  return (
    <div
      className="qa-curved-menu"
      role="group"
      aria-label={props.label}
      data-angle={Math.round(layout.angle)}
      style={
        {
          left: props.center + layout.left,
          top: props.center + layout.top,
          width: layout.width,
          height: layout.height,
          // Grows out of the wheel's center.
          transformOrigin: `${-layout.left}px ${-layout.top}px`,
          "--qa-curve-clip": `path("${layout.outline}")`,
        } as CSSProperties
      }
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="qa-curved-glass" aria-hidden="true" />
      <svg
        className="qa-curved-outline"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        <path d={layout.outline} />
      </svg>
      <p
        className="qa-sub-title qa-curved-title"
        style={{ left: layout.title.left, top: layout.title.top, width: layout.title.width }}
      >
        {props.title}
      </p>
      {props.rows.map((row, i) => {
        const place = layout.rows[i]!;
        const Icon = row.icon;
        return (
          <button
            key={row.id}
            type="button"
            className="qa-more-action qa-curved-row"
            data-sub-index={i}
            data-current={i === props.current}
            disabled={props.busy || Boolean(row.disabledReason)}
            aria-label={row.disabledReason ? `${row.label}: ${row.disabledReason}` : row.label}
            title={row.title}
            style={{
              left: place.left,
              top: place.top,
              width: place.width,
              height: layout.rowHeight - 3,
            }}
            onPointerEnter={() => props.onHover(i)}
            onFocus={() => props.onHover(i)}
            onClick={() => props.onRun(i)}
          >
            <Icon aria-hidden="true" size={15} width={15} height={15} />
            <span className="qa-sub-label">{row.label}</span>
            {row.hint && <span className="qa-sub-hint">{row.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

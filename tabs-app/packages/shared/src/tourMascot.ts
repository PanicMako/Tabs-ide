const TOUR_MASCOT_WIDTH = 180;
const TOUR_MASCOT_HEIGHT = 110;
export const TOUR_MASCOT_INSET = 12;
const TOUR_MASCOT_TOP_INSET = 48;

export interface TourMascotPosition {
  readonly x: number;
  readonly y: number;
}

export type TourMascotInput =
  | { readonly type: "resume" }
  | { readonly type: "corner" }
  | { readonly type: "move"; readonly dx: number; readonly dy: number; readonly done: boolean };

export function readTourMascotInput(value: unknown): TourMascotInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<{ type: string; dx: number; dy: number; done: boolean }>;
  if (input.type === "resume" || input.type === "corner") return { type: input.type };
  if (
    input.type === "move" &&
    typeof input.dx === "number" &&
    typeof input.dy === "number" &&
    Math.abs(input.dx) < 10_000 &&
    Math.abs(input.dy) < 10_000 &&
    typeof input.done === "boolean"
  ) {
    return { type: "move", dx: input.dx, dy: input.dy, done: input.done };
  }
  return null;
}

export function getTourMascotBounds(position: TourMascotPosition, width: number, height: number) {
  const offsetX = Math.max(0, width - TOUR_MASCOT_WIDTH - TOUR_MASCOT_INSET * 2);
  const offsetY = Math.max(
    0,
    height - TOUR_MASCOT_HEIGHT - TOUR_MASCOT_TOP_INSET - TOUR_MASCOT_INSET,
  );
  return {
    x: Math.round(TOUR_MASCOT_INSET + position.x * offsetX),
    y: Math.round(TOUR_MASCOT_TOP_INSET + position.y * offsetY),
    width: Math.max(1, Math.min(TOUR_MASCOT_WIDTH, width - TOUR_MASCOT_INSET * 2)),
    height: TOUR_MASCOT_HEIGHT,
  };
}

const corners = [
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
] as const;

export function moveTourMascot(
  position: TourMascotPosition,
  input: Exclude<TourMascotInput, { type: "resume" }>,
  width: number,
  height: number,
): TourMascotPosition {
  if (input.type === "corner") {
    const index = corners.findIndex((corner) => corner.x === position.x && corner.y === position.y);
    return corners[(index + 1) % corners.length]!;
  }
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: clamp(
      position.x + input.dx / Math.max(1, width - TOUR_MASCOT_WIDTH - TOUR_MASCOT_INSET * 2),
    ),
    y: clamp(
      position.y +
        input.dy /
          Math.max(1, height - TOUR_MASCOT_HEIGHT - TOUR_MASCOT_TOP_INSET - TOUR_MASCOT_INSET),
    ),
  };
}

export function isTourMascotArtwork(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 600_000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export function tourMascotHtml(reducedMotion: boolean, artwork: string, dark: boolean): string {
  return `<!doctype html>
<html lang="en" data-dark="${dark}"><meta charset="utf-8"><title>Tabs tour mascot</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root {
    color-scheme: light;
    --bubble: #fcfcfb;
    --bubble-hover: #f3f3f4;
    --text: #22242a;
    --muted: #4a4e58;
    --edge: #343740;
  }
  :root[data-dark="true"] {
    color-scheme: dark;
    --bubble: #1b1d23;
    --bubble-hover: #252831;
    --text: #f6f6f8;
    --muted: #c1c4cf;
    --edge: #b3b8c5;
  }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  button { font: inherit; padding: 0; }
  #mascot {
    position: absolute; bottom: 3px; left: calc(50% - 22px); width: 44px; height: 44px;
    display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent;
    cursor: grab; touch-action: none; user-select: none;
  }
  #mascot:active { cursor: grabbing; }
  button:focus-visible { outline: 2px solid #6e8ced; outline-offset: -2px; }
  #resume {
    position: absolute; inset: 1px 5px auto; height: 65px; isolation: isolate;
    display: grid; align-content: center; gap: 2px; box-sizing: border-box;
    border: 0; background: transparent; padding: 6px 12px 20px; color: var(--text);
    cursor: pointer; font: 600 11px/1.2 system-ui, sans-serif; text-align: center;
  }
  #resume small { color: var(--muted); font-size: 10px; font-weight: 500; }
  .bubble-ink {
    position: absolute; inset: 0; width: 100%; height: 100%;
    z-index: -1; pointer-events: none;
  }
  .bubble-outline {
    fill: var(--bubble); stroke: var(--edge); stroke-width: 1.8px;
    stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke;
  }
  .bubble-marks {
    fill: none; stroke: var(--edge); stroke-width: 0.9px; opacity: 0.64;
    stroke-linecap: round; vector-effect: non-scaling-stroke;
  }
  #resume:hover .bubble-outline { fill: var(--bubble-hover); }
  #resume:focus-visible { outline: none; }
  #resume:focus-visible .bubble-outline { stroke: #6e8ced; stroke-width: 2.6px; }
  @media (max-width: 118px) { #resume { display: none; } }
  #mascot svg { width: 39px; height: 39px; overflow: visible; pointer-events: none; transition: transform 160ms ease; }
  #mascot:hover svg { transform: translateY(-1px); }
  @media (prefers-reduced-motion: reduce) { #mascot svg { transition: none; } #mascot:hover svg { transform: none; } }
  ${reducedMotion ? "#mascot svg { transition: none; } #mascot:hover svg { transform: none; }" : ""}
</style>
<button id="mascot" type="button" aria-label="Resume workspace tour" title="Done exploring? Click here to continue the tour.">
  <svg viewBox="68 85 902 856" aria-hidden="true">
    <defs>
      <!-- Lift transparency from the original artwork's blue channel. Keep the original colors and glow. -->
      <filter id="remove-plate" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"/>
        <feComponentTransfer result="matte"><feFuncA type="linear" slope="6" intercept="-1.56"/></feComponentTransfer>
        <feComposite in="SourceGraphic" in2="matte" operator="in"/>
      </filter>
    </defs>
    <image href="${isTourMascotArtwork(artwork) ? artwork : ""}" width="1024" height="1024" filter="url(#remove-plate)"/>
  </svg>
</button>
<button id="resume" type="button">
  <svg class="bubble-ink" viewBox="0 0 170 66" preserveAspectRatio="none" aria-hidden="true">
    <path class="bubble-outline" d="M25 7 C13 7 9 12 8 23 L7 32 C6 42 13 47 25 47 L70 48
      C77 48 79 50 82 55 C85 60 89 63 96 64 C94 58 95 53 100 50 C104 47 109 48 115 48
      L143 49 C155 49 162 45 163 35 L164 24 C165 14 160 9 149 8 C118 6 57 5 25 7 Z"/>
    <path class="bubble-marks" d="M52 3 C75 2 101 2 123 4 M129 4.2 L137 5
      M5 15 C3 19 2.6 25 2.8 30 M3 33 L3.2 35
      M167 37 C167 43 164 48 159 50"/>
  </svg>
  Ready to keep going?
  <small>Resume tour →</small>
</button>
<script>
const button = document.getElementById("mascot");
const send = (event) => window.tourMascotBridge
  ? window.tourMascotBridge.emit(event)
  : parent.postMessage(event, "*");
document.getElementById("resume").addEventListener("click", () => send({ type: "resume" }));
let pointer = null;
let dragged = false;
let suppressClick = false;
button.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || pointer) return;
  pointer = { id: event.pointerId, x: event.screenX, y: event.screenY };
  dragged = false;
  suppressClick = false;
  button.setPointerCapture(event.pointerId);
});
button.addEventListener("pointermove", (event) => {
  if (!pointer || event.pointerId !== pointer.id) return;
  const dx = event.screenX - pointer.x;
  const dy = event.screenY - pointer.y;
  if (!dragged && Math.hypot(dx, dy) < 4) return;
  if (!dx && !dy) return;
  dragged = true;
  pointer.x = event.screenX;
  pointer.y = event.screenY;
  send({ type: "move", dx, dy, done: false });
});
const endDrag = (event) => {
  if (!pointer || event.pointerId !== pointer.id) return;
  pointer = null;
  suppressClick = dragged;
  if (dragged) send({ type: "move", dx: 0, dy: 0, done: true });
};
button.addEventListener("pointerup", endDrag);
button.addEventListener("pointercancel", endDrag);
button.addEventListener("lostpointercapture", endDrag);
button.addEventListener("click", (event) => {
  if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
  send({ type: "resume" });
});
button.addEventListener("contextmenu", (event) => { event.preventDefault(); send({ type: "corner" }); });
button.addEventListener("keydown", (event) => {
  const directions = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
  const delta = directions[event.key];
  if (!delta) return;
  event.preventDefault();
  send({ type: "move", dx: delta[0], dy: delta[1], done: true });
});
</script></html>`;
}

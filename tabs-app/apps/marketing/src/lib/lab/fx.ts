import { reduced } from "./common";

/** Helpers for the sub-agents and Overmind sections (components/lab/portal/features). */
export { reduced };

const shown = (el: Element) => el.getClientRects().length > 0;
const watchers = new Set<(resized: boolean) => void>();
let queued = false;
let resized = false;
function flush() {
  queued = false;
  const r = resized;
  resized = false;
  watchers.forEach((w) => w(r));
}
function poke(force = false) {
  resized ||= force;
  if (queued) return;
  queued = true;
  requestAnimationFrame(flush);
}
window.addEventListener("scroll", () => poke(), { passive: true });
window.addEventListener("resize", () => poke(true));

/** Progress 0..1 of a line `at` (0 top, 1 bottom of the viewport) travelling down an element. */
export function sweep(el: HTMLElement, at: number, fn: (p: number) => void) {
  let last = -1;
  const run = (force: boolean) => {
    if (!shown(el)) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (window.innerHeight * at - r.top) / r.height));
    if (force || p !== last) fn((last = p));
  };
  watchers.add(run);
  run(true);
}

/** Call `fn` once, the first time `el` is on screen. */
export function seen(el: Element, fn: () => void, threshold = 0.3) {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fn();
    },
    { threshold },
  );
  io.observe(el);
}

/** `[data-in]` elements get `.in` when they enter (CSS does the motion). */
export function reveal(root: ParentNode) {
  root
    .querySelectorAll<HTMLElement>("[data-in]")
    .forEach((el) => seen(el, () => el.classList.add("in"), 0.15));
}

/* ── Provider logos and names for scripts that recast providers at runtime ── */
let serial = 0;
export function logo(id: string, size = 24): HTMLElement {
  const tpl = document.querySelector<HTMLTemplateElement>("[data-fx-logos]")!;
  const el = tpl.content.querySelector(`[data-pv="${id}"]`)!.cloneNode(true) as HTMLElement;
  const k = `r${++serial}`;
  // Every copy needs its own SVG ids or they all point at the first copy's clip-path.
  el.innerHTML = el.innerHTML
    .replace(/\bid="([^"]+)"/g, `id="$1-${k}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${k})`)
    .replace(/href="#([^"]+)"/g, `href="#$1-${k}"`);
  const svg = el.querySelector("svg");
  svg?.setAttribute("width", String(size));
  svg?.setAttribute("height", String(size));
  return el;
}
export type Provider = { id: string; name: string };
export function providers(): Provider[] {
  return JSON.parse(document.querySelector<HTMLElement>("[data-fx-agents]")!.dataset.fxAgents!);
}

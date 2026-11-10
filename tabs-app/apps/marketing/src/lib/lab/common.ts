import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap, ScrollTrigger, SplitText };

export const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = window.matchMedia("(pointer: fine)").matches;

let lenis: Lenis | null = null;
export function smoothScroll(): Lenis | null {
  if (reduced || lenis) return lenis;
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) =>
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href")!;
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      lenis?.scrollTo(el as HTMLElement, { offset: 0, duration: 1.4 });
    }),
  );
  return lenis;
}

/** Elements with [data-magnetic] drift toward the pointer. */
export function magnetic(root: ParentNode = document) {
  if (!finePointer || reduced) return;
  root.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
    const strength = Number(el.dataset.magnetic || 0.35);
    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1,0.4)" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1,0.4)" });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * strength);
      yTo((e.clientY - r.top - r.height / 2) * strength);
    });
    el.addEventListener("pointerleave", () => {
      xTo(0);
      yTo(0);
    });
  });
}

/** Split [data-split] headings into lines/words and reveal them on scroll. */
export function splitReveals(root: ParentNode = document, opts: { y?: string; stagger?: number } = {}) {
  root.querySelectorAll<HTMLElement>("[data-split]").forEach((el) => {
    if (reduced) return;
    const mode = el.dataset.split || "words";
    const split = SplitText.create(el, {
      type: mode === "chars" ? "words,chars" : "lines,words",
      mask: mode === "chars" ? "words" : "lines",
      autoSplit: true,
      linesClass: "lab-line",
      wordsClass: "lab-word",
      charsClass: "lab-char",
      onSplit(self) {
        const targets = mode === "chars" ? self.chars : self.words;
        return gsap.from(targets, {
          yPercent: 110,
          rotate: mode === "chars" ? 8 : 3,
          duration: 1.1,
          ease: "expo.out",
          stagger: opts.stagger ?? (mode === "chars" ? 0.018 : 0.045),
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      },
    });
    void split;
  });
}

/** Fade/raise [data-rise] elements as they enter. */
export function rises(root: ParentNode = document) {
  if (reduced) return;
  root.querySelectorAll<HTMLElement>("[data-rise]").forEach((el) => {
    gsap.from(el, {
      y: Number(el.dataset.rise || 40),
      autoAlpha: 0,
      duration: 1.2,
      ease: "expo.out",
      delay: Number(el.dataset.delay || 0),
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    });
  });
}

/** Animated number tick for [data-count]. */
export function counters(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const end = Number(el.dataset.count);
    const o = { v: 0 };
    gsap.to(o, {
      v: end,
      duration: reduced ? 0 : 1.6,
      ease: "power3.out",
      onUpdate: () => { el.textContent = String(Math.round(o.v)).padStart(el.dataset.pad ? Number(el.dataset.pad) : 1, "0"); },
      scrollTrigger: { trigger: el, start: "top 90%", once: true },
    });
  });
}

/**
 * Fill [data-version] with the newest stable tag. Tries the site's release
 * function, then GitHub directly, and otherwise keeps the build snapshot.
 */
export async function liveVersion() {
  const els = document.querySelectorAll<HTMLElement>("[data-version]");
  if (!els.length) return;
  const sources: Array<() => Promise<string | undefined>> = [
    async () => {
      const r = await fetch("/api/releases?per_page=5", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return;
      const list = (await r.json()) as Array<{ tag_name: string; prerelease: boolean }>;
      return list.find((x) => !x.prerelease)?.tag_name;
    },
    async () => {
      const r = await fetch("https://api.github.com/repos/PanicMako/Tabs-ide/releases/latest", {
        signal: AbortSignal.timeout(4000),
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!r.ok) return;
      return ((await r.json()) as { tag_name?: string }).tag_name;
    },
  ];
  for (const source of sources) {
    try {
      const tag = await source();
      if (tag && /^v?\d+\.\d+\.\d+$/.test(tag)) {
        els.forEach((el) => (el.textContent = tag.startsWith("v") ? tag : `v${tag}`));
        return;
      }
    } catch {
      /* try the next source */
    }
  }
}

/** Shared boot for every lab page. */
export function boot() {
  smoothScroll();
  magnetic();
  liveVersion();
  window.addEventListener("load", () => ScrollTrigger.refresh());
}

/** Run `fn` once the page loader has finished (or right away when there is none). */
export function onReady(fn: () => void) {
  if (document.documentElement.dataset.loading !== "1") fn();
  else window.addEventListener("lab:ready", () => fn(), { once: true });
}

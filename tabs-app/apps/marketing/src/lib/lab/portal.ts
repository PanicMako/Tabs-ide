import { gsap, ScrollTrigger, boot, splitReveals, rises, reduced, finePointer, onReady } from "./common";
import { liveMarks } from "./mascot";

/**
 * Shared behaviour for every Portal page: smooth scroll, live version, mascot eyes,
 * nav hide/contrast, the dot cursor and scroll reveals.
 * `darkSections` are selectors whose backgrounds need a light nav.
 */
export function portalPage(darkSections: Array<[selector: string, start?: string]> = []) {
  boot();
  liveMarks(document, { range: 16 });
  const nav = document.querySelector<HTMLElement>(".v1-nav");
  if (nav) {
    // Brand lockup settles in: mark, word, divider draws, beta badge slides out from behind it.
    if (!reduced) onReady(() => {
      gsap.timeline({ defaults: { ease: "expo.out" } })
        .from(".v1-nav__logo .lab-mark", { y: -14, rotate: -12, autoAlpha: 0, duration: 0.8 })
        .from(".v1-nav__word", { x: -8, autoAlpha: 0, duration: 0.7 }, 0.08)
        .from(".v1-nav__sep", { scaleY: 0, duration: 0.6 }, 0.2)
        .from(".v1-nav__beta", { x: -16, autoAlpha: 0, clipPath: "inset(0 100% 0 0 round 999px)", duration: 0.9 }, 0.28)
        .from(".v1-nav nav, .v1-nav > .v1-btn", { y: -10, autoAlpha: 0, duration: 0.8, stagger: 0.06 }, 0.2);
    });
    ScrollTrigger.create({ start: 200, onUpdate: (s) => nav.classList.toggle("hide", s.direction === 1 && s.scroll() > 400) });
    [...darkSections, [".v1-end", "top 40px"] as [string, string]].forEach(([sel, start = "top 40px"]) => {
      if (document.querySelector(sel))
        ScrollTrigger.create({ trigger: sel, start, end: "bottom 40px", onToggle: (s) => nav.classList.toggle("on-dark", s.isActive) });
    });
  }
  if (finePointer && !reduced) {
    const cur = document.querySelector<HTMLElement>(".v1-cursor");
    if (cur) {
      const xTo = gsap.quickTo(cur, "x", { duration: 0.3, ease: "power3" });
      const yTo = gsap.quickTo(cur, "y", { duration: 0.3, ease: "power3" });
      window.addEventListener("pointermove", (e) => { xTo(e.clientX); yTo(e.clientY); });
      document.addEventListener("pointerover", (e) => {
        const hot = (e.target as HTMLElement).closest("a, button, [role=tab], summary, input");
        gsap.to(cur, { scale: hot ? 4.2 : 1, opacity: hot ? 0.18 : 1, duration: 0.4, ease: "expo.out", overwrite: "auto" });
      });
    }
  }
  if (!reduced && document.querySelector(".v1-end")) {
    gsap.from(".v1-end", { borderRadius: "50% 50% 0 0", ease: "none", scrollTrigger: { trigger: ".v1-end", start: "top bottom", end: "top 40%", scrub: true } });
    gsap.from(".v1-end__word span", { yPercent: 60, ease: "none", scrollTrigger: { trigger: ".v1-end__word", start: "top bottom", end: "bottom bottom", scrub: true } });
    gsap.from(".v1-end__mark", { rotate: -30, yPercent: 50, ease: "none", scrollTrigger: { trigger: ".v1-end__word", start: "top bottom", end: "bottom bottom", scrub: true } });
  }
  const root = document.querySelector<HTMLElement>(".v1") ?? document;
  splitReveals(root);
  rises(root);
}

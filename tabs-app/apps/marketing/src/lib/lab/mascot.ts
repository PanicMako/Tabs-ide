import { gsap, reduced } from "./common";

/** Make every .lab-mark inside root blink and track the pointer with its eyes. */
export function liveMarks(root: ParentNode = document, opts: { range?: number } = {}) {
  const range = opts.range ?? 14;
  const marks = [...root.querySelectorAll<SVGSVGElement>(".lab-mark[data-alive]")];
  for (const mark of marks) {
    const eyes = mark.querySelector<SVGGElement>(".lab-mark__eyes");
    if (!eyes) continue;
    gsap.set(eyes, { transformOrigin: "50% 50%" });
    if (!reduced) {
      const blink = () => {
        gsap
          .timeline()
          .to(eyes, { scaleY: 0.08, duration: 0.07, ease: "power2.in" })
          .to(eyes, { scaleY: 1, duration: 0.14, ease: "power2.out" });
        gsap.delayedCall(2.2 + Math.random() * 3.5, blink);
      };
      gsap.delayedCall(1 + Math.random() * 2, blink);
    }
    const xTo = gsap.quickTo(eyes, "x", { duration: 0.5, ease: "power3.out" });
    const yTo = gsap.quickTo(eyes, "y", { duration: 0.5, ease: "power3.out" });
    window.addEventListener("pointermove", (e) => {
      const r = mark.getBoundingClientRect();
      // Eyes sit in the upper-left block of the mark.
      const cx = r.left + r.width * 0.27;
      const cy = r.top + r.height * 0.35;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 400);
      xTo((dx / d) * range * k);
      yTo((dy / d) * range * 0.8 * k);
    });
  }
}

import { useEffect, type RefObject } from "react";
import gsap from "gsap";

export function useScrollRail(
  root: RefObject<HTMLDivElement | null>,
  beam: RefObject<HTMLDivElement | null>,
  scrollContainer: HTMLDivElement | null,
  mode: "visible" | "progress" = "visible",
) {
  useEffect(() => {
    const node = root.current,
      bar = beam.current;
    if (!node || !bar) return;
    const target = scrollContainer ?? window;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = scrollContainer?.getBoundingClientRect();
      const top = viewport ? viewport.top + (scrollContainer?.clientTop ?? 0) : 0;
      const bottom = top + (scrollContainer?.clientHeight ?? window.innerHeight);
      const start = Math.max(0, Math.min(rect.height, top - rect.top));
      const end = Math.max(0, Math.min(rect.height, bottom - rect.top));
      const visible = rect.height > 0 && end > start;
      node.dataset.railActive = String(visible);
      const visibleHeight = Math.max(0, end - start);
      const beamHeight =
        mode === "progress" ? Math.min(96, visibleHeight, rect.height) : visibleHeight;
      const progress = Math.max(0, Math.min(1, (bottom - rect.top) / (rect.height + bottom - top)));
      const position =
        mode === "progress"
          ? Math.max(start, Math.min(end - beamHeight, progress * (rect.height - beamHeight)))
          : start;
      gsap.set(bar, { y: position, height: beamHeight });
      gsap.to(bar, {
        opacity: visible ? 1 : 0,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.12,
        ease: "power1.out",
        overwrite: true,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    if (scrollContainer) resize.observe(scrollContainer);
    if (node.parentElement) resize.observe(node.parentElement);
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
      gsap.killTweensOf(bar);
    };
  }, [scrollContainer, root, beam, mode]);
}

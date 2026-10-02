import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { usePanelAnimationSettings } from "../panelAnimations";

/** Smooth changes in native titlebar geometry without delaying the safe hit area. */
export function useGsapInsets(left: number, right: number) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ left, right });
  const { active, durationMs } = usePanelAnimationSettings();

  useLayoutEffect(() => {
    const node = ref.current;
    const from = previous.current;
    previous.current = { left, right };
    if (!node) return;
    if (!active || (from.left === left && from.right === right)) {
      node.style.paddingLeft = `${left}px`;
      node.style.paddingRight = `${right}px`;
      return;
    }
    // Only shrink padding gradually: expanding it must immediately clear native controls.
    const context = gsap.context(() => {
      gsap.fromTo(
        node,
        {
          paddingLeft: Math.max(from.left, left),
          paddingRight: Math.max(from.right, right),
        },
        {
          paddingLeft: left,
          paddingRight: right,
          duration: durationMs / 1000,
          ease: "power3.out",
        },
      );
    });
    return () => context.revert();
  }, [active, durationMs, left, right]);

  return ref;
}

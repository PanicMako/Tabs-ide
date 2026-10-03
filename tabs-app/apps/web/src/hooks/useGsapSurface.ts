import { useCallback, type Ref } from "react";
import gsap from "gsap";
import { usePanelAnimationSettings } from "../panelAnimations";

/** Owns only entrance motion; Base UI retains its dismissal and focus lifecycle. */
export function useGsapSurface<T extends HTMLElement>(
  forwardedRef?: Ref<T>,
  offset = 6,
  axis: "x" | "y" = "y",
) {
  const { active, durationMs } = usePanelAnimationSettings();
  return useCallback(
    (node: T | null) => {
      const forwardedCleanup = typeof forwardedRef === "function" ? forwardedRef(node) : undefined;
      if (forwardedRef && typeof forwardedRef !== "function") forwardedRef.current = node;
      if (!node) return;

      let context: gsap.Context | undefined;
      let wasOpen = false;
      const enter = () => {
        const open = !node.hasAttribute("data-closed") && !node.hasAttribute("data-ending-style");
        if (open && !wasOpen && active) {
          context?.revert();
          context = gsap.context(() => {
            gsap.fromTo(
              node,
              { opacity: 0, [axis]: offset, transition: "none" },
              {
                opacity: 1,
                [axis]: 0,
                duration: durationMs / 1000,
                ease: "power3.out",
                clearProps: "opacity,transform,transition",
                overwrite: "auto",
              },
            );
          });
        }
        if (!open) {
          context?.revert();
          context = undefined;
        }
        wasOpen = open;
      };
      enter();
      const observer = new MutationObserver(enter);
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["data-open", "data-closed", "data-ending-style"],
      });
      return () => {
        observer.disconnect();
        context?.revert();
        if (typeof forwardedCleanup === "function") forwardedCleanup();
        else if (typeof forwardedRef === "function") forwardedRef(null);
        else if (forwardedRef) forwardedRef.current = null;
      };
    },
    [active, axis, durationMs, forwardedRef, offset],
  );
}

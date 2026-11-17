import { useCallback, type Ref } from "react";
import {
  clearSurfaceMotion,
  getSurfacePreset,
  playSurfaceEnter,
  playSurfaceExit,
  type SurfacePreset,
} from "../lib/motion";
import { useSurfaceMotionSettings } from "../panelAnimations";

/**
 * Entrance and exit motion for a surface. Base UI keeps owning presence, dismissal and focus:
 * this follows its `data-open` / `data-ending-style` / `data-closed` attributes, plays the
 * preset's entrance when the surface opens and its exit while Base UI is ending it (holding the
 * element mounted until the exit finishes). Plain elements with no such attributes just enter.
 */
export function useGsapSurface<T extends HTMLElement>(
  forwardedRef?: Ref<T>,
  preset: SurfacePreset = "popover",
  options: {
    /** Animate the popup's parent: for popups whose painted frame wraps the Base UI element. */
    animateParent?: boolean;
  } = {},
) {
  const { animateParent = false } = options;
  const { active, seconds, profile } = useSurfaceMotionSettings();
  return useCallback(
    (node: T | null) => {
      const forwardedCleanup = typeof forwardedRef === "function" ? forwardedRef(node) : undefined;
      if (forwardedRef && typeof forwardedRef !== "function") forwardedRef.current = node;
      if (!node) return;

      const spec = getSurfacePreset(preset);
      const motion = { seconds, profile };
      const target = (animateParent ? node.parentElement : node) ?? node;
      let wasOpen = false;
      let hold: Animation | null = null;
      let exiting = false;

      const cancelHold = () => {
        hold?.cancel();
        hold = null;
      };

      const sync = () => {
        const ending = node.hasAttribute("data-ending-style");
        const open = !node.hasAttribute("data-closed") && !ending;
        // Moving between grouped tooltips/popups: Base UI asks for no motion.
        const instant = node.hasAttribute("data-instant");

        if (open && !wasOpen) {
          cancelHold();
          if (active && !instant) playSurfaceEnter(target, spec, motion, exiting, node);
          else clearSurfaceMotion(target);
          exiting = false;
        } else if (ending && !exiting) {
          exiting = true;
          if (active && !instant) hold = playSurfaceExit(target, spec, motion, node)?.hold ?? null;
        } else if (!open && !ending) {
          cancelHold();
          clearSurfaceMotion(target);
          exiting = false;
        }
        wasOpen = open;
      };

      sync();
      const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(sync);
      observer?.observe(node, {
        attributes: true,
        attributeFilter: ["data-open", "data-closed", "data-ending-style"],
      });
      return () => {
        observer?.disconnect();
        cancelHold();
        clearSurfaceMotion(target);
        if (typeof forwardedCleanup === "function") forwardedCleanup();
        else if (typeof forwardedRef === "function") forwardedRef(null);
        else if (forwardedRef) forwardedRef.current = null;
      };
    },
    [active, animateParent, forwardedRef, preset, profile, seconds],
  );
}

/**
 * Entrance motion for an element React mounts on its own (no Base UI presence): it plays the
 * preset's entrance each time the element mounts. Pass an existing ref to keep it working.
 */
export function useGsapEnter<T extends HTMLElement>(
  preset: SurfacePreset = "panel",
  forwardedRef?: Ref<T>,
) {
  return useGsapSurface<T>(forwardedRef, preset);
}

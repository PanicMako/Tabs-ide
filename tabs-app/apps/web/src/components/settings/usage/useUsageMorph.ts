import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import gsap from "gsap";
import { useSurfaceMotionSettings } from "../../../panelAnimations";

export type MorphProp = "height" | "width" | "flexGrow" | "left" | "top";

/** The attribute carrying an element's target for `prop`; React owns it, GSAP never writes it. */
export const morphAttr = (prop: MorphProp) => `data-morph-${prop.toLowerCase()}`;

/** Spread onto an element to give `useInlineMorph` its target and its initial paint. */
export function morphTarget(prop: MorphProp, value: string | number) {
  return { [morphAttr(prop)]: String(value) };
}

/**
 * Eases keyed elements from what they show now to the target React rendered,
 * instead of snapping. Elements under `root` matching `selector` need a
 * `data-key` and a {@link morphTarget} for `prop`.
 *
 * Targets come from the attribute, not the style, because GSAP writes the
 * style mid-tween and React commits before effects clean up. The value on
 * screen is tracked every frame, so an interrupted tween (new data, Strict
 * Mode's double mount) restarts from where the element visibly is.
 */
export function useInlineMorph(
  root: RefObject<HTMLElement | SVGElement | null>,
  selector: string,
  prop: MorphProp,
  deps: DependencyList,
  options: { readonly duration?: number; readonly fromZero?: boolean } = {},
) {
  const shown = useRef(new Map<string, string>());
  const motion = useSurfaceMotionSettings();
  const { duration = 0.42, fromZero = true } = options;
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- callers pass what changes the targets
  useLayoutEffect(() => {
    const nodes = root.current?.querySelectorAll<HTMLElement>(selector);
    if (!nodes) return;
    const attr = morphAttr(prop);
    const tweens: gsap.core.Tween[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const key = node.dataset.key;
      const target = node.getAttribute(attr);
      if (key === undefined || target === null) continue;
      seen.add(key);
      const from = shown.current.get(key) ?? (fromZero ? zeroOf(prop, target) : undefined);
      if (!motion.active || from === undefined || from === target) {
        node.style[prop] = target;
        shown.current.set(key, target);
        continue;
      }
      shown.current.set(key, from);
      tweens.push(
        gsap.fromTo(
          node,
          { [prop]: from },
          {
            [prop]: target,
            duration: motion.seconds(duration),
            ease: motion.profile.ease,
            overwrite: "auto",
            onUpdate: () => {
              shown.current.set(key, node.style[prop]);
            },
            onComplete: () => {
              shown.current.set(key, target);
            },
          },
        ),
      );
    }
    for (const key of [...shown.current.keys()]) if (!seen.has(key)) shown.current.delete(key);
    return () => {
      for (const tween of tweens) tween.kill();
    };
  }, [...deps, motion]);
}

function zeroOf(prop: MorphProp, target: string): string | undefined {
  if (prop === "left" || prop === "top") return undefined;
  if (prop === "flexGrow") return "0";
  return target.endsWith("%") ? "0%" : "0px";
}

/**
 * Glides list rows to their new position when the order changes (a FLIP
 * reorder), and settles newly added rows in. Rows need a `data-key`. A glide
 * interrupted by another reorder continues from where the row is on screen.
 */
export function useReorderGlide(
  root: RefObject<HTMLElement | null>,
  selector: string,
  deps: DependencyList,
) {
  // Where each row was last seen on screen: its layout top plus any glide offset.
  const seenAt = useRef(new Map<string, number>());
  const motion = useSurfaceMotionSettings();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- callers pass what reorders the rows
  useLayoutEffect(() => {
    const rows = root.current?.querySelectorAll<HTMLElement>(selector);
    if (!rows) return;
    const running: Array<{ key: string; row: HTMLElement; top: number; tween: gsap.core.Tween }> =
      [];
    const hadRows = seenAt.current.size > 0;
    const next = new Map<string, number>();
    let entering = 0;
    for (const row of rows) {
      const key = row.dataset.key;
      if (key === undefined) continue;
      const top = row.offsetTop;
      const previous = seenAt.current.get(key);
      next.set(key, top);
      if (!motion.active) continue;
      if (previous !== undefined && Math.abs(previous - top) > 0.5) {
        const tween = gsap.fromTo(
          row,
          { y: previous - top },
          {
            y: 0,
            duration: motion.seconds(0.42),
            ease: motion.profile.ease,
            overwrite: "auto",
            clearProps: "transform",
          },
        );
        running.push({ key, row, top, tween });
      } else if (previous === undefined && hadRows) {
        const tween = gsap.fromTo(
          row,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: motion.seconds(0.3),
            delay: motion.seconds(0.02 * entering++),
            ease: motion.profile.ease,
            overwrite: "auto",
            clearProps: "opacity,transform",
          },
        );
        running.push({ key, row, top, tween });
      }
    }
    seenAt.current = next;
    return () => {
      for (const { key, row, top, tween } of running) {
        if (tween.progress() < 1) {
          seenAt.current.set(key, top + (Number(gsap.getProperty(row, "y")) || 0));
        }
        tween.progress(1).kill();
      }
    };
  }, [...deps, motion]);
}

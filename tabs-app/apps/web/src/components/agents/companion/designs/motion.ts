import gsap from "gsap";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useSurfaceMotionSettings } from "~/panelAnimations";

/**
 * Motion for the side panel. Every animation runs through GSAP, follows the app's animation
 * duration setting and stops entirely for reduced motion. Nothing animates layout properties
 * that would make the native browser view lag behind: only transform, opacity and filter.
 */
export function useCompanionMotion() {
  // Transform/opacity/filter only, so this follows surface motion (on unless reduced motion).
  const { active, seconds, profile } = useSurfaceMotionSettings();
  return { active, seconds, profile };
}

/** Children matching `selector` rise into place one after another whenever `replayKey` changes. */
export function useStaggerIn(
  root: RefObject<HTMLElement | null>,
  selector: string,
  replayKey: string,
  options: { y?: number; stagger?: number } = {},
) {
  const { active, seconds, profile } = useCompanionMotion();
  const { y = 10, stagger = 0.035 } = options;
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !active) return;
    const items = node.querySelectorAll<HTMLElement>(selector);
    if (!items.length) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: y * 0.5 },
        {
          opacity: 1,
          y: 0,
          duration: seconds(0.24),
          ease: profile.ease,
          stagger: Math.min(stagger * 0.6, 0.16 / items.length),
          clearProps: "opacity,transform",
        },
      );
    }, node);
    return () => context.revert();
  }, [active, profile, replayKey, root, selector, seconds, y, stagger]);
}

/** The surface body settles in when a different surface or tab is shown. */
export function useSurfaceEnter(
  root: RefObject<HTMLElement | null>,
  key: string | null,
  /** Native views (the browser) are placed by their on-screen box and cannot follow a transform. */
  skip = false,
) {
  const { active, seconds, profile } = useCompanionMotion();
  const first = useRef(true);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !active) return;
    // The panel opening has its own motion; only switches inside it animate here.
    if (first.current || skip) {
      first.current = false;
      return;
    }
    // Opacity and a short rise only: blur or scale over a live terminal canvas or webview
    // smeared its rendering and threw off its first measurement.
    const tween = gsap.fromTo(
      node,
      { opacity: 0, y: 4 },
      {
        opacity: 1,
        y: 0,
        duration: seconds(0.2),
        ease: profile.ease,
        clearProps: "opacity,transform",
        // Anything placed from its on-screen box measures again once the surface has settled.
        onComplete: () => window.dispatchEvent(new Event("resize")),
      },
    );
    return () => {
      tween.kill();
      gsap.set(node, { clearProps: "opacity,transform" });
    };
  }, [active, key, profile, root, seconds, skip]);
}

/**
 * The segmented control's thumb glides to the chosen segment, and the segments it passes slide
 * aside as the chosen one opens its label, instead of everything jumping into place.
 */
export function useSegmentThumb(
  container: RefObject<HTMLElement | null>,
  thumb: RefObject<HTMLElement | null>,
  selectedKey: string,
) {
  const { active, seconds } = useCompanionMotion();
  const last = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const list = container.current;
    const mark = thumb.current;
    if (!list || !mark) return;
    const segments = [...list.querySelectorAll<HTMLElement>("[data-segment]")];
    const selected = segments.find((item) => item.dataset.segment === selectedKey);
    const place = (left: number, width: number) =>
      gsap.set(mark, { x: left, width, opacity: selected ? 1 : 0 });
    const previous = last.current;
    last.current = new Map(segments.map((item) => [item.dataset.segment!, item.offsetLeft]));
    if (!selected) return;
    if (!active || !previous) {
      place(selected.offsetLeft, selected.offsetWidth);
      return;
    }
    const context = gsap.context(() => {
      // FLIP: start every segment where it was, then let it travel to where it is now.
      for (const item of segments) {
        const before = previous.get(item.dataset.segment!);
        if (before === undefined || before === item.offsetLeft) continue;
        gsap.fromTo(
          item,
          { x: before - item.offsetLeft },
          { x: 0, duration: seconds(0.26), ease: "power3.out", clearProps: "transform" },
        );
      }
      gsap.to(mark, {
        x: selected.offsetLeft,
        width: selected.offsetWidth,
        opacity: 1,
        duration: seconds(0.28),
        ease: "expo.out",
      });
      const label = selected.querySelector<HTMLElement>(".cd-segment-label");
      if (label)
        gsap.fromTo(
          label,
          { opacity: 0, x: -4 },
          { opacity: 1, x: 0, duration: seconds(0.2), delay: seconds(0.05), ease: "power2.out" },
        );
    }, list);
    return () => context.revert();
  }, [active, container, seconds, selectedKey, thumb]);
}

/**
 * Opening a surface from the home: the chosen name swells and flies into its place in the
 * switcher while the others drift away, then the surface opens. Calls `done` exactly once.
 */
export function launchFromHome(options: {
  home: HTMLElement;
  row: HTMLElement | null;
  target: HTMLElement | null;
  active: boolean;
  seconds: (value: number) => number;
  done: () => void;
}) {
  const { home, row, target, active, seconds, done } = options;
  if (!active || !row) {
    done();
    return;
  }
  const rows = [...home.querySelectorAll<HTMLElement>(".surface-launcher-row")];
  const index = rows.indexOf(row);
  const pill = row.querySelector<HTMLElement>(".surface-launcher") ?? row;
  const kbd = row.querySelector<HTMLElement>("kbd");
  const from = pill.getBoundingClientRect();
  const to = target?.getBoundingClientRect();
  // Everything the flourish moves, so it can all be put back however the launch ends.
  const touched = [...rows, pill, kbd, target].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  let finished = false;
  // The launcher's own hover transition would fight the tween, so it pauses while flying.
  home.dataset.launching = "true";
  const timeline = gsap.timeline();
  const finish = () => {
    if (finished) return;
    finished = true;
    delete home.dataset.launching;
    done();
    // After the surface has opened, leave the home exactly as it was: a launcher left faded or
    // displaced here made the next visit to the home look broken and swallow clicks.
    requestAnimationFrame(() => {
      timeline.kill();
      gsap.set(touched, { clearProps: "opacity,transform,filter" });
    });
  };
  timeline.eventCallback("onComplete", finish);
  // The others fall away from the chosen one, nearest first.
  timeline.to(
    rows.filter((item) => item !== row),
    {
      opacity: 0,
      y: (_i, element: HTMLElement) => (rows.indexOf(element) < index ? -8 : 8),
      duration: seconds(0.16),
      ease: "power2.in",
      stagger: { each: 0.015, from: index },
    },
    0,
  );
  if (kbd) timeline.to(kbd, { opacity: 0, duration: seconds(0.08) }, 0);
  timeline.to(pill, { scale: 1.04, duration: seconds(0.08), ease: "power2.out" }, 0);
  if (to) {
    timeline.to(
      pill,
      {
        x: to.left + to.width / 2 - (from.left + from.width / 2),
        y: to.top + to.height / 2 - (from.top + from.height / 2),
        scale: Math.max(0.18, to.height / from.height),
        opacity: 0,
        duration: seconds(0.2),
        ease: "power3.in",
      },
      seconds(0.06),
    );
    if (target)
      timeline.fromTo(
        target,
        { scale: 1 },
        { scale: 1.08, duration: seconds(0.07), yoyo: true, repeat: 1, ease: "power2.out" },
        seconds(0.24),
      );
  } else {
    timeline.to(pill, { opacity: 0, scale: 1.1, duration: seconds(0.16) }, seconds(0.06));
  }
  // Never leave the user waiting on an animation that was interrupted.
  window.setTimeout(finish, Math.ceil(seconds(0.5) * 1000));
}

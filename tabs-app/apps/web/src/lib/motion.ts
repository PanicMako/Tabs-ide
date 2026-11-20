import gsap from "gsap";
import {
  MOTION_CLEAR_PROPS,
  MOTION_DURATIONS,
  MOTION_PROFILE,
  restFor,
  towardTrigger,
  type MotionKind,
  type MotionProfile,
} from "./motionProfiles";

/**
 * A heavy frame (a screen mounting, a big markdown render) must pause motion, not skip it.
 * GSAP's default only smooths stalls over 500ms, so a 200ms mount made a 300ms entrance jump
 * most of the way in on its first frame — the "it just pops" feel. Any stall over ~3 frames now
 * counts as one frame.
 */
gsap.ticker.lagSmoothing(50, 16);

/**
 * Every GSAP tween in the app plays this many times faster than it is written. Hand-tuned
 * durations across the app read as slow; one global clock keeps them in proportion while making
 * the whole app ~55% quicker. Web Animation holds that mirror a tween divide by this too.
 */
export const MOTION_TIME_SCALE = 2.2;
gsap.globalTimeline.timeScale(MOTION_TIME_SCALE);

/**
 * Generic curves for motion that is not a surface (loaders, small flourishes). Surfaces, screens,
 * rows and the sidebar take their curve from the active motion profile instead.
 */
export const MOTION_EASE = {
  enter: "tabs-glide",
  settle: "tabs-glide",
  exit: "tabs-exit",
  press: "power2.out",
} as const;

/** The active profile and the pace-adjusted clock every motion call needs. */
export interface MotionContext {
  seconds: (value: number) => number;
  profile: MotionProfile;
}

export const DEFAULT_MOTION_CONTEXT: MotionContext = {
  seconds: (value) => value,
  profile: MOTION_PROFILE,
};

export type SurfacePreset = Extract<
  MotionKind,
  | "popover"
  | "tooltip"
  | "dialog"
  | "backdrop"
  | "sheet-left"
  | "sheet-right"
  | "sheet-top"
  | "sheet-bottom"
  | "panel"
>;

export interface PresetSpec {
  kind: SurfacePreset;
  enterDuration: number;
  /** 0: the surface leaves without motion (it unmounts with its owner). */
  exitDuration: number;
}

export function getSurfacePreset(preset: SurfacePreset): PresetSpec {
  const [enterDuration, exitDuration] = MOTION_DURATIONS[preset];
  return { kind: preset, enterDuration, exitDuration };
}

/** Popups placed next to a trigger start slightly toward it, so they read as coming from it. */
export const sideOffsetVars = towardTrigger;

function radiusOf(node: Element, look: gsap.TweenVars | null): number {
  if (look && !("clipPath" in look)) return 0;
  return Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
}

function lookFor(
  kind: MotionKind,
  motion: MotionContext,
  node: Element,
  source: Element,
  amount: number,
): { look: gsap.TweenVars; radius: number } {
  const side = source.getAttribute("data-side");
  // Measure the radius only for looks that clip; probing with radius 0 is enough to tell.
  const probe = motion.profile.look(kind, { side, radius: 0, amount });
  const radius = radiusOf(node, probe);
  const look = radius ? motion.profile.look(kind, { side, radius, amount }) : probe;
  return { look, radius };
}

export function surfaceEnterFrom(
  spec: PresetSpec,
  source: HTMLElement,
  motion: MotionContext = DEFAULT_MOTION_CONTEXT,
): gsap.TweenVars {
  return motion.profile.look(spec.kind, {
    side: source.getAttribute("data-side"),
    radius: 0,
    amount: 1,
  });
}

/**
 * Plays a surface's entrance on `node`. `fromCurrent` resumes from wherever an interrupted exit
 * left it. `source` carries Base UI's state attributes when it differs from the painted node.
 */
export function playSurfaceEnter(
  node: HTMLElement,
  spec: PresetSpec,
  motion: MotionContext,
  fromCurrent: boolean,
  source: HTMLElement = node,
): gsap.core.Tween {
  const { look, radius } = lookFor(spec.kind, motion, node, source, 1);
  const to: gsap.TweenVars = {
    ...restFor(look, radius),
    duration: motion.seconds(spec.enterDuration),
    ease: motion.profile.ease,
    clearProps: MOTION_CLEAR_PROPS,
    overwrite: true,
  };
  if (fromCurrent) {
    gsap.set(node, { transition: "none" });
    return gsap.to(node, to);
  }
  return gsap.fromTo(node, { ...look, transition: "none" }, to);
}

/**
 * Plays a surface's exit and keeps the element alive for it. Base UI unmounts a closing popup
 * once `element.getAnimations()` settle, and a GSAP tween is not one of those — so a no-op Web
 * Animation of the same length holds the element until the tween has finished.
 */
export function playSurfaceExit(
  node: HTMLElement,
  spec: PresetSpec,
  motion: MotionContext,
  source: HTMLElement = node,
): { tween: gsap.core.Tween; hold: Animation | null } | null {
  if (!spec.exitDuration) return null;
  const duration = motion.seconds(spec.exitDuration);
  const { look } = lookFor(spec.kind, motion, node, source, 0.5);
  const tween = gsap.to(node, {
    ...look,
    transition: "none",
    duration,
    ease: motion.profile.exitEase,
    overwrite: true,
  });
  // The hold sits on `source`: that is the element Base UI watches before unmounting.
  const hold =
    typeof source.animate === "function"
      ? source.animate([{ "--surface-exit": "0" }, { "--surface-exit": "1" }], {
          duration: (duration * 1000) / MOTION_TIME_SCALE,
        })
      : null;
  return { tween, hold };
}

export function clearSurfaceMotion(node: HTMLElement) {
  gsap.killTweensOf(node);
  gsap.set(node, { clearProps: MOTION_CLEAR_PROPS });
}

/**
 * Plays a screen's exit before the app swaps it for another, so screens hand over instead of
 * cutting. Resolves when the exit has finished (or straight away when motion is off); the
 * caller then swaps the screen. If the screen stays, call `restoreScreen`.
 */
export function playScreenExit(
  node: HTMLElement | null,
  options: MotionContext & { active: boolean; soft?: boolean },
): Promise<void> {
  if (!node || !options.active) return Promise.resolve();
  const duration = options.seconds(MOTION_DURATIONS.screen[1] * (options.soft ? 0.85 : 1));
  const { look } = lookFor(options.soft ? "part" : "screen", options, node, node, 0.6);
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    gsap.to(node, {
      ...look,
      duration,
      ease: options.profile.exitEase,
      overwrite: true,
      onComplete: done,
      onInterrupt: done,
    });
    // Never hold the swap hostage to a tween that did not get a frame.
    window.setTimeout(done, (duration * 1000) / MOTION_TIME_SCALE + 120);
  });
}

export function restoreScreen(node: HTMLElement | null) {
  if (!node) return;
  gsap.killTweensOf(node);
  gsap.set(node, { clearProps: MOTION_CLEAR_PROPS });
}

/** Plays the active profile's entrance for a plain element (rows, screens, sidebar content). */
export function playLookEnter(
  targets: Element | ReadonlyArray<Element>,
  kind: MotionKind,
  motion: MotionContext,
  options: { stagger?: number; delay?: number; extra?: gsap.TweenVars } = {},
): gsap.core.Tween | null {
  const list = Array.isArray(targets) ? targets : [targets as Element];
  const first = list[0];
  if (!first) return null;
  const { look, radius } = lookFor(kind, motion, first, first, 1);
  const from = { ...look, ...options.extra };
  return gsap.fromTo(list, from, {
    ...restFor(from, radius),
    duration: motion.seconds(MOTION_DURATIONS[kind][0]),
    ease: motion.profile.ease,
    stagger: options.stagger ? motion.seconds(options.stagger) : 0,
    delay: options.delay ? motion.seconds(options.delay) : 0,
    clearProps: MOTION_CLEAR_PROPS,
    overwrite: true,
  });
}

export interface ScreenPart {
  /** Elements inside the screen root, by selector. */
  selector: string;
  /** Direction for this part, layered over the profile's own look. */
  from: gsap.TweenVars;
  /** Seconds after the screen starts, before pace is applied. */
  at: number;
  /** Stagger between matched elements. */
  stagger?: number;
  duration?: number;
}

/**
 * A screen's entrance as a short sequence: chrome, then navigation, then content, each part in
 * the active profile's style. Returns a cleanup that leaves every part at rest.
 */
export function playScreenEnter(
  root: HTMLElement,
  parts: ReadonlyArray<ScreenPart>,
  motion: MotionContext,
): () => void {
  const timeline = gsap.timeline();
  const touched: Element[] = [];
  for (const part of parts) {
    const targets = Array.from(root.querySelectorAll(part.selector));
    const first = targets[0];
    if (!first) continue;
    touched.push(...targets);
    const { look, radius } = lookFor("part", motion, first, first, 1);
    const from = { ...look, ...part.from };
    timeline.fromTo(
      targets,
      from,
      {
        ...restFor(from, radius),
        duration: motion.seconds(part.duration ?? MOTION_DURATIONS.part[0]),
        ease: motion.profile.ease,
        stagger: part.stagger ? motion.seconds(part.stagger) : 0,
        clearProps: MOTION_CLEAR_PROPS,
      },
      motion.seconds(part.at),
    );
  }
  return () => {
    timeline.kill();
    if (touched.length) gsap.set(touched, { clearProps: MOTION_CLEAR_PROPS });
  };
}

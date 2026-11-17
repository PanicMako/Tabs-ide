import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

CustomEase.create("tabs-swift", "M0,0 C0.3,1 0.42,1 1,1");
// Generic curves for motion that is not a surface (loaders, small flourishes).
CustomEase.create("tabs-glide", "M0,0 C0.2,0.9 0.32,1 1,1");
CustomEase.create("tabs-exit", "M0,0 C0.4,0 0.9,0.5 1,1");

/** What is moving. Each profile gives every kind its own look. */
export type MotionKind =
  | "popover"
  | "tooltip"
  | "dialog"
  | "backdrop"
  | "sheet-left"
  | "sheet-right"
  | "sheet-top"
  | "sheet-bottom"
  | "panel"
  | "row"
  | "sidebar"
  | "part"
  | "screen";

export interface MotionLookContext {
  /** Base UI's `data-side`: which side of its trigger a popup sits on. */
  side: string | null;
  /** The element's corner radius, so clip reveals keep its shape. */
  radius: number;
  /** 1 for an entrance; exits use a shorter distance (0.5) so they get out of the way. */
  amount: number;
}

export interface MotionProfile {
  /** Multiplies every reference duration. */
  pace: number;
  ease: string;
  exitEase: string;
  /** The state a surface starts from (entrance) or leaves to (exit). */
  look: (kind: MotionKind, context: MotionLookContext) => gsap.TweenVars;
}

/** Reference durations in seconds (entrance, exit), before profile and user pace. */
export const MOTION_DURATIONS: Record<MotionKind, readonly [number, number]> = {
  popover: [0.2, 0.12],
  tooltip: [0.14, 0.08],
  dialog: [0.26, 0.16],
  backdrop: [0.2, 0.14],
  "sheet-left": [0.3, 0.2],
  "sheet-right": [0.3, 0.2],
  "sheet-top": [0.3, 0.2],
  "sheet-bottom": [0.3, 0.2],
  panel: [0.24, 0],
  row: [0.28, 0],
  sidebar: [0.3, 0],
  part: [0.26, 0],
  screen: [0, 0.12],
};

/** Popups start slightly toward their trigger, so they read as coming out of it. */
export function towardTrigger(side: string | null, distance: number): gsap.TweenVars {
  switch (side) {
    case "top":
      return { y: distance };
    case "bottom":
      return { y: -distance };
    case "left":
    case "inline-start":
      return { x: distance };
    case "right":
    case "inline-end":
      return { x: -distance };
    default:
      return { y: -distance * 0.5 };
  }
}

function sheetTravel(kind: MotionKind, distance: number): gsap.TweenVars {
  if (kind === "sheet-left") return { x: -distance };
  if (kind === "sheet-right") return { x: distance };
  if (kind === "sheet-top") return { y: -distance };
  return { y: distance };
}

function isSheet(kind: MotionKind) {
  return kind.startsWith("sheet-");
}

const inset = (t: number, r: number, b: number, l: number, radius: number) =>
  `inset(${t}% ${r}% ${b}% ${l}% round ${radius}px)`;

export function clipAtRest(radius: number): string {
  return inset(0, 0, 0, 0, radius);
}

/** Quick, clean fades: a small scale on popups and dialogs, a short slide on sheets. */
function crispLook(kind: MotionKind, { amount: a }: MotionLookContext): gsap.TweenVars {
  if (kind === "popover" || kind === "dialog") return { opacity: 0, scale: 1 - 0.02 * a };
  if (isSheet(kind)) return { opacity: 0, ...sheetTravel(kind, 10 * a) };
  return { opacity: 0 };
}

/**
 * The app's motion: clean fades and small scales, quick (half the reference durations)
 * on a sharp curve. The user picked it over slower and more elaborate styles.
 */
export const MOTION_PROFILE: MotionProfile = {
  pace: 0.5,
  ease: "tabs-swift",
  exitEase: "power2.in",
  look: crispLook,
};

const REST_VALUES: Record<string, unknown> = {
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  xPercent: 0,
  yPercent: 0,
  rotationX: 0,
  rotationY: 0,
  filter: "blur(0px)",
};

/** The resting state for exactly the properties a look moves, so nothing else is touched. */
export function restFor(look: gsap.TweenVars, radius: number): gsap.TweenVars {
  const rest: gsap.TweenVars = {};
  for (const key of Object.keys(look)) {
    if (key === "clipPath") rest.clipPath = clipAtRest(radius);
    else if (key === "transformPerspective" || key === "transformOrigin") rest[key] = look[key];
    else if (key in REST_VALUES) rest[key] = REST_VALUES[key];
  }
  return rest;
}

/** Every inline property a look can leave behind. */
export const MOTION_CLEAR_PROPS = "opacity,transform,transformOrigin,filter,clipPath,transition";

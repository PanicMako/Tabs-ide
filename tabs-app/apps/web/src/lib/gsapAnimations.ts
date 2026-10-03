import gsap from "gsap";

/**
 * Standard GSAP easing presets for consistent, ultra-smooth feel across the app.
 */
export const GSAP_EASING = {
  smooth: "power2.out",
  snappy: "power3.out",
  spring: "back.out(1.4)",
  gentle: "power1.inOut",
  elastic: "elastic.out(1.1, 0.4)",
} as const;

export interface FadeInOptions {
  duration?: number;
  y?: number;
  x?: number;
  scale?: number;
  delay?: number;
  ease?: string;
  onComplete?: () => void;
}

export interface StaggerOptions extends FadeInOptions {
  stagger?: number;
}

/**
 * Smoothly animates an element in from a slight offset and 0 opacity.
 */
export function animateElementIn(
  target: gsap.TweenTarget,
  options: FadeInOptions = {},
): gsap.core.Tween {
  const {
    duration = 0.35,
    y = 8,
    x = 0,
    scale = 1,
    delay = 0,
    ease = GSAP_EASING.smooth,
    onComplete,
  } = options;

  gsap.killTweensOf(target);

  const fromVars: gsap.TweenVars = { opacity: 0, y, x };
  if (scale !== 1) fromVars.scale = scale;

  const toVars: gsap.TweenVars = {
    opacity: 1,
    y: 0,
    x: 0,
    scale: 1,
    duration,
    delay,
    ease,
    overwrite: "auto",
  };
  if (onComplete) toVars.onComplete = onComplete;

  return gsap.fromTo(target, fromVars, toVars);
}

/**
 * Staggers a list of child elements with smooth entry animations.
 */
export function animateStaggerChildren(
  targets: gsap.TweenTarget,
  options: StaggerOptions = {},
): gsap.core.Tween {
  const {
    duration = 0.3,
    stagger = 0.04,
    y = 10,
    x = 0,
    delay = 0,
    ease = GSAP_EASING.smooth,
    onComplete,
  } = options;

  gsap.killTweensOf(targets);

  const toVars: gsap.TweenVars = {
    opacity: 1,
    y: 0,
    x: 0,
    duration,
    stagger,
    delay,
    ease,
    overwrite: "auto",
  };
  if (onComplete) toVars.onComplete = onComplete;

  return gsap.fromTo(targets, { opacity: 0, y, x }, toVars);
}

/**
 * Smoothly transitions an active tab / panel in.
 */
export function animateTabSwitch(
  incomingElement: HTMLElement | null,
  options: { duration?: number; y?: number; ease?: string } = {},
): gsap.core.Tween | null {
  if (!incomingElement) return null;

  const { duration = 0.28, y = 6, ease = GSAP_EASING.smooth } = options;

  gsap.killTweensOf(incomingElement);

  return gsap.fromTo(
    incomingElement,
    { opacity: 0, y },
    {
      opacity: 1,
      y: 0,
      duration,
      ease,
      clearProps: "transform",
      overwrite: "auto",
    },
  );
}

/**
 * Animates a modal dialog and backdrop opening with a gentle spring scale.
 */
export function animateModalOpen(
  modalElement: HTMLElement | null,
  backdropElement?: HTMLElement | null,
  options: { duration?: number } = {},
): void {
  const { duration = 0.32 } = options;

  if (backdropElement) {
    gsap.killTweensOf(backdropElement);
    gsap.fromTo(
      backdropElement,
      { opacity: 0 },
      { opacity: 1, duration: duration * 0.75, ease: "power1.out", overwrite: "auto" },
    );
  }

  if (modalElement) {
    gsap.killTweensOf(modalElement);
    gsap.fromTo(
      modalElement,
      { opacity: 0, scale: 0.95, y: 8 },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration,
        ease: GSAP_EASING.spring,
        overwrite: "auto",
      },
    );
  }
}

/**
 * Smoothly pulses or highlights an element (e.g. active badge, live pill).
 */
export function animatePulseBadge(target: gsap.TweenTarget): gsap.core.Tween {
  gsap.killTweensOf(target);
  return gsap.fromTo(
    target,
    { scale: 0.9, opacity: 0.7 },
    {
      scale: 1,
      opacity: 1,
      duration: 0.4,
      ease: GSAP_EASING.spring,
      overwrite: "auto",
    },
  );
}

export default gsap;

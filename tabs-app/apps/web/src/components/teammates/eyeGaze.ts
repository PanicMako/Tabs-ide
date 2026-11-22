import type { TeammateMood } from "@tabs/contracts";
import { useEffect, useRef, type RefObject } from "react";

/** How far the eyes travel at full gaze, in pixels. */
export const GAZE_X_PX = 3.6;
export const GAZE_Y_PX = 2.4;
/** Within this distance the eyes aim straight at the cursor; further out they are at full gaze. */
export const NEAR_PX = 48;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where the eyes aim for a cursor `dx`, `dy` pixels away, as a direction in -1 to 1. */
export function gazeTarget(dx: number, dy: number): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) return { x: 0, y: 0 };
  const pull = Math.min(1, distance / NEAR_PX);
  return { x: (dx / distance) * pull, y: (dy / distance) * pull };
}

/**
 * How the eyes look for a gaze: the pair shifts and tilts a little with the head, the eye farther
 * from where you are looking narrows (perspective), and the lids lower looking down and lift
 * looking up.
 */
export function eyePose(x: number, y: number) {
  const lid = y > 0 ? 1 - y * 0.18 : 1 - y * 0.08;
  return {
    tx: x * GAZE_X_PX,
    ty: y * GAZE_Y_PX,
    rotate: x * 2.5,
    left: { sx: x > 0 ? 1 - x * 0.22 : 1, sy: lid },
    right: { sx: x < 0 ? 1 + x * 0.22 : 1, sy: lid },
  };
}

const between = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Brings a pair of eyes to life. They follow the cursor with a quick, slightly springy glance,
 * blink on their own (and now and then after a big look), drift to look around when left alone,
 * scan slowly while the teammate works, and stay on you when it needs you. The element holds the
 * two eyes as its children; nothing here re-renders React.
 */
export function useEyeGaze(
  ref: RefObject<HTMLElement | null>,
  mood: TeammateMood,
  attention: boolean,
) {
  const live = useRef({ mood, attention });
  live.current = { mood, attention };

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const eyes = Array.from(element.children) as HTMLElement[];
    const [left, right] = eyes;
    if (!left || !right) return;

    const state = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      moved: -1e9,
      glance: 0,
      looking: null as { x: number; y: number } | null,
    };
    let frame: number | null = null;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let glanceTimer: ReturnType<typeof setTimeout> | undefined;
    let lastBlink = 0;

    const apply = () => {
      const pose = eyePose(state.x, state.y);
      element.style.translate = `${pose.tx.toFixed(2)}px ${pose.ty.toFixed(2)}px`;
      element.style.rotate = `${pose.rotate.toFixed(2)}deg`;
      left.style.scale = `${pose.left.sx.toFixed(3)} ${pose.left.sy.toFixed(3)}`;
      right.style.scale = `${pose.right.sx.toFixed(3)} ${pose.right.sy.toFixed(3)}`;
    };

    const blink = () => {
      lastBlink = performance.now();
      for (const eye of eyes)
        eye.animate(
          [
            { transform: "scaleY(1)" },
            { transform: "scaleY(0.08)", offset: 0.45 },
            { transform: "scaleY(1)" },
          ],
          { duration: 150, easing: "ease-in-out" },
        );
    };
    const scheduleBlink = () => {
      blinkTimer = setTimeout(
        () => {
          if (!live.current.attention) {
            blink();
            if (Math.random() < 0.18) setTimeout(blink, 230);
          }
          scheduleBlink();
        },
        between(2400, 6200),
      );
    };

    // Left alone, an idle teammate looks around now and then.
    const scheduleGlance = () => {
      glanceTimer = setTimeout(
        () => {
          const resting = performance.now() - state.moved > 2500;
          if (resting && live.current.mood === "idle" && !live.current.attention) {
            state.looking = { x: between(-0.9, 0.9), y: between(-0.3, 0.3) };
            state.glance = performance.now() + between(500, 1300);
            kick();
          }
          scheduleGlance();
        },
        between(2600, 6000),
      );
    };

    const step = (now: number) => {
      frame = null;
      const resting = now - state.moved > 2500;
      const { mood: currentMood, attention: wantsYou } = live.current;
      if (resting && !wantsYou) {
        if (currentMood === "working" || currentMood === "thinking") {
          // Scanning: a slow look across the work.
          state.tx = Math.sin(now / 1100) * 0.75;
          state.ty = Math.sin(now / 1700) * 0.16;
        } else if (state.looking && now < state.glance) {
          state.tx = state.looking.x;
          state.ty = state.looking.y;
        } else {
          state.looking = null;
          state.tx = 0;
          state.ty = 0;
        }
      }
      // A damped spring that snaps harder the further it has to go, so a big look is a quick
      // saccade that settles, and a small one is a gentle drift.
      const errorX = state.tx - state.x;
      const errorY = state.ty - state.y;
      const snap = 0.14 + 0.2 * Math.min(1, Math.hypot(errorX, errorY));
      state.vx = state.vx * 0.66 + errorX * snap;
      state.vy = state.vy * 0.66 + errorY * snap;
      state.x += state.vx;
      state.y += state.vy;
      apply();
      const moving = Math.abs(errorX) + Math.abs(errorY) + Math.abs(state.vx) + Math.abs(state.vy);
      const scanning =
        resting && !wantsYou && (currentMood === "working" || currentMood === "thinking");
      const glancing = state.looking !== null;
      if (moving > 0.004 || scanning || glancing) frame = requestAnimationFrame(step);
    };
    function kick() {
      if (frame === null) frame = requestAnimationFrame(step);
    }

    const onMove = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const next = gazeTarget(
        event.clientX - (box.left + box.width / 2),
        event.clientY - (box.top + box.height / 2),
      );
      const jump = Math.hypot(next.x - state.tx, next.y - state.ty);
      const now = performance.now();
      // A big change of look is often followed by a blink.
      if (jump > 0.9 && now - lastBlink > 900 && Math.random() < 0.35 && !live.current.attention)
        blink();
      state.tx = clamp(next.x, -1, 1);
      state.ty = clamp(next.y, -1, 1);
      state.moved = now;
      state.looking = null;
      kick();
    };
    const onLeave = () => {
      state.tx = 0;
      state.ty = 0;
      state.moved = performance.now();
      kick();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    scheduleBlink();
    scheduleGlance();
    kick();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      clearTimeout(blinkTimer);
      clearTimeout(glanceTimer);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [ref]);
}

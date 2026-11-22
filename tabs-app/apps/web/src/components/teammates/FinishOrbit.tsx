import type { TeammateFinish } from "@tabs/contracts";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import "~/lib/motion";
import { NotchAvatar } from "./NotchAvatar";
import { customFinishHue, customFinishId, finishStyle, finishSwatch } from "./notchFinish";
import { FINISH_OPTIONS, finishName } from "./teammates.logic";

/** The dial's stops: every preset finish, then "Custom" for a colour of your own. */
const CUSTOM = "custom" as const;
type Stop = TeammateFinish | typeof CUSTOM;
const STOPS: ReadonlyArray<{ id: Stop; label: string }> = [
  ...FINISH_OPTIONS.map((option) => ({ id: option.id as Stop, label: option.name })),
  { id: CUSTOM, label: "Custom colour" },
];
const STEP = 360 / STOPS.length;
const DRAG_START_PX = 4;
const DEFAULT_HUE = 212;
const RAINBOW = `conic-gradient(from 0deg, ${Array.from(
  { length: 13 },
  (_, i) => `hsl(${i * 30} 90% 60%)`,
).join(", ")})`;

const mod = (value: number, size: number) => ((value % size) + size) % size;

/** What the name under the dial says while a stop is hovered: its finish, or "Custom". */
function peekLabel(index: number): string {
  const stop = STOPS[index]!;
  return stop.id === CUSTOM ? "Custom" : stop.label;
}

/** The dial's stop a finish sits on. */
function stopIndex(finish: TeammateFinish): number {
  if (customFinishHue(finish) !== null) return STOPS.length - 1;
  return Math.max(
    0,
    STOPS.findIndex((stop) => stop.id === finish),
  );
}

/** Angle of a point around the dial's centre, 0 at the top and growing clockwise. */
function angleAt(element: HTMLElement, x: number, y: number): number {
  const box = element.getBoundingClientRect();
  return (
    (Math.atan2(x - (box.left + box.width / 2), -(y - (box.top + box.height / 2))) * 180) / Math.PI
  );
}

/**
 * Pick a finish on a dial. The finishes sit on an orbit around the mascot, which wears whatever is
 * chosen. Drag the orbit round, click a finish, or use the arrow keys. The last stop is a colour
 * of your own: choose it and a hue ring opens inside the orbit to turn to any colour.
 */
export function FinishOrbit({
  value,
  onChange,
}: {
  value: TeammateFinish;
  onChange: (finish: TeammateFinish) => void;
}) {
  const dial = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const angle = useRef({ value: 0 });
  const drag = useRef<{ from: number; start: number; moved: boolean } | null>(null);
  const hueDrag = useRef(false);
  const suppressClick = useRef(false);
  const lastHue = useRef(customFinishHue(value) ?? DEFAULT_HUE);
  const [spinning, setSpinning] = useState(false);
  const [peek, setPeek] = useState<number | null>(null);
  const current = stopIndex(value);
  const hue = customFinishHue(value);
  if (hue !== null) lastHue.current = hue;
  const customOpen = hue !== null;

  const paint = () => ring.current?.style.setProperty("--ring", String(angle.current.value));
  const spinTo = (target: number, animate: boolean) => {
    gsap.killTweensOf(angle.current);
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      angle.current.value = target;
      paint();
      return;
    }
    gsap.to(angle.current, {
      value: target,
      duration: 0.8,
      ease: "tabs-glide",
      onUpdate: paint,
    });
  };

  /** The ring angle that brings stop `index` to the top by the shortest way round. */
  const targetFor = (index: number) => {
    const turns = Math.round(-angle.current.value / STEP);
    let delta = mod(index, STOPS.length) - mod(turns, STOPS.length);
    if (delta > STOPS.length / 2) delta -= STOPS.length;
    if (delta < -STOPS.length / 2) delta += STOPS.length;
    return -(turns + delta) * STEP;
  };

  // Follow the value when it changes from outside the dial (a new starting point, say).
  const first = useRef(true);
  useEffect(() => {
    if (drag.current?.moved) return;
    spinTo(targetFor(current), !first.current);
    first.current = false;
  }, [current]);

  /** The finish the middle shows: the one under the pointer while hovering, else the chosen one. */
  const shown: TeammateFinish =
    peek === null
      ? value
      : STOPS[peek]!.id === CUSTOM
        ? customFinishId(lastHue.current)
        : (STOPS[peek]!.id as TeammateFinish);

  // The mascot pops as its finish changes.
  const core = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = core.current?.querySelector<HTMLElement>(".notch-avatar");
    if (!element || first.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const tween = gsap.fromTo(
      element,
      { scale: 0.88, rotation: -5 },
      { scale: 1, rotation: 0, duration: 0.5, ease: "tabs-glide", clearProps: "transform" },
    );
    return () => void tween.kill();
  }, [shown]);

  const choose = (index: number) => {
    const stop = STOPS[mod(index, STOPS.length)]!;
    onChange(stop.id === CUSTOM ? customFinishId(lastHue.current) : stop.id);
  };
  const step = (by: number) => choose(current + by);

  const setHueFrom = (event: { clientX: number; clientY: number }) => {
    if (!dial.current) return;
    lastHue.current = mod(angleAt(dial.current, event.clientX, event.clientY), 360);
    onChange(customFinishId(lastHue.current));
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={dial}
        role="radiogroup"
        aria-label="Finish"
        className="tm-orbit no-drag"
        data-spinning={spinning}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            step(-1);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !dial.current || hueDrag.current) return;
          const box = dial.current.getBoundingClientRect();
          const dx = event.clientX - (box.left + box.width / 2);
          const dy = event.clientY - (box.top + box.height / 2);
          // Only the orbit itself turns: the middle belongs to the mascot and the hue ring.
          if (Math.hypot(dx, dy) < box.width * 0.36) return;
          gsap.killTweensOf(angle.current);
          drag.current = {
            from: angleAt(dial.current, event.clientX, event.clientY),
            start: angle.current.value,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state || !dial.current) return;
          const now = angleAt(dial.current, event.clientX, event.clientY);
          let delta = now - state.from;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          if (!state.moved && Math.abs(delta) < DRAG_START_PX) return;
          if (!state.moved) {
            state.moved = true;
            setSpinning(true);
            dial.current.setPointerCapture(event.pointerId);
          }
          // Keep turning past a half circle without the angle jumping.
          state.from = now;
          state.start += delta;
          angle.current.value = state.start;
          paint();
          const index = mod(Math.round(-state.start / STEP), STOPS.length);
          if (index !== current) choose(index);
        }}
        onPointerUp={(event) => {
          const state = drag.current;
          drag.current = null;
          if (!state?.moved || !dial.current) return;
          setSpinning(false);
          suppressClick.current = true;
          setTimeout(() => (suppressClick.current = false), 0);
          if (dial.current.hasPointerCapture(event.pointerId))
            dial.current.releasePointerCapture(event.pointerId);
          spinTo(-Math.round(-angle.current.value / STEP) * STEP, true);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setSpinning(false);
        }}
      >
        <div className="tm-orbit-track" aria-hidden="true" />
        <div ref={ring} className="tm-orbit-ring" style={{ "--ring": 0, "--step": STEP } as never}>
          {STOPS.map((stop, index) => {
            const selected = index === current;
            return (
              <button
                key={stop.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={stop.label}
                tabIndex={selected ? 0 : -1}
                data-selected={selected}
                data-finish={stop.id === CUSTOM ? undefined : stop.id}
                className="tm-orbit-stop notch-plate no-drag"
                style={{ "--i": index } as never}
                onMouseEnter={() => setPeek(index)}
                onMouseLeave={() => setPeek(null)}
                onFocus={() => setPeek(index)}
                onBlur={() => setPeek(null)}
                onClick={() => {
                  if (suppressClick.current) return;
                  spinTo(targetFor(index), true);
                  choose(index);
                }}
              >
                <span className="tm-orbit-tip" aria-hidden="true">
                  {stop.id === CUSTOM ? "Custom colour" : stop.label}
                </span>
                <span
                  className="tm-swatch-dot"
                  style={{
                    background: stop.id === CUSTOM ? RAINBOW : finishSwatch(stop.id),
                  }}
                />
              </button>
            );
          })}
        </div>
        <div className="tm-hue" data-open={customOpen} aria-hidden={!customOpen}>
          <div
            className="tm-hue-ring"
            onPointerDown={(event) => {
              if (!customOpen || !dial.current) return;
              const box = dial.current.getBoundingClientRect();
              const reach = Math.hypot(
                event.clientX - (box.left + box.width / 2),
                event.clientY - (box.top + box.height / 2),
              );
              // Only the coloured ring turns the hue, not the space inside it.
              if (reach < 76 || reach > 108) return;
              event.stopPropagation();
              hueDrag.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setHueFrom(event);
            }}
            onPointerMove={(event) => {
              if (hueDrag.current) setHueFrom(event);
            }}
            onPointerUp={(event) => {
              hueDrag.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
          <button
            type="button"
            role="slider"
            tabIndex={customOpen ? 0 : -1}
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={Math.round(lastHue.current)}
            className="tm-hue-knob no-drag"
            style={{ "--hue": lastHue.current } as never}
            onKeyDown={(event) => {
              const by =
                event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? 6
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? -6
                    : 0;
              if (!by) return;
              event.preventDefault();
              event.stopPropagation();
              lastHue.current = mod(lastHue.current + by, 360);
              onChange(customFinishId(lastHue.current));
            }}
          />
        </div>
        <div
          ref={core}
          className="tm-orbit-core notch-plate"
          style={finishStyle(shown)}
          data-finish={value}
        >
          <NotchAvatar finish={shown} mood="happy" className="tm-orbit-mascot" />
        </div>
      </div>
      <span className="tm-orbit-name" aria-live="polite">
        {peek === null ? finishName(value) : peekLabel(peek)}
      </span>
    </div>
  );
}

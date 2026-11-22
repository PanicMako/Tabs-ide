import gsap from "gsap";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "~/lib/motion";
import { Button } from "../ui/button";
import { MotionEnter } from "../ui/motion-enter";
import { NotchPlate } from "./NotchPlate";
import { RoleBackdrop, RoleProps } from "./RoleArt";
import { CUSTOM_TEMPLATE_ID, type TeammateTemplate } from "./teammateTemplates";

const CARD_WIDTH_PX = 200;
/** A drag has to travel this far before it is a swipe, and this far again for each further card. */
const DRAG_START_PX = 6;
const DRAG_STEP_PX = 72;
/** Cards further from the middle than this wait off stage, stacked behind the last visible one. */
const VISIBLE_SIDE_CARDS = 2;
const WHEEL_COOLDOWN_MS = 220;
/** How far the eyes turn toward the pointer, in the mascot's artwork units. */
const LOOK_X = 13;
const LOOK_Y = 9;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where a card sits for its distance from the middle: fanned out, turned in, set back. */
export function coverflowPose(offset: number, spacing: number) {
  const side = clamp(offset, -VISIBLE_SIDE_CARDS, VISIBLE_SIDE_CARDS);
  const reach = Math.abs(side);
  return {
    x: side * spacing,
    z: 0 - reach * 110,
    rotationY: 0 - side * 28,
    scale: 1 - reach * 0.09,
    opacity: Math.abs(offset) > VISIBLE_SIDE_CARDS ? 0 : 1 - reach * 0.36,
    zIndex: 20 - Math.abs(offset),
  };
}

/**
 * Starting points as a stage of cards in a fan. Each card is a small scene: a backdrop and a prop
 * that say what the teammate does, and the mascot's eyes follow your pointer. The card in the
 * middle is the chosen one: swipe or drag across the stage, scroll sideways, press the arrow keys,
 * click a card beside it, or use the arrows below.
 */
export function TemplateCarousel({
  templates,
  selectedId,
  onSelect,
  emblem,
  customEditor,
}: {
  templates: ReadonlyArray<TeammateTemplate>;
  selectedId: string;
  onSelect: (id: string) => void;
  /** The emblem the custom card wears. */
  emblem?: string;
  /** Shown under the stage while the custom card is chosen. */
  customEditor?: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [spacing, setSpacing] = useState(170);
  const [look, setLook] = useState<{ x: number; y: number } | undefined>(undefined);
  const placed = useRef(false);
  const frame = useRef<number | null>(null);
  const drag = useRef<{ x: number; steps: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const wheelAt = useRef(0);
  const index = Math.max(
    0,
    templates.findIndex((item) => item.id === selectedId),
  );
  const selected = templates[index]!;

  const step = (by: number) => {
    const next = templates[clamp(index + by, 0, templates.length - 1)];
    if (next && next.id !== selectedId) onSelect(next.id);
  };

  // Fan the cards out to fit however wide the form is.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setSpacing(clamp(element.clientWidth * 0.3, 128, 210));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Glide every card to its place. The first layout and reduced motion jump straight there.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const calm = !placed.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.querySelectorAll<HTMLElement>("[role=radio]").forEach((card, position) => {
      const pose = coverflowPose(position - index, spacing);
      if (calm) gsap.set(card, pose);
      else gsap.to(card, { ...pose, duration: 0.55, ease: "tabs-glide", overwrite: true });
    });
    placed.current = true;
  }, [index, spacing, templates.length]);

  // The chosen mascot hops in as its card arrives.
  useEffect(() => {
    const element = stage.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const art = element.querySelector<HTMLElement>("[data-selected=true] .notch-avatar");
    if (!art) return;
    const tween = gsap.fromTo(
      art,
      { scale: 0.82, y: 10, rotation: -4 },
      { scale: 1, y: 0, rotation: 0, duration: 0.7, ease: "tabs-glide", clearProps: "transform" },
    );
    return () => void tween.kill();
  }, [selectedId]);
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);

  const aim = (clientX: number, clientY: number) => {
    const element = stage.current;
    if (!element) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      const nx = clamp((clientX - (box.left + box.width / 2)) / (box.width / 2), -1, 1);
      const ny = clamp((clientY - (box.top + box.height / 2)) / (box.height / 2), -1, 1);
      element.style.setProperty("--tilt-x", nx.toFixed(3));
      element.style.setProperty("--tilt-y", ny.toFixed(3));
      setLook({ x: nx * LOOK_X, y: ny * LOOK_Y });
    });
  };
  const rest = () => {
    stage.current?.style.setProperty("--tilt-x", "0");
    stage.current?.style.setProperty("--tilt-y", "0");
    setLook(undefined);
  };

  return (
    <div className="tm-flow">
      <div
        ref={stage}
        role="radiogroup"
        aria-label="Starting point"
        className="tm-flow-stage no-drag"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            step(-1);
          }
        }}
        onWheel={(event) => {
          // Sideways scrolling (a trackpad swipe) moves the cards; plain vertical scrolling does not.
          if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 12)
            return;
          const now = performance.now();
          if (now - wheelAt.current < WHEEL_COOLDOWN_MS) return;
          wheelAt.current = now;
          step(event.deltaX > 0 ? 1 : -1);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, steps: 0, moved: false };
        }}
        onPointerMove={(event) => {
          aim(event.clientX, event.clientY);
          const state = drag.current;
          if (!state) return;
          const delta = event.clientX - state.x;
          if (!state.moved && Math.abs(delta) < DRAG_START_PX) return;
          if (!state.moved) {
            state.moved = true;
            stage.current?.setPointerCapture(event.pointerId);
          }
          // Dragging left pulls the next card in, like turning a page.
          const target = Math.trunc(-delta / DRAG_STEP_PX);
          if (target !== state.steps) {
            step(target - state.steps);
            state.steps = target;
          }
        }}
        onPointerUp={(event) => {
          const state = drag.current;
          drag.current = null;
          if (!state?.moved) return;
          suppressClick.current = true;
          setTimeout(() => (suppressClick.current = false), 0);
          if (stage.current?.hasPointerCapture(event.pointerId))
            stage.current.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={rest}
      >
        {templates.map((item, position) => {
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${item.title}. ${item.line}`}
              data-template-id={item.id}
              data-shape="preview"
              data-selected={active}
              tabIndex={active ? 0 : -1}
              style={{ width: CARD_WIDTH_PX }}
              className="tm-flow-card no-drag"
              onClick={() => {
                if (!suppressClick.current) onSelect(item.id);
              }}
            >
              <NotchPlate
                finish={item.finish}
                mood={active ? "happy" : "idle"}
                look={active ? look : undefined}
                className="tm-flow-art"
                avatarClassName="tm-flow-mascot"
                overlay={<RoleProps art={item.art} {...(emblem ? { emblem } : {})} />}
              >
                <RoleBackdrop art={item.art} />
              </NotchPlate>
              <span className="tm-flow-index">{String(position + 1).padStart(2, "0")}</span>
              <span className="tm-flow-check" aria-hidden="true">
                {active ? (
                  <CheckIcon className="size-3" />
                ) : item.id === CUSTOM_TEMPLATE_ID ? (
                  <PlusIcon className="size-3" />
                ) : null}
              </span>
              <span className="tm-flow-title">{item.title}</span>
            </button>
          );
        })}
      </div>
      <MotionEnter key={selected.id} className="tm-flow-caption" aria-live="polite">
        <h3 className="tm-flow-caption-title">{selected.title}</h3>
        <p className="tm-supporting">{selected.line}</p>
        {selected.id === CUSTOM_TEMPLATE_ID ? (
          customEditor
        ) : (
          <p className="tm-meta">Try asking: “{selected.asks[0]}”</p>
        )}
      </MotionEnter>
      <div className="tm-carousel-nav">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Previous starting point"
          disabled={index === 0}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="tm-carousel-dots" aria-hidden="true">
          {templates.map((item) => (
            <span key={item.id} className="tm-dot" data-active={item.id === selectedId} />
          ))}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Next starting point"
          disabled={index === templates.length - 1}
          onClick={() => step(1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}

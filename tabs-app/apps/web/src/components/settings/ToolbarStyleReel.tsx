import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import type { ToolbarStyle } from "@tabs/contracts/settings";
import { cn } from "../../lib/utils";
import { resolveToolbarStyle, TOOLBAR_STYLES } from "../../lib/toolbarStyles";
import { usePanelAnimationSettings } from "../../panelAnimations";
import { Button } from "../ui/button";
import "./toolbar-style-reel.css";

const TOOLS = ["Code", "Agents", "Browser"];

function ToolbarSample({
  style,
  activeTool,
  animate,
}: {
  style: ToolbarStyle;
  activeTool: number;
  animate: boolean;
}) {
  const track = useRef<HTMLSpanElement>(null);
  const pill = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const node = track.current;
    const indicator = pill.current;
    const tab = node?.querySelector<HTMLElement>(".nav-tab.active");
    if (!node || !indicator || !tab) return;
    const align = () => {
      indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
      indicator.style.width = `${tab.offsetWidth}px`;
    };
    align();
    const resize = new ResizeObserver(align);
    resize.observe(node);
    resize.observe(tab);
    return () => resize.disconnect();
  }, [activeTool, style]);

  return (
    <span ref={track} aria-hidden="true" className={cn("nav-track", `design-${style}`)}>
      <span ref={pill} className="active-pill">
        <span className="toolbar-pill-effect" data-animate={animate ? "" : undefined} />
      </span>
      {TOOLS.map((name, index) => (
        <span key={name} className={cn("nav-tab", activeTool === index && "active")}>
          {name}
        </span>
      ))}
    </span>
  );
}

export function ToolbarStyleReel({
  value,
  onApply,
}: {
  value: ToolbarStyle;
  onApply: (style: ToolbarStyle) => void;
}) {
  const applied = resolveToolbarStyle(value);
  const appliedIndex = Math.max(
    0,
    TOOLBAR_STYLES.findIndex(({ id }) => id === applied),
  );
  const [cursor, setCursor] = useState(appliedIndex);
  const [demoTool, setDemoTool] = useState(0);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const { reducedMotion } = usePanelAnimationSettings();
  const track = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const target = useRef<number | null>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const option = TOOLBAR_STYLES[cursor]!;
  const isApplied = option.id === applied;

  function scrollToStyle(index: number, behavior: ScrollBehavior) {
    const node = track.current;
    const tile = tiles.current[index];
    if (!node || !tile) return;
    const bounds = tile.getBoundingClientRect();
    const center = bounds.left + bounds.width / 2;
    const left =
      node.scrollLeft + center - node.getBoundingClientRect().left - node.clientWidth / 2;
    node.scrollTo({ left, behavior });
  }

  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    scrollToStyle(appliedIndex, "instant");
    updateProgress(node);
    const observer = new ResizeObserver(() => updateProgress(node));
    observer.observe(node);
    // Keep the initial preview centered if Settings opens in a narrow pane.
    // Subsequent layout changes use the browser's scroll snap position.
    return () => observer.disconnect();
  }, [appliedIndex]);

  useEffect(() => {
    const node = track.current;
    if (!node || reducedMotion) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView((entry?.intersectionRatio ?? 0) >= 0.4),
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  useEffect(() => {
    setDemoTool(0);
  }, [cursor]);

  useEffect(() => {
    if (reducedMotion || !inView || paused) return;
    const timer = setInterval(() => setDemoTool((tool) => (tool + 1) % TOOLS.length), 1300);
    return () => clearInterval(timer);
  }, [cursor, inView, paused, reducedMotion]);

  function browse(index: number) {
    const next = Math.max(0, Math.min(TOOLBAR_STYLES.length - 1, index));
    if (next === cursor) return;
    target.current = next;
    setCursor(next);
    scrollToStyle(next, reducedMotion ? "instant" : "smooth");
  }

  function updateProgress(node: HTMLDivElement) {
    const range = node.scrollWidth - node.clientWidth;
    const fraction = range > 0 ? Math.max(0, Math.min(1, node.scrollLeft / range)) : 0;
    progress.current?.style.setProperty(
      "--toolbar-progress",
      `${fraction * (100 - 100 / TOOLBAR_STYLES.length)}%`,
    );
  }

  function readScroll(finished = false) {
    const node = track.current;
    if (!node) return;
    updateProgress(node);
    if (!finished && (target.current !== null || drag.current?.moved)) return;
    if (finished) target.current = null;
    const rect = node.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    let closest = 0;
    let distance = Infinity;
    tiles.current.forEach((tile, index) => {
      if (!tile) return;
      const bounds = tile.getBoundingClientRect();
      const delta = Math.abs(bounds.left + bounds.width / 2 - center);
      if (delta < distance) {
        distance = delta;
        closest = index;
      }
    });
    setCursor(closest);
  }

  function endDrag(node: HTMLDivElement, pointerId: number) {
    const gesture = drag.current;
    if (gesture?.id !== pointerId) return;
    drag.current = null;
    if (!gesture.moved) return;
    delete node.dataset.dragging;
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    readScroll(true);
  }

  return (
    <div className="toolbar-style-reel" data-paused={paused ? "" : undefined}>
      <div className="toolbar-style-nav">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous toolbar style"
          disabled={cursor === 0}
          onClick={() => browse(cursor - 1)}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {String(cursor + 1).padStart(2, "0")} / {String(TOOLBAR_STYLES.length).padStart(2, "0")}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next toolbar style"
          disabled={cursor === TOOLBAR_STYLES.length - 1}
          onClick={() => browse(cursor + 1)}
        >
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </div>

      <div
        ref={track}
        className="toolbar-style-track"
        role="region"
        aria-label="Toolbar style previews"
        tabIndex={0}
        onScroll={() => readScroll()}
        onScrollEnd={() => {
          if (!drag.current?.moved) readScroll(true);
        }}
        onWheel={() => {
          target.current = null;
        }}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowLeft"
              ? cursor - 1
              : event.key === "ArrowRight"
                ? cursor + 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? TOOLBAR_STYLES.length - 1
                    : null;
          if (next === null) return;
          event.preventDefault();
          browse(next);
        }}
        onPointerDown={(event) => {
          target.current = null;
          suppressClick.current = false;
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            left: event.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId || !(event.buttons & 1)) return;
          const delta = event.clientX - gesture.x;
          if (!gesture.moved && Math.abs(delta) < 5) return;
          const node = event.currentTarget;
          if (!gesture.moved) {
            gesture.moved = true;
            suppressClick.current = true;
            node.dataset.dragging = "true";
            node.setPointerCapture(event.pointerId);
          }
          node.scrollLeft = gesture.left - delta;
        }}
        onPointerUp={(event) => endDrag(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => endDrag(event.currentTarget, event.pointerId)}
        onLostPointerCapture={(event) => endDrag(event.currentTarget, event.pointerId)}
      >
        {TOOLBAR_STYLES.map((style, index) => (
          <button
            key={style.id}
            ref={(node) => {
              tiles.current[index] = node;
            }}
            type="button"
            className="toolbar-style-tile"
            tabIndex={-1}
            aria-label={style.id === applied ? `${style.label} (in use)` : style.label}
            aria-current={cursor === index ? "true" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!suppressClick.current) {
                track.current?.focus({ preventScroll: true });
                browse(index);
              }
            }}
          >
            {style.id === applied && (
              <span className="toolbar-style-applied" aria-hidden="true">
                In use
              </span>
            )}
            <ToolbarSample
              style={style.id}
              activeTool={cursor === index ? demoTool : 0}
              animate={cursor === index && inView && !reducedMotion}
            />
          </button>
        ))}
      </div>

      <div className="toolbar-style-caption">
        <div aria-live="polite">
          <h3>{option.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
        </div>
        <Button
          className="toolbar-style-use"
          variant={isApplied ? "outline" : "default"}
          disabled={isApplied}
          onClick={() => onApply(option.id)}
        >
          {isApplied ? "In use" : "Use this style"}
        </Button>
        <div
          className="toolbar-style-progress"
          role="progressbar"
          aria-label="Toolbar style position"
          aria-valuemin={1}
          aria-valuemax={TOOLBAR_STYLES.length}
          aria-valuenow={cursor + 1}
        >
          <span ref={progress} style={{ width: `${100 / TOOLBAR_STYLES.length}%` }} />
        </div>
        <div className="toolbar-style-hint text-xs text-muted-foreground">
          <span>Scroll sideways, drag, or use the arrow keys</span>
          {!reducedMotion && (
            <button type="button" onClick={() => setPaused(!paused)}>
              {paused ? "Resume preview" : "Pause preview"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

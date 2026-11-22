import gsap from "gsap";
import { useLayoutEffect, useMemo, useRef } from "react";
import { TABS_MARK } from "@tabs/shared/tabsBrand";
import { cn } from "~/lib/utils";
import "./mascot-motion.css";

/**
 * Halftone: the Tabs lockup (mascot plus the TABS wordmark) printed as a dot
 * screen. On startup the mascot prints at the centre, steps left, and the name
 * slides in from the right, printing letter by letter. On close the name
 * breaks into dots and drifts off, and the mascot glides back to the centre
 * and comes closer as it dissolves.
 *
 * Both are one GSAP timeline with a meta row riding it. The intro lands in
 * about 1.5 s and idles (blinks, glances at the name) until the workspace
 * rises; `onDone` fires on the landing. The outro finishes in under 1.6 s,
 * well inside the desktop shell's close timeout.
 */

/** The body's outer contour, without the two eye slots. */
const BODY = TABS_MARK.main.slice(0, TABS_MARK.main.indexOf(" M 76.5"));
const TAB = TABS_MARK.detached;
const WORD = TABS_MARK.wordmark;
const EYES = [
  { x: 65, y: 108 },
  { x: 126, y: 108 },
] as const;
const EYE_W = 23;
const EYE_H = 56;
/** Where the wordmark sits beside the mark: level with the head, clear of the tab. */
const WORD_X = 470;
const WORD_Y = 70;
const WORD_SCALE = 2;
const WORD_RIGHT = WORD_X + 388 * WORD_SCALE;
const WORD_TRANSFORM = `translate(${WORD_X} ${WORD_Y}) scale(${WORD_SCALE})`;
const LOCKUP_BOX = `-12 -6 ${WORD_RIGHT + 24} 400`;

export type MascotMotionMode = "intro" | "outro";

export interface MascotMotionProps {
  mode: MascotMotionMode;
  /** Mark colour. */
  ink: string;
  /** Surface colour: the eye cut-outs. */
  paper: string;
  /** For outros: hold the settled pose until this turns true. */
  play?: boolean;
  /** Fired once when the intro lands or the outro finishes. */
  onDone?: (() => void) | undefined;
  /** Rendered height of the lockup, in px. */
  size?: number;
  /** Keep idling after the intro lands (blinks and glances). */
  idle?: boolean;
  /**
   * Show the meta row under the lockup: a status word, a hairline that tracks
   * the timeline, and a counter (intro) or a sign-off (outro).
   */
  meta?: boolean;
  /** Face for the meta row's words; the counter always uses the mono role. */
  metaFont?: string | undefined;
  className?: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/* ── Dot fields, computed once from the lockup's own paths ────────────────── */

interface Dot {
  x: number;
  y: number;
  /** The wave's clock, 0 to 1: from the tab for the mascot, left to right for the name. */
  d: number;
}

const DOT_STEP = 13;
const DOT_R = 6.9;
const WAVE_ORIGIN = { x: 93, y: 315 };
/** The mascot's own centre, and how far it travels to sit at the lockup's centre. */
const MARK_CENTRE_X = 193;
const CENTRE_SHIFT = (WORD_RIGHT + 12) / 2 - MARK_CENTRE_X;
/** How far the name starts (and leaves) off to the right. */
const WORD_DRIFT = 180;
let dotCache: { mark: Dot[]; word: Dot[] } | null = null;

function halftoneDots(): { mark: Dot[]; word: Dot[] } {
  if (dotCache) return dotCache;
  const fields = { mark: [] as Dot[], word: [] as Dot[] };
  if (typeof document === "undefined") return fields;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fields;
  const body = new Path2D(BODY);
  const tab = new Path2D(TAB);
  const word = new Path2D();
  word.addPath(new Path2D(WORD), new DOMMatrix([WORD_SCALE, 0, 0, WORD_SCALE, WORD_X, WORD_Y]));
  const inEye = (x: number, y: number) =>
    EYES.some(
      (eye) => x > eye.x - 4 && x < eye.x + EYE_W + 4 && y > eye.y - 4 && y < eye.y + EYE_H + 4,
    );
  let max = 0;
  for (let y = 8 + DOT_STEP / 2; y < 380; y += DOT_STEP) {
    for (let x = 2 + DOT_STEP / 2; x < WORD_RIGHT; x += DOT_STEP) {
      if (ctx.isPointInPath(word, x, y, "evenodd")) {
        fields.word.push({ x, y, d: (x - WORD_X) / (WORD_RIGHT - WORD_X) });
        continue;
      }
      if (!ctx.isPointInPath(body, x, y) && !ctx.isPointInPath(tab, x, y)) continue;
      if (inEye(x, y)) continue;
      const d = Math.hypot(x - WAVE_ORIGIN.x, y - WAVE_ORIGIN.y);
      max = Math.max(max, d);
      fields.mark.push({ x, y, d });
    }
  }
  for (const dot of fields.mark) dot.d /= max || 1;
  dotCache = fields;
  return fields;
}

/* ── The art ─────────────────────────────────────────────────────────────── */

function HalftoneArt({ ink, paper }: { ink: string; paper: string }) {
  const { mark, word } = useMemo(halftoneDots, []);
  return (
    <svg viewBox={LOCKUP_BOX} className="mm-svg">
      <g className="mm-word">
        <g className="mm-word-dots" fill={ink}>
          {word.map((dot) => (
            <circle
              key={`${dot.x}:${dot.y}`}
              className="mm-word-dot"
              cx={dot.x}
              cy={dot.y}
              r={DOT_R}
            />
          ))}
        </g>
        <path
          className="mm-word-solid"
          fill={ink}
          fillRule="evenodd"
          transform={WORD_TRANSFORM}
          d={WORD}
        />
      </g>
      <g className="mm-mark">
        <g className="mm-mark-dots" fill={ink}>
          {mark.map((dot) => (
            <circle
              key={`${dot.x}:${dot.y}`}
              className="mm-mark-dot"
              cx={dot.x}
              cy={dot.y}
              r={DOT_R}
            />
          ))}
        </g>
        <g className="mm-mark-solid">
          <path d={BODY} fill={ink} />
          <path d={TAB} fill={ink} />
          <g className="mm-eyes" fill={paper}>
            {EYES.map((eye) => (
              <rect
                key={eye.x}
                className="mm-eye"
                x={eye.x}
                y={eye.y}
                width={EYE_W}
                height={EYE_H}
                rx={EYE_W / 2}
              />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}

/* ── Choreography ────────────────────────────────────────────────────────── */

type Q = (selector: string) => Element[];

const EASE_OUT = "expo.out";
const EASE_IN = "expo.in";
const EASE_IN_OUT = "expo.inOut";

/** A quick, human blink: shut fast, open a little slower. */
function blink(tl: gsap.core.Timeline, q: Q, at: number | string) {
  // ">" keeps the opening right after the shut, wherever the blink sits.
  tl.to(q(".mm-eye"), { scaleY: 0.08, duration: 0.07, ease: "power2.in" }, at).to(
    q(".mm-eye"),
    { scaleY: 1, duration: 0.14, ease: "power2.out" },
    ">",
  );
}

/** The eyes look along x (right is toward the name). */
function glance(tl: gsap.core.Timeline, q: Q, x: number, at: number | string) {
  tl.to(q(".mm-eyes"), { x, duration: 0.2, ease: "power3.out" }, at);
}

/**
 * Startup: the mascot prints at the centre, coming in a little close and
 * settling back; it steps left, and the name slides in from the right,
 * printing letter by letter. Close: the name breaks into dots and drifts off,
 * the mascot glides back to the centre and comes closer as it dissolves.
 */
function buildHalftone(tl: gsap.core.Timeline, q: Q, mode: MascotMotionMode) {
  const { mark: markField, word: wordField } = halftoneDots();
  const markDots = q(".mm-mark-dot");
  const wordDots = q(".mm-word-dot");
  const mark = q(".mm-mark");
  const word = q(".mm-word");
  const markWave = (i: number) => markField[i]?.d ?? 0;
  const wordWave = (i: number) => wordField[i]?.d ?? 0;
  gsap.set([...markDots, ...wordDots], { transformOrigin: "50% 50%" });
  gsap.set(mark, { transformOrigin: "50% 50%" });
  if (mode === "intro") {
    gsap.set(mark, { x: CENTRE_SHIFT, scale: 1.22 });
    gsap.set([...markDots, ...wordDots], { scale: 0 });
    gsap.set([...q(".mm-mark-solid"), ...q(".mm-word-solid")], { opacity: 0 });
    gsap.set(word, { x: WORD_DRIFT });
    // 1. The mascot prints at the centre and settles back.
    tl.to(
      markDots,
      { scale: 1, duration: 0.42, ease: "power3.out", stagger: (i: number) => markWave(i) * 0.46 },
      0,
    )
      .to(mark, { scale: 1, duration: 0.95, ease: EASE_OUT }, 0)
      .to(q(".mm-mark-solid"), { opacity: 1, duration: 0.22, ease: "power1.inOut" }, 0.62)
      .to(q(".mm-mark-dots"), { opacity: 0, duration: 0.18 }, 0.8)
      // 2. It steps left; the name slides in from the right and prints.
      .to(mark, { x: 0, duration: 0.8, ease: EASE_IN_OUT }, 0.92)
      .to(word, { x: 0, duration: 0.86, ease: EASE_OUT }, 1.08)
      .to(
        wordDots,
        {
          scale: 1,
          duration: 0.32,
          ease: "power3.out",
          stagger: (i: number) => wordWave(i) * 0.34,
        },
        1.12,
      )
      .to(q(".mm-word-solid"), { opacity: 1, duration: 0.2, ease: "power1.inOut" }, 1.52)
      .to(q(".mm-word-dots"), { opacity: 0, duration: 0.16 }, 1.64);
    blink(tl, q, 0.76);
    glance(tl, q, 12, 1.16);
    glance(tl, q, 0, 1.6);
    return;
  }
  gsap.set([...q(".mm-mark-dots"), ...q(".mm-word-dots")], { opacity: 0 });
  glance(tl, q, 12, 0);
  // 1. The name breaks into dots, from its far end, and drifts away.
  tl.set(q(".mm-word-dots"), { opacity: 1 }, 0.1)
    .to(q(".mm-word-solid"), { opacity: 0, duration: 0.14 }, 0.1)
    .to(
      wordDots,
      {
        scale: 0,
        duration: 0.32,
        ease: "power2.in",
        stagger: (i: number) => (1 - wordWave(i)) * 0.36,
      },
      0.16,
    )
    .to(word, { x: WORD_DRIFT * 0.6, duration: 0.7, ease: EASE_IN }, 0.12)
    // 2. The mascot glides back to the centre.
    .to(mark, { x: CENTRE_SHIFT, duration: 0.72, ease: EASE_IN_OUT }, 0.5);
  glance(tl, q, 0, 0.7);
  blink(tl, q, 1.02);
  // 3. It comes closer as it dissolves, back toward its tab.
  tl.set(q(".mm-mark-dots"), { opacity: 1 }, 1.22)
    .to(q(".mm-mark-solid"), { opacity: 0, duration: 0.14 }, 1.22)
    .to(mark, { scale: 1.24, duration: 0.6, ease: "power2.in" }, 1.22)
    .to(
      markDots,
      {
        scale: 0,
        duration: 0.3,
        ease: "power2.in",
        stagger: (i: number) => (1 - markWave(i)) * 0.3,
      },
      1.28,
    );
}

const pad3 = (value: number) => String(Math.round(value)).padStart(3, "0");

/**
 * The meta row rides the same timeline as the lockup: the hairline is a true
 * progress line for the intro, and retracts over the outro.
 */
function buildMeta(tl: gsap.core.Timeline, q: Q, mode: MascotMotionMode) {
  const row = q(".mm-meta");
  if (row.length === 0) return;
  const line = q(".mm-meta-line > i");
  const label = q(".mm-meta-label");
  const count = q(".mm-meta-count")[0] as HTMLElement | undefined;
  const signOff = q(".mm-meta-signoff");
  const span = Math.max(0.6, tl.duration() - 0.1);
  if (mode === "intro") {
    const clock = { value: 0 };
    gsap.set(line, { scaleX: 0, transformOrigin: "0% 50%" });
    gsap.set([...label, count], { yPercent: 110 });
    tl.to([...label, count], { yPercent: 0, duration: 0.6, ease: EASE_OUT, stagger: 0.06 }, 0.08)
      .to(line, { scaleX: 1, duration: span, ease: "power2.inOut" }, 0.05)
      .to(
        clock,
        {
          value: 100,
          duration: span,
          ease: "power2.inOut",
          onUpdate: () => {
            if (count) count.textContent = pad3(clock.value);
          },
        },
        0.05,
      );
    return;
  }
  gsap.set(line, { scaleX: 1, transformOrigin: "100% 50%" });
  gsap.set(signOff, { yPercent: 110 });
  tl.to(line, { scaleX: 0, duration: span * 0.85, ease: "power2.inOut" }, 0.1)
    .to(count ? [count] : [], { yPercent: -110, duration: 0.4, ease: EASE_IN }, 0.1)
    .to(signOff, { yPercent: 0, duration: 0.6, ease: EASE_OUT }, Math.max(0.5, span - 0.45));
}

/** Blinks and the odd glance at the name while the intro waits on the workspace. */
function idleLoop(q: Q): gsap.core.Timeline {
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 1.2 });
  blink(tl, q, 0);
  glance(tl, q, 12, 1.3);
  glance(tl, q, 0, 2.1);
  blink(tl, q, 2.7);
  blink(tl, q, 2.95);
  return tl;
}

/** The Halftone lockup and its timeline. */
export function MascotMotion({
  mode,
  ink,
  paper,
  play = true,
  onDone,
  size = 124,
  idle = true,
  meta = false,
  metaFont,
  className,
}: MascotMotionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let idleTl: gsap.core.Timeline | undefined;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root) as Q;
      gsap.set(q(".mm-eye"), { transformOrigin: "50% 50%" });
      const tl = gsap.timeline({ paused: true });
      buildHalftone(tl, q, mode);
      buildMeta(tl, q, mode);
      if (mode === "outro" && !play) {
        // Settled pose: everything as the intro leaves it.
        return;
      }
      const finish = () => {
        onDoneRef.current?.();
        if (mode === "intro" && idle) idleTl = idleLoop(q);
      };
      if (prefersReducedMotion()) {
        tl.progress(1);
        finish();
        return;
      }
      tl.eventCallback("onComplete", finish);
      tl.play(0);
    }, root);
    return () => {
      idleTl?.kill();
      ctx.revert();
    };
  }, [mode, play, idle]);

  const wordFont = metaFont ? { fontFamily: metaFont } : undefined;
  return (
    <div
      ref={rootRef}
      className={cn("mm-root", className)}
      data-motion="halftone"
      data-mode={mode}
      aria-hidden="true"
    >
      <div className="mm-art" style={{ height: size }}>
        <HalftoneArt ink={ink} paper={paper} />
      </div>
      {meta ? (
        <div className="mm-meta" style={{ color: ink, width: size * 3.2 }}>
          <span className="mm-meta-mask" style={wordFont}>
            <span className="mm-meta-label">{mode === "intro" ? "Starting" : "Closing"}</span>
          </span>
          <span className="mm-meta-line">
            <i />
          </span>
          <span className="mm-meta-mask mm-meta-end">
            {mode === "intro" ? (
              <span className="mm-meta-count">000</span>
            ) : (
              <>
                <span className="mm-meta-count">100</span>
                <span className="mm-meta-signoff" style={wordFont}>
                  See you soon
                </span>
              </>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

import type { CSSProperties } from "react";
import { TABS_MARK } from "@tabs/shared/tabsBrand";
import { cn } from "~/lib/utils";
import "./tabs-mascot.css";

/** The mark's body without its two eye slots, so the eyes can blink on their own. */
const BODY_PATH = TABS_MARK.main.slice(0, TABS_MARK.main.indexOf(" M 76.5"));
const EYES = [
  { x: 65, y: 108 },
  { x: 126, y: 108 },
] as const;

/** Time the intro takes to land: body, docked tab and first blink. */
export const TABS_MASCOT_INTRO_MS = 1_250;
/** Time bedtime takes, from the goodbye until lights out. */
export const TABS_MASCOT_GOODBYE_MS = 3_600;

/**
 * The Tabs mark as a character: the two slots are its eyes and the detached
 * piece is a tab it carries around. "intro" springs it in and docks the tab,
 * then idles (bobbing, blinking, an occasional hop); "goodbye" closes its
 * eyes and lets it sink away.
 */
export function TabsMascot({
  mode,
  className,
  eyeColor,
  look,
}: {
  mode: "intro" | "walk" | "goodbye" | "still";
  className?: string;
  /** The surface colour behind the mascot; the eyes are cut-outs of it. */
  eyeColor: string;
  /** Where the eyes point, in artwork units from centre. */
  look?: { x: number; y: number } | undefined;
}) {
  return (
    <div
      className={cn("tabs-mascot loader-respect-motion", className)}
      data-mode={mode}
      aria-hidden="true"
    >
      <svg viewBox="-20 -30 430 470" className="tabs-mascot-svg">
        <ellipse className="tabs-mascot-shadow" cx="195" cy="420" rx="150" ry="12" />
        <g className="tabs-mascot-rig">
          <g className="tabs-mascot-body">
            <path d={BODY_PATH} fill="currentColor" />
            <g
              className="tabs-mascot-eyes"
              fill={eyeColor}
              style={look ? { transform: `translate(${look.x}px, ${look.y}px)` } : undefined}
            >
              {EYES.map((eye) => (
                <rect
                  key={eye.x}
                  className="tabs-mascot-eye"
                  x={eye.x}
                  y={eye.y}
                  width="23"
                  height="56"
                  rx="11.5"
                />
              ))}
            </g>
          </g>
          <g className="tabs-mascot-tab">
            <path d={TABS_MARK.detached} fill="currentColor" />
          </g>
        </g>
      </svg>
    </div>
  );
}

const FLAG_STRIPS = 35;
const FLAG_STRIP_WIDTH = 300 / FLAG_STRIPS;

/** The TABS flag, cut into strips so each can ripple a little behind the last. */
function WavingFlag({ ink, paper }: { ink: string; paper: string }) {
  return (
    <div className="tabs-stroll-flag">
      {Array.from({ length: FLAG_STRIPS }, (_, i) => (
        <div
          key={i}
          className="tabs-flag-strip"
          style={{ "--i": i, "--amp": `${0.4 + (i / (FLAG_STRIPS - 1)) * 6}px` } as CSSProperties}
        >
          <svg
            // A sliver wider than the strip, so no seams show between them.
            viewBox={`${i * FLAG_STRIP_WIDTH} 0 ${FLAG_STRIP_WIDTH * 1.1} 92`}
            preserveAspectRatio="none"
          >
            <rect width="300" height="92" rx="6" fill={ink} />
            <path
              fill={paper}
              fillRule="evenodd"
              transform="translate(52 22) scale(0.505)"
              d={TABS_MARK.wordmark}
            />
          </svg>
          <div className="tabs-flag-shade" style={{ background: paper }} />
        </div>
      ))}
    </div>
  );
}

const CODE_LINES = [
  { width: "78%", off: "22px", tilt: "7deg" },
  { width: "54%", off: "-14px", tilt: "-5deg" },
  { width: "92%", off: "30px", tilt: "4deg" },
  { width: "40%", off: "8px", tilt: "-9deg" },
] as const;

const APP_CRACKS = [
  { name: "app-crack-1", d: "M56 0 L48 26 L62 40 L50 70" },
  { name: "app-crack-2", d: "M150 130 L142 96 L158 80 L146 52 L160 34" },
  { name: "app-crack-3", d: "M210 44 L176 54 L166 76 L136 72" },
] as const;

const APP_SPARKS = [
  { left: 58, top: 38, sx: "-8px", delay: "0ms" },
  { left: 148, top: 78, sx: "10px", delay: "140ms" },
  { left: 174, top: 52, sx: "6px", delay: "260ms" },
] as const;

const APP_STATUS = [
  { name: "app-text-broken", text: "undefined is not a fn" },
  { name: "app-text-compiles", text: "// it compiles?" },
  { name: "app-text-works", text: "// works on my machine" },
] as const;

/** A little app window that starts in pieces and rests fully repaired. */
function BrokenApp({ ink, paper }: { ink: string; paper: string }) {
  return (
    <div className="tabs-app" style={{ color: ink, background: paper }}>
      <div className="tabs-app-bar">
        <i />
        <i />
        <i />
        <span className="tabs-app-tab" />
      </div>
      <div className="tabs-app-side" style={{ background: paper }}>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="tabs-app-code">
        {CODE_LINES.map((line) => (
          <i
            key={line.width}
            style={{ width: line.width, "--off": line.off, "--tilt": line.tilt } as CSSProperties}
          />
        ))}
      </div>
      <div className="tabs-app-status">
        {APP_STATUS.map((line, index) => (
          <span
            key={line.name}
            data-final={index === APP_STATUS.length - 1 || undefined}
            style={{ "--line": line.name } as CSSProperties}
          >
            {line.text}
          </span>
        ))}
      </div>
      {APP_CRACKS.map((crack) => (
        <svg
          key={crack.name}
          className="tabs-app-crack"
          viewBox="0 0 210 130"
          style={{ "--crack": crack.name } as CSSProperties}
        >
          <path d={crack.d} fill="none" stroke={ink} strokeWidth="1.6" strokeLinejoin="bevel" />
        </svg>
      ))}
      {APP_SPARKS.map((spark) => (
        <span
          key={spark.left}
          className="tabs-app-spark"
          style={
            {
              left: spark.left,
              top: spark.top,
              "--sx": spark.sx,
              "--d": spark.delay,
            } as CSSProperties
          }
        />
      ))}
      <div className="tabs-app-check">
        <svg viewBox="0 0 22 22">
          <circle cx="11" cy="11" r="11" fill={ink} />
          <path
            d="M6 11.5 L9.6 15 L16 7.8"
            fill="none"
            stroke={paper}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** One digit column; it steps through 0-9 `turns` times over the gag. */
function CountReel({
  reel,
  turns,
  blankZero = false,
}: {
  reel: string;
  turns: number;
  /** Show nothing for 0, so the tens column has no leading zero. */
  blankZero?: boolean;
}) {
  return (
    <span className="tabs-gag-reel">
      <b style={{ "--reel": reel, "--turns": turns } as CSSProperties}>
        {DIGITS.map((digit) => (
          <u key={digit}>{blankZero && digit === "0" ? "\u00A0" : digit}</u>
        ))}
      </b>
    </span>
  );
}

/**
 * The startup gag. The mascot walks in from the right in a hard hat, carrying
 * a hammer and the TABS flag, and hammers a broken app back together while the
 * count climbs. It plants the flag over the fixed app, flings the hat and
 * hammer off-screen and walks over to stand by the pole. The count waits at 99
 * until the workspace is ready, then hits 100 and the workspace rises.
 *
 * Everything moves with `transform` and `opacity` on HTML layers, so the
 * compositor runs it smoothly even while the workspace is busy loading.
 */
export function TabsStroll({
  ink,
  paper,
  className,
}: {
  /** Mascot, pole and banner colour. */
  ink: string;
  /** The surface behind: eye cut-outs and the banner lettering. */
  paper: string;
  className?: string;
}) {
  return (
    <div className={cn("tabs-stroll loader-respect-motion", className)} aria-hidden="true">
      <div className="tabs-stroll-scene">
        <div className="tabs-stroll-ground" style={{ background: ink }} />
        {/* The flag shares the walker's path until it is thrown. */}
        <div className="tabs-stroll-flag-track">
          <div className="tabs-stroll-flag-step">
            <div className="tabs-stroll-flag-toss">
              <div className="tabs-stroll-pole" style={{ background: ink }} />
              <WavingFlag ink={ink} paper={paper} />
            </div>
          </div>
        </div>
        <BrokenApp ink={ink} paper={paper} />
        <div className="tabs-stroll-walker">
          <div className="tabs-stroll-go">
            <div className="tabs-stroll-step" style={{ color: ink }}>
              <div className="tabs-stroll-act">
                <TabsMascot mode="walk" eyeColor={paper} />
                <div className="tabs-gag-hat">
                  <svg viewBox="0 0 62 34">
                    <path d="M8 27 C8 9 19 2 31 2 C43 2 54 9 54 27 Z" fill="#f5b301" />
                    <rect x="26" y="1" width="10" height="26" rx="4" fill="#ffd34d" />
                    <rect x="1" y="25" width="60" height="7" rx="3.5" fill="#d99a00" />
                  </svg>
                </div>
                <div className="tabs-gag-hammer">
                  <svg viewBox="0 0 56 100">
                    <rect x="25" y="18" width="6" height="82" rx="3" fill="#c98a4b" />
                    <rect x="6" y="2" width="44" height="24" rx="3" fill="#8b95a5" />
                    <rect x="6" y="2" width="44" height="7" rx="3" fill="#b4bcc8" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="tabs-gag-burst">
          <svg viewBox="0 0 120 80">
            <path
              d="M60 40 L60 6 M60 40 L28 14 M60 40 L92 14 M60 40 L12 40 M60 40 L108 40"
              stroke={ink}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="12 40"
              strokeDashoffset="-16"
            />
          </svg>
        </div>
      </div>
      <div className="tabs-gag-caption" style={{ color: ink }}>
        <span className="tabs-gag-count">
          <CountReel reel="6500ms" turns={1} blankZero />
          <CountReel reel="650ms" turns={10} />
        </span>
        <span className="tabs-gag-count" data-done="true">
          100
        </span>
      </div>
      <div className="tabs-gag-progress" style={{ color: ink }}>
        <i />
      </div>
    </div>
  );
}

const BED_ZS = ["2700ms", "3000ms", "3300ms"] as const;

/**
 * The closing scene. While Tabs shuts down the mascot waits beside its bed.
 * On "closing" it says goodbye, hops in, gets tucked up and falls asleep.
 */
export function TabsBedtime({
  ink,
  paper,
  phase,
}: {
  ink: string;
  paper: string;
  phase: "idle" | "closing";
}) {
  return (
    <div
      className="tabs-bed loader-respect-motion"
      data-phase={phase}
      aria-hidden="true"
      style={{ color: ink }}
    >
      <div className="tabs-bed-ground" style={{ background: ink }} />
      <svg className="tabs-bed-frame" viewBox="0 0 240 110">
        <rect x="0" y="6" width="10" height="104" rx="4" fill={ink} />
        <rect x="230" y="40" width="10" height="70" rx="4" fill={ink} />
        <rect x="8" y="86" width="224" height="9" fill={ink} />
        <rect
          x="10"
          y="52"
          width="220"
          height="34"
          rx="8"
          fill={paper}
          stroke={ink}
          strokeWidth="2"
        />
        <ellipse cx="44" cy="46" rx="30" ry="12" fill={paper} stroke={ink} strokeWidth="2" />
      </svg>
      <div className="tabs-bed-mascot">
        <TabsMascot mode="still" eyeColor={paper} />
      </div>
      <div className="tabs-bed-blanket" />
      <div
        className="tabs-bed-bubble"
        style={{ background: ink, color: paper, "--bed-bubble": ink } as CSSProperties}
      >
        Bye, see you soon!
      </div>
      {BED_ZS.map((delay) => (
        <span key={delay} className="tabs-bed-z" style={{ "--d": delay } as CSSProperties}>
          z
        </span>
      ))}
    </div>
  );
}

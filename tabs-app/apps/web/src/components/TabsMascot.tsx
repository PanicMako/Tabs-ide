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
  mode: "intro" | "goodbye" | "still";
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

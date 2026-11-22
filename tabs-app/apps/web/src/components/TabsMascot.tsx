import { TABS_MARK } from "@tabs/shared/tabsBrand";
import { useId, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import "./tabs-mascot.css";

/** The mark's body without its two eye slots, so the eyes can blink on their own. */
const BODY_PATH = TABS_MARK.main.slice(0, TABS_MARK.main.indexOf(" M 76.5"));
const EYES = [
  { x: 65, y: 108 },
  { x: 126, y: 108 },
] as const;

/** A lit surface for the mark (gradient body, rim light, sheen, optional halo). */
export interface MascotMaterial {
  readonly stops: ReadonlyArray<readonly [offset: number, color: string]>;
  readonly rim: string;
  readonly sheen: number;
  readonly glow?: string | undefined;
}

/** One piece of the mark: its fill, then a sheen and a rim of light when it has a material. */
function MascotPiece({
  d,
  uid,
  material,
}: {
  d: string;
  uid: string;
  material: MascotMaterial | undefined;
}) {
  if (!material) return <path d={d} fill="currentColor" />;
  return (
    <>
      {material.glow ? (
        <path d={d} fill={material.glow} opacity="0.85" filter={`url(#tm-glow-${uid})`} />
      ) : null}
      <path d={d} fill={`url(#tm-body-${uid})`} />
      {material.sheen > 0 ? <path d={d} fill={`url(#tm-sheen-${uid})`} /> : null}
      <path d={d} fill="none" stroke={material.rim} strokeWidth="3" strokeOpacity="0.85" />
    </>
  );
}

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
  material,
  overlay,
}: {
  mode: "intro" | "goodbye" | "still";
  className?: string;
  /** The surface colour behind the mascot; the eyes are cut-outs of it. */
  eyeColor: string;
  /** Where the eyes point, in artwork units from centre. */
  look?: { x: number; y: number } | undefined;
  material?: MascotMaterial | undefined;
  /** Drawn on the mascot in artwork units, so it moves with it (a hat, glasses, a prop). */
  overlay?: ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div
      className={cn("tabs-mascot loader-respect-motion", className)}
      data-mode={mode}
      aria-hidden="true"
    >
      <svg viewBox="-20 -30 430 470" className="tabs-mascot-svg">
        {material ? (
          <defs>
            <linearGradient
              id={`tm-body-${uid}`}
              gradientUnits="userSpaceOnUse"
              x1="40"
              y1="8"
              x2="340"
              y2="380"
            >
              {material.stops.map(([offset, color]) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </linearGradient>
            <linearGradient
              id={`tm-sheen-${uid}`}
              gradientUnits="userSpaceOnUse"
              x1="40"
              y1="8"
              x2="230"
              y2="280"
            >
              <stop offset="0" stopColor="#ffffff" stopOpacity={material.sheen} />
              <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            {material.glow ? (
              <filter id={`tm-glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="13" />
              </filter>
            ) : null}
          </defs>
        ) : null}
        <ellipse className="tabs-mascot-shadow" cx="195" cy="420" rx="150" ry="12" />
        <g className="tabs-mascot-rig">
          <g className="tabs-mascot-body">
            <MascotPiece d={BODY_PATH} uid={uid} material={material} />
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
            {overlay}
          </g>
          <g className="tabs-mascot-tab">
            <MascotPiece d={TABS_MARK.detached} uid={uid} material={material} />
          </g>
        </g>
      </svg>
    </div>
  );
}

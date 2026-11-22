import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "../hooks/useTheme";
import { cn } from "~/lib/utils";
import "./close-animation.css";
import "./loaders.css";
import { MascotMotion } from "./mascot-motion/MascotMotion";
import { resolveAnimationFonts } from "../lib/animationTypography";

export type ClosePhase = "idle" | "closing" | "holding";

const SOLARI_WORD = "TABS IDE";

const CLOSE_SOLARI_MESSAGES = [
  "RETURNING BORROWED STACK FRAMES",
  "SAYING GOODBYE TO NODE_MODULES",
  "DEFRAGMENTING YOUR MOTIVATION",
  "FILING BUG REPORTS FOR NEXT TIME",
  "BLAMING THE LAST COMMIT",
  "SHUTTING DOWN (PROBABLY)",
];

function RotatingLabel({
  messages,
  phase,
  intervalMs = 600,
  className,
  uiFont,
}: {
  messages: string[];
  phase: ClosePhase;
  intervalMs?: number;
  className?: string;
  uiFont?: string | undefined;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (phase === "holding") return;
    setIdx(Math.floor(Math.random() * messages.length));

    const id = setInterval(() => {
      setIdx((prev) => {
        let next = Math.floor(Math.random() * messages.length);
        while (next === prev && messages.length > 1) {
          next = Math.floor(Math.random() * messages.length);
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [messages, intervalMs, phase]);

  const fontStyle = uiFont ? { fontFamily: uiFont } : undefined;

  return (
    <div
      className={cn("relative z-10 h-[14px] w-full text-center loader-respect-motion", className)}
      style={fontStyle}
    >
      <span
        key={phase === "holding" ? "goodbye" : messages[idx]}
        className="absolute inset-x-0 whitespace-nowrap text-[11px] font-light tracking-[0.22em] uppercase transition-opacity duration-300"
      >
        {phase === "holding" ? "GOODBYE." : messages[idx]}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TABS MASCOT CLOSE — the Halftone lockup dissolves, then a sign-off
   ═══════════════════════════════════════════════════════════════════════ */

interface CloseAnimationProps {
  phase: ClosePhase;
  palette: "block" | "mono";
  isDark: boolean;
  onIntroEnd?: (() => void) | undefined;
  fonts?:
    | {
        headingFont?: string | undefined;
        headingWeight?: number | undefined;
        uiFont?: string | undefined;
      }
    | undefined;
}

/** After the outro lands, the sign-off line holds this long before exit. */
const MOTION_SIGN_OFF_MS = 360;

/** The mark plays its exit, then the sign-off holds for a beat. */
function MascotClose({ phase, palette, isDark, onIntroEnd, fonts }: CloseAnimationProps) {
  const isBlock = palette === "block";
  const onIntroEndRef = useRef(onIntroEnd);
  onIntroEndRef.current = onIntroEnd;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const ink = isBlock || isDark ? "#ffffff" : "#0a0a0a";
  const paper = isBlock ? "#2563eb" : isDark ? "#09090b" : "#ffffff";

  return (
    <div className="close-screen relative z-10 flex min-h-[300px] w-full flex-col items-center justify-center p-6">
      <MascotMotion
        key={phase === "idle" ? "idle" : "bye"}
        mode="outro"
        ink={ink}
        paper={paper}
        play={phase !== "idle"}
        meta
        metaFont={fonts?.uiFont}
        onDone={() => {
          clearTimeout(timer.current);
          // Hold on the sign-off for a beat before the window goes.
          timer.current = setTimeout(() => onIntroEndRef.current?.(), MOTION_SIGN_OFF_MS);
        }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SOLARI GRID CLOSE
   ═══════════════════════════════════════════════════════════════════════ */

function SolariGridClose({ phase, palette, isDark, onIntroEnd, fonts }: CloseAnimationProps) {
  const tiles = SOLARI_WORD.split("");
  const isBlock = palette === "block";

  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onIntroEndRef = useRef(onIntroEnd);
  useEffect(() => {
    onIntroEndRef.current = onIntroEnd;
  }, [onIntroEnd]);

  useEffect(() => {
    if (phase !== "closing") return;
    if (prefersReducedMotion) {
      onIntroEndRef.current?.();
      return;
    }
    const cascadeEnd = tiles.length * 70 + 260;
    const holdTimer = setTimeout(() => {
      onIntroEndRef.current?.();
    }, cascadeEnd + 800);
    return () => clearTimeout(holdTimer);
  }, [phase, tiles.length, prefersReducedMotion]);

  const animating = phase === "closing" || phase === "holding";
  const tileFont = fonts?.headingFont || fonts?.uiFont;

  return (
    <div className="close-screen relative z-10 flex min-h-[300px] w-full max-w-[560px] items-center justify-center p-6 loader-respect-motion">
      <div className="relative flex w-full flex-col items-center justify-center gap-[20px]">
        {/* Card with collapse animation */}
        <div
          className={cn(
            "relative w-full flex flex-col items-center justify-center gap-[22px] transform-origin-center",
            animating && "cq-card-collapse",
          )}
        >
          {/* Tile grid */}
          <div
            className={cn(
              "relative z-10 grid grid-cols-4 gap-[6px]",
              isBlock
                ? isDark
                  ? "text-[#1c0f0e]"
                  : "text-white"
                : isDark
                  ? "text-white"
                  : "text-black",
            )}
          >
            {tiles.map((ch, i) => (
              <div
                key={i}
                data-shape="tile"
                className={cn(
                  "relative flex h-[64px] w-[52px] items-center justify-center rounded-lg border text-[26px] font-light transition-all duration-[280ms]",
                  animating && (isDark ? "cq-tile-dim" : "cq-tile-dim-light"),
                  isBlock
                    ? "border-white/24 bg-white/12"
                    : isDark
                      ? "border-white/10 bg-white/4"
                      : "border-black/10 bg-black/4",
                )}
                style={{
                  ...(animating ? { transitionDelay: `${i * 70}ms` } : {}),
                  ...(tileFont ? { fontFamily: tileFont, fontWeight: fonts?.headingWeight } : {}),
                }}
              >
                <div
                  className={cn(
                    "absolute inset-x-0 top-1/2 h-px",
                    isDark ? "bg-black/35" : "bg-black/15",
                  )}
                />
                {ch === " " ? "\u00A0" : ch}
              </div>
            ))}
          </div>
        </div>

        {/* Rotating status label — visible in closing + holding phases */}
        <RotatingLabel
          messages={CLOSE_SOLARI_MESSAGES}
          phase={phase}
          uiFont={fonts?.uiFont}
          className={
            isBlock
              ? isDark
                ? "text-[#1c0f0e]/85"
                : "text-white/75"
              : isDark
                ? "text-[#a1a1aa]"
                : "text-[#52525b]"
          }
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════════ */

export interface CloseScreenProps {
  /** "mascot" | "solari"; a stored "glass" (retired) shows the mascot. */
  loader: "mascot" | "glass" | "solari" | string;
  palette: "block" | "mono" | string;
  theme?: "light" | "dark" | "system";
  phase?: ClosePhase | undefined;
  onIntroEnd?: (() => void) | undefined;
  fontComboId?: string | undefined;
  customFont?: string | undefined;
}

export function CloseScreen({
  loader,
  palette,
  theme: overrideTheme,
  phase = "closing",
  onIntroEnd,
  fontComboId,
  customFont,
}: CloseScreenProps) {
  const { resolvedTheme, fontPreferences } = useTheme();
  const effectiveTheme =
    overrideTheme && overrideTheme !== "system" ? overrideTheme : resolvedTheme;
  const isDark = effectiveTheme === "dark";
  const isBlock = palette === "block";

  const storedComboId =
    fontComboId ||
    (typeof window !== "undefined"
      ? (window.localStorage?.getItem("tabs.closeAnimationFontComboId") ??
        window.localStorage?.getItem("tabs.animationFontComboId") ??
        "app-default")
      : "app-default");
  const storedCustomFont =
    customFont ||
    (typeof window !== "undefined"
      ? ((window.localStorage?.getItem("tabs.closeCustomAnimationFont") ||
          window.localStorage?.getItem("tabs.customAnimationFont")) ??
        undefined)
      : undefined);

  const fonts = resolveAnimationFonts(storedComboId, storedCustomFont, fontPreferences);

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center",
        isBlock ? "bg-[#2563eb]" : isDark ? "bg-[#09090b]" : "bg-white",
      )}
    >
      {loader === "solari" ? (
        <SolariGridClose
          phase={phase}
          palette={palette as "block" | "mono"}
          isDark={isDark}
          fonts={fonts}
          onIntroEnd={onIntroEnd}
        />
      ) : (
        <MascotClose
          phase={phase}
          palette={palette as "block" | "mono"}
          isDark={isDark}
          fonts={fonts}
          onIntroEnd={onIntroEnd}
        />
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "../hooks/useTheme";
import { cn } from "../lib/cn";
import { TabsStroll } from "./TabsMascot";
import "./loaders.css";
import { resolveAnimationFonts } from "../lib/animationTypography";

import {
  SOLARI_TILE_COUNT,
  SOLARI_TILE_SETTLE_MS,
  SOLARI_TILE_STAGGER_MS,
  SOLARI_TILE_HIGHLIGHT_MS,
} from "../lib/startupAnimationTiming";
import { useReducedStartupMotion } from "../hooks/useStartupAnimation";
export { STARTUP_ANIMATION_EXIT_MS } from "../lib/startupAnimationTiming";

const MASCOT_MESSAGES = [
  "WAKING UP THE MASCOT",
  "FINDING A SPARE TAB",
  "NEGOTIATING WITH THE LINTER",
  "BRIBING THE GARBAGE COLLECTOR",
  "RETICULATING SPLINES",
  "ALMOST READY (PROBABLY)",
];

const SOLARI_MESSAGES = [
  "BOARDING NODE_MODULES",
  "HERDING SEMICOLONS",
  "RESOLVING MERGE CONFLICTS",
  "DOWNLOADING MORE RAM",
  "BLAMING THE CACHE",
  "ALMOST READY (PROBABLY)",
];

const SOLARI_WORD = "TABS IDE";

const SOLARI_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ".split("");

function RotatingLabel({
  messages,
  intervalMs = 2200,
  className,
  uiFont,
}: {
  messages: string[];
  intervalMs?: number;
  className?: string;
  uiFont?: string | undefined;
}) {
  const [idx, setIdx] = useState(0);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const idxRef = useRef(0);

  useEffect(() => {
    let clearId: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      const leaving = messages[idxRef.current];
      if (leaving === undefined) return;
      const next = (idxRef.current + 1) % messages.length;
      idxRef.current = next;
      setOutgoing(leaving);
      setIdx(next);
      clearId = setTimeout(() => setOutgoing(null), 520);
    }, intervalMs);
    return () => {
      clearInterval(id);
      if (clearId) clearTimeout(clearId);
    };
  }, [messages, intervalMs]);

  const fontStyle = uiFont ? { fontFamily: uiFont } : undefined;

  return (
    <div
      className={cn("relative z-10 h-[14px] w-full text-center loader-respect-motion", className)}
      style={fontStyle}
    >
      {outgoing && (
        <span
          key={`out-${outgoing}`}
          className="rl-out absolute inset-x-0 whitespace-nowrap text-[11px] font-light tracking-[0.22em] uppercase"
        >
          {outgoing}
        </span>
      )}
      <span
        key={`in-${messages[idx]}`}
        className="rl-in absolute inset-x-0 whitespace-nowrap text-[11px] font-light tracking-[0.22em] uppercase"
      >
        {messages[idx]}
      </span>
    </div>
  );
}

function MascotLoader({
  palette,
  isDark,
  fonts,
}: {
  palette: "block" | "mono";
  isDark: boolean;
  fonts?:
    | {
        headingFont?: string | undefined;
        headingWeight?: number | undefined;
        uiFont?: string | undefined;
      }
    | undefined;
}) {
  const isBlock = palette === "block";
  return (
    <div className="relative z-10 flex min-h-[300px] w-full items-center justify-center p-6 loader-respect-motion">
      <div className="relative flex w-full flex-col items-center justify-center gap-[18px]">
        <TabsStroll
          ink={isBlock ? "#ffffff" : isDark ? "#ffffff" : "#0a0a0a"}
          paper={isBlock ? "#2563eb" : isDark ? "#09090b" : "#ffffff"}
        />
        <RotatingLabel
          // Held back until the gag ends, so only slow loads see it (see tabs-mascot.css).
          messages={MASCOT_MESSAGES}
          uiFont={fonts?.uiFont}
          className={cn(
            "mascot-status",
            isBlock ? "text-white/75" : isDark ? "text-[#a1a1aa]" : "text-[#71717a]",
          )}
        />
      </div>
    </div>
  );
}

function SolariTile({
  target,
  index,
  isBlock,
  isDark,
  tileFont,
  tileWeight,
  onSettled,
}: {
  target: string;
  index: number;
  onSettled?: (() => void) | undefined;
  isBlock: boolean;
  isDark: boolean;
  tileFont?: string | undefined;
  tileWeight?: number | undefined;
}) {
  const [ch, setCh] = useState(target);
  const [justSettled, setJustSettled] = useState(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const reducedMotion = useReducedStartupMotion();
  useEffect(() => {
    if (reducedMotion) {
      setCh(target);
      setJustSettled(false);
      onSettledRef.current?.();
      return;
    }
    let highlight: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    // Settle in a smooth cascade from top-left to bottom-right across the 8 tiles.
    const settleAt = SOLARI_TILE_SETTLE_MS + index * SOLARI_TILE_STAGGER_MS;
    const iv = setInterval(() => {
      if (!cancelled) setCh(SOLARI_CHARS[Math.floor(Math.random() * SOLARI_CHARS.length)]!);
    }, 60);
    const to = setTimeout(() => {
      clearInterval(iv);
      if (cancelled) return;
      setCh(target);
      setJustSettled(true);
      onSettledRef.current?.();
      highlight = setTimeout(() => !cancelled && setJustSettled(false), SOLARI_TILE_HIGHLIGHT_MS);
    }, settleAt);

    return () => {
      cancelled = true;
      clearInterval(iv);
      clearTimeout(to);
      clearTimeout(highlight);
    };
  }, [target, index, reducedMotion]);

  return (
    <div
      data-shape="tile"
      className={cn(
        "relative flex h-[64px] w-[52px] items-center justify-center rounded-lg border text-[26px] font-light transition-all duration-300 ease-out",
        isBlock
          ? justSettled
            ? "border-white/90 bg-white/22 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
            : "border-white/24 bg-white/12 shadow-none"
          : justSettled
            ? cn(
                "border-primary shadow-[0_0_0_1px_var(--primary)]",
                isDark ? "bg-white/4" : "bg-black/3",
              )
            : cn("border-border shadow-none", isDark ? "bg-white/4" : "bg-black/3"),
      )}
      style={tileFont ? { fontFamily: tileFont, fontWeight: tileWeight } : undefined}
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-black/35" />
      {ch === " " ? "\u00A0" : ch}
    </div>
  );
}

function SolariGrid({
  palette,
  isDark,
  fonts,
  onSettled,
}: {
  onSettled?: (() => void) | undefined;
  palette: "block" | "mono";
  isDark: boolean;
  fonts?:
    | {
        headingFont?: string | undefined;
        headingWeight?: number | undefined;
        uiFont?: string | undefined;
      }
    | undefined;
}) {
  const word = SOLARI_WORD.padEnd(SOLARI_TILE_COUNT, " ").split("");
  const isBlock = palette === "block";

  return (
    <div className="relative z-10 flex min-h-[300px] w-full max-w-[560px] items-center justify-center p-6 loader-respect-motion">
      <div className="relative flex w-full flex-col items-center justify-center gap-[20px]">
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
          {word.map((ch, i) => (
            <SolariTile
              key={i}
              target={ch!}
              index={i}
              isBlock={isBlock}
              isDark={isDark}
              tileFont={fonts?.headingFont || fonts?.uiFont}
              tileWeight={fonts?.headingWeight}
              // The board is done once its last tile lands; that is the cue
              // for the workspace to rise, not a timer.
              onSettled={i === word.length - 1 ? onSettled : undefined}
            />
          ))}
        </div>
        <RotatingLabel
          messages={SOLARI_MESSAGES}
          uiFont={fonts?.uiFont}
          className={
            isBlock
              ? isDark
                ? "text-[#1c0f0e]/85"
                : "text-white/75"
              : isDark
                ? "text-[#a1a1aa]"
                : "text-[#71717a]"
          }
        />
      </div>
    </div>
  );
}

export interface SplashScreenProps {
  /** "mascot" | "solari"; a stored "glass" (retired) shows the mascot. */
  loader: "mascot" | "glass" | "solari" | string;
  palette: "block" | "mono" | string;
  theme?: "light" | "dark" | "system" | undefined;
  fontComboId?: string | undefined;
  customFont?: string | undefined;
  /** Fired once when the loader's own intro has played (the board's last tile). */
  onIntroComplete?: (() => void) | undefined;
}

export function SplashScreen({
  loader,
  palette,
  theme: overrideTheme,
  fontComboId,
  customFont,
  onIntroComplete,
}: SplashScreenProps) {
  const { resolvedTheme, fontPreferences } = useTheme();
  const effectiveTheme =
    overrideTheme && overrideTheme !== "system" ? overrideTheme : resolvedTheme;
  const isDark = effectiveTheme === "dark";
  const isBlock = palette === "block";
  const storedComboId =
    fontComboId ||
    (typeof window !== "undefined"
      ? (window.localStorage?.getItem("tabs.startupAnimationFontComboId") ??
        window.localStorage?.getItem("tabs.animationFontComboId") ??
        "app-default")
      : "app-default");
  const storedCustomFont =
    customFont ||
    (typeof window !== "undefined"
      ? ((window.localStorage?.getItem("tabs.startupCustomAnimationFont") ||
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
        <SolariGrid
          palette={palette as any}
          isDark={isDark}
          fonts={fonts}
          onSettled={onIntroComplete}
        />
      ) : (
        <MascotLoader palette={palette as any} isDark={isDark} fonts={fonts} />
      )}
    </div>
  );
}

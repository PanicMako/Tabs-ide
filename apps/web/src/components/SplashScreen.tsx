import React, { useState, useEffect, useRef, useId } from "react";
import { useTheme } from "../hooks/useTheme";
import { cn } from "~/lib/utils";
import { FONT_COMBOS, type FontCombo } from "../lib/themes";
import "./loaders.css";

// Give the loader enough time to resolve into the Tabs wordmark on a warm
// launch, then reveal the workspace with a deliberate one-second upward wipe.
export const STARTUP_ANIMATION_HOLD_MS = 1_800;
export const STARTUP_ANIMATION_EXIT_MS = 1_000;

const GLASS_MESSAGES = [
  "COMPILING VIBES",
  "MELTING NODE_MODULES",
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

function resolveAnimationFonts(
  fontComboId?: string | undefined,
  customFontProp?: string | undefined,
): { headingFont?: string | undefined; uiFont?: string | undefined } {
  if (!fontComboId || fontComboId === "app-default") return {};
  if (fontComboId === "custom") {
    const customFont =
      customFontProp ||
      (typeof window !== "undefined"
        ? (window.localStorage?.getItem("tabs.customAnimationFont") ?? "'Inter', sans-serif")
        : "'Inter', sans-serif");
    return {
      headingFont: customFont,
      uiFont: customFont,
    };
  }
  const combo = FONT_COMBOS.find((c) => c.id === fontComboId);
  if (!combo) return {};
  const displayFont = combo.uiFont !== "custom" ? combo.uiFont : undefined;
  return {
    headingFont: displayFont,
    uiFont: displayFont,
  };
}

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

function MoltenGlass({
  palette,
  isDark,
  fonts,
}: {
  palette: "block" | "mono";
  isDark: boolean;
  fonts?: { headingFont?: string | undefined; uiFont?: string | undefined } | undefined;
}) {
  const filterId = useId().replace(/:/g, "");
  const isBlock = palette === "block";
  const animateRef = useRef<SVGAnimationElement>(null);

  useEffect(() => {
    const triggerAnimation = () => {
      if (animateRef.current) {
        try {
          (animateRef.current as any).beginElement();
        } catch (e) {}
      }
    };

    const frame = requestAnimationFrame(triggerAnimation);
    const intervalId = setInterval(triggerAnimation, 6700);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(intervalId);
    };
  }, []);

  const headingStyle = fonts?.headingFont
    ? { fontFamily: fonts.headingFont, filter: `url(#${filterId})` }
    : { filter: `url(#${filterId})` };

  return (
    <div className="relative z-10 flex min-h-[300px] w-full max-w-[560px] items-center justify-center p-6 loader-respect-motion">
      <div className="relative flex w-full flex-col items-center justify-center gap-[22px]">
        <svg
          width="1"
          height="1"
          style={{ position: "absolute", opacity: 0.001, pointerEvents: "none" }}
          aria-hidden="true"
        >
          <defs>
            <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.02 0.09"
                numOctaves="2"
                seed="3"
                result="noise"
              >
                <animate
                  ref={animateRef}
                  attributeName="baseFrequency"
                  dur="6.75s"
                  begin="indefinite"
                  values="0.02 0.09;0.035 0.14;0.02 0.09"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="12"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>

        <div
          className={cn(
            "relative z-10 text-[80px] font-light tracking-[-0.02em]",
            isBlock
              ? isDark
                ? "text-[#1c0f0e]"
                : "text-white"
              : isDark
                ? "text-white"
                : "text-black",
          )}
          style={headingStyle}
        >
          TABS
        </div>

        <RotatingLabel
          messages={GLASS_MESSAGES}
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

function SolariTile({
  target,
  index,
  isBlock,
  isDark,
  tileFont,
}: {
  target: string;
  index: number;
  isBlock: boolean;
  isDark: boolean;
  tileFont?: string | undefined;
}) {
  const [ch, setCh] = useState(target);
  const [justSettled, setJustSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Settle in a smooth cascade from top-left to bottom-right across the 8 tiles.
    const settleAt = 250 + index * 160;
    const iv = setInterval(() => {
      if (!cancelled) setCh(SOLARI_CHARS[Math.floor(Math.random() * SOLARI_CHARS.length)]!);
    }, 60);
    const to = setTimeout(() => {
      clearInterval(iv);
      if (cancelled) return;
      setCh(target);
      setJustSettled(true);
      setTimeout(() => !cancelled && setJustSettled(false), 380);
    }, settleAt);

    return () => {
      cancelled = true;
      clearInterval(iv);
      clearTimeout(to);
    };
  }, [target, index]);

  return (
    <div
      className={cn(
        "relative flex h-[64px] w-[52px] items-center justify-center rounded-[6px] border text-[26px] font-light transition-all duration-300 ease-out",
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
      style={tileFont ? { fontFamily: tileFont } : undefined}
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
}: {
  palette: "block" | "mono";
  isDark: boolean;
  fonts?: { headingFont?: string | undefined; uiFont?: string | undefined } | undefined;
}) {
  const word = "TABS IDE".padEnd(8, " ").split("");
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
  loader: "glass" | "solari" | string;
  palette: "block" | "mono" | string;
  theme?: "light" | "dark" | "system" | undefined;
  fontComboId?: string | undefined;
  customFont?: string | undefined;
}

export function SplashScreen({
  loader,
  palette,
  theme: overrideTheme,
  fontComboId,
  customFont,
}: SplashScreenProps) {
  const { resolvedTheme } = useTheme();
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

  const fonts = resolveAnimationFonts(storedComboId, storedCustomFont);

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center",
        isBlock ? "bg-[#2563eb]" : isDark ? "bg-[#09090b]" : "bg-white",
      )}
    >
      {loader === "solari" ? (
        <SolariGrid palette={palette as any} isDark={isDark} fonts={fonts} />
      ) : (
        <MoltenGlass palette={palette as any} isDark={isDark} fonts={fonts} />
      )}
    </div>
  );
}

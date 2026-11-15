/** Workspace wallpaper with a still print texture, soft reading light, and per-thread controls. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { usePanelAnimationSettings } from "../panelAnimations";
import { useTheme } from "../hooks/useTheme";
import {
  type WallpaperOption,
  saveAgentWallpaperPreference,
  getIsAgentWallpaperEnabled,
  saveIsAgentWallpaperEnabled,
  AGENT_WALLPAPER_CHANGE_EVENT,
  getAllAgentWallpapers,
  getThreadWallpaper,
  saveThreadWallpaper,
  clearThreadWallpaper,
  getProjectWallpaper,
  saveProjectWallpaper,
  clearProjectWallpaper,
  type WallpaperScope,
  resolveWallpaperForThread,
} from "./onboarding/wallpapers";
import {
  type WallpaperPrintStrength,
  type WallpaperPrintStyle,
  getWallpaperPrintAnimate,
  getWallpaperPrintStrength,
  getWallpaperPrintStyle,
} from "./onboarding/wallpaperPrint";
import { WallpaperPrintLayer } from "./WallpaperPrintLayer";
import { useWallpaperControlsStore } from "../stores/wallpaperControlsStore";
import { WallpaperGalleryModal } from "./onboarding/WallpaperGalleryModal";

const PARALLAX_SCALE = 1.05;
const MAX_PARALLAX_PX = 10;

/** A still print texture keeps the artwork present without moving across the text. */
function WorkspacePrintTexture({
  style,
  strength,
  wallpaperUrl,
  isLight,
  animate,
}: {
  readonly style: WallpaperPrintStyle;
  readonly strength: WallpaperPrintStrength;
  readonly wallpaperUrl: string;
  readonly isLight: boolean;
  readonly animate: boolean;
}) {
  // A wallpaper the browser cannot read back (another host) falls back to the CSS halftone.
  const [unreadableUrl, setUnreadableUrl] = useState<string | null>(null);
  if (style === "none") return null;
  const generated = style !== "halftone" && unreadableUrl !== wallpaperUrl;
  return (
    <>
      {generated ? (
        // The mask keeps the print to the open artwork and clears it from behind the text.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            maskImage: "linear-gradient(180deg, #000 0%, #000 38%, transparent 86%)",
            WebkitMaskImage: "linear-gradient(180deg, #000 0%, #000 38%, transparent 86%)",
          }}
        >
          <WallpaperPrintLayer
            url={wallpaperUrl}
            style={style}
            strength={strength}
            ink={isLight ? "dark" : "light"}
            animate={animate}
            onUnavailable={() => setUnreadableUrl(wallpaperUrl)}
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="agent-wallpaper-halftone pointer-events-none absolute inset-0 z-[2]"
        />
      )}
      <div
        aria-hidden="true"
        className="agent-wallpaper-grain pointer-events-none absolute inset-0 z-[2]"
      />
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface AgentBackgroundProps {
  readonly enabled?: boolean;
  readonly threadId?: string | null;
  /** The project this chat belongs to, so a wallpaper can be set per project. */
  readonly projectId?: string | null;
  readonly children?: ReactNode;
}

export function AgentBackground({
  enabled = true,
  threadId = null,
  projectId = null,
  children,
}: AgentBackgroundProps) {
  const { resolvedTheme } = useTheme();
  const { reducedMotion } = usePanelAnimationSettings();
  const isLight = resolvedTheme === "light";

  const [isWallpaperEnabled, setIsWallpaperEnabled] = useState<boolean>(
    () => enabled && getIsAgentWallpaperEnabled(),
  );

  const [wallpaper, setWallpaper] = useState<WallpaperOption>(() =>
    resolveWallpaperForThread(threadId, projectId),
  );
  const [prevWallpaper, setPrevWallpaper] = useState<WallpaperOption | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [printStyle, setPrintStyle] = useState<WallpaperPrintStyle>(() => getWallpaperPrintStyle());
  const [printStrength, setPrintStrength] = useState<WallpaperPrintStrength>(() =>
    getWallpaperPrintStrength(),
  );
  const [printAnimate, setPrintAnimate] = useState<boolean>(() => getWallpaperPrintAnimate());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const parallaxRef = useRef<HTMLDivElement | null>(null);
  const mousePos = useRef({ x: 0.5, y: 0.5 });
  const currentTranslate = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Check if current wallpaper is specifically assigned to this thread
  const hasThreadSpecific = Boolean(threadId && getThreadWallpaper(threadId));
  const hasProjectSpecific = Boolean(projectId && getProjectWallpaper(projectId));

  // Sync wallpaper when threadId changes or when storage / custom events fire
  useEffect(() => {
    setWallpaper(resolveWallpaperForThread(threadId, projectId));
  }, [threadId, projectId]);

  useEffect(() => {
    const handleUpdate = () => {
      setIsWallpaperEnabled(enabled && getIsAgentWallpaperEnabled());
      setWallpaper(resolveWallpaperForThread(threadId, projectId));
      setPrintStyle(getWallpaperPrintStyle());
      setPrintStrength(getWallpaperPrintStrength());
      setPrintAnimate(getWallpaperPrintAnimate());
    };
    window.addEventListener(AGENT_WALLPAPER_CHANGE_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(AGENT_WALLPAPER_CHANGE_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [threadId, projectId, enabled]);

  // Parallax tracking relative to the chat area container
  useEffect(() => {
    if (!isWallpaperEnabled || reducedMotion) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      mousePos.current = {
        x: Math.max(0, Math.min(1, relX)),
        y: Math.max(0, Math.min(1, relY)),
      };
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    const animate = () => {
      if (document.hidden) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      const targetX = (mousePos.current.x - 0.5) * -MAX_PARALLAX_PX * 2;
      const targetY = (mousePos.current.y - 0.5) * -MAX_PARALLAX_PX * 2;

      currentTranslate.current.x += (targetX - currentTranslate.current.x) * 0.04;
      currentTranslate.current.y += (targetY - currentTranslate.current.y) * 0.04;

      if (parallaxRef.current) {
        parallaxRef.current.style.transform = `scale(${PARALLAX_SCALE}) translate3d(${currentTranslate.current.x}px, ${currentTranslate.current.y}px, 0)`;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isWallpaperEnabled, reducedMotion]);

  const changeWallpaper = useCallback(
    (next: WallpaperOption, targetScope: WallpaperScope = "global") => {
      if (next.url === wallpaper.url && !targetScope) return;
      setPrevWallpaper(wallpaper);
      setIsTransitioning(true);
      setWallpaper(next);

      if (targetScope === "thread" && threadId) {
        saveThreadWallpaper(threadId, next.url);
      } else if (targetScope === "project" && projectId) {
        saveProjectWallpaper(projectId, next.url);
      } else {
        saveAgentWallpaperPreference(next.url);
      }

      setTimeout(() => {
        setPrevWallpaper(null);
        setIsTransitioning(false);
      }, 750);
    },
    [wallpaper, threadId, projectId],
  );

  const handleClearThreadWallpaper = useCallback(() => {
    if (!threadId) return;
    clearThreadWallpaper(threadId);
    setWallpaper(resolveWallpaperForThread(threadId, projectId));
  }, [threadId, projectId]);

  const handleClearProjectWallpaper = useCallback(() => {
    if (!projectId) return;
    clearProjectWallpaper(projectId);
    setWallpaper(resolveWallpaperForThread(threadId, projectId));
  }, [threadId, projectId]);

  /** The dock's reset button removes the narrowest override first: the thread's, then the project's. */
  const handleClearOverride = useCallback(() => {
    if (hasThreadSpecific) handleClearThreadWallpaper();
    else handleClearProjectWallpaper();
  }, [hasThreadSpecific, handleClearThreadWallpaper, handleClearProjectWallpaper]);

  const handleDisableWallpaper = useCallback(() => {
    saveIsAgentWallpaperEnabled(false);
    setIsWallpaperEnabled(false);
  }, []);

  const stepWallpaper = useCallback(
    (direction: 1 | -1) => {
      const all = getAllAgentWallpapers();
      const index = Math.max(
        0,
        all.findIndex((candidate) => candidate.url === wallpaper.url),
      );
      const next = all[(index + direction + all.length) % all.length];
      if (next) {
        changeWallpaper(next, hasThreadSpecific ? "thread" : projectId ? "project" : "global");
      }
    },
    [wallpaper.url, changeWallpaper, hasThreadSpecific, projectId],
  );

  const shuffleWallpaper = useCallback(() => {
    const others = getAllAgentWallpapers().filter((candidate) => candidate.url !== wallpaper.url);
    const next = others[Math.floor(Math.random() * others.length)];
    if (next) {
      changeWallpaper(next, hasThreadSpecific ? "thread" : projectId ? "project" : "global");
    }
  }, [wallpaper.url, changeWallpaper, hasThreadSpecific, projectId]);

  const publishControls = useWallpaperControlsStore((state) => state.publish);
  useEffect(() => {
    publishControls({
      enabled: isWallpaperEnabled,
      label: wallpaper.label,
      url: wallpaper.url,
      overridden: hasThreadSpecific || hasProjectSpecific,
      openGallery: () => setIsGalleryOpen(true),
      shuffle: shuffleWallpaper,
      step: stepWallpaper,
      resetOverride: handleClearOverride,
      setEnabled: (next) => {
        saveIsAgentWallpaperEnabled(next);
        setIsWallpaperEnabled(next && enabled);
      },
    });
  }, [
    publishControls,
    isWallpaperEnabled,
    wallpaper.label,
    wallpaper.url,
    hasThreadSpecific,
    hasProjectSpecific,
    shuffleWallpaper,
    stepWallpaper,
    handleClearOverride,
    enabled,
  ]);
  useEffect(() => () => publishControls(null), [publishControls]);

  // If wallpaper is turned off, render purely children with zero extra icons or pills
  if (!isWallpaperEnabled) {
    return <>{children}</>;
  }

  const allAvailableWallpapers = getAllAgentWallpapers();

  return (
    <div
      ref={containerRef}
      data-agent-wallpaper="active"
      data-theme={resolvedTheme}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        isLight ? "theme-wallpaper-light" : "theme-wallpaper-dark",
      )}
    >
      {/* ── Layer 1: Base Wallpaper Image with Crossfade & Parallax (z-0) ── */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        {prevWallpaper && (
          <div
            className={cn(
              "absolute inset-0 bg-cover bg-center transition-opacity duration-700",
              isTransitioning ? "opacity-0" : "opacity-100",
            )}
            style={{
              backgroundImage: `url(${prevWallpaper.url})`,
              transform: `scale(${PARALLAX_SCALE})`,
            }}
          />
        )}
        <div
          ref={parallaxRef}
          className="absolute inset-0 bg-cover bg-center will-change-transform"
          style={{
            backgroundImage: `url(${wallpaper.url})`,
            transform: `scale(${PARALLAX_SCALE})`,
          }}
        />
      </div>

      {/* ── Layer 2: Aesthetic Scrim Gradient (z-1) ── */}
      {/* Light Mode: Artwork visible at top, gently washing down into pure white canvas */}
      {/* Dark Mode: Deep neutral black vignette & depth mask */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-500"
        style={{
          background: isLight
            ? "linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.52) 52%, rgba(255,255,255,.92)), radial-gradient(ellipse at 50% 45%, rgba(255,255,255,.42), transparent 68%)"
            : "linear-gradient(180deg, rgba(5,7,12,.08), rgba(5,7,12,.22) 42%, rgba(5,7,12,.84)), radial-gradient(ellipse at 50% 45%, rgba(5,7,12,.38), transparent 72%)",
        }}
        aria-hidden="true"
      />

      {/* ── Layer 3: Still halftone and paper grain (z-2) ──── */}
      <WorkspacePrintTexture
        style={printStyle}
        strength={printStrength}
        wallpaperUrl={wallpaper.url}
        isLight={isLight}
        animate={printAnimate && !reducedMotion}
      />

      {/* ── Layer 3.5: Subtle tone veil (z-[3]) ── */}
      <div
        className="pointer-events-none absolute inset-0 z-[3]"
        style={{
          background: isLight ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)",
        }}
        aria-hidden="true"
      />

      {/* ── Layer 4: Chat Content (z-10) ─────────────────────────────────── */}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* ── Full Wallpaper Gallery Modal (Portaled to document.body) ─────────── */}
      <WallpaperGalleryModal
        isOpen={isGalleryOpen}
        activeWallpaperUrl={wallpaper.url}
        threadId={threadId}
        projectId={projectId}
        isThreadSpecific={hasThreadSpecific}
        isProjectSpecific={hasProjectSpecific}
        theme={resolvedTheme}
        onSelectWallpaper={(wp, scope) => {
          changeWallpaper(wp, scope);
          setIsGalleryOpen(false);
        }}
        onClearThreadWallpaper={handleClearThreadWallpaper}
        onClearProjectWallpaper={handleClearProjectWallpaper}
        onDisableWallpaper={handleDisableWallpaper}
        onClose={() => setIsGalleryOpen(false)}
        wallpapers={allAvailableWallpapers}
      />
    </div>
  );
}

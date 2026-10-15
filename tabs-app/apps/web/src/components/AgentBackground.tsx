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
  resolveWallpaperForThread,
  getIsAgentWallpaperMinimized,
  saveIsAgentWallpaperMinimized,
} from "./onboarding/wallpapers";
import { WallpaperTopBar } from "./onboarding/WallpaperTopBar";
import { WallpaperGalleryModal } from "./onboarding/WallpaperGalleryModal";

const PARALLAX_SCALE = 1.05;
const MAX_PARALLAX_PX = 10;

/** A still print texture keeps the artwork present without moving across the text. */
function WorkspacePrintTexture() {
  return (
    <>
      <div
        aria-hidden="true"
        className="agent-wallpaper-halftone pointer-events-none absolute inset-0 z-[2]"
      />
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
  readonly children?: ReactNode;
  readonly defaultMinimized?: boolean;
}

export function AgentBackground({
  enabled = true,
  threadId = null,
  children,
  defaultMinimized,
}: AgentBackgroundProps) {
  const { resolvedTheme } = useTheme();
  const { reducedMotion } = usePanelAnimationSettings();
  const isLight = resolvedTheme === "light";

  const [isWallpaperEnabled, setIsWallpaperEnabled] = useState<boolean>(
    () => enabled && getIsAgentWallpaperEnabled(),
  );

  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    if (defaultMinimized !== undefined) return defaultMinimized;
    return getIsAgentWallpaperMinimized();
  });

  const handleToggleMinimize = (minimized: boolean) => {
    setIsMinimized(minimized);
    saveIsAgentWallpaperMinimized(minimized);
  };

  const [wallpaper, setWallpaper] = useState<WallpaperOption>(() =>
    resolveWallpaperForThread(threadId),
  );
  const [prevWallpaper, setPrevWallpaper] = useState<WallpaperOption | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const parallaxRef = useRef<HTMLDivElement | null>(null);
  const mousePos = useRef({ x: 0.5, y: 0.5 });
  const currentTranslate = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Check if current wallpaper is specifically assigned to this thread
  const hasThreadSpecific = Boolean(threadId && getThreadWallpaper(threadId));

  // Sync wallpaper when threadId changes or when storage / custom events fire
  useEffect(() => {
    setWallpaper(resolveWallpaperForThread(threadId));
  }, [threadId]);

  useEffect(() => {
    const handleUpdate = () => {
      setIsWallpaperEnabled(enabled && getIsAgentWallpaperEnabled());
      setWallpaper(resolveWallpaperForThread(threadId));
    };
    window.addEventListener(AGENT_WALLPAPER_CHANGE_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(AGENT_WALLPAPER_CHANGE_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [threadId, enabled]);

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
    (next: WallpaperOption, targetScope: "global" | "thread" = "global") => {
      if (next.url === wallpaper.url && !targetScope) return;
      setPrevWallpaper(wallpaper);
      setIsTransitioning(true);
      setWallpaper(next);

      if (targetScope === "thread" && threadId) {
        saveThreadWallpaper(threadId, next.url);
      } else {
        saveAgentWallpaperPreference(next.url);
      }

      setTimeout(() => {
        setPrevWallpaper(null);
        setIsTransitioning(false);
      }, 750);
    },
    [wallpaper, threadId],
  );

  const handleClearThreadWallpaper = useCallback(() => {
    if (!threadId) return;
    clearThreadWallpaper(threadId);
    setWallpaper(resolveWallpaperForThread(threadId));
  }, [threadId]);

  const handleDisableWallpaper = useCallback(() => {
    saveIsAgentWallpaperEnabled(false);
    setIsWallpaperEnabled(false);
  }, []);

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
      <WorkspacePrintTexture />

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

      {/* ── Layer 5: Wallpaper Floating Controller (z-40) ────────── */}
      {/* Positioned upwards in the right gutter, level with the composer upper bar */}
      {/* Completely clear of the bottom toolbar and branch selector! */}
      <div className="pointer-events-auto absolute bottom-24 right-4 sm:bottom-28 sm:right-6 z-40">
        <WallpaperTopBar
          activeWallpaperUrl={wallpaper.url}
          onSelectWallpaper={(wp) => changeWallpaper(wp, hasThreadSpecific ? "thread" : "global")}
          onOpenGallery={() => setIsGalleryOpen(true)}
          onDisableWallpaper={handleDisableWallpaper}
          onMinimize={() => handleToggleMinimize(true)}
          isMinimized={isMinimized}
          onExpand={() => handleToggleMinimize(false)}
          isThreadSpecific={hasThreadSpecific}
          onClearThreadWallpaper={handleClearThreadWallpaper}
          theme={resolvedTheme}
          wallpapers={allAvailableWallpapers}
          dropDirection="left"
          orientation="vertical"
          showFilmstrip={false}
        />
      </div>

      {/* ── Full Wallpaper Gallery Modal (Portaled to document.body) ─────────── */}
      <WallpaperGalleryModal
        isOpen={isGalleryOpen}
        activeWallpaperUrl={wallpaper.url}
        threadId={threadId}
        isThreadSpecific={hasThreadSpecific}
        theme={resolvedTheme}
        onSelectWallpaper={(wp, scope) => {
          changeWallpaper(wp, scope);
          setIsGalleryOpen(false);
        }}
        onClearThreadWallpaper={handleClearThreadWallpaper}
        onDisableWallpaper={handleDisableWallpaper}
        onClose={() => setIsGalleryOpen(false)}
        wallpapers={allAvailableWallpapers}
      />
    </div>
  );
}

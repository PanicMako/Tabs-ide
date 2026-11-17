import { useRef } from "react";
import type { RightPanelTab } from "~/stores/rightPanelStore";
import { cn } from "~/lib/utils";
import {
  launchFromHome,
  useCompanionMotion,
  useSegmentThumb,
  useStaggerIn,
  useSurfaceEnter,
} from "./motion";
import { SurfaceChooser, surfaceInstanceLabel } from "../SurfaceTabs";
import {
  PanelControls,
  SurfaceBody,
  SurfaceSubTabs,
  activeInstance,
  surfaces,
  type CompanionDesignProps,
} from "./shared";

/**
 * 4 · Grouped, and 4+1 · Edition. One segmented control holds every surface (the active one shows
 * its name), browsers and terminals get a row of page tabs, and the home is the shipped launcher.
 */
export function GroupedDesign(props: CompanionDesignProps) {
  const active = activeInstance(props);
  const home = props.choosing || !active;
  const browsers = props.instances.filter((item) => item.kind === "browser");
  const devices = props.instances.filter((item) => item.kind === "device");
  const sideChats = props.instances.filter((item) => item.kind === "sidechat");
  const segments = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const launching = useRef(false);
  const motion = useCompanionMotion();
  useSegmentThumb(segments, thumb, home ? "home" : (active?.kind ?? "home"));
  useSurfaceEnter(body, home ? "home" : (active?.id ?? null), !home && active?.kind === "browser");
  useStaggerIn(homeRef, ".surface-launcher-row", home ? "home" : "away", { y: 16, stagger: 0.04 });
  const openFromHome = (kind: RightPanelTab) => {
    if (launching.current) return;
    const root = homeRef.current;
    if (!root) return props.onOpen(kind);
    launching.current = true;
    launchFromHome({
      home: root,
      row: root.querySelector<HTMLElement>(`[data-surface="${kind}"]`),
      target: segments.current?.querySelector<HTMLElement>(`[data-segment="${kind}"]`) ?? null,
      active: motion.active,
      seconds: motion.seconds,
      done: () => {
        launching.current = false;
        props.onOpen(kind);
      },
    });
  };
  return (
    <>
      <header className={cn("cd-grouped-bar", props.dragRegion && "drag-region")}>
        <div
          role="tablist"
          aria-label="Surfaces"
          ref={segments}
          className="cd-segments"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
            const index = tabs.indexOf(document.activeElement as HTMLElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
            next?.focus();
            next?.click();
          }}
        >
          <span ref={thumb} className="cd-segment-thumb" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            data-segment="home"
            aria-selected={home}
            tabIndex={home ? 0 : -1}
            className="cd-segment"
            aria-label="All surfaces"
            title="All surfaces"
            onClick={() => props.onChooserChange(true)}
          >
            <SurfacesGlyph />
          </button>
          {surfaces.map((surface) => {
            const selected = !home && active?.kind === surface.id;
            return (
              <button
                key={surface.id}
                type="button"
                role="tab"
                data-segment={surface.id}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                id={selected ? `surface-tab-${active!.id}` : undefined}
                className="cd-segment"
                aria-label={surface.label}
                title={`${surface.label} · ${surface.key.toUpperCase()}`}
                onClick={() => props.onFocusKind(surface.id)}
              >
                <surface.Icon aria-hidden="true" size={15} />
                <span className="cd-segment-label">{surface.label}</span>
                {!!props.counts[surface.id] && !selected && (
                  <span className="cd-segment-dot" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
        <PanelControls {...props} />
      </header>
      {!home && active?.kind === "browser" && (
        <SurfaceSubTabs
          label="Browser tabs"
          tabs={browsers.map((item) => {
            const fallback = surfaceInstanceLabel(props.instances, item);
            return {
              id: item.id,
              label: item.title && item.title !== "Browser" ? item.title : fallback,
              title: item.title || fallback,
            };
          })}
          activeId={active.id}
          onSelect={props.onSelectInstance}
          onClose={props.onCloseInstance}
          onNew={() => props.onOpen("browser")}
          newLabel="New browser tab"
        />
      )}
      {!home && active?.kind === "device" && (
        <SurfaceSubTabs
          label="Device tabs"
          tabs={devices.map((item) => {
            const label = surfaceInstanceLabel(props.instances, item);
            return { id: item.id, label, title: label };
          })}
          activeId={active.id}
          onSelect={props.onSelectInstance}
          onClose={props.onCloseInstance}
          onNew={() => props.onOpen("device")}
          newLabel="Open another device"
          onRename={props.onRenameInstance}
        />
      )}
      {!home && active?.kind === "sidechat" && (
        <SurfaceSubTabs
          label="Side chat tabs"
          tabs={sideChats.map((item) => {
            const label = surfaceInstanceLabel(props.instances, item);
            return { id: item.id, label, title: label };
          })}
          activeId={active.id}
          onSelect={props.onSelectInstance}
          onClose={props.onCloseInstance}
          onNew={() => props.onOpen("sidechat")}
          newLabel="Start another side chat"
        />
      )}
      <SurfaceBody label={active ? surfaceInstanceLabel(props.instances, active) : "Surfaces"}>
        {/* The home is the shipped launcher: playful type, letter shortcuts, one click to open. */}
        <div ref={body} className="cd-surface-stage">
          {home ? (
            <div ref={homeRef} className="cd-home">
              <SurfaceChooser onSelect={openFromHome} />
            </div>
          ) : (
            props.body
          )}
        </div>
      </SurfaceBody>
    </>
  );
}

/** Four rounded squares: every surface at once. */
function SurfacesGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.8" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.8" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.8" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.8" />
    </svg>
  );
}

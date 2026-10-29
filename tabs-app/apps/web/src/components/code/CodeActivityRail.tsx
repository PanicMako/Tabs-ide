import {
  BlocksIcon,
  BugIcon,
  FilesIcon,
  GitBranchIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import {
  type ComponentType,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  CODE_ACTIVITY_ITEMS,
  CODE_CHROME_COMMANDS,
  CODE_MENU_BAR,
  type CodeActivityItem,
  type CodeChromeState,
  type CodeRailPresentation,
  type CustomActivityBarItem,
} from "@tabs/shared/codeChrome";

import { cn } from "../../lib/utils";
import { getVisibleCustomActivityBarItems } from "./CodeActivityRail.logic";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const ICONS: Record<CodeActivityItem["icon"], ComponentType<{ className?: string }>> = {
  files: FilesIcon,
  search: SearchIcon,
  "git-branch": GitBranchIcon,
  bug: BugIcon,
  puzzle: BlocksIcon,
};

interface CodeActivityRailProps {
  chromeState: CodeChromeState;
  workspaceId?: string;
  onPresentationChange?: (presentation: CodeRailPresentation) => void;
  onApplicationMenuOpenChange?: (open: boolean) => void | Promise<void>;
  onRunCommand: (commandId: string) => void;
}

function RailButton(props: {
  label: string;
  active?: boolean;
  nativeLabel?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      data-rail-label={props.label}
      onClick={props.onClick}
      className={cn("code-rail-action", props.active && "is-active")}
    >
      <span className="code-rail-icon">{props.children}</span>
    </button>
  );
  if (props.nativeLabel) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="right" className="code-rail-label">
        {props.label}
      </TooltipPopup>
    </Tooltip>
  );
}

function CustomActivityIcon({ item }: { item: CustomActivityBarItem }) {
  if (item.icon.type === "themeIcon" && item.icon.value) {
    return <span aria-hidden="true" className={`codicon codicon-${item.icon.value} text-[18px]`} />;
  }
  if (item.icon.type === "uri" && item.icon.value) {
    return (
      <span
        aria-hidden="true"
        className="size-5 bg-current"
        style={{
          WebkitMaskImage: `url(${JSON.stringify(item.icon.value)})`,
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskImage: `url(${JSON.stringify(item.icon.value)})`,
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
        }}
      />
    );
  }
  if (item.icon.type === "themeUri" && (item.icon.light || item.icon.dark)) {
    return (
      <picture aria-hidden="true">
        {item.icon.dark ? (
          <source media="(prefers-color-scheme: dark)" srcSet={item.icon.dark} />
        ) : null}
        <img alt="" className="size-5" src={item.icon.light ?? item.icon.dark} />
      </picture>
    );
  }
  return <BlocksIcon aria-hidden="true" className="size-5" />;
}

function ApplicationMenu(props: CodeActivityRailProps) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setOpen(false);
          void props.onApplicationMenuOpenChange?.(false);
          return;
        }
        if (opening) return;
        setOpening(true);
        void Promise.resolve(props.onApplicationMenuOpenChange?.(true)).finally(() => {
          setOpening(false);
          setOpen(true);
        });
      }}
    >
      <DropdownMenuTrigger
        aria-label="Code application menu"
        className="code-rail-action code-menu-trigger"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          className="code-menu-glyph size-5"
        >
          <path className="code-menu-top" d="M5 6h14" />
          <path className="code-menu-middle" d="M5 12h14" />
          <path className="code-menu-bottom" d="M5 18h14" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Code application menu"
        align="start"
        className="code-actions-menu w-56"
        side="right"
        sideOffset={6}
      >
        {CODE_MENU_BAR.map((menu) => (
          <DropdownMenuSub key={menu.id}>
            <DropdownMenuSubTrigger>{menu.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="code-actions-menu w-72">
              {menu.groups.map((group, groupIndex) => (
                <Fragment key={`${menu.id}-${group.items.map((item) => item.commandId).join("-")}`}>
                  {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                  {group.items.map((item) =>
                    item.commandId === "workbench.action.toggleAutoSave" ? (
                      <DropdownMenuCheckboxItem
                        checked={props.chromeState.autoSaveEnabled}
                        key={item.commandId}
                        onClick={() => props.onRunCommand(item.commandId)}
                      >
                        {item.label}
                      </DropdownMenuCheckboxItem>
                    ) : (
                      <DropdownMenuItem
                        key={item.commandId}
                        onClick={() => props.onRunCommand(item.commandId)}
                      >
                        {item.label}
                        {item.shortcut ? (
                          <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
                        ) : null}
                      </DropdownMenuItem>
                    ),
                  )}
                </Fragment>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Stable Tabs activity rail backed only by allowlisted workbench commands. */
export function CodeActivityRail(props: CodeActivityRailProps) {
  const railRef = useRef<HTMLElement>(null);
  const viewsRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef(props.onRunCommand);
  const presentationCallbackRef = useRef(props.onPresentationChange);
  const presentationRef = useRef<CodeRailPresentation>({
    selectionY: null,
    spotlight: false,
    label: null,
  });
  const labelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelTargetRef = useRef<HTMLButtonElement | null>(null);
  const spotlightRef = useRef(false);
  const frameRef = useRef(0);
  useLayoutEffect(() => {
    commandRef.current = props.onRunCommand;
    presentationCallbackRef.current = props.onPresentationChange;
    props.onPresentationChange?.(presentationRef.current);
  }, [props.onRunCommand, props.onPresentationChange]);

  const publishPresentation = useCallback((patch: Partial<CodeRailPresentation>) => {
    presentationRef.current = { ...presentationRef.current, ...patch };
    presentationCallbackRef.current?.(presentationRef.current);
  }, []);

  const clearLabel = useCallback(() => {
    if (labelTimerRef.current !== null) clearTimeout(labelTimerRef.current);
    labelTimerRef.current = null;
    labelTargetRef.current = null;
    if (presentationRef.current.label) publishPresentation({ label: null });
  }, [publishPresentation]);

  const positionInHost = useCallback((button: HTMLElement) => {
    const rail = railRef.current!;
    const host = rail.closest(".code-workspace-body") ?? rail;
    const bounds = button.getBoundingClientRect();
    const viewport = host.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(1, (bounds.top + bounds.height / 2 - viewport.top) / Math.max(1, viewport.height)),
    );
  }, []);

  const queueLabel = useCallback(
    (button: HTMLButtonElement | null, immediate = false) => {
      if (!presentationCallbackRef.current) return;
      if (!button || (!immediate && button.classList.contains("is-active"))) {
        clearLabel();
        return;
      }
      if (labelTargetRef.current === button) return;
      clearLabel();
      labelTargetRef.current = button;
      const show = () => {
        labelTimerRef.current = null;
        if (!button.isConnected) return;
        publishPresentation({
          label: {
            text: (button.getAttribute("aria-label") ?? "").slice(0, 100),
            y: positionInHost(button),
          },
        });
      };
      if (immediate) show();
      else labelTimerRef.current = setTimeout(show, 300);
    },
    [clearLabel, positionInHost, publishPresentation],
  );

  const setSpotlight = useCallback(
    (active: boolean) => {
      if (spotlightRef.current === active) return;
      spotlightRef.current = active;
      viewsRef.current?.toggleAttribute("data-spotlight", active);
      railRef.current?.toggleAttribute("data-spotlight", active);
      publishPresentation({ spotlight: active });
      if (!presentationCallbackRef.current)
        commandRef.current(
          active ? CODE_CHROME_COMMANDS.railSpotlightOn : CODE_CHROME_COMMANDS.railSpotlightOff,
        );
    },
    [publishPresentation],
  );

  const resetWave = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    viewsRef.current?.querySelectorAll<HTMLElement>(".code-rail-icon").forEach((icon) => {
      icon.style.removeProperty("transform");
      icon.style.removeProperty("opacity");
    });
  }, []);

  useLayoutEffect(() => {
    const views = viewsRef.current;
    const rail = railRef.current;
    const scroll = views?.parentElement;
    if (!views || !rail || !scroll) return;
    const place = () => {
      const selected = views.querySelector<HTMLElement>(".is-active");
      views.toggleAttribute("data-has-selection", !!selected);
      if (selected) {
        views.style.setProperty("--code-selection-y", `${selected.offsetTop}px`);
        const bounds = selected.getBoundingClientRect();
        const viewport = scroll.getBoundingClientRect();
        rail.style.setProperty(
          "--code-rail-glow-y",
          `${bounds.top + bounds.height / 2 - rail.getBoundingClientRect().top}px`,
        );
        const visible = bounds.bottom > viewport.top && bounds.top < viewport.bottom;
        rail.toggleAttribute("data-has-selection", visible);
        publishPresentation({ selectionY: visible ? positionInHost(selected) : null });
      } else {
        rail.removeAttribute("data-has-selection");
        publishPresentation({ selectionY: null });
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(views);
    observer.observe(rail);
    const onScroll = () => {
      clearLabel();
      setSpotlight(false);
      resetWave();
      place();
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", onScroll);
    };
  }, [
    props.chromeState.activeViewId,
    props.chromeState.activityBarItems,
    setSpotlight,
    resetWave,
    clearLabel,
    publishPresentation,
    positionInHost,
  ]);

  useEffect(() => {
    clearLabel();
    setSpotlight(false);
    resetWave();
    publishPresentation({ spotlight: false, label: null });
    const sendPresentation = presentationCallbackRef.current;
    const sendCommand = commandRef.current;
    // Capture the owning project before a subsequent render changes the bridge.
    return () => {
      if (labelTimerRef.current !== null) clearTimeout(labelTimerRef.current);
      sendPresentation?.({ selectionY: null, spotlight: false, label: null });
      if (spotlightRef.current) {
        spotlightRef.current = false;
        viewsRef.current?.removeAttribute("data-spotlight");
        railRef.current?.removeAttribute("data-spotlight");
        if (!sendPresentation) sendCommand(CODE_CHROME_COMMANDS.railSpotlightOff);
      }
      resetWave();
    };
  }, [
    props.workspaceId,
    props.chromeState.activeViewId,
    props.chromeState.modalOpen,
    setSpotlight,
    resetWave,
    clearLabel,
    publishPresentation,
  ]);

  useEffect(() => {
    const clear = () => {
      clearLabel();
      setSpotlight(false);
      resetWave();
    };
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    motion.addEventListener("change", clear);
    return () => {
      clear();
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      motion.removeEventListener("change", clear);
    };
  }, [setSpotlight, resetWave, clearLabel]);

  return (
    <nav
      ref={railRef}
      aria-label="Code views"
      inert={props.chromeState.modalOpen}
      className="code-activity-rail"
      data-sidebar-open={props.chromeState.activeViewId !== null}
      onPointerMove={(event) =>
        queueLabel(
          (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-rail-label]"),
        )
      }
      onPointerLeave={clearLabel}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches(":focus-visible"))
          queueLabel(target.closest<HTMLButtonElement>("button[data-rail-label]"), true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearLabel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") clearLabel();
      }}
    >
      <ApplicationMenu {...props} />
      <div className="code-rail-scroll">
        <div
          ref={viewsRef}
          className="code-rail-views"
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            const buttons = Array.from(
              viewsRef.current?.querySelectorAll<HTMLButtonElement>(".code-rail-action") ?? [],
            );
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
            buttons[next]?.focus();
          }}
          onPointerMove={(event) => {
            if (props.chromeState.modalOpen) return;
            const views = viewsRef.current;
            if (!views) return;
            const target = event.target as HTMLElement;
            const active = !!target.closest(".code-rail-action.is-active");
            setSpotlight(active);
            if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            const pointerY = event.clientY;
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = requestAnimationFrame(() => {
              frameRef.current = 0;
              views.querySelectorAll<HTMLElement>(".code-rail-action").forEach((button) => {
                const icon = button.querySelector<HTMLElement>(".code-rail-icon");
                if (!icon) return;
                const rect = button.getBoundingClientRect();
                const distance = pointerY - (rect.top + rect.height / 2);
                const weight = Math.exp(-(distance * distance) / 5408);
                const animate = !active && !button.classList.contains("is-active");
                icon.style.transform = animate
                  ? `translateX(${4 * weight}px) scale(${0.9 + 0.4 * weight})`
                  : "";
                icon.style.opacity = animate ? `${0.5 + 0.5 * weight}` : "";
              });
            });
          }}
          onPointerLeave={() => {
            setSpotlight(false);
            resetWave();
          }}
        >
          <span className="code-rail-selection" aria-hidden="true" />
          {CODE_ACTIVITY_ITEMS.map((item) => {
            const Icon = ICONS[item.icon];
            const active = props.chromeState.activeViewId === item.id;
            return (
              <Fragment key={item.id}>
                <RailButton
                  nativeLabel={!!props.onPresentationChange}
                  label={item.label}
                  active={active}
                  onClick={() => props.onRunCommand(item.commandId)}
                >
                  <span aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                </RailButton>
              </Fragment>
            );
          })}
          {getVisibleCustomActivityBarItems(props.chromeState.activityBarItems).map((item) => (
            <RailButton
              nativeLabel={!!props.onPresentationChange}
              active={props.chromeState.activeViewId === item.id}
              key={item.id}
              label={item.label}
              onClick={() => props.onRunCommand(item.commandId)}
            >
              <CustomActivityIcon item={item} />
            </RailButton>
          ))}
        </div>
      </div>
      <div className="code-rail-settings">
        <RailButton
          nativeLabel={!!props.onPresentationChange}
          label="Open settings"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.settings)}
        >
          <SettingsIcon aria-hidden="true" className="size-5" />
        </RailButton>
      </div>
    </nav>
  );
}

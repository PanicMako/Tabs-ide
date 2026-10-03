import React, { useState, useRef, useEffect, memo } from "react";
import { ChevronDownIcon, ChevronUpIcon, HelpCircleIcon, SearchIcon } from "lucide-react";
import type {
  ProjectId,
  DesktopBrowserSessionState,
  TestingLocatorLibraryResult,
  TestingLocatorEntry,
  ModelSelection,
} from "@tabs/contracts";
import type { ProviderPickerKind } from "~/session-logic";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { clipTestingPreviewBounds } from "~/lib/testingPreviewBounds";
import {
  NATIVE_SURFACE_BLOCKING_OVERLAY_SELECTOR,
  shouldSuspendNativeSurfaceForOverlay,
  useNativeSurfaceOverlaySuspension,
} from "~/nativeSurfaceOverlay";

export const CODE_HOST_OVERLAY_SELECTOR = NATIVE_SURFACE_BLOCKING_OVERLAY_SELECTOR;

export function isSameWebUrl(
  urlA: string | null | undefined,
  urlB: string | null | undefined,
): boolean {
  if (!urlA || !urlB) return false;
  if (urlA === urlB) return true;
  try {
    const parsedA = new URL(urlA);
    const parsedB = new URL(urlB);
    return parsedA.origin === parsedB.origin && parsedA.pathname === parsedB.pathname;
  } catch {
    return false;
  }
}

export function createEmptyBrowserSessionState(
  projectId: ProjectId,
  sessionId = "browser",
): DesktopBrowserSessionState {
  return {
    projectId,
    sessionId,
    currentUrl: null,
    pageTitle: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devToolsOpen: false,
    zoomFactor: 1,
    audioMuted: false,
    pictureInPicture: false,
    colorScheme: "system",
    lastError: null,
    transientError: null,
  };
}

export function InfoTooltip(props: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1.5 inline-flex items-center text-muted-foreground/60 hover:text-foreground focus:outline-none transition-colors"
        aria-label="More information"
      >
        <HelpCircleIcon className="size-3.5" />
      </button>
      {open ? (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 w-64 rounded-xl border border-border/80 bg-popover p-2.5 text-xs font-normal leading-relaxed text-popover-foreground shadow-xl">
          {props.content}
        </span>
      ) : null}
    </span>
  );
}

export function NumberStepperInput(props: {
  id: string;
  value: string;
  onChange: (val: string) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}) {
  const step = props.step ?? 1;

  const handleStep = (dir: 1 | -1) => {
    const current = parseFloat(props.value) || 0;
    let next = current + dir * step;
    if (props.min !== undefined && next < props.min) next = props.min;
    if (props.max !== undefined && next > props.max) next = props.max;
    props.onChange(String(Number(next.toFixed(2))));
  };

  return (
    <div className="relative flex items-center">
      <Input
        id={props.id}
        type="number"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        aria-describedby={props.ariaDescribedBy}
        aria-invalid={props.ariaInvalid}
        className="pr-16 font-mono text-sm"
      />
      <div className="absolute right-1.5 flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5 border border-border/40">
        <button
          type="button"
          onClick={() => handleStep(-1)}
          disabled={props.disabled}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 transition-colors"
          aria-label="Decrease value"
        >
          <ChevronDownIcon className="size-3" />
        </button>
        <div className="h-3 w-px bg-border/40" />
        <button
          type="button"
          onClick={() => handleStep(1)}
          disabled={props.disabled}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 transition-colors"
          aria-label="Increase value"
        >
          <ChevronUpIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

export const TESTING_FUSION_PROVIDER_IDS: ReadonlyArray<ProviderPickerKind> = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "opencode",
  "kilo",
];

export function testingReasoningTierFromOptions(
  options: ModelSelection["options"],
): "low" | "medium" | "high" {
  const effort = options
    ?.find((option) => /reasoning|effort/iu.test(option.id))
    ?.value.toString()
    .toLocaleLowerCase();
  if (!effort || effort === "medium" || effort === "standard") return "medium";
  if (effort === "none" || effort === "minimal" || effort === "low") return "low";
  return "high";
}

export const TestingCaseLocatorPicker = memo(function TestingCaseLocatorPicker(props: {
  library: TestingLocatorLibraryResult | null;
  selectedIds: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const pages = (props.library?.pages ?? [])
    .map((page) => ({
      page,
      entries: page.entries.filter(
        (entry) =>
          entry.lifecycleStatus !== "archived" &&
          (!normalizedQuery ||
            page.name.toLocaleLowerCase().includes(normalizedQuery) ||
            entry.locatorKey.toLocaleLowerCase().includes(normalizedQuery) ||
            entry.semanticContext.toLocaleLowerCase().includes(normalizedQuery)),
      ),
    }))
    .filter(({ entries }) => entries.length > 0);

  const toggleEntries = (entryIds: ReadonlyArray<string>, selected: boolean) => {
    const next = new Set(props.selectedIds);
    for (const entryId of entryIds) {
      if (selected) next.add(entryId);
      else next.delete(entryId);
    }
    props.onChange(next);
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{props.label}</div>
          <p className="text-xs text-muted-foreground">
            Select any number of pages or individual locators for this case.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{props.selectedIds.size} selected</Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Done" : "Choose locators"}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        </div>
      </div>
      {open ? (
        <>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search locator pages or keys"
              aria-label={`Search ${props.label.toLocaleLowerCase()}`}
              className="pl-9"
            />
          </div>
          <div className="max-h-64 space-y-2 overflow-auto" aria-label={props.label}>
            {pages.map(({ page, entries }) => {
              const pageEntryIds = entries.map((entry) => entry.id);
              const selectedCount = pageEntryIds.filter((id) => props.selectedIds.has(id)).length;
              return (
                <div
                  key={page.id}
                  className="rounded-lg border border-border/60 bg-background/70 p-3"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={selectedCount === pageEntryIds.length && pageEntryIds.length > 0}
                      onCheckedChange={(checked) => toggleEntries(pageEntryIds, Boolean(checked))}
                      aria-label={`Use all locators from ${page.name}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{page.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {selectedCount}/{pageEntryIds.length}
                    </span>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entries.map((entry) => (
                      <label
                        key={entry.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                          props.selectedIds.has(entry.id)
                            ? "border-primary/30 bg-primary/10 text-foreground"
                            : "border-border/60 text-muted-foreground",
                        )}
                      >
                        <Checkbox
                          checked={props.selectedIds.has(entry.id)}
                          onCheckedChange={(checked) => toggleEntries([entry.id], Boolean(checked))}
                          aria-label={`Use locator ${entry.locatorKey}`}
                          className="size-3.5"
                        />
                        <span className="font-mono">{entry.locatorKey}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {pages.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No locator pages match this search. Capture locators in App & locators first.
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
});

export function TestingApplicationPreview(props: {
  projectId: ProjectId;
  targetUrl: string;
  sessionId: string;
  viewport: "desktop" | "tablet" | "mobile";
  onUrlChange?: (url: string) => void;
}) {
  const bridge = window.desktopBridge;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [sessionState, setSessionState] = useState<DesktopBrowserSessionState>(() =>
    createEmptyBrowserSessionState(props.projectId, props.sessionId),
  );
  const currentUrlRef = useRef<string | null>(null);
  const onUrlChangeRef = useRef(props.onUrlChange);
  onUrlChangeRef.current = props.onUrlChange;

  useEffect(() => {
    if (!bridge || !props.targetUrl) return;
    let disposed = false;
    void bridge
      .ensureBrowserSession({
        projectId: props.projectId,
        sessionId: props.sessionId,
        initialUrl: props.targetUrl,
      })
      .then(() =>
        bridge.activateBrowserSession({ projectId: props.projectId, sessionId: props.sessionId }),
      )
      .catch(() => undefined);
    const unsubscribe = bridge.onBrowserSessionState((nextState) => {
      if (
        disposed ||
        nextState.projectId !== props.projectId ||
        nextState.sessionId !== props.sessionId
      ) {
        return;
      }
      currentUrlRef.current = nextState.currentUrl;
      setSessionState(nextState);
      if (nextState.currentUrl) onUrlChangeRef.current?.(nextState.currentUrl);
    });
    return () => {
      disposed = true;
      unsubscribe();
      void bridge.hideBrowserSession().catch(() => undefined);
    };
  }, [bridge, props.projectId, props.sessionId]);

  useEffect(() => {
    if (!bridge || !props.targetUrl || isSameWebUrl(currentUrlRef.current, props.targetUrl)) {
      return;
    }
    void bridge
      .navigateBrowserSession({
        projectId: props.projectId,
        sessionId: props.sessionId,
        url: props.targetUrl,
      })
      .catch(() => undefined);
  }, [bridge, props.projectId, props.sessionId, props.targetUrl]);

  useEffect(() => {
    if (!bridge) return;
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    let lastSignature = "";
    const publish = () => {
      frame = 0;
      const cssZoom =
        (typeof document !== "undefined" && parseFloat(document.documentElement.style.zoom)) || 1;
      const rect = host.getBoundingClientRect();
      const scrollViewport = host.closest("main")?.getBoundingClientRect();
      const clipTop = Math.max(0, scrollViewport?.top ?? 0);
      const clipLeft = Math.max(0, scrollViewport?.left ?? 0);
      const clipRight = Math.min(window.innerWidth, scrollViewport?.right ?? window.innerWidth);
      const clipBottom = Math.min(window.innerHeight, scrollViewport?.bottom ?? window.innerHeight);
      const clipped = clipTestingPreviewBounds({
        host: rect,
        viewport: { left: clipLeft, top: clipTop, right: clipRight, bottom: clipBottom },
        zoom: cssZoom,
      });
      const bounds = {
        projectId: props.projectId,
        sessionId: props.sessionId,
        ...clipped,
      };
      const signature = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}:${bounds.visible}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      void bridge.setBrowserBounds(bounds).catch(() => undefined);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(publish);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    window.addEventListener("resize", schedule);
    window.addEventListener("tabs-zoom-change", schedule);
    document.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("tabs-zoom-change", schedule);
      document.removeEventListener("scroll", schedule, true);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      void bridge
        .setBrowserBounds({
          projectId: props.projectId,
          sessionId: props.sessionId,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false,
        })
        .catch(() => undefined);
    };
  }, [bridge, props.projectId, props.sessionId, props.viewport]);

  useNativeSurfaceOverlaySuspension({
    enabled: Boolean(bridge),
    surfaceReady: true,
    onSuspend: () => {
      void bridge?.hideBrowserSession().catch(() => undefined);
    },
    onResume: () => {
      void bridge
        ?.activateBrowserSession({ projectId: props.projectId, sessionId: props.sessionId })
        .catch(() => undefined);
    },
  });

  const viewportClass =
    props.viewport === "mobile"
      ? "mx-auto h-full w-[31.64%]"
      : props.viewport === "tablet"
        ? "mx-auto h-full w-3/4"
        : "h-full w-full";
  if (!bridge) {
    return (
      <iframe
        title="Testing application preview"
        src={props.targetUrl}
        className={cn("h-full min-h-0 rounded-lg border-0 bg-background", viewportClass)}
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
      />
    );
  }
  return (
    <div
      ref={hostRef}
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-lg bg-background",
        viewportClass,
      )}
      aria-label="Live Testing application preview"
    >
      {sessionState.loading ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      ) : null}
    </div>
  );
}

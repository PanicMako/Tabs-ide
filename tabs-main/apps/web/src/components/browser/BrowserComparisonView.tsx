import { useSettings } from "../../hooks/useSettings";
import type { DesktopPreviewScreenshotArtifact } from "@tabs/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  Columns2Icon,
  CopyIcon,
  ExternalLinkIcon,
  LaptopIcon,
  LayersIcon,
  Link2Icon,
  Link2OffIcon,
  RefreshCwIcon,
  Rows2Icon,
  SmartphoneIcon,
  TabletIcon,
  UserCheckIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";

export type ComparisonMode = "responsive" | "profiles" | "routes";

export interface ViewportPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  icon: "mobile" | "tablet" | "desktop";
}

export const COMPARISON_VIEWPORTS: readonly ViewportPreset[] = [
  { id: "mobile-sm", name: "iPhone SE", width: 375, height: 667, icon: "mobile" },
  { id: "mobile-md", name: "iPhone 14", width: 390, height: 844, icon: "mobile" },
  { id: "mobile-lg", name: "Pixel 7", width: 412, height: 915, icon: "mobile" },
  { id: "tablet-md", name: "iPad Mini", width: 768, height: 1024, icon: "tablet" },
  { id: "tablet-lg", name: "iPad Pro", width: 1024, height: 1366, icon: "tablet" },
  { id: "desktop-sm", name: "Laptop (1366)", width: 1366, height: 768, icon: "desktop" },
  { id: "desktop-md", name: "Desktop (1080p)", width: 1920, height: 1080, icon: "desktop" },
];

export interface BrowserComparisonViewProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sessionId?: string | undefined;
  primaryUrl: string;
  primaryProfileId?: string | undefined;
}

export function BrowserComparisonView({
  isOpen,
  onOpenChange,
  projectId,
  sessionId,
  primaryUrl,
  primaryProfileId = "current",
}: BrowserComparisonViewProps) {
  const bridge = window.desktopBridge;
  const comparisonId = useRef(crypto.randomUUID()).current;
  const paneA = useRef<HTMLDivElement>(null);
  const paneB = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const profiles = [
    { id: "current", label: "Source tab profile" },
    ...(settings.browserProfiles?.length
      ? settings.browserProfiles
      : [
          { id: "personal", label: "Personal" },
          { id: "work", label: "Work" },
        ]),
  ];
  const [error, setError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<DesktopPreviewScreenshotArtifact[]>([]);
  const [syncNavigation, setSyncNavigation] = useState(false);

  // Comparison State
  const [mode, setMode] = useState<ComparisonMode>("responsive");
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [syncScroll, setSyncScroll] = useState(true);

  // Pane A (Left/Top)
  const [urlA, setUrlA] = useState(primaryUrl);
  const [viewportA, setViewportA] = useState<ViewportPreset>(COMPARISON_VIEWPORTS[1]!); // iPhone 14
  const [profileA, setProfileA] = useState(primaryProfileId);

  // Pane B (Right/Bottom)
  const [urlB, setUrlB] = useState(primaryUrl);
  const [viewportB, setViewportB] = useState<ViewportPreset>(COMPARISON_VIEWPORTS[5]!); // Laptop
  const [profileB, setProfileB] = useState("work");

  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setUrlA(primaryUrl);
    setUrlB(primaryUrl);
    setCaptures([]);
    return () => {
      void bridge?.closeBrowserComparison({ projectId, comparisonId });
    };
  }, [isOpen, projectId, comparisonId, bridge]);

  useEffect(() => {
    if (!isOpen || !bridge) return;
    return bridge.onBrowserSessionState((state) => {
      if (state.projectId !== projectId || !state.currentUrl) return;
      if (state.sessionId === `comparison-${comparisonId}-a`) setUrlA(state.currentUrl);
      if (state.sessionId === `comparison-${comparisonId}-b`) setUrlB(state.currentUrl);
    });
  }, [isOpen, bridge, projectId, comparisonId]);

  useEffect(() => {
    if (!isOpen || !bridge) return;
    let alive = true;
    let last = "";
    const update = () => {
      if (!alive || !paneA.current || !paneB.current) return;
      const a = paneA.current.getBoundingClientRect(),
        b = paneB.current.getBoundingClientRect();
      if (a.width < 1 || b.width < 1 || a.height < 1 || b.height < 1) return;
      const bounds = (rect: DOMRect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      const input = {
        projectId,
        comparisonId,
        sourceSessionId: sessionId,
        syncNavigation,
        syncScroll,
        panes: [
          {
            url: urlA,
            profileId: profileA,
            viewport: { width: viewportA.width, height: viewportA.height },
            bounds: bounds(a),
          },
          {
            url: urlB,
            profileId: mode === "profiles" ? profileB : profileA,
            viewport: { width: viewportB.width, height: viewportB.height },
            bounds: bounds(b),
          },
        ] as const,
      };
      const signature = JSON.stringify(input);
      if (signature === last) return;
      last = signature;
      void bridge
        .configureBrowserComparison({ ...input, panes: [...input.panes] })
        .then(() => {
          if (alive) setError(null);
        })
        .catch((cause) => {
          if (alive)
            setError(cause instanceof Error ? cause.message : "Could not open comparison.");
        });
    };
    const observer = new ResizeObserver(update);
    if (paneA.current) observer.observe(paneA.current);
    if (paneB.current) observer.observe(paneB.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const timer = setInterval(update, 250);
    update();
    return () => {
      alive = false;
      observer.disconnect();
      clearInterval(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [
    isOpen,
    bridge,
    projectId,
    comparisonId,
    sessionId,
    urlA,
    urlB,
    profileA,
    profileB,
    viewportA,
    viewportB,
    syncScroll,
    syncNavigation,
    orientation,
    mode,
  ]);

  const swapPanes = useCallback(() => {
    setUrlA(urlB);
    setUrlB(urlA);
    setViewportA(viewportB);
    setViewportB(viewportA);
    setProfileA(profileB);
    setProfileB(profileA);
  }, [urlA, urlB, viewportA, viewportB, profileA, profileB]);

  const reloadBoth = useCallback(() => {
    void Promise.all(
      ["a", "b"].map((pane) =>
        bridge?.reloadBrowserSession({
          projectId,
          sessionId: `comparison-${comparisonId}-${pane}`,
        }),
      ),
    ).catch(() => setError("Could not reload comparison panes."));
    toastManager.add({
      type: "info",
      title: "Reloading comparison panes",
      description: "Both comparison views are refreshing.",
    });
  }, [bridge, projectId, comparisonId]);

  const captureComparison = useCallback(async () => {
    if (!bridge) return;
    setCapturing(true);
    try {
      const artifacts = await bridge.captureBrowserComparison({ projectId, comparisonId });
      setCaptures(artifacts);
      toastManager.add({
        type: "success",
        title: "Both comparison panes captured",
        description:
          "Two separate screenshots were saved. Use the pane controls to reveal or copy them.",
      });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Could not capture screenshot",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCapturing(false);
    }
  }, [bridge, projectId, comparisonId]);

  const renderIcon = (iconType: ViewportPreset["icon"]) => {
    switch (iconType) {
      case "mobile":
        return <SmartphoneIcon className="size-3" />;
      case "tablet":
        return <TabletIcon className="size-3" />;
      case "desktop":
        return <LaptopIcon className="size-3" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-6xl h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header toolbar */}
        <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <Columns2Icon className="size-4 text-foreground" />
            <DialogTitle className="text-sm font-semibold">
              Side-by-Side Browser Comparison
            </DialogTitle>
            <Badge variant="outline" className="text-[11px] capitalize">
              {mode}
            </Badge>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Mode selection buttons */}
            <div className="flex rounded-md border bg-background/50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode("responsive")}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  mode === "responsive"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <SmartphoneIcon className="size-3" />
                <span>Responsive</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("profiles")}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  mode === "profiles"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UsersIcon className="size-3" />
                <span>Multi-Profile</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("routes")}
                className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                  mode === "routes"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayersIcon className="size-3" />
                <span>Routes</span>
              </button>
            </div>

            {/* Split orientation */}
            <div className="flex rounded-md border bg-background/50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setOrientation("horizontal")}
                className={`p-1 rounded ${orientation === "horizontal" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Side-by-side (columns)"
              >
                <Columns2Icon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOrientation("vertical")}
                className={`p-1 rounded ${orientation === "vertical" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Stacked (rows)"
              >
                <Rows2Icon className="size-3.5" />
              </button>
            </div>

            <Button
              type="button"
              size="xs"
              variant={syncNavigation ? "secondary" : "outline"}
              onClick={() => setSyncNavigation(!syncNavigation)}
            >
              Sync navigation
            </Button>
            {/* Sync toggle */}
            <Button
              type="button"
              size="xs"
              variant={syncScroll ? "secondary" : "outline"}
              onClick={() => setSyncScroll(!syncScroll)}
              className="gap-1 text-xs"
              title="Synchronize scrolling between panes"
            >
              {syncScroll ? (
                <Link2Icon className="size-3 text-foreground" />
              ) : (
                <Link2OffIcon className="size-3" />
              )}
              <span>Sync scroll</span>
            </Button>

            {/* Reload button */}
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={reloadBoth}
              title="Refresh both panes"
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>

            {/* Capture button */}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={capturing}
              onClick={() => void captureComparison()}
              className="gap-1 text-xs"
            >
              <CameraIcon className="size-3.5" />
              <span>Snapshot</span>
            </Button>

            <DialogClose
              render={
                <Button type="button" size="icon-xs" variant="ghost">
                  <XIcon className="size-4" />
                </Button>
              }
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="px-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {captures.length > 0 && (
          <div className="flex gap-2 px-4">
            {captures.map((artifact, index) => (
              <Button
                key={artifact.id}
                size="xs"
                onClick={() => void bridge?.revealBrowserArtifact(artifact.path)}
              >
                Reveal Pane {index === 0 ? "A" : "B"} screenshot
              </Button>
            ))}
          </div>
        )}
        {/* Viewport comparison area */}
        <div
          className={`flex-1 min-h-0 grid gap-2 p-3 bg-muted/20 ${
            orientation === "horizontal" ? "grid-cols-2" : "grid-rows-2"
          }`}
        >
          {/* Pane A */}
          <div className="flex flex-col rounded-lg border bg-background overflow-hidden shadow-xs">
            <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/40 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold">
                  Pane A
                </Badge>
                {mode === "responsive" && (
                  <Select
                    value={viewportA.id}
                    onValueChange={(val) => {
                      const v = COMPARISON_VIEWPORTS.find((vp) => vp.id === val);
                      if (v) setViewportA(v);
                    }}
                  >
                    <SelectTrigger className="h-6 rounded border bg-background px-2 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {COMPARISON_VIEWPORTS.map((vp) => (
                        <SelectItem key={vp.id} value={vp.id}>
                          {vp.name} ({vp.width}x{vp.height})
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                )}
                {mode === "profiles" && (
                  <Select
                    value={profileA}
                    onValueChange={(val) => {
                      if (val) setProfileA(val);
                    }}
                  >
                    <SelectTrigger
                      aria-label="Profile for Pane A"
                      className="h-6 rounded border bg-background text-xs px-2"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span>
                  {viewportA.width}x{viewportA.height}
                </span>
              </div>
            </div>

            {/* Address bar for Pane A (editable in routes mode) */}
            {mode === "routes" && (
              <div className="border-b px-2 py-1">
                <Input
                  className="h-6 font-mono text-[11px]"
                  key={urlA}
                  defaultValue={urlA}
                  onBlur={(event) => setUrlA(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setUrlA(event.currentTarget.value);
                  }}
                  placeholder="URL for Pane A"
                />
              </div>
            )}

            {/* Preview Frame A */}
            <div className="flex-1 min-h-0 bg-muted/10 flex items-center justify-center p-2 overflow-auto">
              <div
                style={{
                  width: mode === "responsive" ? `${viewportA.width}px` : "100%",
                  height: mode === "responsive" ? `${viewportA.height}px` : "100%",
                  maxWidth: "100%",
                  maxHeight: "100%",
                }}
                className="relative rounded border bg-background shadow-xs overflow-hidden flex flex-col"
              >
                <div className="h-4 bg-muted/60 border-b flex items-center gap-1 px-2">
                  <span className="size-1.5 rounded-full bg-red-400" />
                  <span className="size-1.5 rounded-full bg-amber-400" />
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="ml-2 font-mono text-[9px] text-muted-foreground truncate">
                    {urlA}
                  </span>
                </div>
                <div
                  ref={paneA}
                  aria-label="Comparison Pane A"
                  className="w-full flex-1 min-h-0 border-0"
                />
              </div>
            </div>
          </div>

          {/* Pane B */}
          <div className="flex flex-col rounded-lg border bg-background overflow-hidden shadow-xs">
            <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/40 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold">
                  Pane B
                </Badge>
                {mode === "responsive" && (
                  <Select
                    value={viewportB.id}
                    onValueChange={(val) => {
                      const v = COMPARISON_VIEWPORTS.find((vp) => vp.id === val);
                      if (v) setViewportB(v);
                    }}
                  >
                    <SelectTrigger className="h-6 rounded border bg-background px-2 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {COMPARISON_VIEWPORTS.map((vp) => (
                        <SelectItem key={vp.id} value={vp.id}>
                          {vp.name} ({vp.width}x{vp.height})
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                )}
                {mode === "profiles" && (
                  <Select
                    value={profileB}
                    onValueChange={(val) => {
                      if (val) setProfileB(val);
                    }}
                  >
                    <SelectTrigger
                      aria-label="Profile for Pane B"
                      className="h-6 rounded border bg-background text-xs px-2"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span>
                  {viewportB.width}x{viewportB.height}
                </span>
              </div>
            </div>

            {/* Address bar for Pane B (editable in routes mode) */}
            {mode === "routes" && (
              <div className="border-b px-2 py-1">
                <Input
                  className="h-6 font-mono text-[11px]"
                  key={urlB}
                  defaultValue={urlB}
                  onBlur={(event) => setUrlB(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setUrlB(event.currentTarget.value);
                  }}
                  placeholder="URL for Pane B"
                />
              </div>
            )}

            {/* Preview Frame B */}
            <div className="flex-1 min-h-0 bg-muted/10 flex items-center justify-center p-2 overflow-auto">
              <div
                style={{
                  width: mode === "responsive" ? `${viewportB.width}px` : "100%",
                  height: mode === "responsive" ? `${viewportB.height}px` : "100%",
                  maxWidth: "100%",
                  maxHeight: "100%",
                }}
                className="relative rounded border bg-background shadow-xs overflow-hidden flex flex-col"
              >
                <div className="h-4 bg-muted/60 border-b flex items-center gap-1 px-2">
                  <span className="size-1.5 rounded-full bg-red-400" />
                  <span className="size-1.5 rounded-full bg-amber-400" />
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="ml-2 font-mono text-[9px] text-muted-foreground truncate">
                    {urlB}
                  </span>
                </div>
                <div
                  ref={paneB}
                  aria-label="Comparison Pane B"
                  className="w-full flex-1 min-h-0 border-0"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer controls & info */}
        <div className="flex items-center justify-between border-t px-4 py-2 bg-muted/30 text-xs shrink-0">
          <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
            <span>
              Mode: <strong>{mode}</strong>
            </span>
            <span>·</span>
            <span>
              {mode === "responsive"
                ? `Comparing ${viewportA.name} vs ${viewportB.name}`
                : mode === "profiles"
                  ? `Comparing profile "${profileA}" vs "${profileB}"`
                  : `Comparing routes side-by-side`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={swapPanes}
              className="text-xs"
            >
              Swap Panes
            </Button>
            <DialogClose
              render={
                <Button type="button" size="xs" variant="default">
                  Done
                </Button>
              }
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

import type {
  ThreadId,
  DesktopBrowserSessionState,
  PreviewAnnotationPayload,
} from "@tabs/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Code,
  ExternalLink,
  Globe,
  RotateCcw,
  Volume2,
  VolumeX,
  MoreHorizontal,
  MousePointer2,
  Radio,
  PictureInPicture2,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useProjectWorkspaceSettings } from "~/state/workspaceShell";
import { useNativeSurfaceOverlaySuspension } from "~/nativeSurfaceOverlay";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { toastManager } from "~/components/ui/toast";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  MenuRadioGroup,
  MenuRadioItem,
} from "~/components/ui/menu";
import { PreviewAnnotationEditor } from "~/components/PreviewAnnotationEditor";
import { BrowserComparisonView } from "~/components/browser/BrowserComparisonView";
import {
  isNativeBrowserRecordingActive,
  startNativeBrowserRecording,
  stopNativeBrowserRecording,
} from "~/components/NativePreviewAutomationHost";
import { PREVIEW_ANNOTATION_PICKED_EVENT } from "~/lib/previewAnnotation";
import { showCustomConfirm } from "~/lib/customConfirm";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { CompanionEmpty } from "./CompanionChrome";
import { CompanionBrowserSession, emptyBrowserState } from "./browserSession";

export const CompanionBrowserPanel = memo(function CompanionBrowserPanel({
  threadId,
  surface,
  scope,
}: {
  threadId?: ThreadId | null | undefined;
  surface: CompanionSurface;
  scope: string;
}) {
  const target = useActiveProjectTarget(threadId);
  const settings = useProjectWorkspaceSettings(target?.projectId ?? null);
  const bridge = window.desktopBridge;
  const sessionId = `agents-surface-${surface.id}`;
  const initialUrl = useRef(
    surface.url ?? settings?.browser.defaultUrl ?? "https://www.google.com",
  );
  const [state, setState] = useState<DesktopBrowserSessionState>(() =>
    emptyBrowserState(target?.projectId ?? "", sessionId),
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState(initialUrl.current || "https://www.google.com");
  const [annotation, setAnnotation] = useState<PreviewAnnotationPayload | null>(null);
  const [picking, setPicking] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [recording, setRecording] = useState(
    () => !!target && isNativeBrowserRecordingActive(target.projectId, sessionId),
  );
  const editing = useRef(false);
  const controller = useRef<CompanionBrowserSession | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const update = useCompanionSurfaceStore((store) => store.update);
  const command = useCallback((operation: () => Promise<unknown> | undefined) => {
    editing.current = false;
    setError(null);
    try {
      void operation()?.catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => {
    if (!bridge || !target) return;
    let disposed = false;
    const session = new CompanionBrowserSession(bridge, target.projectId, sessionId, (next) => {
      if (disposed) return;
      setState(next);
      if (next.currentUrl && !next.loading) {
        if (!editing.current) setAddress(next.currentUrl);
        update(scope, surface.id, { url: next.currentUrl, title: next.pageTitle ?? "Browser" });
      }
    });
    controller.current = session;
    void session
      .start(initialUrl.current || "https://www.google.com")
      .then(() => {
        if (!disposed) setReady(true);
      })
      .catch((failure: unknown) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      disposed = true;
      controller.current = null;
      session.dispose();
    };
  }, [bridge, target?.projectId, sessionId, scope, surface.id, update]);
  useLayoutEffect(() => {
    if (
      !bridge ||
      !ready ||
      error ||
      state.lastError ||
      state.transientError ||
      !target ||
      !host.current
    )
      return;
    const node = host.current;
    let frame = 0;
    let last = "";
    const publish = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const zoom = parseFloat(document.documentElement.style.zoom) || 1;
      const bounds = {
        projectId: target.projectId,
        sessionId,
        x: Math.round(rect.left * zoom),
        y: Math.round(rect.top * zoom),
        width: Math.round(rect.width * zoom),
        height: Math.round(rect.height * zoom),
        visible: rect.width > 0 && rect.height > 0,
      };
      const signature = JSON.stringify(bounds);
      if (last === signature) return;
      last = signature;
      void bridge.setBrowserBounds(bounds).catch((failure: unknown) => setError(String(failure)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(publish);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    window.addEventListener("resize", schedule);
    window.addEventListener("tabs-zoom-change", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      void bridge
        .setBrowserBounds({
          projectId: target.projectId,
          sessionId,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false,
        })
        .catch(() => undefined);
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("tabs-zoom-change", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [bridge, ready, error, state.lastError, state.transientError, target?.projectId, sessionId]);
  useNativeSurfaceOverlaySuspension({
    enabled: Boolean(bridge && ready),
    surfaceReady: ready && !error && !state.lastError && !state.transientError,
    onSuspend: () => {
      void bridge?.hideBrowserSession().catch(() => undefined);
    },
    onResume: () => {
      if (target)
        void bridge
          ?.activateBrowserSession({ projectId: target.projectId, sessionId })
          .catch(() => undefined);
    },
  });
  const args = { projectId: target?.projectId ?? "", sessionId };
  const external = async () => {
    const api = await environmentApi(target?.environmentId ?? null);
    await api.shell.openExternal(state.currentUrl ?? address);
  };
  if (!target)
    return (
      <CompanionEmpty kind="browser" title="Choose a project">
        Open a project to start browsing.
      </CompanionEmpty>
    );
  const failure = error ?? state.lastError ?? state.transientError;
  return (
    <div className="companion-workspace">
      <div className="companion-toolbar companion-browser-toolbar" aria-label="Browser navigation">
        <button
          type="button"
          className="companion-icon-button"
          aria-label="Back"
          disabled={!ready || !state.canGoBack}
          onClick={() => command(() => controller.current?.back())}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className="companion-icon-button"
          aria-label="Forward"
          disabled={!ready || !state.canGoForward}
          onClick={() => command(() => controller.current?.forward())}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          className="companion-icon-button"
          aria-label="Reload page"
          disabled={!ready}
          onClick={() => command(() => bridge?.reloadBrowserSession(args))}
        >
          <RotateCcw
            size={15}
            className={state.loading ? "animate-spin motion-reduce:animate-none" : ""}
          />
        </button>
        <form
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            command(() => controller.current?.navigate(address));
          }}
        >
          <Globe size={13} className="shrink-0 text-muted-foreground" />
          <input
            aria-label="Browser URL"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
            value={address}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
            }}
            onChange={(event) => setAddress(event.target.value)}
          />
          <button type="submit" className="text-muted-foreground" aria-label="Navigate to address">
            <ArrowRight size={14} />
          </button>
        </form>
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="companion-icon-button"
                aria-label="Browser tools"
                disabled={!ready}
              >
                <MoreHorizontal size={16} />
              </button>
            }
          />
          <MenuPopup align="end" className="w-64">
            <div className="flex flex-col gap-2 border-b border-border px-2 py-2 text-xs text-muted-foreground">
              <MenuRadioGroup
                className="flex gap-1"
                aria-label="Preview width"
                value={String(surface.viewportWidth ?? 0)}
                onValueChange={(value) =>
                  update(scope, surface.id, { viewportWidth: Number(value) })
                }
              >
                {[
                  { label: "Fit", width: 0 },
                  { label: "Mobile", width: 390 },
                  { label: "Tablet", width: 768 },
                ].map(({ label, width }) => (
                  <MenuRadioItem
                    key={label}
                    value={String(width)}
                    className="min-w-0 flex-1 grid-cols-[0.75rem_1fr] gap-1 rounded-lg px-1.5 py-1 text-xs sm:text-xs data-checked:bg-muted data-checked:text-foreground [&_svg]:size-3 sm:[&_svg]:size-3"
                  >
                    {label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Browser zoom and audio"
              >
                <MenuItem
                  aria-label="Zoom out"
                  className="companion-icon-button"
                  disabled={!ready || state.zoomFactor <= 0.3}
                  onClick={() =>
                    command(() =>
                      bridge?.setBrowserZoomFactor({
                        ...args,
                        zoomFactor: Math.max(0.25, state.zoomFactor - 0.1),
                      }),
                    )
                  }
                >
                  −
                </MenuItem>
                <MenuItem
                  aria-label="Reset browser zoom"
                  onClick={() =>
                    command(() => bridge?.setBrowserZoomFactor({ ...args, zoomFactor: 1 }))
                  }
                >
                  {Math.round(state.zoomFactor * 100)}%
                </MenuItem>
                <MenuItem
                  aria-label="Zoom in"
                  className="companion-icon-button"
                  disabled={!ready || state.zoomFactor >= 3}
                  onClick={() =>
                    command(() =>
                      bridge?.setBrowserZoomFactor({
                        ...args,
                        zoomFactor: Math.min(3, state.zoomFactor + 0.1),
                      }),
                    )
                  }
                >
                  +
                </MenuItem>
                <MenuItem
                  aria-label={state.audioMuted ? "Unmute page" : "Mute page"}
                  className="companion-icon-button"
                  disabled={!ready}
                  onClick={() =>
                    command(() =>
                      bridge?.setBrowserAudioMuted({ ...args, audioMuted: !state.audioMuted }),
                    )
                  }
                >
                  {state.audioMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </MenuItem>
              </div>
            </div>

            <MenuItem
              disabled={!ready || state.loading}
              onClick={() =>
                command(async () => {
                  if (!bridge) return;
                  const artifact = await bridge.captureBrowserScreenshot(args);
                  await bridge.revealBrowserArtifact(artifact.path);
                  toastManager.add({ type: "success", title: "Screenshot saved" });
                })
              }
            >
              <Camera size={15} /> Save screenshot
            </MenuItem>
            <MenuItem onClick={() => command(external)}>
              <ExternalLink size={15} /> Open in external browser
            </MenuItem>
            <MenuItem onClick={() => command(() => bridge?.toggleBrowserDevTools(args))}>
              <Code size={15} />
              {state.devToolsOpen ? "Close developer tools" : "Developer tools"}
            </MenuItem>
            <MenuItem
              disabled={picking || !target.threadId}
              onClick={() =>
                command(async () => {
                  if (!bridge) return;
                  setPicking(true);
                  try {
                    setAnnotation(await bridge.pickBrowserElement(args));
                  } finally {
                    setPicking(false);
                  }
                })
              }
            >
              <MousePointer2 size={15} />
              Annotate an element
            </MenuItem>
            <MenuItem
              onClick={() =>
                command(async () => {
                  if (!bridge) return;
                  if (isNativeBrowserRecordingActive(target.projectId, sessionId)) {
                    const artifact = await stopNativeBrowserRecording(
                      bridge,
                      target.projectId,
                      sessionId,
                    );
                    setRecording(false);
                    toastManager.add({
                      type: "success",
                      title: "Recording saved",
                      description: artifact.path,
                      actionProps: {
                        children: "Show file",
                        onClick: () => {
                          void bridge.revealBrowserArtifact(artifact.path);
                        },
                      },
                    });
                  } else {
                    await startNativeBrowserRecording(bridge, target.projectId, sessionId);
                    setRecording(true);
                  }
                })
              }
            >
              <Radio size={15} />
              {recording ? "Stop and save recording" : "Record page"}
            </MenuItem>
            <MenuItem
              onClick={() =>
                command(() =>
                  state.pictureInPicture
                    ? bridge?.closeBrowserPictureInPicture(args)
                    : bridge?.openBrowserPictureInPicture(args),
                )
              }
            >
              <PictureInPicture2 size={15} />
              {state.pictureInPicture ? "Close floating preview" : "Floating preview"}
            </MenuItem>
            <MenuItem onClick={() => setComparing(true)}>Compare pages</MenuItem>
            <MenuItem
              onClick={() =>
                command(() =>
                  bridge?.setBrowserColorScheme({
                    ...args,
                    colorScheme: state.colorScheme === "dark" ? "light" : "dark",
                  }),
                )
              }
            >
              Page appearance: {state.colorScheme}
            </MenuItem>
            <MenuItem
              onClick={() =>
                command(async () => {
                  if (
                    await showCustomConfirm(
                      "Clear this browser profile’s cookies, cache, and site storage?",
                    )
                  )
                    await bridge?.clearBrowserSessionData(args);
                })
              }
            >
              Clear browsing data
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="companion-browser-host">
        <div
          ref={host}
          className="absolute inset-y-0 left-1/2 -translate-x-1/2"
          style={{
            width: surface.viewportWidth ? `${surface.viewportWidth}px` : "100%",
            maxWidth: "100%",
          }}
        />
        {!bridge ? (
          <CompanionEmpty kind="browser" title="Desktop browser required">
            Open this page in the Tabs desktop app or your external browser.
          </CompanionEmpty>
        ) : failure ? (
          <div className="relative z-20 flex h-full flex-col items-center justify-center bg-background p-6">
            <CompanionEmpty kind="browser" title="Couldn’t load this page">
              {failure}
            </CompanionEmpty>
            <Button
              onClick={() =>
                command(() =>
                  ready
                    ? bridge.reloadBrowserSession(args)
                    : controller.current?.start(address).then(() => setReady(true)),
                )
              }
            >
              Retry
            </Button>
          </div>
        ) : !ready ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Starting browser...
          </p>
        ) : null}
      </div>
      {state.controller === "agent" && (
        <div className="companion-note flex items-center gap-2">
          <span className="flex-1">Agent is using this page</span>
          <Button size="xs" onClick={() => command(() => bridge?.takeBrowserControl?.(args))}>
            Take control
          </Button>
        </div>
      )}
      {state.controller === "human" && state.assignedTaskId && (
        <div className="companion-note flex items-center gap-2">
          <span className="flex-1">You’re controlling this page</span>
          <Button
            size="xs"
            onClick={() =>
              command(() =>
                bridge?.resumeBrowserAgent?.({ ...args, taskId: state.assignedTaskId! }),
              )
            }
          >
            Return to agent
          </Button>
        </div>
      )}
      {annotation && (
        <PreviewAnnotationEditor
          key={annotation.id}
          annotation={annotation}
          onCancel={() => setAnnotation(null)}
          onAttach={(next) => {
            window.dispatchEvent(
              new CustomEvent(PREVIEW_ANNOTATION_PICKED_EVENT, {
                detail: { projectId: target.projectId, annotation: next },
              }),
            );
            setAnnotation(null);
            toastManager.add({ type: "success", title: "Element attached to composer" });
          }}
        />
      )}
      {comparing && (
        <BrowserComparisonView
          isOpen={comparing}
          onOpenChange={setComparing}
          projectId={target.projectId}
          sessionId={sessionId}
          primaryUrl={state.currentUrl ?? address}
          primaryProfileId={state.profileId}
        />
      )}
      {state.pendingPermission && (
        <div role="alert" className="companion-note flex items-center gap-3">
          <span className="flex-1">
            {state.pendingPermission.origin} requests {state.pendingPermission.permission}.
          </span>
          {[true, false].map((granted) => (
            <Button
              key={String(granted)}
              size="xs"
              onClick={() =>
                command(() =>
                  bridge?.respondBrowserPermission?.({
                    requestId: state.pendingPermission!.requestId,
                    granted,
                    remember: true,
                  }),
                )
              }
            >
              {granted ? "Allow" : "Block"}
            </Button>
          ))}
        </div>
      )}
      <footer className="companion-browser-status">
        <i />
        {recording && <span className="text-destructive">● Recording</span>}
        <span>{state.loading ? "Loading page" : state.pageTitle || "Ready"}</span>
        <span className="ml-auto">
          {surface.viewportWidth ? `${surface.viewportWidth}px` : "Fit to panel"}
        </span>
      </footer>
    </div>
  );
});

import type {
  EnvironmentId,
  ThreadId,
  DeviceComparisonFrame,
  DeviceComparisonReport,
  DesktopBrowserSessionState,
  PreviewAnnotationPayload,
} from "@tabs/contracts";
import { BrowserFindBar } from "./BrowserFindBar";
import { PREVIEW_FIND_EVENT } from "~/lib/previewFind";
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
  TextSelect,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addSurfaceFileToDraft,
  browserExcerptAttachmentFile,
  comparisonScreenshotAttachmentFile,
  rememberBrowserAttachment,
  surfaceAttachmentFile,
  surfaceScope,
  type SurfaceLocation,
} from "~/lib/threadSurfaceAttachment";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useSettings } from "~/hooks/useSettings";
import { browserDefaultsToApply, newTabProfileId } from "./browserDefaults";
import { useProjectWorkspaceSettings, useWorkspaceActiveProjectId } from "~/state/workspaceShell";
import { useAtomValue } from "@effect/atom-react";
import { projectsAtom, threadsAtom } from "~/state/threads";
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
import { BrowserHandoffControls } from "~/components/browser/BrowserHandoffControls";
import { BrowserComparisonView } from "~/components/browser/BrowserComparisonView";
import {
  BrowserSelectionReview,
  type BrowserSelectionResult,
} from "~/components/browser/BrowserSelectionReview";
import {
  isNativeBrowserRecordingActive,
  startNativeBrowserRecording,
  stopNativeBrowserRecording,
} from "~/components/NativePreviewAutomationHost";
import { BROWSER_SELECTION_MAX_LENGTH } from "@tabs/shared/preview";
import { PREVIEW_ANNOTATION_PICKED_EVENT } from "~/lib/previewAnnotation";
import {
  BROWSER_SELECTION_DROP_EVENT,
  BROWSER_SELECTION_REVIEW_EVENT,
  isBrowserSelectionDrag,
  type BrowserSelectionDrag,
  type BrowserSelectionDrop,
  type BrowserSelectionReviewTarget,
} from "~/lib/browserSelectionDrag";
import { showCustomConfirm } from "~/lib/customConfirm";
import { environmentApi, isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { CompanionEmpty } from "./CompanionChrome";
import { CompanionBrowserSession, emptyBrowserState } from "./browserSession";
import { BrowserStartPage } from "./BrowserStartPage";
import { displayAddress, resolveOmniboxInput } from "./browserOmnibox";

interface BrowserSelectionRequest {
  location: SurfaceLocation;
  page: {
    sessionId: string;
    url: string;
    pageRef: string;
    instanceId: string;
    profileId: string;
    controlEpoch: number | undefined;
  };
  selection: Promise<BrowserSelectionResult>;
}

interface ComparisonScreenshotPair {
  runId: string;
  step: number;
  source: DeviceComparisonReport["source"];
  target: DeviceComparisonReport["source"];
}

function isOpenComparisonDevice(
  surfaces: readonly CompanionSurface[] | undefined,
  { hostId, deviceId }: { hostId: string; deviceId: string },
) {
  return surfaces?.some(
    (tab) =>
      tab.kind === "device" && (tab.hostId ?? "local") === hostId && tab.deviceId === deviceId,
  );
}

function matchesSelectionPage(state: DesktopBrowserSessionState, request: BrowserSelectionRequest) {
  const { location, page } = request;
  return (
    state.projectId === location.projectId &&
    state.sessionId === page.sessionId &&
    state.currentUrl === page.url &&
    state.pageRef === page.pageRef &&
    state.instanceId === page.instanceId &&
    (state.profileId ?? "default") === page.profileId &&
    state.controlEpoch === page.controlEpoch &&
    (!state.assignedTaskId || state.assignedTaskId === location.threadId) &&
    state.controller !== "agent" &&
    !state.loading &&
    !state.resting &&
    !state.lastError &&
    !state.transientError
  );
}

export const CompanionBrowserPanel = memo(function CompanionBrowserPanel({
  threadId,
  environmentId: panelEnvironmentId,
  surface,
  scope,
}: {
  threadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
  surface: CompanionSurface;
  scope: string;
}) {
  const threadTarget = useActiveProjectTarget(threadId, panelEnvironmentId);
  // When no thread-specific target is found (e.g. new-thread view) but the
  // surface has an external URL (e.g. a PR link), fall back to the globally
  // active project so we can still spin up a BrowserView.
  const fallbackProjectId = useWorkspaceActiveProjectId();
  const allProjects = useAtomValue(projectsAtom);
  const fallbackProject =
    !threadTarget && surface.url && fallbackProjectId
      ? allProjects.find((p) => p.id === fallbackProjectId)
      : undefined;
  const target =
    threadTarget ??
    (fallbackProject
      ? {
          environmentId: fallbackProject.environmentId ?? null,
          projectId: fallbackProject.id,
          cwd: fallbackProject.cwd,
          projectCwd: fallbackProject.cwd,
          projectName: fallbackProject.name,
          threadId: null,
        }
      : null);
  const settings = useProjectWorkspaceSettings(target?.projectId ?? null);
  const bridge = window.desktopBridge;
  const sessionId = `agents-surface-${surface.id}`;
  const initialUrl = useRef(
    surface.url ?? settings?.browser.defaultUrl ?? "https://www.google.com",
  );
  // Only a tab that had no page when it appeared starts with the default zoom and appearance;
  // a restored tab keeps whatever it already had.
  const startedAsNewTab = useRef(!surface.url);
  const defaultZoom = useSettings((s) => s.browserDefaultZoomFactor);
  const defaultAppearance = useSettings((s) => s.browserDefaultAppearance);
  const defaultProfileId = useSettings((s) => s.browserDefaultProfileId);
  const savedProfiles = useSettings((s) => s.browserProfiles);
  const browserDefaults = useRef({
    zoom: defaultZoom,
    appearance: defaultAppearance,
    profileId: defaultProfileId,
    profileIds: savedProfiles.map((profile) => profile.id),
  });
  browserDefaults.current = {
    zoom: defaultZoom,
    appearance: defaultAppearance,
    profileId: defaultProfileId,
    profileIds: savedProfiles.map((profile) => profile.id),
  };
  const [state, setState] = useState<DesktopBrowserSessionState>(() =>
    emptyBrowserState(target?.projectId ?? "", sessionId),
  );
  // A new tab opens on a start page instead of loading a default site.
  const [started, setStarted] = useState(() => Boolean(surface.url));
  const [addressFocused, setAddressFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState(initialUrl.current || "https://www.google.com");
  const [annotation, setAnnotation] = useState<PreviewAnnotationPayload | null>(null);
  const [picking, setPicking] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findTick, setFindTick] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [recording, setRecording] = useState(
    () => !!target && isNativeBrowserRecordingActive(target.projectId, sessionId),
  );
  const ownerTitle = useAtomValue(
    threadsAtom,
    (threads) =>
      threads.find(
        (thread) =>
          thread.id === state.assignedTaskId &&
          thread.projectId === target?.projectId &&
          (thread.environmentId ?? null) === target?.environmentId,
      )?.title,
  );
  const editing = useRef(false);
  const controller = useRef<CompanionBrowserSession | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const surfaces = useCompanionSurfaceStore((store) => store.workspaces[scope]?.tabs);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const [selectionReview, setSelectionReview] = useState<BrowserSelectionRequest | null>(null);
  const selectionRequest = useRef<BrowserSelectionRequest | null>(null);
  const closeSelectionReview = useCallback(() => {
    selectionRequest.current = null;
    setSelectionReview(null);
  }, []);
  const [comparisonResults, setComparisonResults] = useState<{
    scope: string;
    threadId: ThreadId;
    runs: DeviceComparisonReport[];
    pairs: ComparisonScreenshotPair[];
  }>();
  const environmentId = target?.environmentId;
  useEffect(() => {
    if (!toolsOpen || !threadId || !isPrimaryEnvironment(environmentId ?? undefined)) return;
    let current = true;
    const load = async () => {
      try {
        const { device } = await environmentApi(environmentId ?? null);
        if (!current || !device?.comparison) return;
        const reports = await Promise.all([
          device
            .comparison({ action: "status", threadId })
            .then(({ run }) => run)
            .catch(() => undefined),
          ...(surfaces ?? []).flatMap((tab) => {
            const ref = tab.kind === "device" ? tab.deviceComparisonResult : undefined;
            if (ref?.step === undefined) return [];
            return [
              device
                .comparison({ action: "status", threadId, runId: ref.runId })
                .then(({ run }) =>
                  run?.runId === ref.runId && run.firstDifference?.step === ref.step
                    ? run
                    : undefined,
                )
                .catch(() => undefined),
            ];
          }),
        ]);
        if (!current) return;
        const comparisons = new Map<string, DeviceComparisonReport>();
        for (const run of reports) {
          if (run?.firstDifference && !run.busy && !comparisons.has(run.runId))
            comparisons.set(run.runId, run);
        }
        const runs = [...comparisons.values()];
        setComparisonResults({ scope, threadId, runs, pairs: [] });

        const pairs = await Promise.all(
          runs.map(async (report): Promise<ComparisonScreenshotPair | undefined> => {
            const { runId, source, target, firstDifference } = report;
            if (!target || !firstDifference) return;
            if (source.hostId === target.hostId && source.deviceId === target.deviceId) return;
            if (
              !report.savedAt &&
              ![source, target].every((device) => isOpenComparisonDevice(surfaces, device))
            )
              return;
            if (report.availableEvidence) {
              return report.availableEvidence.source && report.availableEvidence.target
                ? { runId, step: firstDifference.step, source, target }
                : undefined;
            }
            const response = await device
              .comparison({ action: "evidence", threadId, runId })
              .catch(() => undefined);
            const run = response?.run;
            if (
              run?.runId === runId &&
              run.firstDifference?.step === firstDifference.step &&
              !run.busy &&
              run.source.hostId === source.hostId &&
              run.source.deviceId === source.deviceId &&
              run.target?.hostId === target.hostId &&
              run.target.deviceId === target.deviceId &&
              response?.evidence?.sourcePng &&
              response.evidence.targetPng
            ) {
              return { runId, step: firstDifference.step, source: run.source, target: run.target };
            }
          }),
        );
        if (current)
          setComparisonResults({ scope, threadId, runs, pairs: pairs.filter((pair) => !!pair) });
      } catch {
        if (current) setComparisonResults(undefined);
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, [toolsOpen, threadId, environmentId, surfaces, scope]);
  const liveSources = (surfaces ?? []).flatMap((tab) =>
    tab.kind === "device" && tab.deviceId
      ? [
          {
            key: tab.id,
            deviceId: tab.deviceId,
            hostId: tab.hostId ?? "local",
            name: tab.title ?? tab.deviceId,
          },
        ]
      : [],
  );
  const screenshotSources: Array<
    (typeof liveSources)[number] & { frame?: DeviceComparisonFrame; runLabel?: string }
  > = [...liveSources];
  const availableComparisons =
    comparisonResults?.scope === scope && comparisonResults.threadId === threadId
      ? comparisonResults
      : undefined;
  const comparisonRuns = availableComparisons?.runs ?? [];
  const screenshotPairs = availableComparisons?.pairs ?? [];
  for (const comparison of comparisonRuns) {
    const step = comparison.firstDifference!.step;
    const runLabel =
      comparisonRuns.length > 1 ? ` · Run ${comparison.runId.slice(0, 8)}` : undefined;
    for (const side of ["source", "target"] as const) {
      const device = comparison[side];
      if (device && (comparison.savedAt || isOpenComparisonDevice(surfaces, device))) {
        screenshotSources.push({
          key: `${comparison.runId}:${side}`,
          deviceId: device.deviceId,
          hostId: device.hostId,
          name: device.name,
          frame: { runId: comparison.runId, step, side },
          ...(runLabel ? { runLabel } : {}),
        });
      }
    }
  }
  const restoredProfileId = useRef(surface.profileId);
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
    if (!bridge || !target || !started) return;
    let disposed = false;
    const session = new CompanionBrowserSession(bridge, target.projectId, sessionId, (next) => {
      if (disposed) return;
      if (selectionRequest.current && !matchesSelectionPage(next, selectionRequest.current))
        closeSelectionReview();
      setState(next);
      if (next.currentUrl && !next.loading) {
        if (!editing.current) setAddress(next.currentUrl);
        update(scope, surface.id, {
          url: next.currentUrl,
          title: next.pageTitle ?? "Browser",
          profileId: next.profileId,
          pageRef: next.pageRef,
          browserInstanceId: next.instanceId,
        });
      }
    });
    controller.current = session;
    void session
      .start(initialUrl.current || "https://www.google.com", {
        profileId:
          restoredProfileId.current ??
          newTabProfileId({
            isNewTab: startedAsNewTab.current,
            defaultProfileId: browserDefaults.current.profileId,
            profileIds: browserDefaults.current.profileIds,
          }),
      })
      .then(() => {
        if (disposed) return;
        const defaults = browserDefaultsToApply({
          isNewTab: startedAsNewTab.current,
          zoomFactor: browserDefaults.current.zoom,
          appearance: browserDefaults.current.appearance,
        });
        startedAsNewTab.current = false;
        const control = { projectId: target.projectId, sessionId };
        if (defaults.zoomFactor !== undefined) {
          void bridge
            .setBrowserZoomFactor({ ...control, zoomFactor: defaults.zoomFactor })
            .catch(() => undefined);
        }
        if (defaults.colorScheme !== undefined) {
          void bridge
            .setBrowserColorScheme({ ...control, colorScheme: defaults.colorScheme })
            .catch(() => undefined);
        }
        setReady(true);
      })
      .catch((failure: unknown) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      disposed = true;
      controller.current = null;
      if (selectionRequest.current) closeSelectionReview();
      session.dispose();
    };
  }, [
    bridge,
    target?.projectId,
    sessionId,
    scope,
    surface.id,
    update,
    started,
    closeSelectionReview,
  ]);
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
  const selectionLocation =
    threadId && target && isPrimaryEnvironment(target.environmentId ?? undefined)
      ? { environmentId: target.environmentId, projectId: target.projectId, threadId }
      : null;
  async function confirmInSelectedTab(message: string) {
    const session = controller.current;
    const isSelected = () =>
      session !== null &&
      session === controller.current &&
      host.current !== null &&
      useCompanionSurfaceStore.getState().workspaces[scope]?.activeId === surface.id;
    return isSelected() && (await showCustomConfirm(message)) && isSelected();
  }
  async function attachComparisonScreenshotPair(pair: ComparisonScreenshotPair) {
    if (!bridge || !selectionLocation) return;
    const location = selectionLocation;
    const { currentUrl: url, pageRef, instanceId, pageApprovalToken } = state;
    if (!url || !pageRef || !instanceId || state.loading)
      throw new Error("Wait for the destination page to finish loading.");
    const profileId = state.profileId ?? "default";
    const profile = savedProfiles.find((item) => item.id === profileId)?.label ?? profileId;
    const destination = new URL(url);
    const { runId, step, source, target } = pair;
    if (
      !(await confirmInSelectedTab(
        `Allow this thread to use this tab to attach both first-difference screenshots and verify the draft at ${destination.origin}${destination.pathname} in the ${profile} profile? Run ${runId}, step ${step}. The source is ${source.name} (${source.hostId} / ${source.deviceId}). The target is ${target.name} (${target.hostId} / ${target.deviceId}).`,
      ))
    )
      return;
    const frames = [
      { hostId: source.hostId, deviceId: source.deviceId, frame: { runId, step, side: "source" } },
      { hostId: target.hostId, deviceId: target.deviceId, frame: { runId, step, side: "target" } },
    ] as const;
    const request = { ...args, source: "human", taskId: location.threadId } as const;
    const result = await bridge.runBrowserAutomation({
      ...request,
      operation: "authorizeDeviceScreenshotPair",
      input: {
        url,
        profileId,
        instanceId,
        frames,
        ...(pageApprovalToken !== undefined ? { pageApprovalToken } : {}),
      },
    });
    if (
      !result ||
      typeof result !== "object" ||
      !("grantIds" in result) ||
      !Array.isArray(result.grantIds) ||
      result.grantIds.length !== 2
    )
      throw new Error("The desktop did not approve both screenshots.");
    const [sourceGrantId, targetGrantId] = result.grantIds;
    if (typeof sourceGrantId !== "string" || typeof targetGrantId !== "string")
      throw new Error("The desktop did not approve both screenshots.");
    try {
      const file = comparisonScreenshotAttachmentFile(
        location,
        { ...surface, url, profileId, pageRef, browserInstanceId: instanceId },
        {
          source: { ...frames[0], grantId: sourceGrantId },
          target: { ...frames[1], grantId: targetGrantId },
        },
      );
      if (!file) throw new Error("Reopen the destination tab and select the screenshots again.");
      addSurfaceFileToDraft(location, file);
    } catch (failure) {
      await bridge.runBrowserAutomation({
        ...request,
        operation: "revokeDeviceScreenshot",
        input: { grantIds: [sourceGrantId, targetGrantId] },
      });
      throw failure;
    }
    toastManager.add({ type: "success", title: "First-difference screenshots added to composer" });
  }
  const canReviewSelection = Boolean(
    bridge &&
    selectionLocation &&
    scope === surfaceScope(selectionLocation) &&
    ready &&
    state.projectId === args.projectId &&
    state.sessionId === sessionId &&
    !error &&
    !state.loading &&
    !state.resting &&
    !state.lastError &&
    !state.transientError &&
    state.currentUrl &&
    state.pageRef &&
    state.instanceId,
  );
  const reviewBrowserSelection = useCallback(
    (drag?: BrowserSelectionDrag) => {
      const { currentUrl: url, pageRef, instanceId, controlEpoch } = state;
      if (
        selectionRequest.current ||
        !canReviewSelection ||
        !bridge ||
        !selectionLocation ||
        !url ||
        !pageRef ||
        !instanceId
      )
        return;
      const profileId = state.profileId ?? "default";
      const read = async (): Promise<BrowserSelectionResult> => {
        try {
          const result = await bridge.runBrowserAutomation({
            projectId: selectionLocation.projectId,
            sessionId,
            source: "human",
            taskId: selectionLocation.threadId,
            operation: "readBrowserSelection",
            input: { pageRef, instanceId, profileId, ...drag },
          });
          if (
            !result ||
            typeof result !== "object" ||
            !("text" in result) ||
            typeof result.text !== "string" ||
            !result.text.trim() ||
            result.text.length > BROWSER_SELECTION_MAX_LENGTH
          )
            return { error: "Select up to 1,000 characters of page text and try again." };
          return { text: result.text };
        } catch (failure) {
          return {
            error:
              failure instanceof Error ? failure.message : "Could not read the browser selection.",
          };
        }
      };
      const request = {
        location: selectionLocation,
        page: { sessionId, url, pageRef, instanceId, profileId, controlEpoch },
        selection: read(),
      };
      selectionRequest.current = request;
      setSelectionReview(request);
    },
    [bridge, canReviewSelection, selectionLocation, sessionId, state],
  );
  useLayoutEffect(() => {
    if (!canReviewSelection || !selectionLocation) return;
    const isActiveTarget = (location?: SurfaceLocation) =>
      !!location &&
      location.environmentId === selectionLocation.environmentId &&
      location.projectId === selectionLocation.projectId &&
      location.threadId === selectionLocation.threadId &&
      useCompanionSurfaceStore.getState().workspaces[scope]?.activeId === surface.id &&
      Boolean(host.current?.offsetParent);
    const onDrop = (event: Event) => {
      const { detail } = event as CustomEvent<BrowserSelectionDrop>;
      if (!detail || !isActiveTarget(detail.location) || !isBrowserSelectionDrag(detail)) return;
      reviewBrowserSelection({ dragToken: detail.dragToken, droppedText: detail.droppedText });
    };
    const onReview = (event: Event) => {
      const { detail } = event as CustomEvent<BrowserSelectionReviewTarget>;
      if (detail?.sessionId !== sessionId || !isActiveTarget(detail.location)) return;
      event.preventDefault();
      reviewBrowserSelection();
    };
    window.addEventListener(BROWSER_SELECTION_DROP_EVENT, onDrop);
    window.addEventListener(BROWSER_SELECTION_REVIEW_EVENT, onReview);
    return () => {
      window.removeEventListener(BROWSER_SELECTION_DROP_EVENT, onDrop);
      window.removeEventListener(BROWSER_SELECTION_REVIEW_EVENT, onReview);
    };
  }, [canReviewSelection, reviewBrowserSelection, scope, selectionLocation, sessionId, surface.id]);
  async function addBrowserSelection(text: string, isOpen: () => boolean) {
    if (!selectionReview || !bridge) return;
    const { location, page } = selectionReview;
    const isCurrent = () =>
      isOpen() &&
      selectionRequest.current === selectionReview &&
      isPrimaryEnvironment(location.environmentId ?? undefined) &&
      useCompanionSurfaceStore.getState().workspaces[scope]?.activeId === surface.id;
    if (!isCurrent()) return;
    const latest = await bridge.getBrowserSessionState({
      projectId: location.projectId,
      sessionId: page.sessionId,
    });
    if (!isCurrent()) return;
    if (!matchesSelectionPage(latest, selectionReview))
      throw new Error("The browser tab, page or profile changed. Select the text again.");
    const file = browserExcerptAttachmentFile(
      location,
      {
        ...surface,
        url: page.url,
        pageRef: page.pageRef,
        profileId: page.profileId,
        browserInstanceId: page.instanceId,
      },
      text,
    );
    if (!file) throw new Error("Reopen the browser tab and select the text again.");
    const attachment = await rememberBrowserAttachment(location, file);
    if (!isCurrent()) return;
    addSurfaceFileToDraft(location, attachment);
    toastManager.add({ type: "success", title: "Browser excerpt added to composer" });
  }
  const closeFind = () => {
    setFindOpen(false);
    void bridge?.stopFindInBrowser?.(args);
  };
  // Cmd/Ctrl+Alt+F asks the browser tab that is on screen to open its find bar.
  useEffect(() => {
    const open = () => {
      if (!host.current || host.current.offsetParent === null) return;
      setFindOpen(true);
      setFindTick((tick) => tick + 1);
    };
    window.addEventListener(PREVIEW_FIND_EVENT, open);
    return () => window.removeEventListener(PREVIEW_FIND_EVENT, open);
  }, []);
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
  if (!started)
    return (
      <div className="companion-workspace">
        <BrowserStartPage
          surfaceId={surface.id}
          projectName={target.projectName}
          homeUrl={settings?.browser.defaultUrl}
          onStart={(url) => {
            initialUrl.current = url;
            setAddress(url);
            update(scope, surface.id, { url });
            setStarted(true);
          }}
        />
      </div>
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
            command(() => controller.current?.navigate(resolveOmniboxInput(address)));
          }}
        >
          <Globe size={13} className="shrink-0 text-muted-foreground" />
          <input
            aria-label="Browser URL"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
            value={addressFocused ? address : displayAddress(address)}
            onFocus={(event) => {
              editing.current = true;
              setAddressFocused(true);
              const input = event.currentTarget;
              requestAnimationFrame(() => input.select());
            }}
            onBlur={() => {
              editing.current = false;
              setAddressFocused(false);
            }}
            onChange={(event) => setAddress(event.target.value)}
          />
          <button type="submit" className="text-muted-foreground" aria-label="Navigate to address">
            <ArrowRight size={14} />
          </button>
        </form>
        <Menu
          onOpenChange={(open) => {
            setToolsOpen(open);
            if (!open) setComparisonResults(undefined);
          }}
        >
          <MenuTrigger
            render={
              <button
                ref={toolsTrigger}
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
            {selectionLocation && bridge && (
              <MenuItem disabled={!canReviewSelection} onClick={() => reviewBrowserSelection()}>
                <TextSelect size={15} />
                <span>Review browser selection</span>
              </MenuItem>
            )}
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
            {ready &&
              bridge &&
              threadId &&
              isPrimaryEnvironment(target.environmentId ?? undefined) && (
                <MenuItem
                  onClick={() =>
                    command(async () => {
                      if (state.browserPageAuthorized) {
                        await bridge.runBrowserAutomation({
                          ...args,
                          source: "human",
                          taskId: threadId,
                          operation: "revokeBrowserPage",
                        });
                        return;
                      }
                      const { currentUrl: url, instanceId, pageApprovalToken } = state;
                      if (!url) return;
                      const profileId = state.profileId ?? "default";
                      const profile =
                        savedProfiles.find((item) => item.id === profileId)?.label ?? profileId;
                      const page = new URL(url);
                      if (
                        !(await confirmInSelectedTab(
                          `Allow this thread to use ${page.origin}${page.pathname} in the ${profile} profile?`,
                        ))
                      )
                        return;
                      await bridge.runBrowserAutomation({
                        ...args,
                        source: "human",
                        taskId: threadId,
                        operation: "authorizeBrowserPage",
                        input: {
                          profileId,
                          url,
                          instanceId,
                          ...(pageApprovalToken !== undefined ? { pageApprovalToken } : {}),
                        },
                      });
                      toastManager.add({
                        type: "success",
                        title: "Browser access granted to this thread",
                      });
                    })
                  }
                >
                  {state.browserPageAuthorized
                    ? "Revoke thread access"
                    : "Allow this thread to use this tab"}
                </MenuItem>
              )}
            {ready &&
              bridge &&
              selectionLocation &&
              screenshotPairs.map((pair) => (
                <MenuItem
                  key={pair.runId}
                  onClick={() => command(() => attachComparisonScreenshotPair(pair))}
                >
                  <span>
                    Attach both first-difference screenshots
                    {screenshotPairs.length > 1 && (
                      <span className="block break-all text-xs text-muted-foreground">
                        Run {pair.runId} · Step {pair.step}
                      </span>
                    )}
                  </span>
                </MenuItem>
              ))}
            {ready &&
              bridge &&
              threadId &&
              isPrimaryEnvironment(target.environmentId ?? undefined) &&
              screenshotSources.map(({ key, deviceId, hostId, name, frame, runLabel }) => (
                <MenuItem
                  key={key}
                  onClick={() =>
                    command(async () => {
                      const { currentUrl: url, pageRef, instanceId, pageApprovalToken } = state;
                      if (!url || !pageRef || !instanceId || state.loading)
                        throw new Error("Wait for the destination page to finish loading.");
                      const profileId = state.profileId ?? "default";
                      const profile =
                        savedProfiles.find((item) => item.id === profileId)?.label ?? profileId;
                      const destination = new URL(url);
                      if (
                        !(await confirmInSelectedTab(
                          `Allow this thread to use ${frame ? `the frozen screen at step ${frame.step} from` : "one live screen from"} ${name} (${hostId} / ${deviceId}${runLabel ?? ""}) and operate this tab to attach it and verify the draft on ${destination.origin}${destination.pathname} in the ${profile} profile?`,
                        ))
                      )
                        return;
                      const result = (await bridge.runBrowserAutomation({
                        ...args,
                        source: "human",
                        taskId: threadId,
                        operation: "authorizeDeviceScreenshot",
                        input: {
                          deviceId,
                          hostId,
                          profileId,
                          url,
                          instanceId,
                          ...(pageApprovalToken !== undefined ? { pageApprovalToken } : {}),
                          ...(frame ? { frame } : {}),
                          allowPageControl: true,
                        },
                      })) as { grantId: string };
                      try {
                        const location = {
                          environmentId: target.environmentId,
                          projectId: target.projectId,
                          threadId,
                        };
                        const file = surfaceAttachmentFile(
                          location,
                          { ...surface, url, profileId, pageRef, browserInstanceId: instanceId },
                          {
                            hostId,
                            deviceId,
                            grantId: result.grantId,
                            ...(frame ? { frame } : {}),
                          },
                        );
                        if (!file) throw new Error("Reopen the destination tab.");
                        addSurfaceFileToDraft(location, file);
                      } catch (error) {
                        await bridge.runBrowserAutomation({
                          ...args,
                          source: "human",
                          taskId: threadId,
                          operation: "revokeDeviceScreenshot",
                          input: { grantId: result.grantId },
                        });
                        throw error;
                      }
                      toastManager.add({
                        type: "success",
                        title: "Screenshot transfer added to composer",
                      });
                    })
                  }
                >
                  {frame
                    ? `Attach first difference (step ${frame.step}) from`
                    : "Attach screenshot from"}{" "}
                  {name} · {hostId} / {deviceId}
                  {runLabel}
                </MenuItem>
              ))}
            {state.deviceScreenshotAuthorized && bridge && threadId && (
              <MenuItem
                onClick={() =>
                  command(() =>
                    bridge.runBrowserAutomation({
                      ...args,
                      source: "human",
                      taskId: threadId,
                      operation: "revokeDeviceScreenshot",
                    }),
                  )
                }
              >
                Revoke screenshot transfer
              </MenuItem>
            )}
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
      {findOpen && bridge?.findInBrowser ? (
        <BrowserFindBar
          focusTick={findTick}
          onClose={closeFind}
          find={(text, direction) =>
            bridge.findInBrowser!({
              ...args,
              text,
              forward: direction.forward,
              findNext: direction.next,
            })
          }
        />
      ) : null}
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
      {isPrimaryEnvironment(target.environmentId ?? undefined) && (
        <BrowserHandoffControls
          key={state.assignedTaskId ?? ""}
          state={state}
          ownerTitle={ownerTitle}
          className="companion-note"
        />
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
      {selectionReview &&
        bridge &&
        selectionLocation &&
        selectionReview.location.threadId === selectionLocation.threadId &&
        selectionReview.location.environmentId === selectionLocation.environmentId &&
        selectionReview.location.projectId === selectionLocation.projectId && (
          <BrowserSelectionReview
            selection={selectionReview.selection}
            origin={new URL(selectionReview.page.url).origin}
            profile={
              savedProfiles.find(({ id }) => id === selectionReview.page.profileId)?.label ??
              selectionReview.page.profileId
            }
            returnFocus={toolsTrigger}
            onClose={closeSelectionReview}
            onApprove={addBrowserSelection}
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

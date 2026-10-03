import { ProjectId, ThreadId } from "@tabs/contracts";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";
import { useAtomValue } from "@effect/atom-react";

import { APP_DISPLAY_NAME } from "../branding";
import { Button } from "../components/ui/button";
import { AnchoredToastProvider, ToastProvider, toastManager } from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { serverConfigQueryOptions, serverQueryKeys } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { clearPromotedDraftThreads } from "../composerDraftStore";
import { terminalActions } from "../state/terminal";
import { terminalRunningSubprocessFromEvent } from "../terminalActivity";
import { onServerConfigUpdated, onServerProvidersUpdated, onServerWelcome } from "../wsNativeApi";
import { migrateLocalSettingsToServer, useSettings } from "../hooks/useSettings";
import { useMinimumDuration } from "../hooks/useMinimumDuration";
import {
  SplashScreen,
  STARTUP_ANIMATION_EXIT_MS,
  STARTUP_ANIMATION_HOLD_MS,
} from "../components/SplashScreen";
import { markStartupStage } from "../lib/startupReadiness";
import { cn, isPopoutMode } from "../lib/utils";
import { DiagnosticsSettings } from "../components/settings/DiagnosticsSettings";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";
import { GlobalConfirmDialog } from "../components/GlobalConfirmDialog";
import { CommandPalette } from "../components/CommandPalette";
import { FirstRunGate } from "../components/onboarding/FirstRunGate";
import { NativePreviewAutomationHost } from "../components/NativePreviewAutomationHost";
import { BackgroundActivityReporter } from "../components/BackgroundActivityReporter";
import { ProviderUpdateNotification } from "../components/ProviderUpdateNotification";
import { SlowRpcRequestToastCoordinator } from "../components/SlowRpcRequestToastCoordinator";
import { startRendererPerformanceCapture } from "../lib/rendererPerformance";
import { createKeybindingsUpdateToastController } from "../components/KeybindingsUpdateToast.logic";
import {
  removeEnvironmentReadModelFromAtoms,
  setProjectExpandedInAtoms,
  syncServerReadModelToAtoms,
} from "../state/readModel";
import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import {
  composerDraftActions,
  composerDraftsAtom,
  createScopedComposerDraftActions,
  scopedComposerThreadId,
  scopedComposerProjectId,
} from "../state/composerDrafts";
import { workspaceShellAtom } from "../state/workspaceShell";
import { applyServerConfigUpdate, refreshServerConfig } from "../state/settings";
import { threadsHydratedAtom } from "../state/threads";
import {
  initializePrimaryEnvironmentApi,
  onEnvironmentApiRegistryEvent,
} from "../connection/environmentApiRegistry";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

/**
 * Minimal shell rendered in popout windows (dedicated Resources Explorer).
 * No splash screen, no EventRouter, no WebSocket bootstrap — popouts call
 * Electron IPC directly and don't need any of the heavy infrastructure.
 * Locks the view to DiagnosticsSettings so that app reloads, redirects, or
 * route resets never navigate away to the full Tabs instance.
 */
function PopoutRootView() {
  useEffect(() => startRendererPerformanceCapture(), []);
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <CommandPalette>
          <div className="isolate flex h-screen min-h-0 min-w-0 flex-col overflow-y-auto overscroll-y-none bg-background text-foreground">
            <DiagnosticsSettings />
          </div>
        </CommandPalette>
        <GlobalConfirmDialog />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

/**
 * Full app root for the main Tabs window: splash screen, WebSocket bootstrap,
 * thread/project sync, CommandPalette, etc.
 */
function FullAppRootView() {
  useEffect(() => startRendererPerformanceCapture(), []);
  const isNativeApiReady = !!readNativeApi();
  const threadsHydrated = useAtomValue(threadsHydratedAtom);
  const settings = useSettings();
  const [startupDeadlineElapsed, setStartupDeadlineElapsed] = useState(false);
  const bootstrapReady = isNativeApiReady && threadsHydrated;
  const ready = useMinimumDuration(bootstrapReady, STARTUP_ANIMATION_HOLD_MS);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.diffColorScheme = settings.diffColorScheme;
    }
  }, [settings.diffColorScheme]);

  useEffect(() => {
    if (bootstrapReady) return;
    const timer = setTimeout(() => {
      console.warn(
        "Startup hydration is taking longer than expected; keeping the startup animation visible.",
      );
      setStartupDeadlineElapsed(true);
    }, 8_000);
    return () => clearTimeout(timer);
  }, [bootstrapReady]);

  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => setMounted(false), STARTUP_ANIMATION_EXIT_MS + 50);
      return () => clearTimeout(timer);
    } else {
      setMounted(true);
    }
  }, [ready]);

  return (
    <>
      {mounted && (
        <div
          className={cn(
            "pointer-events-auto fixed inset-0 z-[9999] bg-background transition-transform duration-1000 ease-in-out motion-reduce:duration-0",
            ready ? "-translate-y-full" : "translate-y-0",
          )}
        >
          <SplashScreen
            loader={settings.splashLoaderStyle}
            palette={settings.splashLoaderPalette}
            theme={settings.splashLoaderTheme}
          />
          {startupDeadlineElapsed && !bootstrapReady ? (
            <p
              className="absolute inset-x-0 bottom-8 text-center text-xs text-muted-foreground"
              role="status"
            >
              Still connecting to your workspace. Your saved projects will appear when loading
              finishes.
            </p>
          ) : null}
        </div>
      )}
      <ToastProvider>
        <AnchoredToastProvider>
          <EventRouter />
          <RemoteEnvironmentEventRouter />
          <NativePreviewAutomationHost />
          <BackgroundActivityReporter />
          <ProviderUpdateNotification />
          <SlowRpcRequestToastCoordinator />
          <DesktopProjectBootstrap />
          <FirstRunGate enabled={!isPopoutMode()}>
            <CommandPalette>
              <Outlet />
            </CommandPalette>
          </FirstRunGate>
          <GlobalConfirmDialog />
        </AnchoredToastProvider>
      </ToastProvider>
    </>
  );
}

/**
 * Dispatches to either the lightweight popout shell or the full app root
 * depending on whether the window was opened as a standalone popout.
 * `isPopoutMode` is a module-level constant so this conditional is stable
 * across all renders — no hooks are called before it.
 */
function RootRouteView() {
  if (isPopoutMode()) {
    return <PopoutRootView />;
  }
  return <FullAppRootView />;
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function threadIdFromPathname(pathname: string): ThreadId | null {
  const match = /^\/(?:[^/]+\/)?([^/]+)$/.exec(pathname);
  if (!match) {
    return null;
  }
  const [, threadId] = match;
  if (!threadId || threadId === "settings") {
    return null;
  }
  return ThreadId.makeUnsafe(threadId);
}

function draftHasVisibleContent(
  draft:
    | {
        prompt: string;
        images: readonly unknown[];
        persistedAttachments: readonly unknown[];
        terminalContexts: readonly unknown[];
      }
    | null
    | undefined,
): boolean {
  if (!draft) {
    return false;
  }
  return (
    draft.prompt.trim().length > 0 ||
    draft.images.length > 0 ||
    draft.persistedAttachments.length > 0 ||
    draft.terminalContexts.length > 0
  );
}

function EventRouter() {
  const syncServerReadModel = syncServerReadModelToAtoms;
  const setProjectExpanded = setProjectExpandedInAtoms;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pathnameRef = useRef(pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);

  pathnameRef.current = pathname;

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    const primaryEnvironmentIdPromise = initializePrimaryEnvironmentApi().catch((error) => {
      console.warn("Failed to initialize the primary environment registry", error);
      return null;
    });
    let disposed = false;
    let latestSequence = 0;
    let syncing = false;
    let pending = false;
    let needsProviderInvalidation = false;

    const flushSnapshotSync = async (): Promise<void> => {
      const snapshot = await api.orchestration.getSnapshot();
      const primaryEnvironmentId = await primaryEnvironmentIdPromise;
      if (disposed) return;
      latestSequence = Math.max(latestSequence, snapshot.snapshotSequence);
      syncServerReadModel(snapshot, primaryEnvironmentId ?? undefined);
      clearPromotedDraftThreads(new Set(snapshot.threads.map((t) => t.id)), primaryEnvironmentId);
      const draftThreadIds = Object.keys(
        appAtomRegistry.get(composerDraftsAtom).draftThreadsByThreadId,
      ) as ThreadId[];
      // Collect custom-process IDs per project from the workspace store so
      // their isolated terminal threads (server:<projectId>:custom:<processId>)
      // are also retained by the orphan cleanup.
      const projectSettingsByProjectId =
        appAtomRegistry.get(workspaceShellAtom).projectSettingsByProjectId;
      const customProcessIdsByProjectId = new Map<ProjectId, string[]>();
      for (const project of snapshot.projects) {
        const settings = projectSettingsByProjectId[project.id];
        if (!settings) continue;
        const customIds = settings.tools.flatMap((tool) =>
          tool.kind === "custom_process" && tool.serverProcessId != null
            ? [tool.serverProcessId]
            : [],
        );
        if (customIds.length > 0) {
          customProcessIdsByProjectId.set(project.id, customIds);
        }
      }
      const activeThreadIds = collectActiveTerminalThreadIds({
        snapshotThreads: snapshot.threads,
        draftThreadIds,
        projectIds: snapshot.projects.map((p) => p.id),
        customProcessIdsByProjectId,
      });
      terminalActions.removeOrphans(activeThreadIds);
      if (pending) {
        pending = false;
        await flushSnapshotSync();
      }
    };

    const syncSnapshot = async () => {
      if (syncing) {
        pending = true;
        return;
      }
      syncing = true;
      pending = false;
      try {
        await flushSnapshotSync();
      } catch {
        // Keep prior state and wait for next domain event to trigger a resync.
      }
      syncing = false;
    };

    const domainEventFlushThrottler = new Throttler(
      () => {
        if (needsProviderInvalidation) {
          needsProviderInvalidation = false;
          void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
          // Invalidate workspace entry queries so the @-mention file picker
          // reflects files created, deleted, or restored during this turn.
          void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
        }
        void syncSnapshot();
      },
      {
        wait: 100,
        leading: false,
        trailing: true,
      },
    );

    const unsubDomainEvent = api.orchestration.onDomainEvent((event) => {
      if (event.sequence <= latestSequence) {
        return;
      }
      latestSequence = event.sequence;
      if (event.type === "thread.turn-diff-completed" || event.type === "thread.reverted") {
        needsProviderInvalidation = true;
      }
      domainEventFlushThrottler.maybeExecute();
    });
    const unsubTerminalEvent = api.terminal.onEvent((event) => {
      const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
      if (hasRunningSubprocess === null) {
        return;
      }
      const label = event.type === "activity" ? event.label : undefined;
      terminalActions.activity(
        ThreadId.makeUnsafe(event.threadId),
        event.terminalId,
        hasRunningSubprocess,
        label,
      );
    });
    const unsubWelcome = onServerWelcome((payload) => {
      // DS-001: Backend connection established
      markStartupStage("backend-connection-ready");
      // Migrate old localStorage settings to server on first connect
      migrateLocalSettingsToServer();
      void (async () => {
        await syncSnapshot();
        markStartupStage("provider-inventory-available");
        const primaryEnvironmentId = await primaryEnvironmentIdPromise;
        if (disposed) {
          return;
        }

        // Reconcile terminal state
        try {
          const activeSessions = await api.terminal.list();
          const activeIds = new Set(activeSessions.map((s) => s.terminalId));
          terminalActions.reconcileRunning(activeIds);
        } catch (e) {
          console.error("Failed to reconcile terminal states", e);
        }

        if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
          return;
        }
        setProjectExpanded(payload.bootstrapProjectId, true, primaryEnvironmentId ?? undefined);

        const currentThreadId = threadIdFromPathname(pathnameRef.current);
        const snapshotThreadIds = new Set(
          appAtomRegistry.get(readModelStateAtom).threads.map((thread) => thread.id),
        );
        const composerDraftStore = appAtomRegistry.get(composerDraftsAtom);
        const scopedCurrentThreadId =
          currentThreadId && primaryEnvironmentId
            ? scopedComposerThreadId(primaryEnvironmentId, currentThreadId)
            : currentThreadId;
        const activeDraftThread = currentThreadId
          ? (composerDraftStore.draftThreadsByThreadId[scopedCurrentThreadId!] ??
            composerDraftStore.draftThreadsByThreadId[currentThreadId])
          : null;
        const activeComposerDraft = currentThreadId
          ? (composerDraftStore.draftsByThreadId[scopedCurrentThreadId!] ??
            composerDraftStore.draftsByThreadId[currentThreadId])
          : null;
        const shouldReplaceEmptyDraftSelection = Boolean(
          currentThreadId &&
          activeDraftThread &&
          !snapshotThreadIds.has(currentThreadId) &&
          (activeDraftThread.projectId === payload.bootstrapProjectId ||
            (primaryEnvironmentId &&
              activeDraftThread.projectId ===
                scopedComposerProjectId(primaryEnvironmentId, payload.bootstrapProjectId))) &&
          !draftHasVisibleContent(activeComposerDraft),
        );

        if (pathnameRef.current !== "/" && !shouldReplaceEmptyDraftSelection) {
          return;
        }
        if (
          handledBootstrapThreadIdRef.current === payload.bootstrapThreadId &&
          !shouldReplaceEmptyDraftSelection
        ) {
          return;
        }

        if (shouldReplaceEmptyDraftSelection && currentThreadId) {
          (primaryEnvironmentId
            ? createScopedComposerDraftActions(primaryEnvironmentId)
            : composerDraftActions
          ).clearDraftThread(currentThreadId);
        }
        if (primaryEnvironmentId) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: primaryEnvironmentId,
              threadId: payload.bootstrapThreadId,
            },
            replace: true,
          });
        }
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
      })().catch(() => undefined);
    });
    // onServerConfigUpdated replays the latest cached value synchronously
    // during subscribe. Skip the toast for that replay so effect re-runs
    // don't produce duplicate toasts.
    let subscribed = false;
    const keybindingsToastController = createKeybindingsUpdateToastController({});
    const unsubServerConfigUpdated = onServerConfigUpdated((payload) => {
      if (payload.settings) {
        applyServerConfigUpdate(payload);
      }
      void refreshServerConfig();
      // Invalidate the config query so active observers refetch fresh data.
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });

      if (!subscribed) {
        return;
      }

      const decision = keybindingsToastController.handle(payload);
      if (!decision) {
        return;
      }

      if (decision._tag === "Success") {
        toastManager.add({
          type: "success",
          title: "Keybindings updated",
          description: "Keybindings configuration reloaded successfully.",
        });
        return;
      }

      toastManager.add({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: decision.message,
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            void queryClient
              .ensureQueryData(serverConfigQueryOptions())
              .then((config) => {
                const editor = resolveAndPersistPreferredEditor(config.availableEditors);
                if (!editor) {
                  throw new Error("No available editors found.");
                }
                return api.shell.openInEditor(config.keybindingsConfigPath, editor);
              })
              .catch((error) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error ? error.message : "Unknown error opening file.",
                });
              });
          },
        },
      });
    });
    const unsubProvidersUpdated = onServerProvidersUpdated(() => {
      markStartupStage("provider-update-received");
      void refreshServerConfig();
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
    });
    subscribed = true;
    return () => {
      disposed = true;
      needsProviderInvalidation = false;
      domainEventFlushThrottler.cancel();
      unsubDomainEvent();
      unsubTerminalEvent();
      unsubWelcome();
      unsubServerConfigUpdated();
      unsubProvidersUpdated();
    };
  }, [navigate, queryClient, setProjectExpanded, syncServerReadModel]);

  return null;
}

function RemoteEnvironmentEventRouter() {
  useEffect(() => {
    const cleanups = new Map<string, () => void>();
    const unsubscribeRegistry = onEnvironmentApiRegistryEvent((event) => {
      if (event.type === "disconnected") {
        cleanups.get(event.environmentId)?.();
        cleanups.delete(event.environmentId);
        removeEnvironmentReadModelFromAtoms(event.environmentId);
        return;
      }
      if (event.primary || cleanups.has(event.environmentId)) return;

      let disposed = false;
      let latestSequence = 0;
      let syncPromise: Promise<void> | null = null;
      let pending = false;
      const syncSnapshot = async (): Promise<void> => {
        if (syncPromise) {
          pending = true;
          return syncPromise;
        }
        syncPromise = (async () => {
          do {
            pending = false;
            const snapshot = await event.api.orchestration.getSnapshot();
            if (disposed) return;
            latestSequence = Math.max(latestSequence, snapshot.snapshotSequence);
            syncServerReadModelToAtoms(snapshot, event.environmentId);
          } while (pending && !disposed);
        })().finally(() => {
          syncPromise = null;
        });
        return syncPromise;
      };
      const throttler = new Throttler(() => void syncSnapshot(), {
        wait: 100,
        leading: false,
        trailing: true,
      });
      const unsubscribeDomain = event.api.orchestration.onDomainEvent((domainEvent) => {
        if (domainEvent.sequence <= latestSequence) return;
        latestSequence = domainEvent.sequence;
        throttler.maybeExecute();
      });
      void syncSnapshot().catch((error) => {
        console.warn(`Failed to sync environment ${event.environmentId}`, error);
      });
      cleanups.set(event.environmentId, () => {
        disposed = true;
        unsubscribeDomain();
        throttler.cancel();
      });
    });

    return () => {
      unsubscribeRegistry();
      for (const cleanup of cleanups.values()) cleanup();
    };
  }, []);

  return null;
}

function DesktopProjectBootstrap() {
  // Desktop hydration runs through EventRouter project + orchestration sync.
  return null;
}

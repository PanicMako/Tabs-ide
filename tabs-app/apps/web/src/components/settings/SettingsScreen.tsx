import { readTourProjectTool } from "~/stores/guidedTourStore";
import {
  SettingsNavigation,
  SETTINGS_NAV,
  type SettingsPageId,
} from "~/components/settings/SettingsNavigation";
import { usePanelAnimationSettings, useSurfaceMotionSettings } from "~/panelAnimations";
import { playScreenEnter, playScreenExit, type ScreenPart } from "~/lib/motion";
import { navigateUrgently } from "~/lib/urgentNavigation";
import { settingsReturnHref } from "~/lib/settingsReturn";
import { closeSettingsLayer, useSettingsLayerStore } from "~/lib/settingsLayerStore";
import { useGsapSurface } from "~/hooks/useGsapSurface";
import {
  type ComponentType,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowUpCircleIcon,
  DownloadIcon,
  LogInIcon,
  LogOutIcon,
  XIcon,
  TerminalIcon,
} from "lucide-react";
import {
  SettingsEditorialFrame,
  SettingsWorkspaceIdentity,
} from "~/components/settings/SettingsEditorialFrame";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { toastManager } from "~/components/ui/toast";
import { SettingsPersistenceStatus } from "~/components/settings/SettingsPersistenceStatus";
import { SettingsLoadingState } from "~/components/settings/SettingsLoadingState";
import { useUnreadNotificationCount } from "~/stores/notificationStore";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { refreshServerConfig, useServerConfig } from "~/state/settings";
import { useSettingsViewState } from "~/state/scopedStateStore";
import ThreadTerminalDrawer from "~/components/ThreadTerminalDrawer";
import { DEFAULT_THREAD_TERMINAL_ID } from "~/types";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { serverQueryKeys } from "~/lib/serverReactQuery";
import {
  cn,
  getHashAwareSearchParams,
  isMacPlatform,
  isPopoutMode,
  isWindowsPlatform,
} from "~/lib/utils";
import { isElectron } from "~/env";
import { useWindowControlsInset } from "~/hooks/useWindowControlsInset";
import { useConfirm } from "~/hooks/useConfirm";

const isMacDesktop =
  isElectron && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const isWindowsDesktop =
  isElectron && typeof navigator !== "undefined" && isWindowsPlatform(navigator.platform);
import {
  useIsAnyDraftDirty,
  useDirtyDraftSources,
  clearAllDraftSources,
} from "~/state/settingsDraftRegistry";
import { clearProjectWorkspaceDrafts } from "~/components/projectWorkspaceDrafts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  PROVIDER_DISPLAY_NAMES,
  type KeybindingRule,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  ThreadId,
} from "@tabs/contracts";
import {
  PROVIDER_SETTINGS_KEYS,
  type ProviderSettingsKey,
} from "~/components/settings/providerSettings.shared";

/** Every settings page's chunk loader, so opening Settings can warm them all at idle. */
const settingsSectionLoaders: Array<() => Promise<unknown>> = [];
function lazySection<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  settingsSectionLoaders.push(load);
  return lazy(load);
}

const NotificationsSettings = lazySection(() =>
  import("~/components/settings/NotificationsSettings").then((m) => ({
    default: m.NotificationsSettings,
  })),
);

import { NotificationHistoryPanel } from "~/components/NotificationHistoryPanel";

function NotificationBellButton({
  active,
  onOpenSettings,
}: {
  active: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <NotificationHistoryPanel
      variant="settings-header"
      active={active}
      onOpenSettings={onOpenSettings}
    />
  );
}

function NotificationsBadge() {
  const unreadCount = useUnreadNotificationCount();
  if (unreadCount === 0) return null;
  return (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground tabular-nums">
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}

const AgentPluginsSettings = lazySection(() =>
  import("~/components/settings/AgentPluginsSettings").then((module) => ({
    default: module.AgentPluginsSettings,
  })),
);
const QuickActionsSettings = lazySection(
  () => import("~/components/settings/QuickActionsSettings"),
);
const TerminalCommandsSettings = lazySection(
  () => import("~/components/settings/TerminalCommandsSettings"),
);
const WorkspaceMaintenanceSettings = lazySection(
  () => import("~/components/settings/WorkspaceMaintenanceSettings"),
);
const GeneralSettings = lazySection(() => import("~/components/settings/GeneralSettings"));
const DeviceSettings = lazySection(() => import("~/components/settings/DeviceSettings"));
const LabsSettings = lazySection(() => import("~/components/settings/LabsSettings"));
const TeammatesSettings = lazySection(() => import("~/components/settings/TeammatesSettings"));
const ThemesSettings = lazySection(() => import("~/components/settings/ThemesSettings"));
const AnimationsSettings = lazySection(() => import("~/components/settings/AnimationsSettings"));
const ProvidersSettings = lazySection(() => import("~/components/settings/ProvidersSettings"));
const AboutSettings = lazySection(() => import("~/components/settings/AboutSettings"));
/** One settings page. It glides in when the user switches to it; the first page arrives with the screen. */
/**
 * How Settings arrives: a short, subtle sequence that starts the moment it is shown — the top
 * bar settles down, the page list slides in from the left one item after another, and the open
 * page rises into place. About a quarter of a second in all. Seconds before the app's motion
 * pace (0.5×).
 */
const SETTINGS_ENTRANCE: ReadonlyArray<ScreenPart> = [
  { selector: '[data-slot="settings-topbar"]', from: { opacity: 0, y: -6 }, at: 0, duration: 0.5 },
  { selector: ".settings-navigation-heading", from: { opacity: 0 }, at: 0.02, duration: 0.44 },
  {
    selector: "[data-settings-nav-item]",
    from: { opacity: 0, x: -8 },
    at: 0.03,
    stagger: 0.012,
    duration: 0.48,
  },
  {
    selector: '[data-slot="settings-surface"]',
    from: { opacity: 0, y: 10 },
    at: 0.05,
    duration: 0.56,
  },
];

function SettingsSurface({ children, animate }: { children: React.ReactNode; animate: boolean }) {
  const ref = useGsapSurface<HTMLDivElement>(undefined, "panel");
  return (
    <div ref={animate ? ref : undefined} data-slot="settings-surface">
      {children}
    </div>
  );
}

const ProjectWorkspaceSettingsSection = lazySection(() =>
  import("~/components/ProjectWorkspaceSettingsSection").then((m) => ({
    default: m.ProjectWorkspaceSettingsSection,
  })),
);
const BrowserProfilesSettings = lazySection(() =>
  import("~/components/settings/BrowserProfilesSettings").then((m) => ({
    default: m.BrowserProfilesSettings,
  })),
);
const KeybindingsSettings = lazySection(() =>
  import("~/components/settings/KeybindingsSettings").then((m) => ({
    default: m.KeybindingsSettings,
  })),
);
const UsageLimitsPage = lazySection(() =>
  import("~/components/settings/usage/UsageLimitsPage").then((m) => ({
    default: m.UsageLimitsPage,
  })),
);
const DiagnosticsSettings = lazySection(() =>
  import("~/components/settings/DiagnosticsSettings").then((m) => ({
    default: m.DiagnosticsSettings,
  })),
);
const DocumentationSettings = lazySection(() =>
  import("~/components/settings/DocumentationSettings").then((m) => ({
    default: m.DocumentationSettings,
  })),
);
const ConnectionsSettings = lazySection(() =>
  import("~/components/settings/ConnectionsSettings").then((m) => ({
    default: m.ConnectionsSettings,
  })),
);
const SourceControlSettingsPanel = lazySection(() =>
  import("~/components/settings/SourceControlSettings").then((m) => ({
    default: m.SourceControlSettingsPanel,
  })),
);

export type SettingsSectionId = SettingsPageId;

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

/**
 * The Settings screen. Opened from the workspace it is a layer over it (`layer`): the workspace
 * stays mounted underneath, so opening and leaving Settings never rebuilds either screen (see
 * lib/settingsLayerStore.ts). The `/settings` route renders the same screen for deep links.
 */
export function SettingsScreen({ layer = false }: { layer?: boolean } = {}) {
  const iconMotion = usePanelAnimationSettings();
  const surfaceMotion = useSurfaceMotionSettings();
  const shellRef = useRef<HTMLDivElement>(null);
  const [hasSwitchedSection, setHasSwitchedSection] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const navigate = useNavigate();
  const isAnyDraftDirty = useIsAnyDraftDirty();
  const dirtySources = useDirtyDraftSources();

  const handleBack = useCallback(async () => {
    if (isAnyDraftDirty) {
      const sourceLabels = dirtySources.map((s) => s.label || s.sourceId).join(", ");
      const shouldDiscard = await confirm(
        `You have unsaved changes in ${sourceLabels || "Settings"}. Discard these changes and leave Settings?`,
      );
      if (!shouldDiscard) {
        return;
      }
      clearProjectWorkspaceDrafts();
      clearAllDraftSources();
    }
    // As a layer, leaving is just showing the workspace again. From the deep-link route, go
    // straight back to where the user was: one navigation, committed at once.
    if (layer) closeSettingsLayer();
    else void navigateUrgently(() => navigate({ href: settingsReturnHref() }));
  }, [isAnyDraftDirty, dirtySources, confirm, layer, navigate]);

  const serverConfig = useServerConfig();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const queryClient = useQueryClient();

  const windowControlsInset = useWindowControlsInset(
    isWindowsDesktop || isMacDesktop,
    isMacDesktop ? { left: 92, right: 0 } : { left: 0, right: 140 },
  );

  const isPopout = isPopoutMode();

  const [settingsViewState, updateSettingsViewState] = useSettingsViewState();
  const urlSearch = useRouterState({ select: (state) => state.location.searchStr });
  // As a layer, the URL still belongs to the workspace underneath; the page lives in app state.
  const routeSearch = layer ? "" : urlSearch;
  const layerSection = useSettingsLayerStore((state) => state.section);
  const requestedSection = layer
    ? layerSection
    : (new URLSearchParams(routeSearch).get("section") ??
      getHashAwareSearchParams().get("section"));
  const activeSettingsSection = SETTINGS_NAV.some((item) => item.id === requestedSection)
    ? (requestedSection as SettingsSectionId)
    : ((settingsViewState.activeSection as SettingsSectionId) ?? "general");
  const setActiveSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      updateSettingsViewState({ activeSection: section });
      if (layer) {
        useSettingsLayerStore.getState().setSection(section);
        return;
      }
      void navigate({
        to: "/settings",
        search: { section },
        replace: true,
      });
    },
    [layer, updateSettingsViewState, navigate],
  );
  // The open page steps aside before the next one glides in, instead of a hard cut.
  const selectSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      if (section === activeSettingsSection) return;
      const surface = shellRef.current?.querySelector<HTMLElement>(
        '[data-slot="settings-surface"]',
      );
      void playScreenExit(surface ?? null, { ...surfaceMotion, soft: true }).then(() => {
        setHasSwitchedSection(true);
        setActiveSettingsSection(section);
      });
    },
    [activeSettingsSection, setActiveSettingsSection, surfaceMotion],
  );

  // Settings eases in when it opens (see SETTINGS_ENTRANCE).
  useLayoutEffect(() => {
    const root = shellRef.current;
    if (!root || !surfaceMotion.active) return;
    return playScreenEnter(root, SETTINGS_ENTRANCE, surfaceMotion);
    // Plays once, when Settings opens.
  }, []);

  // Warm every settings page while idle, so switching pages never shows a loading state.
  useEffect(() => {
    const warm = () => {
      for (const load of settingsSectionLoaders) void load().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 600);
    return () => window.clearTimeout(id);
  }, []);

  const openSettingsSection = useCallback(
    (section: string) => {
      const target = SETTINGS_NAV.find((item) => item.id === section)?.id;
      if (target) setActiveSettingsSection(target);
    },
    [setActiveSettingsSection],
  );

  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    const api = ensureNativeApi();
    api.server
      .refreshProviders()
      .then((res: any) => {
        try {
          localStorage.setItem("tabs_last_models_refresh_time", String(Date.now()));
        } catch {}
        void refreshServerConfig();
        void queryClient.invalidateQueries({
          queryKey: serverQueryKeys.config(),
        });
        void queryClient.invalidateQueries({
          queryKey: ["source-control-discovery"],
        });

        const providersList: ReadonlyArray<ServerProvider> = res?.providers ?? [];
        if (providersList.length > 0) {
          const readyCount = providersList.filter(
            (p) => p.status === "ready" || p.auth.status === "authenticated",
          ).length;
          const failedProviders = providersList
            .filter((p) => p.status === "error")
            .map(
              (p) =>
                PROVIDER_DISPLAY_NAMES[p.driver as keyof typeof PROVIDER_DISPLAY_NAMES] ?? p.driver,
            );

          if (failedProviders.length > 0) {
            toastManager.add({
              type: "warning",
              title: "Providers refreshed with warnings",
              description: `${readyCount} of ${providersList.length} providers refreshed — ${failedProviders.join(", ")} failed.`,
            });
          } else {
            toastManager.add({
              type: "success",
              title: "Models refreshed",
              description: `${providersList.length} of ${providersList.length} providers refreshed successfully.`,
            });
          }
        } else {
          toastManager.add({
            type: "success",
            title: "Models refreshed",
            description: "Provider model discovery refresh completed.",
          });
        }
      })
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
        toastManager.add({
          type: "error",
          title: "Refresh failed",
          description:
            error instanceof Error ? error.message : "Failed to query provider model endpoints.",
        });
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, [queryClient]);

  type ProviderActionKind = "login" | "logout" | "install" | "update" | "plugins";
  const [providerActionSession, setProviderActionSession] = useState<{
    provider: ProviderSettingsKey;
    providerName: string;
    command: string;
    followUpCommand?: string;
    kind: ProviderActionKind;
    threadId: ThreadId;
  } | null>(null);
  const providerActionCommandSentRef = useRef<string | null>(null);
  const [managedProviderActionBusy, setManagedProviderActionBusy] = useState(false);

  const startProviderAction = useCallback(
    (input: {
      provider: ProviderSettingsKey;
      providerName: string;
      command: string;
      followUpCommand?: string;
      kind: ProviderActionKind;
    }) => {
      if (input.provider === "antigravity" && input.kind === "install") {
        const api = readNativeApi();
        const instance = serverConfig?.providers.find(
          (provider) => provider.driver === "antigravity",
        );
        if (!api || !instance) {
          toastManager.add({ type: "error", title: "Antigravity provider is unavailable" });
          return;
        }
        setManagedProviderActionBusy(true);
        toastManager.add({ type: "info", title: "Installing Antigravity runtime" });
        void api.server
          .runProviderMaintenance({ instanceId: instance.instanceId, action: "install" })
          .then((result) => {
            const installed = result.providers.find(
              (provider) => provider.instanceId === instance.instanceId,
            );
            toastManager.add({
              type: installed?.installed ? "success" : "error",
              title: installed?.installed
                ? "Antigravity installed"
                : "Antigravity installation failed",
              description: installed?.updateState?.message ?? installed?.message ?? undefined,
            });
          })
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: "Antigravity installation failed",
              description: error instanceof Error ? error.message : "Installation failed.",
            });
          })
          .finally(() => {
            setManagedProviderActionBusy(false);
            refreshProviders();
          });
        return;
      }
      let command = input.command.trim();
      if (command.length === 0) return;
      if (input.provider === "copilot" && input.kind === "login") {
        const gheHost = settings.providers.copilot?.gheHost?.trim();
        if (gheHost && !command.includes("--host")) {
          command = `${command} --host ${gheHost}`;
        }
      }
      providerActionCommandSentRef.current = null;
      setProviderActionSession({
        provider: input.provider,
        providerName: input.providerName,
        command,
        ...(input.followUpCommand ? { followUpCommand: input.followUpCommand } : {}),
        kind: input.kind,
        threadId: ThreadId.makeUnsafe(`settings-${input.kind}-${input.provider}-${Date.now()}`),
      });
    },
    [settings.providers.copilot?.gheHost, serverConfig?.providers, refreshProviders],
  );

  const closeProviderAction = useCallback(() => {
    setProviderActionSession((current) => {
      if (current) {
        const api = readNativeApi();
        void api?.terminal.close({ threadId: current.threadId }).catch(() => undefined);
      }
      return null;
    });
    providerActionCommandSentRef.current = null;
    refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    if (!providerActionSession) return;
    const api = readNativeApi();
    if (!api) return;
    const { threadId, command, followUpCommand, kind } = providerActionSession;
    const sendOnce = () => {
      if (providerActionCommandSentRef.current === threadId) return;
      providerActionCommandSentRef.current = threadId;
      setTimeout(() => {
        const api = readNativeApi();
        if (!api) return;
        void api.terminal
          .write({
            threadId,
            terminalId: DEFAULT_THREAD_TERMINAL_ID,
            data: `${command}\r`,
          })
          .catch((error: unknown) => {
            providerActionCommandSentRef.current = null;
            toastManager.add({
              type: "error",
              title: "Could not run provider command",
              description: error instanceof Error ? error.message : "Terminal command failed.",
            });
          });
        if (followUpCommand) {
          setTimeout(() => {
            void api.terminal
              .write({
                threadId,
                terminalId: DEFAULT_THREAD_TERMINAL_ID,
                data: `${followUpCommand}\r`,
              })
              .then(() => {
                if (kind === "logout") {
                  setTimeout(() => refreshProviders(), 1_500);
                }
              })
              .catch(() => undefined);
          }, 1_250);
        }
      }, 750);
    };
    const unsubscribe = api.terminal.onEvent((event) => {
      if (event.threadId !== threadId || event.terminalId !== DEFAULT_THREAD_TERMINAL_ID) return;
      if (event.type === "output" || event.type === "started" || event.type === "restarted") {
        sendOnce();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [providerActionSession, refreshProviders]);

  useEffect(() => {
    const hasAnyEnabled = PROVIDER_SETTINGS_KEYS.some((provider) => {
      const cfg = settings.providers[provider];
      return cfg ? cfg.enabled : true;
    });
    if (!hasAnyEnabled) {
      updateSettings({
        providers: {
          ...settings.providers,
          codex: {
            ...(settings.providers.codex ?? DEFAULT_UNIFIED_SETTINGS.providers.codex),
            enabled: true,
          },
        },
      });
    }
  }, [settings.providers, updateSettings]);

  const keybindingsConfigPath = serverConfig?.keybindingsConfigPath ?? null;
  const loginCwd = serverConfig?.cwd ?? null;
  const availableEditors = serverConfig?.availableEditors;
  const resolvedKeybindings = serverConfig?.keybindings ?? EMPTY_KEYBINDINGS;

  const applyKeybindingMutation = useCallback(
    (run: Promise<unknown>) =>
      run
        .then(() => {
          void refreshServerConfig();
          return queryClient.invalidateQueries({
            queryKey: serverQueryKeys.config(),
          });
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Couldn't update keybinding",
            description: error instanceof Error ? error.message : "Please try again.",
          });
        }),
    [queryClient],
  );

  const handleUpsertKeybinding = useCallback(
    (rule: KeybindingRule) =>
      applyKeybindingMutation(ensureNativeApi().server.upsertKeybinding(rule)),
    [applyKeybindingMutation],
  );

  const handleBatchUpsertKeybindings = useCallback(
    async (rules: ReadonlyArray<KeybindingRule>) => {
      const result = await ensureNativeApi().server.batchUpsertKeybindings({ rules: [...rules] });
      void refreshServerConfig();
      await queryClient.invalidateQueries({
        queryKey: serverQueryKeys.config(),
      });
      return result;
    },
    [queryClient],
  );

  const handleRemoveKeybinding = useCallback(
    (rule: KeybindingRule) =>
      applyKeybindingMutation(ensureNativeApi().server.removeKeybinding(rule)),
    [applyKeybindingMutation],
  );

  const handleBatchRemoveKeybindings = useCallback(
    async (rules: ReadonlyArray<KeybindingRule>) => {
      const result = await ensureNativeApi().server.batchRemoveKeybindings({ rules: [...rules] });
      await Promise.all([
        refreshServerConfig(),
        queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() }),
      ]);
      return {
        removedCount: result.removedCount,
        failedCount: Math.max(0, rules.length - result.removedCount),
      };
    },
    [queryClient],
  );

  if (isPopout) {
    return (
      <SettingsEditorialFrame className="isolate flex h-screen min-h-0 min-w-0 flex-col overflow-y-auto overscroll-y-none bg-background text-foreground">
        <Suspense fallback={<SettingsLoadingState label="Loading settings" className="h-64" />}>
          {activeSettingsSection === "documentation" ? (
            <div className="mx-auto w-full max-w-7xl p-6">
              <DocumentationSettings />
            </div>
          ) : (
            <DiagnosticsSettings />
          )}
        </Suspense>
        {confirmDialog}
      </SettingsEditorialFrame>
    );
  }

  return (
    <SettingsEditorialFrame className="isolate flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-y-none bg-background text-foreground">
      <div
        ref={shellRef}
        data-slot="settings-shell"
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
      >
        {!isElectron && (
          <header data-slot="settings-topbar" className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <Button
                data-slot="settings-classic-back"
                size="xs"
                variant="ghost"
                onClick={handleBack}
              >
                <ArrowLeftIcon className="size-3.5" />
                Back
              </Button>
              <span
                data-slot="settings-classic-label"
                className="text-sm font-medium text-foreground"
              >
                Settings
              </span>
              <SettingsWorkspaceIdentity
                onBack={handleBack}
                pageName={SETTINGS_NAV.find((item) => item.id === activeSettingsSection)?.label}
                onSettingsHome={() => setActiveSettingsSection("general")}
              />
              <div id="settings-header-actions" className="ms-auto flex items-center gap-2">
                <NotificationBellButton
                  active={activeSettingsSection === "notifications"}
                  onOpenSettings={() => setActiveSettingsSection("notifications")}
                />
                <SettingsPersistenceStatus />
              </div>
            </div>
          </header>
        )}

        {isElectron && (
          <div
            data-slot="settings-topbar"
            className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5"
            style={{
              paddingLeft: Math.max(20, windowControlsInset.left),
              paddingRight: Math.max(20, windowControlsInset.right),
            }}
          >
            <Button
              data-slot="settings-classic-back"
              size="xs"
              variant="ghost"
              className="no-drag"
              onClick={handleBack}
            >
              <ArrowLeftIcon className="size-3.5" />
              Back
            </Button>
            <span
              data-slot="settings-classic-label"
              className="ml-2 text-xs font-medium tracking-wide text-muted-foreground/70"
            >
              Settings
            </span>
            <SettingsWorkspaceIdentity
              onBack={handleBack}
              pageName={SETTINGS_NAV.find((item) => item.id === activeSettingsSection)?.label}
              onSettingsHome={() => setActiveSettingsSection("general")}
            />
            <div id="settings-header-actions" className="ms-auto flex items-center gap-2">
              <NotificationBellButton
                active={activeSettingsSection === "notifications"}
                onOpenSettings={() => setActiveSettingsSection("notifications")}
              />
              <SettingsPersistenceStatus />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            data-slot="settings-columns"
            className="settings-shell-columns flex h-full w-full gap-6 px-6 sm:px-10 lg:px-16"
          >
            <SettingsNavigation
              activeSection={activeSettingsSection}
              onSelect={selectSettingsSection}
              reducedMotion={iconMotion.reducedMotion}
              notificationBadge={<NotificationsBadge />}
            />
            <div
              data-slot="settings-scroll"
              className="min-w-0 flex-1 overflow-y-auto overscroll-y-contain py-6"
            >
              <div
                data-slot="settings-content"
                className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-12"
              >
                <Suspense
                  fallback={
                    <SettingsLoadingState
                      label={`Loading ${SETTINGS_NAV.find((item) => item.id === activeSettingsSection)?.label ?? "settings"}`}
                    />
                  }
                >
                  <SettingsSurface key={activeSettingsSection} animate={hasSwitchedSection}>
                    {activeSettingsSection === "general" ? <GeneralSettings /> : null}
                    {activeSettingsSection === "quick-actions" ? <QuickActionsSettings /> : null}
                    {activeSettingsSection === "terminal-commands" ? (
                      <TerminalCommandsSettings />
                    ) : null}
                    {activeSettingsSection === "maintenance" ? (
                      <WorkspaceMaintenanceSettings />
                    ) : null}
                    {activeSettingsSection === "notifications" ? <NotificationsSettings /> : null}
                    {activeSettingsSection === "themes" ? <ThemesSettings /> : null}
                    {activeSettingsSection === "startup-animation" ? <AnimationsSettings /> : null}
                    {activeSettingsSection === "workspace" ? (
                      <ProjectWorkspaceSettingsSection
                        tourTool={readTourProjectTool(routeSearch)}
                      />
                    ) : null}
                    {activeSettingsSection === "profiles" ? <BrowserProfilesSettings /> : null}
                    {activeSettingsSection === "source-control" ? (
                      <SourceControlSettingsPanel
                        startProviderAction={startProviderAction}
                        providerActionBusy={
                          providerActionSession !== null || managedProviderActionBusy
                        }
                      />
                    ) : null}
                    {activeSettingsSection === "connections" ? <ConnectionsSettings /> : null}
                    {activeSettingsSection === "documentation" ? (
                      <DocumentationSettings onOpenSettingsSection={openSettingsSection} />
                    ) : null}
                    {activeSettingsSection === "agent-plugins" ? (
                      <AgentPluginsSettings
                        onRunCommand={(command, name) =>
                          startProviderAction({
                            provider: "openrouter",
                            providerName: name,
                            command,
                            kind: "plugins",
                          })
                        }
                      />
                    ) : null}
                    {activeSettingsSection === "providers" ? (
                      <ProvidersSettings
                        refreshProviders={refreshProviders}
                        isRefreshingProviders={isRefreshingProviders}
                        startProviderAction={startProviderAction}
                        providerActionBusy={
                          providerActionSession !== null || managedProviderActionBusy
                        }
                      />
                    ) : null}
                    {activeSettingsSection === "keybindings" ? (
                      <KeybindingsSettings
                        keybindings={resolvedKeybindings}
                        onUpsert={handleUpsertKeybinding}
                        onBatchUpsert={handleBatchUpsertKeybindings}
                        onBatchRemove={handleBatchRemoveKeybindings}
                        onRemove={handleRemoveKeybinding}
                        keybindingsConfigPath={keybindingsConfigPath as string}
                        availableEditors={(availableEditors as any) ?? []}
                      />
                    ) : null}
                    {activeSettingsSection === "usage" ? <UsageLimitsPage /> : null}
                    {activeSettingsSection === "diagnostics" ? <DiagnosticsSettings /> : null}
                    {activeSettingsSection === "about" ? <AboutSettings /> : null}
                    {activeSettingsSection === "devices" ? <DeviceSettings /> : null}
                    {activeSettingsSection === "labs" ? <LabsSettings /> : null}
                    {activeSettingsSection === "teammates" ? <TeammatesSettings /> : null}
                  </SettingsSurface>
                </Suspense>
                <footer data-slot="settings-footer">
                  <span>Built around your workflow.</span>
                  <span>Settings · Experimental layout</span>
                </footer>
              </div>
            </div>
          </div>
        </div>

        <Dialog
          open={providerActionSession !== null && Boolean(loginCwd)}
          onOpenChange={(open) => {
            if (!open) closeProviderAction();
          }}
        >
          {providerActionSession && loginCwd ? (
            <DialogPopup
              showCloseButton={false}
              className="w-[92vw] max-w-5xl h-[640px] max-h-[85vh] overflow-hidden p-0 flex flex-col shadow-2xl border-border/80"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
                {providerActionSession.kind === "install" ? (
                  <DownloadIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : providerActionSession.kind === "update" ? (
                  <ArrowUpCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : providerActionSession.kind === "logout" ? (
                  <LogOutIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : providerActionSession.kind === "plugins" ? (
                  <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <LogInIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <DialogTitle className="shrink-0 text-sm font-semibold text-foreground">
                  {providerActionSession.kind === "install"
                    ? `Installing ${providerActionSession.providerName}`
                    : providerActionSession.kind === "update"
                      ? `Updating ${providerActionSession.providerName}`
                      : providerActionSession.kind === "logout"
                        ? `Logging out of ${providerActionSession.providerName}`
                        : providerActionSession.kind === "plugins"
                          ? `Plugins · ${providerActionSession.providerName}`
                          : `Signing in to ${providerActionSession.providerName}`}
                </DialogTitle>
                <code className="min-w-0 truncate rounded-md bg-muted px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                  {providerActionSession.command}
                </code>
                <Button
                  size="xs"
                  variant="ghost"
                  className="ms-auto h-6 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={closeProviderAction}
                  aria-label="Close provider action terminal"
                >
                  <XIcon className="size-3.5" />
                  Close
                </Button>
              </div>
              <DialogDescription className="sr-only">
                Interactive terminal for installing, updating, signing in to, or logging out of a
                provider.
              </DialogDescription>
              <div role="status" aria-live="polite" className="sr-only">
                {providerActionSession.kind === "login"
                  ? "Sign-in terminal opened"
                  : providerActionSession.kind === "logout"
                    ? "Log-out terminal opened"
                    : "Provider command terminal opened"}
              </div>
              {/^npm\s/.test(providerActionSession.command) && (
                <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  If npm is missing, install Node.js and npm or activate your Node version first. On
                  macOS or Linux, NVM users can try <code>nvm use --lts</code> in this terminal
                  before retrying the command.
                </p>
              )}
              <div className="min-h-0 w-full flex-1 bg-background p-2">
                <ThreadTerminalDrawer
                  variant="embedded"
                  showControls={false}
                  threadId={providerActionSession.threadId}
                  cwd={loginCwd}
                  height={580}
                  terminalIds={[DEFAULT_THREAD_TERMINAL_ID]}
                  activeTerminalId={DEFAULT_THREAD_TERMINAL_ID}
                  terminalGroups={[{ id: "action", terminalIds: [DEFAULT_THREAD_TERMINAL_ID] }]}
                  activeTerminalGroupId="action"
                  focusRequestId={0}
                  terminalLabels={{
                    [DEFAULT_THREAD_TERMINAL_ID]: providerActionSession.providerName,
                  }}
                  onSplitTerminal={() => {}}
                  onNewTerminal={() => {}}
                  onActiveTerminalChange={() => {}}
                  onCloseTerminal={closeProviderAction}
                  onHeightChange={() => {}}
                  onAddTerminalContext={() => {}}
                />
              </div>
            </DialogPopup>
          ) : null}
        </Dialog>
      </div>
      {confirmDialog}
    </SettingsEditorialFrame>
  );
}

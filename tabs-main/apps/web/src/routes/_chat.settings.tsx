import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowUpCircleIcon,
  BellIcon,
  BookOpenIcon,
  BotIcon,
  DownloadIcon,
  FingerprintIcon,
  FolderIcon,
  GitBranchIcon,
  InfoIcon,
  KeyboardIcon,
  Link2Icon,
  LogInIcon,
  LogOutIcon,
  MonitorPlayIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
  GaugeIcon,
  XIcon,
} from "lucide-react";
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
import { cn, getHashAwareSearchParams, isPopoutMode } from "~/lib/utils";
import { isElectron } from "~/env";
import { useConfirm } from "~/hooks/useConfirm";
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

export {
  SettingsSection,
  SettingsRow,
  SettingResetButton,
  SettingsHeaderPortal,
  SettingsSectionHeader,
} from "~/components/settings/SettingsLayout";

const NotificationsSettings = lazy(() =>
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

const GeneralSettings = lazy(() => import("~/components/settings/GeneralSettings"));
const ThemesSettings = lazy(() => import("~/components/settings/ThemesSettings"));
const AnimationsSettings = lazy(() => import("~/components/settings/AnimationsSettings"));
const ProvidersSettings = lazy(() => import("~/components/settings/ProvidersSettings"));
const AboutSettings = lazy(() => import("~/components/settings/AboutSettings"));
const ProjectWorkspaceSettingsSection = lazy(() =>
  import("~/components/ProjectWorkspaceSettingsSection").then((m) => ({
    default: m.ProjectWorkspaceSettingsSection,
  })),
);
const BrowserProfilesSettings = lazy(() =>
  import("~/components/settings/BrowserProfilesSettings").then((m) => ({
    default: m.BrowserProfilesSettings,
  })),
);
const KeybindingsSettings = lazy(() =>
  import("~/components/settings/KeybindingsSettings").then((m) => ({
    default: m.KeybindingsSettings,
  })),
);
const UsageLimitsPage = lazy(() =>
  import("~/components/settings/usage/UsageLimitsPage").then((m) => ({
    default: m.UsageLimitsPage,
  })),
);
const DiagnosticsSettings = lazy(() =>
  import("~/components/settings/DiagnosticsSettings").then((m) => ({
    default: m.DiagnosticsSettings,
  })),
);
const DocumentationSettings = lazy(() =>
  import("~/components/settings/DocumentationSettings").then((m) => ({
    default: m.DocumentationSettings,
  })),
);
const ConnectionsSettings = lazy(() =>
  import("~/components/settings/ConnectionsSettings").then((m) => ({
    default: m.ConnectionsSettings,
  })),
);
const SourceControlSettingsPanel = lazy(() =>
  import("~/components/settings/SourceControlSettings").then((m) => ({
    default: m.SourceControlSettingsPanel,
  })),
);

export type SettingsSectionId =
  | "general"
  | "notifications"
  | "themes"
  | "workspace"
  | "profiles"
  | "providers"
  | "usage"
  | "source-control"
  | "connections"
  | "startup-animation"
  | "keybindings"
  | "about"
  | "diagnostics"
  | "documentation";

const SETTINGS_NAV: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: typeof SlidersHorizontalIcon;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "notifications", label: "Notifications", icon: BellIcon },
  { id: "themes", label: "Themes", icon: PaletteIcon },
  { id: "startup-animation", label: "Animations", icon: MonitorPlayIcon },
  { id: "providers", label: "Providers", icon: BotIcon },
  { id: "usage", label: "Usage & Limits", icon: GaugeIcon },
  { id: "diagnostics", label: "Diagnostics", icon: ActivityIcon },
  { id: "documentation", label: "Documentation", icon: BookOpenIcon },
  { id: "source-control", label: "Source Control", icon: GitBranchIcon },
  { id: "connections", label: "Connections", icon: Link2Icon },
  { id: "workspace", label: "Workspace", icon: FolderIcon },
  { id: "profiles", label: "Browser Profiles", icon: FingerprintIcon },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon },
  { id: "about", label: "About", icon: InfoIcon },
];

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function SettingsRouteView() {
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
    void navigate({ to: "/" });
  }, [isAnyDraftDirty, dirtySources, confirm, navigate]);

  const serverConfig = useServerConfig();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const queryClient = useQueryClient();

  const isPopout = isPopoutMode();

  const [settingsViewState, updateSettingsViewState] = useSettingsViewState();
  const [initialUrlSection, setInitialUrlSection] = useState<SettingsSectionId | null>(() => {
    const section = getHashAwareSearchParams().get("section");
    return SETTINGS_NAV.some((item) => item.id === section) ? (section as SettingsSectionId) : null;
  });
  const activeSettingsSection =
    initialUrlSection ?? (settingsViewState.activeSection as SettingsSectionId) ?? "general";
  const setActiveSettingsSection = useCallback(
    (s: SettingsSectionId) => {
      setInitialUrlSection(null);
      updateSettingsViewState({ activeSection: s });
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("section", s);

        const hash = url.hash;
        const queryStart = hash.indexOf("?");
        if (queryStart >= 0) {
          const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
          hashParams.set("section", s);
          url.hash = `${hash.slice(0, queryStart)}?${hashParams.toString()}`;
        }
        window.history.replaceState(window.history.state, "", url.toString());
      }
    },
    [updateSettingsViewState],
  );
  const openSettingsSection = useCallback(
    (section: string) => {
      const target = SETTINGS_NAV.find((item) => item.id === section)?.id;
      if (target) setActiveSettingsSection(target);
    },
    [setActiveSettingsSection],
  );

  useEffect(() => {
    const syncUrlSection = () => {
      const section = getHashAwareSearchParams().get("section");
      setInitialUrlSection(
        SETTINGS_NAV.some((item) => item.id === section) ? (section as SettingsSectionId) : null,
      );
    };
    window.addEventListener("popstate", syncUrlSection);
    return () => window.removeEventListener("popstate", syncUrlSection);
  }, []);

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

  type ProviderActionKind = "login" | "logout" | "install" | "update";
  const [providerActionSession, setProviderActionSession] = useState<{
    provider: ProviderSettingsKey;
    providerName: string;
    command: string;
    followUpCommand?: string;
    kind: ProviderActionKind;
    threadId: ThreadId;
  } | null>(null);
  const providerActionCommandSentRef = useRef<string | null>(null);

  const startProviderAction = useCallback(
    (input: {
      provider: ProviderSettingsKey;
      providerName: string;
      command: string;
      followUpCommand?: string;
      kind: ProviderActionKind;
    }) => {
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
    [settings.providers.copilot?.gheHost],
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
          .catch(() => undefined);
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
      <div className="isolate flex h-screen min-h-0 min-w-0 flex-col overflow-y-auto overscroll-y-none bg-background text-foreground">
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
      </div>
    );
  }

  return (
    <div className="isolate flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <Button size="xs" variant="ghost" onClick={handleBack}>
                <ArrowLeftIcon className="size-3.5" />
                Back
              </Button>
              <span className="text-sm font-medium text-foreground">Settings</span>
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
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <Button size="xs" variant="ghost" className="no-drag" onClick={handleBack}>
              <ArrowLeftIcon className="size-3.5" />
              Back
            </Button>
            <span className="ml-2 text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
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
          <div className="flex h-full w-full gap-6 px-6 sm:px-10 lg:px-16">
            <nav className="w-48 shrink-0 space-y-0.5 py-4">
              {SETTINGS_NAV.map((item) => {
                const NavIcon = item.icon;
                const active = activeSettingsSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSettingsSection(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer",
                      active
                        ? "bg-accent font-semibold text-foreground shadow-2xs"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    <NavIcon className="size-3.5 shrink-0" />
                    <span className="capitalize flex-1">{item.label}</span>
                    {item.id === "notifications" && !active && <NotificationsBadge />}
                  </button>
                );
              })}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto overscroll-y-contain py-6">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-12">
                <Suspense
                  fallback={
                    <SettingsLoadingState
                      label={`Loading ${SETTINGS_NAV.find((item) => item.id === activeSettingsSection)?.label ?? "settings"}`}
                    />
                  }
                >
                  <div key={activeSettingsSection} className="tabs-surface-enter">
                    {activeSettingsSection === "general" ? <GeneralSettings /> : null}
                    {activeSettingsSection === "notifications" ? <NotificationsSettings /> : null}
                    {activeSettingsSection === "themes" ? <ThemesSettings /> : null}
                    {activeSettingsSection === "startup-animation" ? <AnimationsSettings /> : null}
                    {activeSettingsSection === "workspace" ? (
                      <ProjectWorkspaceSettingsSection />
                    ) : null}
                    {activeSettingsSection === "profiles" ? <BrowserProfilesSettings /> : null}
                    {activeSettingsSection === "source-control" ? (
                      <SourceControlSettingsPanel
                        startProviderAction={startProviderAction}
                        providerActionBusy={providerActionSession !== null}
                      />
                    ) : null}
                    {activeSettingsSection === "connections" ? <ConnectionsSettings /> : null}
                    {activeSettingsSection === "documentation" ? (
                      <DocumentationSettings onOpenSettingsSection={openSettingsSection} />
                    ) : null}
                    {activeSettingsSection === "providers" ? (
                      <ProvidersSettings
                        refreshProviders={refreshProviders}
                        isRefreshingProviders={isRefreshingProviders}
                        startProviderAction={startProviderAction}
                        providerActionBusy={providerActionSession !== null}
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
                  </div>
                </Suspense>
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
                        : `Signing in to ${providerActionSession.providerName}`}
                </DialogTitle>
                <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
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
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});

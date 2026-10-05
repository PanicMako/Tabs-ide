import { UsageAnalyticsSettings } from "./UsageAnalyticsSettings";
import { useEffect, useMemo, useState, useCallback } from "react";
import { LoaderCircleIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  DEFAULT_DESKTOP_ICON_THEME,
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  DEFAULT_REDUCED_MOTION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
} from "@tabs/contracts/settings";
import type { AiProvider, ServerProvider } from "@tabs/contracts";
import { createModelSelection } from "@tabs/shared/model";
import { useDebouncedSettingField, useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useConfirm } from "../../hooks/useConfirm";
import { useTheme } from "../../hooks/useTheme";
import { useResetOnboarding } from "../../onboarding/firstRun";
import { useZoomFactor, ZOOM_SNAP_POINTS } from "../../state/zoom";
import { useWorkspaceActiveProjectId } from "../../state/workspaceShell";
import { useServerConfig } from "../../state/settings";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsProviderModelPicker } from "../chat/SettingsProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  SettingResetButton,
  SettingsHeaderPortal,
  SettingsRow,
  SettingsSection,
  SettingsSectionHeader,
} from "./SettingsLayout";
import {
  getOsNotificationsEnabled,
  requestOsNotificationPermission,
  setOsNotificationsEnabled,
} from "../../stores/notificationStore";

const DESKTOP_ICON_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Follows your OS appearance.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Uses the dark background icon.",
  },
  {
    value: "light",
    label: "Light",
    description: "Uses the white icon variant.",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System",
  "12-hour": "12h",
  "24-hour": "24h",
} as const;

const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  tabs: "Tabs Agent",
  copilot: "GitHub Copilot",
};

const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];

function OsNotificationsToggle() {
  const [enabled, setEnabled] = useState(() => getOsNotificationsEnabled());
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported">(
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
  );

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        setOsNotificationsEnabled(false);
        setEnabled(false);
        return;
      }
      if (permissionState === "unsupported") return;
      if (permissionState === "denied") {
        toastManager.add({
          type: "warning",
          title: "Notifications blocked",
          description:
            "System notifications are blocked in your OS settings. Enable them for Tabs in your browser/system notification preferences.",
        });
        return;
      }
      setIsRequestingPermission(true);
      try {
        const granted = await requestOsNotificationPermission();
        const next = Notification.permission as NotificationPermission;
        setPermissionState(next);
        setEnabled(granted);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not request notification permission",
          description: error instanceof Error ? error.message : "Try again in system settings.",
        });
      } finally {
        setIsRequestingPermission(false);
      }
    },
    [permissionState],
  );

  if (permissionState === "unsupported") {
    return <span className="text-xs text-muted-foreground">Not supported in this environment</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {permissionState === "denied" && (
        <span className="text-[11px] text-warning">Blocked by OS</span>
      )}
      <Switch
        checked={enabled && permissionState === "granted"}
        onCheckedChange={handleToggle}
        aria-label="Enable system notifications"
        disabled={permissionState === "denied" || isRequestingPermission}
        aria-busy={isRequestingPermission}
      />
      {isRequestingPermission ? (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground" role="status">
          <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
          Waiting for permission…
        </span>
      ) : null}
    </div>
  );
}

export function GeneralSettings() {
  const resetOnboarding = useResetOnboarding();
  const { confirm } = useConfirm();
  const { setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [zoomFactor, updateZoom] = useZoomFactor();
  const activeProjectId = useWorkspaceActiveProjectId();
  const [isReloadingCode, setIsReloadingCode] = useState(false);
  const [isReloadingBrowser, setIsReloadingBrowser] = useState(false);
  const serverConfig = useServerConfig();

  const panelDurationField = useDebouncedSettingField<number>({
    value: settings.panelAnimationDurationMs ?? DEFAULT_PANEL_ANIMATION_DURATION_MS,
    onPersist: (val) => updateSettings({ panelAnimationDurationMs: val }),
    delay: 300,
  });

  const [confirmBeforeQuit, setConfirmBeforeQuit] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void window.desktopBridge?.getConfirmBeforeQuit?.().then((value) => {
      if (!cancelled && typeof value === "boolean") setConfirmBeforeQuit(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const serverProviders = serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;

  const textGenerationModelSelection = useMemo(
    () => resolveAppModelSelectionState(settings, serverProviders),
    [settings, serverProviders],
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;

  const gitModelInstanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const textGenInstanceEntry = useMemo(
    () => gitModelInstanceEntries.find((entry) => entry.instanceId === textGenInstanceId),
    [gitModelInstanceEntries, textGenInstanceId],
  );
  const textGenProvider = textGenInstanceEntry?.driverKind ?? "codex";
  const gitModelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(settings, serverProviders, textGenInstanceId, textGenModel),
    [settings, serverProviders, textGenInstanceId, textGenModel],
  );

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="General"
        description="Customize appearance, assistant behavior, display settings, and workspace preferences."
        actions={
          <SettingsHeaderPortal>
            <Button
              size="xs"
              variant="outline"
              className="no-drag cursor-pointer"
              onClick={async () => {
                const confirmed = await confirm(
                  "Restore default settings?\n\nThis will reset: Theme, Time format, Diff wrapping, Assistant output, New threads, and Confirmations.",
                );
                if (confirmed) {
                  setTheme("system");
                  updateSettings({
                    aiProvider: DEFAULT_UNIFIED_SETTINGS.aiProvider,
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                    confirmTabClose: DEFAULT_UNIFIED_SETTINGS.confirmTabClose,
                  });
                }
              }}
            >
              <RotateCcwIcon className="size-3.5 mr-1" />
              Restore defaults
            </Button>
          </SettingsHeaderPortal>
        }
      />

      <UsageAnalyticsSettings />

      {/* Group 1: Appearance & Interface */}
      <SettingsSection title="Appearance & Interface">
        <SettingsRow
          title="Zoom & Scale"
          description="Adjust interface zoom level. Drag slider or use Cmd + / Cmd -."
          resetAction={
            zoomFactor !== 1.0 ? (
              <SettingResetButton label="zoom" onClick={() => updateZoom(1.0)} />
            ) : null
          }
          control={(() => {
            const currentIndex = Math.max(
              0,
              ZOOM_SNAP_POINTS.findIndex((pt) => Math.abs(zoomFactor - pt) < 0.01),
            );
            return (
              <div className="flex flex-col gap-2 w-full sm:w-72">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground/70 font-medium">Scale Range</span>
                  <span className="font-mono font-bold text-foreground bg-accent/60 px-2.5 py-0.5 rounded-md text-xs shadow-xs border border-border/50">
                    {Math.round(zoomFactor * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() =>
                      updateZoom(ZOOM_SNAP_POINTS[Math.max(0, currentIndex - 1)] ?? 1.0)
                    }
                    title="Zoom Out (Cmd -)"
                    aria-label="Zoom Out"
                  >
                    <MinusIcon className="h-3.5 w-3.5" />
                  </Button>

                  <div className="relative flex-1 flex items-center px-1">
                    <input
                      type="range"
                      min="0"
                      max={ZOOM_SNAP_POINTS.length - 1}
                      step="1"
                      value={currentIndex}
                      onChange={(e) =>
                        updateZoom(ZOOM_SNAP_POINTS[parseInt(e.target.value, 10)] ?? 1.0)
                      }
                      aria-label="Zoom level slider"
                      className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer focus:outline-none relative z-10"
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() =>
                      updateZoom(
                        ZOOM_SNAP_POINTS[Math.min(ZOOM_SNAP_POINTS.length - 1, currentIndex + 1)] ??
                          1.0,
                      )
                    }
                    title="Zoom In (Cmd +)"
                    aria-label="Zoom In"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex justify-between px-8 text-[10px] font-mono text-muted-foreground/60 select-none">
                  {ZOOM_SNAP_POINTS.map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => updateZoom(pt)}
                      className="hover:text-foreground transition-colors cursor-pointer text-center w-8 -mx-1"
                      style={Math.abs(zoomFactor - pt) < 0.01 ? { fontWeight: "bold" } : undefined}
                    >
                      {Math.round(pt * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        />

        {isElectron ? (
          <SettingsRow
            title="Desktop icon"
            description="Choose which icon variant Tabs uses in the desktop shell and dock."
            resetAction={
              settings.desktopIconTheme !== DEFAULT_DESKTOP_ICON_THEME ? (
                <SettingResetButton
                  label="desktop icon"
                  onClick={() =>
                    updateSettings({
                      desktopIconTheme: DEFAULT_DESKTOP_ICON_THEME,
                    })
                  }
                />
              ) : null
            }
            control={
              <SegmentedControl
                value={settings.desktopIconTheme}
                onValueChange={(val) => {
                  if (val !== "dark" && val !== "light" && val !== "system") return;
                  updateSettings({
                    desktopIconTheme: val,
                  });
                }}
                options={DESKTOP_ICON_OPTIONS}
                aria-label="Desktop icon theme"
              />
            }
          />
        ) : null}

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <SegmentedControl
              value={settings.timestampFormat}
              onValueChange={(fmt) => updateSettings({ timestampFormat: fmt })}
              options={(["locale", "12-hour", "24-hour"] as const).map((fmt) => ({
                value: fmt,
                label: TIMESTAMP_FORMAT_LABELS[fmt],
                ariaLabel: `Time format: ${TIMESTAMP_FORMAT_LABELS[fmt]}`,
              }))}
              aria-label="Time format"
            />
          }
        />

        <SettingsRow
          title="Diff colors"
          description="Choose colors for additions and deletions across Git, pull requests, and file comparisons."
          resetAction={
            settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
              <SettingResetButton
                label="diff colors"
                onClick={() =>
                  updateSettings({
                    diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
                  })
                }
              />
            ) : null
          }
          control={
            <SegmentedControl
              value={settings.diffColorScheme}
              onValueChange={(val) => {
                if (val === "red-green" || val === "blue-orange") {
                  updateSettings({ diffColorScheme: val });
                }
              }}
              options={[
                {
                  value: "red-green",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <span className="flex shrink-0 gap-1" aria-hidden="true">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <span className="size-2 rounded-full bg-red-500" />
                      </span>
                      <span>Red & green</span>
                    </span>
                  ),
                  ariaLabel: "Diff colors: Red and green (default)",
                },
                {
                  value: "blue-orange",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <span className="flex shrink-0 gap-1" aria-hidden="true">
                        <span className="size-2 rounded-full bg-blue-500" />
                        <span className="size-2 rounded-full bg-orange-500" />
                      </span>
                      <span>Blue & orange</span>
                    </span>
                  ),
                  ariaLabel: "Diff colors: Blue and orange",
                },
              ]}
              aria-label="Diff colors"
            />
          }
        />

        <SettingsRow
          title="Panel animations"
          description="Set how fast workspace panels open and close (0 ms suppresses panel transitions)."
          resetAction={
            panelDurationField.value !== DEFAULT_PANEL_ANIMATION_DURATION_MS ? (
              <SettingResetButton
                label="panel animations"
                onClick={async () => {
                  panelDurationField.setValue(DEFAULT_PANEL_ANIMATION_DURATION_MS);
                  await panelDurationField.flush();
                }}
              />
            ) : null
          }
          control={
            <div className="flex items-center gap-3 w-full sm:w-72">
              <output
                htmlFor="panel-animation-duration"
                className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground border border-border/50"
              >
                {panelDurationField.value} ms
              </output>
              <input
                id="panel-animation-duration"
                type="range"
                min={0}
                max={400}
                step={25}
                value={panelDurationField.value}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isInteger(val) && val >= 0 && val <= 400) {
                    panelDurationField.onChange(val);
                  }
                }}
                onBlur={panelDurationField.onBlur}
                aria-label="Panel animation duration slider"
                className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer focus:outline-none relative z-10"
              />
            </div>
          }
        />

        <SettingsRow
          title="Reduced motion"
          description="Control whether decorative animations and interface transitions are reduced or suppressed."
          resetAction={
            (settings.reducedMotion ?? DEFAULT_REDUCED_MOTION_MODE) !==
            DEFAULT_REDUCED_MOTION_MODE ? (
              <SettingResetButton
                label="reduced motion"
                onClick={() =>
                  updateSettings({
                    reducedMotion: DEFAULT_REDUCED_MOTION_MODE,
                  })
                }
              />
            ) : null
          }
          control={
            <SegmentedControl
              value={settings.reducedMotion ?? DEFAULT_REDUCED_MOTION_MODE}
              onValueChange={(val) => {
                if (val === "system" || val === "always" || val === "never") {
                  updateSettings({ reducedMotion: val });
                }
              }}
              options={[
                {
                  value: "system",
                  label: "System",
                  ariaLabel: "System (follow OS reduced motion preference)",
                },
                {
                  value: "always",
                  label: "Always reduce",
                  ariaLabel: "Always reduce motion",
                },
                {
                  value: "never",
                  label: "Never reduce",
                  ariaLabel: "Never reduce motion",
                },
              ]}
              aria-label="Reduced motion"
            />
          }
        />
      </SettingsSection>

      {/* Group 2: Assistant & Code Generation */}
      <SettingsSection title="Assistant & Code Generation">
        <SettingsRow
          title="Code tool AI provider"
          description="Choose the AI assistant used within the embedded Code editor (Tabs Agent built-in side chat vs GitHub Copilot native chat). The standalone Agents tab always runs the Tabs agent."
          resetAction={
            settings.aiProvider !== DEFAULT_UNIFIED_SETTINGS.aiProvider ? (
              <SettingResetButton
                label="code tool AI provider"
                onClick={() =>
                  updateSettings({
                    aiProvider: DEFAULT_UNIFIED_SETTINGS.aiProvider,
                  })
                }
              />
            ) : null
          }
          control={
            <SegmentedControl
              value={settings.aiProvider}
              onValueChange={(provider) => updateSettings({ aiProvider: provider })}
              options={(["tabs", "copilot"] as const).map((provider) => ({
                value: provider,
                label: AI_PROVIDER_LABELS[provider],
                ariaLabel: `AI Provider: ${AI_PROVIDER_LABELS[provider]}`,
              }))}
              aria-label="Code tool AI provider"
            />
          }
        />

        <SettingsRow
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              onCheckedChange={(checked) =>
                updateSettings({
                  enableAssistantStreaming: Boolean(checked),
                })
              }
              aria-label="Stream assistant messages"
            />
          }
        />

        <SettingsRow
          title="Always create tasks"
          description="Synthesize task progress for providers that do not emit native task events."
          resetAction={
            settings.alwaysCreateTasks !== DEFAULT_UNIFIED_SETTINGS.alwaysCreateTasks ? (
              <SettingResetButton
                label="always create tasks"
                onClick={() =>
                  updateSettings({
                    alwaysCreateTasks: DEFAULT_UNIFIED_SETTINGS.alwaysCreateTasks,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.alwaysCreateTasks}
              onCheckedChange={(checked) =>
                updateSettings({
                  alwaysCreateTasks: Boolean(checked),
                })
              }
              aria-label="Always create tasks"
            />
          }
        />

        <SettingsRow
          title="Text generation model"
          description="Configure the model used for text generation (commit messages, PR content etc.)"
          resetAction={
            JSON.stringify(settings.textGenerationModelSelection ?? null) !==
            JSON.stringify(DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null) ? (
              <SettingResetButton
                label="text generation model"
                onClick={() => {
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  });
                }}
              />
            ) : null
          }
          control={
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <SettingsProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                instanceEntries={gitModelInstanceEntries}
                modelOptionsByInstance={gitModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider as any}
                models={textGenInstanceEntry?.models ?? []}
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>

      {/* Group 3: Diff & Display */}
      <SettingsSection title="Diff & Display">
        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens. The in-panel wrap toggle only affects the current diff session."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) =>
                updateSettings({
                  diffWordWrap: Boolean(checked),
                })
              }
              aria-label="Wrap diff lines by default"
            />
          }
        />

        <SettingsRow
          title="Colorize permissions"
          description="Apply distinct semantic colors to the different permission levels in the composer."
          resetAction={
            !settings.colorizePermissions ? (
              <SettingResetButton
                label="colorize permissions"
                onClick={() =>
                  updateSettings({
                    colorizePermissions: true,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.colorizePermissions}
              onCheckedChange={(checked) => {
                updateSettings({ colorizePermissions: checked });
              }}
              aria-label="Colorize permissions"
            />
          }
        />
      </SettingsSection>

      {/* Group 4: Workspace & Confirmations */}
      <SettingsSection title="Workspace & Confirmations">
        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value !== "local" && value !== "worktree") return;
                updateSettings({
                  defaultThreadEnvMode: value,
                });
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({
                  confirmThreadDelete: Boolean(checked),
                })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />

        <SettingsRow
          title="Confirm tab close"
          description="Ask before closing a project tab (cmd/ctrl+W or the tab's × button)."
          resetAction={
            settings.confirmTabClose !== DEFAULT_UNIFIED_SETTINGS.confirmTabClose ? (
              <SettingResetButton
                label="confirm tab close"
                onClick={() =>
                  updateSettings({
                    confirmTabClose: DEFAULT_UNIFIED_SETTINGS.confirmTabClose,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmTabClose}
              onCheckedChange={(checked) =>
                updateSettings({
                  confirmTabClose: Boolean(checked),
                })
              }
              aria-label="Confirm before closing a tab"
            />
          }
        />

        <SettingsRow
          title="Confirm before quitting"
          description="Ask for confirmation when quitting the app (Cmd+Q / closing the window)."
          control={
            <Switch
              checked={confirmBeforeQuit}
              onCheckedChange={(checked) => {
                const next = Boolean(checked);
                setConfirmBeforeQuit(next);
                void window.desktopBridge?.setConfirmBeforeQuit?.(next);
              }}
              aria-label="Confirm before quitting"
            />
          }
        />
        <SettingsRow
          title="System notifications"
          description="Show OS-level notifications for errors and warnings, so you're alerted even when Tabs is in the background. Excludes transient watchdog alerts."
          control={<OsNotificationsToggle />}
        />
      </SettingsSection>

      <SettingsSection title="Troubleshooting & Recovery">
        <SettingsRow
          title="Reload Embedded Code OSS"
          description="If the embedded editor visual state becomes corrupted, click reload to recreate the editor view without restarting Tabs."
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!isElectron || !activeProjectId || isReloadingCode}
              aria-busy={isReloadingCode}
              onClick={async () => {
                if (!activeProjectId) return;
                setIsReloadingCode(true);
                try {
                  const bridge = window.desktopBridge;
                  if (bridge) {
                    await bridge.recreateCodeSession({
                      projectId: activeProjectId,
                    });
                    toastManager.add({
                      type: "success",
                      title: "Code OSS reloaded",
                      description: "Re-created the Code OSS BrowserView successfully.",
                    });
                  }
                } catch (e) {
                  toastManager.add({
                    type: "error",
                    title: "Reload failed",
                    description: String(e),
                  });
                } finally {
                  setIsReloadingCode(false);
                }
              }}
            >
              {isReloadingCode ? (
                <LoaderCircleIcon className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              {isReloadingCode ? "Reloading Code OSS…" : "Reload Code OSS"}
            </Button>
          }
        />

        <SettingsRow
          title="Reload Embedded Browser Previews"
          description="If browser previews or custom embeds fail to synchronize, click reload to recreate the browser preview view."
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!isElectron || !activeProjectId || isReloadingBrowser}
              aria-busy={isReloadingBrowser}
              onClick={async () => {
                if (!activeProjectId) return;
                setIsReloadingBrowser(true);
                try {
                  const bridge = window.desktopBridge;
                  if (bridge) {
                    await bridge.recreateBrowserSession({
                      projectId: activeProjectId,
                    });
                    toastManager.add({
                      type: "success",
                      title: "Browser Preview reloaded",
                      description: "Re-created the Browser Preview BrowserView successfully.",
                    });
                  }
                } catch (e) {
                  toastManager.add({
                    type: "error",
                    title: "Reload failed",
                    description: String(e),
                  });
                } finally {
                  setIsReloadingBrowser(false);
                }
              }}
            >
              {isReloadingBrowser ? (
                <LoaderCircleIcon className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              {isReloadingBrowser ? "Reloading browser…" : "Reload Browser Preview"}
            </Button>
          }
        />

        <SettingsRow
          title="First-Run Setup Wizard"
          description="Revisit the welcome wizard to review Tabs' core architecture (Code, Agents, Server, Git, Browser, Testing), check AI provider configuration, and setup workspaces."
          control={
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                void resetOnboarding();
              }}
            >
              Re-run Setup Wizard
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}

export default GeneralSettings;

import { useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { Equal } from "effect";
import {
  ArrowUpCircleIcon,
  BotIcon,
  ChevronDownIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  InfoIcon,
  LoaderIcon,
  LogInIcon,
  LogOutIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  GoogleGemini,
  GrokIcon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
} from "~/components/Icons";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DebouncedSettingsInput } from "./DebouncedSettingsInput";
import { Switch } from "~/components/ui/switch";
import { Badge } from "~/components/ui/badge";
import { Collapsible, CollapsibleContent } from "~/components/ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogViewport,
} from "~/components/ui/dialog";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { toastManager } from "~/components/ui/toast";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useServerConfig } from "~/state/settings";
import { useSettingsViewState } from "~/state/scopedStateStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { getActiveFontCombo } from "~/lib/themes";
import { readNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { formatRelativeTime } from "~/timestampFormat";
import {
  getPinnedModels,
  isPinnedModel,
  reorderPinnedModels,
  togglePinnedModel,
} from "~/modelPinning";
import {
  applyCustomModelOrdering,
  isAllBuiltInModelsHidden,
  nextHiddenModelsForBulkToggle,
  resetModelOrder,
  toggleHiddenModel,
  updateHiddenModels,
  updateModelOrder,
} from "~/modelOrdering";
import { getDefaultServerModel, getProviderModels } from "~/providerModels";
import { MAX_CUSTOM_MODEL_LENGTH, resolveAppModelSelectionState } from "~/modelSelection";
import { normalizeModelSlug } from "@tabs/shared/model";
import {
  DEFAULT_UNIFIED_SETTINGS,
  PROVIDER_DISPLAY_NAMES,
  type ServerProvider,
  type ServerProviderModel,
  type UnifiedSettings,
} from "@tabs/contracts";
import { SettingsHeaderPortal } from "./SettingsLayout";
import { PROVIDER_SETTINGS_KEYS, type ProviderSettingsKey } from "./providerSettings.shared";

export type { ProviderSettingsKey } from "./providerSettings.shared";

const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];

const PROVIDER_ICONS_BY_KIND: Record<string, any> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  gemini: GoogleGemini,
  droid: DroidIcon,
  antigravity: AntigravityIcon,
  openrouter: OpenRouterIcon,
};

interface InstallProviderSettings {
  provider: ProviderSettingsKey;
  title: string;
  icon: any;
  binaryPlaceholder: string;
  binaryDescription: ReactNode;
  hasBinaryPath?: boolean;
  hasApiKey?: boolean;
  installCommand?: string;
  homePathKey?: "codexHomePath";
  homePlaceholder?: string;
  homeDescription?: ReactNode;
}

export const PROVIDER_SETTINGS: readonly InstallProviderSettings[] = [
  {
    provider: "codex",
    title: "Codex",
    icon: OpenAI,
    binaryPlaceholder: "Codex binary path",
    binaryDescription: "Path to the Codex binary",
    installCommand: "npm install -g @openai/codex",
    homePathKey: "codexHomePath",
    homePlaceholder: "CODEX_HOME",
    homeDescription: "Optional custom Codex home and config directory.",
  },
  {
    provider: "claudeAgent",
    title: "Claude",
    icon: ClaudeAI,
    binaryPlaceholder: "Claude binary path",
    binaryDescription: "Path to the Claude binary",
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
  {
    provider: "cursor",
    title: "Cursor",
    icon: CursorIcon,
    binaryPlaceholder: "Cursor Agent binary path",
    binaryDescription: "Path to the Cursor Agent binary",
    installCommand: "curl https://cursor.com/install -fsS | bash",
  },
  {
    provider: "copilot",
    title: "GitHub Copilot",
    icon: CopilotIcon,
    binaryPlaceholder: "Copilot binary path",
    binaryDescription: "Path to the GitHub Copilot CLI binary",
    installCommand: "npm install -g @github/copilot",
  },
  {
    provider: "grok",
    title: "Grok",
    icon: GrokIcon,
    binaryPlaceholder: "Grok binary path",
    binaryDescription: "Path to the Grok CLI binary",
    installCommand: "npm install -g @vibe-kit/grok-cli",
  },
  {
    provider: "opencode",
    title: "OpenCode",
    icon: OpenCodeIcon,
    binaryPlaceholder: "OpenCode binary path",
    binaryDescription: "Path to the OpenCode binary",
    installCommand: "npm install -g opencode-ai",
  },
  {
    provider: "kilo",
    title: "Kilo",
    icon: KiloIcon,
    binaryPlaceholder: "Kilo binary path",
    binaryDescription: "Path to the Kilo binary",
    installCommand: "npm install -g @kilocode/cli",
  },
  {
    provider: "droid",
    title: "Factory Droid",
    icon: DroidIcon,
    binaryPlaceholder: "droid",
    binaryDescription: "Path to the Factory Droid binary",
    installCommand: "curl -fsSL https://app.factory.ai/cli | sh",
    hasApiKey: true,
  },
  {
    provider: "antigravity",
    title: "Antigravity",
    icon: AntigravityIcon,
    binaryPlaceholder: "agy",
    binaryDescription: "Path to the Antigravity binary",
    installCommand: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  },
  {
    provider: "openrouter",
    title: "OpenRouter",
    icon: OpenRouterIcon,
    binaryPlaceholder: "",
    binaryDescription: "OpenRouter uses HTTPS and does not require a CLI.",
    hasBinaryPath: false,
    hasApiKey: true,
  },
];

if (import.meta.env.DEV && PROVIDER_SETTINGS.length !== PROVIDER_SETTINGS_KEYS.length) {
  throw new Error("Provider settings metadata is out of sync with the provider key list");
}

const PROVIDER_LOGIN_COMMAND: Partial<Record<ProviderSettingsKey, string>> = {
  codex: "codex login",
  claudeAgent: "claude auth login --claudeai",
  cursor: "cursor-agent login",
  copilot: "copilot login",
  grok: "grok login",
  opencode: "opencode auth login",
  kilo: "kilo auth login",
  droid: "droid auth login",
  antigravity: "agy",
};

const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
    badge: "warning" as const,
  },
  error: {
    dot: "bg-destructive",
    badge: "error" as const,
  },
  ready: {
    dot: "bg-success",
    badge: "success" as const,
  },
  warning: {
    dot: "bg-warning",
    badge: "warning" as const,
  },
} as const;

function SortableModelRowItem({
  id,
  children,
}: {
  id: string;
  children: (handle: Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-70")}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

function SortablePinnedModelItem({
  id,
  children,
}: {
  id: string;
  children: (handle: Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        isDragging && "relative z-20 opacity-70 shadow-md ring-1 ring-border rounded-lg",
      )}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

function getProviderSummary(provider: ServerProvider | undefined): {
  readonly headline: string;
  readonly detail: string | null;
} {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        provider.message ?? "This provider is installed but disabled for new sessions in Tabs.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const usesMeteredCredentials = ["api_key", "byok", "cloud_credential"].includes(
      provider.auth.credentialSource ?? "unknown",
    );
    return {
      headline: "Authenticated",
      detail:
        provider.message ??
        (usesMeteredCredentials
          ? `${provider.auth.billingLabel ?? provider.auth.label ?? "API credentials"}. Requests may incur usage-based charges; this is not using plan-included account access.`
          : (provider.auth.billingLabel ?? provider.auth.label ?? null)),
    };
  }
  if (provider.auth.status === "authenticated_unentitled") {
    return {
      headline: "No active seat",
      detail: provider.message ?? "GitHub account connected, but no active Copilot seat was found.",
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  return {
    headline: "Available",
    detail: provider.message ?? "Installed and ready, but authentication could not be verified.",
  };
}

function getProviderVersionLabel(version: string | null | undefined): string | null {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

interface ProviderUpdatePrompt {
  readonly headline: string;
  readonly detail: string | null;
  readonly command: string | null;
}

function getProviderUpdatePrompt(
  advisory: ServerProvider["versionAdvisory"] | undefined,
): ProviderUpdatePrompt | null {
  if (!advisory || advisory.status !== "behind_latest") {
    return null;
  }
  const latest = getProviderVersionLabel(advisory.latestVersion);
  const current = getProviderVersionLabel(advisory.currentVersion);
  const headline = latest ? `Update available — ${latest}` : "Update available";
  const detail =
    advisory.message ?? (current && latest ? `Installed ${current}, latest ${latest}.` : null);
  return { headline, detail, command: advisory.updateCommand };
}

function PinModelCommandPalette({
  serverProviders,
  settings,
  updateSettings,
  providerCards,
}: {
  serverProviders: ReadonlyArray<ServerProvider>;
  settings: Partial<UnifiedSettings> | null | undefined;
  updateSettings: (next: Partial<UnifiedSettings>) => void;
  providerCards: ReadonlyArray<{ provider: string; title: string }>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeProviderFilter, setActiveProviderFilter] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const pinnedEntries = getPinnedModels(settings);

  const allModels = useMemo(() => {
    const items: Array<{
      provider: string;
      providerName: string;
      model: ServerProviderModel;
    }> = [];

    for (const card of providerCards) {
      const providerName =
        PROVIDER_DISPLAY_NAMES[card.provider as keyof typeof PROVIDER_DISPLAY_NAMES] ?? card.title;
      const models = getProviderModels(serverProviders, card.provider);
      for (const m of models) {
        items.push({
          provider: card.provider,
          providerName,
          model: m,
        });
      }
    }
    return items;
  }, [providerCards, serverProviders]);

  const filteredModels = useMemo(() => {
    return allModels.filter(
      (item: { provider: string; providerName: string; model: ServerProviderModel }) => {
        if (activeProviderFilter && item.provider !== activeProviderFilter) {
          return false;
        }
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
          item.model.name.toLowerCase().includes(q) ||
          item.model.slug.toLowerCase().includes(q) ||
          item.providerName.toLowerCase().includes(q)
        );
      },
    );
  }, [allModels, activeProviderFilter, searchQuery]);

  if (allModels.length === 0) return null;

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => setIsOpen(true)}
      >
        <PlusIcon className="size-3.5" />
        Pin Model
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport>
            <DialogPopup
              showCloseButton={false}
              className="w-full max-w-xl p-0 overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2xl isolate my-auto"
            >
              {/* Search Header */}
              <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 bg-muted/20">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models to pin across all providers..."
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  autoFocus
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-muted-foreground/60 hover:text-foreground p-1 rounded cursor-pointer"
                  >
                    <XIcon className="size-4" />
                  </button>
                ) : null}
                <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground select-none">
                  ESC
                </kbd>
              </div>

              {/* Provider Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-2 border-b border-border/40 bg-muted/10 [&::-webkit-scrollbar]:hidden">
                <div
                  className="tabs-segmented inline-flex items-center shrink-0"
                  role="group"
                  aria-label="Provider filter"
                >
                  <button
                    type="button"
                    onClick={() => setActiveProviderFilter(null)}
                    aria-pressed={activeProviderFilter === null}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-full transition-all whitespace-nowrap cursor-pointer",
                      activeProviderFilter === null
                        ? "bg-foreground text-background font-semibold shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    All Providers
                  </button>
                  {providerCards.map((card) => {
                    const providerName =
                      PROVIDER_DISPLAY_NAMES[
                        card.provider as keyof typeof PROVIDER_DISPLAY_NAMES
                      ] ?? card.title;
                    const isSelected = activeProviderFilter === card.provider;
                    return (
                      <button
                        key={card.provider}
                        type="button"
                        onClick={() => setActiveProviderFilter(isSelected ? null : card.provider)}
                        aria-pressed={isSelected}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-full transition-all whitespace-nowrap cursor-pointer",
                          isSelected
                            ? "bg-foreground text-background font-semibold shadow-xs"
                            : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted",
                        )}
                      >
                        {providerName}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Model Results List */}
              <div className="max-h-96 overflow-y-auto p-2 divide-y divide-border/20">
                {filteredModels.length === 0 ? (
                  <div className="py-12 px-4 text-center select-none">
                    <SearchIcon className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                    <div className="text-sm font-medium text-foreground">No Matching Models</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                      No models match "{searchQuery}"
                    </div>
                  </div>
                ) : (
                  filteredModels.map(
                    (item: {
                      provider: string;
                      providerName: string;
                      model: ServerProviderModel;
                    }) => {
                      const IconComponent = PROVIDER_ICONS_BY_KIND[item.provider] ?? BotIcon;
                      const caps = item.model.capabilities;
                      const capLabels: string[] = [];
                      if (caps?.supportsFastMode) capLabels.push("Fast");
                      if (caps?.supportsThinkingToggle) capLabels.push("Thinking");
                      if (caps?.reasoningEffortLevels && caps.reasoningEffortLevels.length > 0)
                        capLabels.push("Reasoning");

                      const isPinned = isPinnedModel(pinnedEntries, item.provider, item.model.slug);

                      return (
                        <div
                          key={`${item.provider}:${item.model.slug}`}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-accent/50 transition-all group cursor-pointer"
                          onClick={() => {
                            const nextPinned = togglePinnedModel(
                              settings,
                              item.provider,
                              item.model.slug,
                            );
                            updateSettings({ pinnedModels: nextPinned as any });
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground group-hover:text-foreground group-hover:bg-muted">
                              <IconComponent className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-sm font-medium text-foreground truncate">
                                  {item.model.name}
                                </span>
                                <span className="text-xs font-mono text-muted-foreground/60 shrink-0">
                                  ({item.providerName})
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-xs font-mono text-muted-foreground/50 truncate">
                                  {item.model.slug}
                                </span>
                                {capLabels.map((label) => (
                                  <span
                                    key={label}
                                    className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted/50 text-muted-foreground/70 shrink-0 border border-border/30"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          {isPinned ? (
                            <Button
                              size="xs"
                              variant="secondary"
                              className="h-7 gap-1 px-2.5 text-xs font-medium text-foreground bg-muted/80 hover:bg-muted cursor-pointer shrink-0"
                            >
                              <PinIcon className="size-3.5 fill-current" />
                              Pinned
                            </Button>
                          ) : (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="h-7 gap-1 px-2.5 text-xs font-medium text-muted-foreground group-hover:text-foreground group-hover:bg-accent cursor-pointer shrink-0"
                            >
                              <PlusIcon className="size-3.5" />
                              Pin
                            </Button>
                          )}
                        </div>
                      );
                    },
                  )
                )}
              </div>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </Dialog>
    </>
  );
}

export interface ProvidersSettingsProps {
  serverProviders?: ReadonlyArray<ServerProvider>;
  refreshProviders: () => void | Promise<unknown>;
  isRefreshingProviders: boolean;
  startProviderAction: (action: {
    provider: ProviderSettingsKey;
    providerName: string;
    command: string;
    followUpCommand?: string;
    kind: "install" | "update" | "login" | "logout";
  }) => void;
  providerActionBusy: boolean;
}

export default function ProvidersSettings(props: ProvidersSettingsProps) {
  const { refreshProviders, isRefreshingProviders, startProviderAction, providerActionBusy } =
    props;

  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const serverProviders =
    props.serverProviders ?? serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const { fontPreferences } = useTheme();
  const activeFontCombo = useMemo(() => getActiveFontCombo(fontPreferences), [fontPreferences]);
  const { copyToClipboard } = useCopyToClipboard<{ providerName: string }>();

  const [settingsViewState, updateSettingsViewState] = useSettingsViewState();
  const openProviderDetails = settingsViewState.openProviderDetails as Partial<
    Record<ProviderSettingsKey, boolean>
  >;
  const setOpenProviderDetails = useCallback(
    (
      updater:
        | Partial<Record<ProviderSettingsKey, boolean>>
        | ((
            prev: Partial<Record<ProviderSettingsKey, boolean>>,
          ) => Partial<Record<ProviderSettingsKey, boolean>>),
    ) => {
      updateSettingsViewState((prev) => ({
        openProviderDetails:
          typeof updater === "function"
            ? (updater(prev.openProviderDetails as any) as any)
            : { ...prev.openProviderDetails, ...updater },
      }));
    },
    [updateSettingsViewState],
  );

  const customModelInputByProvider = settingsViewState.customModelInputByProvider as Partial<
    Record<ProviderSettingsKey, string>
  >;
  const setCustomModelInputByProvider = useCallback(
    (
      updater:
        | Partial<Record<ProviderSettingsKey, string>>
        | ((
            prev: Partial<Record<ProviderSettingsKey, string>>,
          ) => Partial<Record<ProviderSettingsKey, string>>),
    ) => {
      updateSettingsViewState((prev) => ({
        customModelInputByProvider:
          typeof updater === "function"
            ? (updater(prev.customModelInputByProvider as any) as any)
            : { ...prev.customModelInputByProvider, ...updater },
      }));
    },
    [updateSettingsViewState],
  );

  const draftModelOrders = settingsViewState.draftModelOrders as Partial<
    Record<ProviderSettingsKey, ReadonlyArray<string>>
  >;
  const setDraftModelOrders = useCallback(
    (
      updater:
        | Partial<Record<ProviderSettingsKey, ReadonlyArray<string>>>
        | ((
            prev: Partial<Record<ProviderSettingsKey, ReadonlyArray<string>>>,
          ) => Partial<Record<ProviderSettingsKey, ReadonlyArray<string>>>),
    ) => {
      updateSettingsViewState((prev) => ({
        draftModelOrders:
          typeof updater === "function"
            ? (updater(prev.draftModelOrders as any) as any)
            : { ...prev.draftModelOrders, ...updater },
      }));
    },
    [updateSettingsViewState],
  );

  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Record<string, string | null>
  >({});
  const [modelFilters, setModelFilters] = useState<Record<string, string>>({});
  const modelListRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const pinnedDndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const codexHomePath = settings.providers.codex.homePath;

  const handleSaveModelOrder = useCallback(
    (provider: ProviderSettingsKey) => {
      const pendingOrder = draftModelOrders[provider];
      if (pendingOrder) {
        const nextPrefs = updateModelOrder(settings.providerModelPreferences, provider, [
          ...pendingOrder,
        ]);
        updateSettings({ providerModelPreferences: nextPrefs as any });
        setDraftModelOrders((existing) => {
          const next = { ...existing };
          delete next[provider];
          return next;
        });
      }
    },
    [draftModelOrders, setDraftModelOrders, settings.providerModelPreferences, updateSettings],
  );

  const addCustomModel = useCallback(
    (provider: ProviderSettingsKey) => {
      const customModelInput = customModelInputByProvider[provider];
      const providerSettingsMap = settings.providers as Record<string, any>;
      const defaultProvidersMap = DEFAULT_UNIFIED_SETTINGS.providers as Record<string, any>;
      const customModels: string[] =
        providerSettingsMap[provider]?.customModels ??
        defaultProvidersMap[provider]?.customModels ??
        [];
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (
        serverProviders
          .find((candidate: ServerProvider) => candidate.instanceId === provider)
          ?.models.some(
            (option: ServerProviderModel) => !option.isCustom && option.slug === normalized,
          )
      ) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...(providerSettingsMap[provider] ?? defaultProvidersMap[provider]),
            customModels: [...customModels, normalized],
          },
        },
      });
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
      const el = modelListRefs.current[provider];
      if (el) {
        const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        requestAnimationFrame(scrollToEnd);
        const observer = new MutationObserver(() => {
          scrollToEnd();
          observer.disconnect();
        });
        observer.observe(el, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 2000);
      }
    },
    [
      customModelInputByProvider,
      serverProviders,
      setCustomModelInputByProvider,
      settings.providers,
      updateSettings,
    ],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderSettingsKey, slug: string) => {
      const providerSettingsMap = settings.providers as Record<string, any>;
      const defaultProvidersMap = DEFAULT_UNIFIED_SETTINGS.providers as Record<string, any>;
      const customModels: string[] =
        providerSettingsMap[provider]?.customModels ??
        defaultProvidersMap[provider]?.customModels ??
        [];
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...(providerSettingsMap[provider] ?? defaultProvidersMap[provider]),
            customModels: customModels.filter((model: string) => model !== slug),
          },
        },
      });
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings.providers, updateSettings],
  );

  const providerCards = useMemo(() => {
    return PROVIDER_SETTINGS.map((providerSettings) => {
      const liveProvider = serverProviders.find(
        (candidate: ServerProvider) => candidate.instanceId === providerSettings.provider,
      );
      const defaultProvidersMap = DEFAULT_UNIFIED_SETTINGS.providers as Record<string, any>;
      const currentProvidersMap = settings.providers as Record<string, any>;
      const defaultProviderConfig = defaultProvidersMap[providerSettings.provider];
      const providerConfig =
        currentProvidersMap[providerSettings.provider] ?? defaultProviderConfig;
      const statusKey = (liveProvider?.status ??
        (providerConfig?.enabled ? "warning" : "disabled")) as keyof typeof PROVIDER_STATUS_STYLES;
      const statusStyle = PROVIDER_STATUS_STYLES[statusKey] ?? PROVIDER_STATUS_STYLES.disabled;
      const summary = getProviderSummary(liveProvider);
      const baseModels =
        liveProvider?.models && liveProvider.models.length > 0
          ? liveProvider.models
          : getProviderModels(serverProviders, providerSettings.provider);
      const seenSlugs = new Set(baseModels.map((m: ServerProviderModel) => m.slug));
      const mergedModels: ServerProviderModel[] = [...baseModels];
      for (const customSlug of providerSettings.provider === "copilot"
        ? []
        : (providerConfig.customModels ?? [])) {
        if (!seenSlugs.has(customSlug)) {
          seenSlugs.add(customSlug);
          mergedModels.push({
            slug: customSlug,
            name: customSlug,
            isCustom: true,
            capabilities: null,
          });
        }
      }
      const customOrder =
        draftModelOrders[providerSettings.provider] ??
        settings.providerModelPreferences?.[providerSettings.provider as any]?.modelOrder;
      const models = applyCustomModelOrdering(mergedModels, customOrder, providerSettings.provider);
      const hasPendingOrderChanges = Boolean(
        draftModelOrders[providerSettings.provider] &&
        !Equal.equals(
          draftModelOrders[providerSettings.provider],
          settings.providerModelPreferences?.[providerSettings.provider as any]?.modelOrder ?? [],
        ),
      );
      const binaryPathValue = "binaryPath" in providerConfig ? providerConfig.binaryPath : "";
      const isDirty = !Equal.equals(providerConfig, defaultProviderConfig);

      return {
        provider: providerSettings.provider,
        title: providerSettings.title,
        icon: providerSettings.icon,
        badgeLabel: liveProvider?.badgeLabel ?? null,
        binaryPlaceholder: providerSettings.binaryPlaceholder,
        binaryDescription: providerSettings.binaryDescription,
        hasBinaryPath: providerSettings.hasBinaryPath !== false,
        hasApiKey: providerSettings.hasApiKey === true,
        homePathKey: providerSettings.homePathKey,
        homePlaceholder: providerSettings.homePlaceholder,
        homeDescription: providerSettings.homeDescription,
        binaryPathValue,
        isDirty,
        hasPendingOrderChanges,
        liveProvider,
        models,
        providerConfig,
        statusKey,
        statusStyle,
        summary,
        versionLabel: getProviderVersionLabel(liveProvider?.version),
        updatePrompt: getProviderUpdatePrompt(liveProvider?.versionAdvisory),
        needsInstall: Boolean(providerConfig.enabled && liveProvider && !liveProvider.installed),
        installCommand: providerSettings.installCommand,
        needsAuth: Boolean(
          providerConfig.enabled &&
          liveProvider?.installed === true &&
          liveProvider.auth.status === "unauthenticated",
        ),
        isAuthenticated: liveProvider?.auth.status === "authenticated",
        loginCommand:
          liveProvider?.lifecycleActions?.find((action: any) => action.kind === "login")?.command ??
          PROVIDER_LOGIN_COMMAND[providerSettings.provider] ??
          null,
        logoutCommand:
          liveProvider?.lifecycleActions?.find((action: any) => action.kind === "logout")
            ?.command ?? null,
      };
    });
  }, [draftModelOrders, serverProviders, settings.providerModelPreferences, settings.providers]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <h2
              className={cn(
                "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
                activeFontCombo.sansClass,
              )}
              style={{
                fontFamily: "var(--font-sans)",
                textTransform: "capitalize",
              }}
            >
              Providers
            </h2>
            <p className="text-sm text-muted-foreground">
              Manage AI providers, API keys, custom model endpoints, and status checks.
            </p>
          </div>
          <SettingsHeaderPortal>
            <Button
              size="xs"
              variant="outline"
              className="no-drag gap-1.5 cursor-pointer"
              disabled={isRefreshingProviders}
              onClick={() => void refreshProviders()}
            >
              {isRefreshingProviders ? (
                <LoaderIcon className="size-3.5 animate-spin text-foreground" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              {isRefreshingProviders ? "Refreshing..." : "Refresh models"}
            </Button>
          </SettingsHeaderPortal>
        </div>
        <div
          className="h-[5px] w-full my-5 rounded-full dark:block hidden"
          style={{
            background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)",
          }}
        />
        <div
          className="h-[5px] w-full my-5 rounded-full dark:hidden block"
          style={{
            background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)",
          }}
        />
      </div>

      {/* 📌 Pinned Models Section */}
      {(() => {
        const pinnedEntries = getPinnedModels(settings);
        return (
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-muted/80 text-foreground">
                  <PinIcon className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Pinned Models</h3>
                    <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                      {pinnedEntries.length}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Quick access models pinned across all providers. Appears at the top of
                    FusedModelPicker.
                  </p>
                </div>
              </div>

              {/* Cockpit Command Palette for Pinning Models */}
              <PinModelCommandPalette
                serverProviders={serverProviders}
                settings={settings}
                updateSettings={updateSettings}
                providerCards={providerCards}
              />
            </div>

            {pinnedEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 py-6 px-4 text-center">
                <PinIcon className="size-6 text-muted-foreground/40 mb-1.5" />
                <div className="text-xs font-medium text-foreground">No Pinned Models Yet</div>
                <div className="text-[11px] text-muted-foreground max-w-sm mt-0.5">
                  Click "+ Pin Model" above or the pin icon next to any model in your provider lists
                  below to pin it.
                </div>
              </div>
            ) : (
              <DndContext
                sensors={pinnedDndSensors}
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const oldIndex = pinnedEntries.findIndex(
                    (entry) => `${entry.provider}:${entry.model}` === active.id,
                  );
                  const newIndex = pinnedEntries.findIndex(
                    (entry) => `${entry.provider}:${entry.model}` === over.id,
                  );
                  if (oldIndex !== -1 && newIndex !== -1) {
                    const nextPinned = reorderPinnedModels(
                      settings.pinnedModels,
                      oldIndex,
                      newIndex,
                    );
                    updateSettings({
                      pinnedModels: nextPinned as any,
                    });
                  }
                }}
              >
                <SortableContext
                  items={pinnedEntries.map((entry) => `${entry.provider}:${entry.model}`)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {pinnedEntries.map((entry) => {
                      const itemId = `${entry.provider}:${entry.model}`;
                      const providerName =
                        PROVIDER_DISPLAY_NAMES[
                          entry.provider as keyof typeof PROVIDER_DISPLAY_NAMES
                        ] ?? entry.provider;
                      const IconComponent = PROVIDER_ICONS_BY_KIND[entry.provider] ?? BotIcon;

                      const providerModels = getProviderModels(serverProviders, entry.provider);
                      const matchedModel = providerModels.find((m) => m.slug === entry.model);
                      const displayName = matchedModel?.name ?? entry.model;

                      return (
                        <SortablePinnedModelItem key={itemId} id={itemId}>
                          {(handle) => (
                            <div className="group/pinnedcard flex items-center justify-between gap-2.5 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 transition-all hover:bg-muted/40 hover:border-border">
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  type="button"
                                  className="cursor-grab active:cursor-grabbing text-muted-foreground/40 group-hover/pinnedcard:text-muted-foreground hover:!text-foreground transition-colors p-0.5 rounded touch-none shrink-0"
                                  aria-label={`Reorder ${displayName}`}
                                  {...handle.attributes}
                                  {...handle.listeners}
                                >
                                  <GripVerticalIcon className="size-3.5" />
                                </button>
                                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/60">
                                  <IconComponent className="size-3.5 text-muted-foreground" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="text-xs font-semibold text-foreground truncate">
                                      {displayName}
                                    </span>
                                    <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
                                      ({providerName})
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        className="size-6 shrink-0 rounded text-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                        onClick={() => {
                                          const nextPinned = togglePinnedModel(
                                            settings.pinnedModels,
                                            entry.provider,
                                            entry.model,
                                          );
                                          updateSettings({
                                            pinnedModels: nextPinned as any,
                                          });
                                        }}
                                        aria-label={`Unpin ${displayName}`}
                                      >
                                        <PinIcon className="size-3.5 fill-current" />
                                      </Button>
                                    }
                                  />
                                  <TooltipPopup side="top">Unpin model</TooltipPopup>
                                </Tooltip>
                              </div>
                            </div>
                          )}
                        </SortablePinnedModelItem>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        );
      })()}

      <div className="flex items-center justify-between pb-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          Configured Providers
        </div>
        <div className="flex items-center gap-1.5">
          {serverProviders.length > 0 ? (
            <span className="text-[11px] text-muted-foreground/60">
              {(() => {
                const rel = formatRelativeTime(
                  serverProviders.reduce(
                    (latest: string, provider: ServerProvider) =>
                      provider.checkedAt > latest ? provider.checkedAt : latest,
                    serverProviders[0]!.checkedAt,
                  ),
                );
                return rel.suffix ? (
                  <>
                    Checked <span className="font-mono tabular-nums">{rel.value}</span> {rel.suffix}
                  </>
                ) : (
                  <>Checked {rel.value}</>
                );
              })()}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                  disabled={isRefreshingProviders}
                  onClick={() => void refreshProviders()}
                  aria-label="Refresh provider status"
                >
                  {isRefreshingProviders ? (
                    <LoaderIcon className="size-3 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3" />
                  )}
                </Button>
              }
            />
            <TooltipPopup side="top">Refresh provider status</TooltipPopup>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-4">
        {(() => {
          const enabledProvidersCount = providerCards.filter(
            (c) => c.providerConfig.enabled,
          ).length;
          return providerCards.map((providerCard) => {
            const isLastEnabledProvider =
              providerCard.providerConfig.enabled && enabledProvidersCount <= 1;
            const customModelInput = customModelInputByProvider[providerCard.provider];
            const customModelError = customModelErrorByProvider[providerCard.provider] ?? null;
            const providerDisplayName =
              PROVIDER_DISPLAY_NAMES[
                providerCard.provider as keyof typeof PROVIDER_DISPLAY_NAMES
              ] ?? providerCard.title;
            const RowIcon = providerCard.icon;

            return (
              <div
                key={providerCard.provider}
                className="rounded-xl border border-border bg-card p-0 overflow-hidden shadow-2xs hover:border-border/90 transition-all"
                data-slot="settings-row"
              >
                <div className="px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-h-5 items-center gap-1.5">
                        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
                          <RowIcon
                            aria-hidden="true"
                            className={cn(
                              "size-4",
                              providerCard.provider === "claudeAgent"
                                ? "text-[#d97757]"
                                : "text-muted-foreground/85",
                            )}
                          />
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-background",
                              providerCard.statusStyle.dot,
                            )}
                          />
                        </span>
                        <h3 className="text-sm font-medium text-foreground">
                          {providerDisplayName}
                        </h3>
                        {providerCard.versionLabel ? (
                          <code className="text-xs text-muted-foreground">
                            {providerCard.versionLabel}
                          </code>
                        ) : null}
                        {providerCard.updatePrompt ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label={`${providerDisplayName} update available`}
                                  className="inline-flex size-4 shrink-0 items-center justify-center rounded text-amber-600 hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400"
                                  onClick={() =>
                                    providerCard.updatePrompt?.command &&
                                    copyToClipboard(providerCard.updatePrompt.command, {
                                      providerName: providerDisplayName,
                                    })
                                  }
                                >
                                  <ArrowUpCircleIcon className="size-3.5" />
                                </button>
                              }
                            />
                            <TooltipPopup side="top">
                              Update available: click to copy installer command
                            </TooltipPopup>
                          </Tooltip>
                        ) : null}
                        {providerCard.isDirty ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  onClick={() => {
                                    const defaultProvidersMap =
                                      DEFAULT_UNIFIED_SETTINGS.providers as Record<string, any>;
                                    updateSettings({
                                      providers: {
                                        ...settings.providers,
                                        [providerCard.provider]:
                                          defaultProvidersMap[providerCard.provider],
                                      },
                                    });
                                  }}
                                  className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/65 hover:text-foreground"
                                  aria-label={`Reset ${providerDisplayName} to default settings`}
                                >
                                  <Undo2Icon className="size-3.5" />
                                </button>
                              }
                            />
                            <TooltipPopup side="top">
                              Reset provider settings to defaults
                            </TooltipPopup>
                          </Tooltip>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="text-muted-foreground">
                          {providerCard.summary.headline}
                          {providerCard.summary.detail ? ` — ${providerCard.summary.detail}` : null}
                        </span>
                        {providerCard.badgeLabel ? (
                          <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                            {providerCard.badgeLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                      {providerCard.needsInstall && providerCard.installCommand ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 px-2.5 text-xs cursor-pointer"
                          disabled={providerActionBusy}
                          onClick={() =>
                            startProviderAction({
                              provider: providerCard.provider,
                              providerName: providerDisplayName,
                              command: providerCard.installCommand!,
                              kind: "install",
                            })
                          }
                        >
                          <DownloadIcon className="size-3.5" />
                          Install
                        </Button>
                      ) : null}

                      {providerCard.updatePrompt?.command ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 px-2.5 text-xs cursor-pointer"
                          disabled={providerActionBusy}
                          onClick={() =>
                            startProviderAction({
                              provider: providerCard.provider,
                              providerName: providerDisplayName,
                              command: providerCard.updatePrompt!.command!,
                              kind: "update",
                            })
                          }
                        >
                          <ArrowUpCircleIcon className="size-3.5" />
                          Update
                        </Button>
                      ) : null}

                      {providerCard.needsAuth && providerCard.loginCommand ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 px-2.5 text-xs cursor-pointer"
                          disabled={providerActionBusy}
                          onClick={() =>
                            startProviderAction({
                              provider: providerCard.provider,
                              providerName: providerDisplayName,
                              command: providerCard.loginCommand ?? "",
                              kind: "login",
                            })
                          }
                        >
                          <LogInIcon className="size-3.5" />
                          Sign in
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() =>
                          setOpenProviderDetails((existing) => {
                            const isCurrentlyOpen = Boolean(existing[providerCard.provider]);
                            if (isCurrentlyOpen) {
                              return {};
                            }
                            return {
                              [providerCard.provider]: true,
                            };
                          })
                        }
                        aria-label={`Toggle ${providerDisplayName} details`}
                      >
                        <ChevronDownIcon
                          className={cn(
                            "size-3.5 transition-transform duration-200",
                            openProviderDetails[providerCard.provider] && "rotate-180",
                          )}
                        />
                      </Button>
                      {isLastEnabledProvider ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex items-center cursor-not-allowed">
                                <Switch
                                  checked={true}
                                  disabled={true}
                                  className="opacity-50 cursor-not-allowed"
                                  aria-label={`Enable ${providerDisplayName}`}
                                />
                              </span>
                            }
                          />
                          <TooltipPopup side="left">
                            At least one provider must remain enabled.
                          </TooltipPopup>
                        </Tooltip>
                      ) : (
                        <Switch
                          checked={providerCard.providerConfig.enabled}
                          onCheckedChange={(checked) => {
                            if (!checked && enabledProvidersCount <= 1) {
                              return;
                            }
                            const isDisabling = !checked;
                            const shouldClearModelSelection =
                              isDisabling && textGenInstanceId === providerCard.provider;
                            const currentProvidersMap = settings.providers as Record<string, any>;
                            const defaultProvidersMap =
                              DEFAULT_UNIFIED_SETTINGS.providers as Record<string, any>;
                            updateSettings({
                              providers: {
                                ...settings.providers,
                                [providerCard.provider]: {
                                  ...(currentProvidersMap[providerCard.provider] ??
                                    defaultProvidersMap[providerCard.provider]),
                                  enabled: Boolean(checked),
                                },
                              },
                              ...(shouldClearModelSelection
                                ? {
                                    textGenerationModelSelection:
                                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                                  }
                                : {}),
                            });
                          }}
                          aria-label={`Enable ${providerDisplayName}`}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <Collapsible
                  open={Boolean(openProviderDetails[providerCard.provider])}
                  onOpenChange={(open) =>
                    setOpenProviderDetails((existing) => {
                      const isCurrentlyOpen = Boolean(existing[providerCard.provider]);
                      if (open && !isCurrentlyOpen) {
                        return { [providerCard.provider]: true };
                      }
                      if (!open && isCurrentlyOpen) {
                        return {};
                      }
                      return existing;
                    })
                  }
                >
                  <CollapsibleContent>
                    <div className="space-y-0">
                      {/* Binary path */}
                      {providerCard.hasBinaryPath ? (
                        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                          <label
                            htmlFor={`provider-install-${providerCard.provider}-binary-path`}
                            className="block"
                          >
                            <span className="text-xs font-medium text-foreground">
                              {providerDisplayName} binary path
                            </span>
                            <DebouncedSettingsInput
                              id={`provider-install-${providerCard.provider}-binary-path`}
                              className="mt-1.5"
                              value={providerCard.binaryPathValue}
                              onPersist={(val) => {
                                return updateSettings({
                                  providers: {
                                    [providerCard.provider]: {
                                      binaryPath: val,
                                    },
                                  },
                                });
                              }}
                              placeholder={providerCard.binaryPlaceholder}
                              spellCheck={false}
                            />
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {providerCard.binaryDescription}
                            </span>
                          </label>
                        </div>
                      ) : null}

                      {providerCard.hasApiKey ? (
                        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                          <label className="block">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-foreground">API key</span>
                              {"apiKey" in providerCard.providerConfig &&
                              providerCard.providerConfig.apiKey ? (
                                <RedactedSensitiveText
                                  value={providerCard.providerConfig.apiKey}
                                  ariaLabel={`Toggle ${providerDisplayName} API key visibility`}
                                  revealTooltip="Click to reveal API key"
                                  hideTooltip="Click to hide API key"
                                />
                              ) : null}
                            </div>
                            <DebouncedSettingsInput
                              aria-label={`${providerDisplayName} API key`}
                              className="mt-1.5"
                              type="password"
                              value={
                                "apiKey" in providerCard.providerConfig
                                  ? providerCard.providerConfig.apiKey
                                  : ""
                              }
                              onPersist={(val) =>
                                updateSettings({
                                  providers: {
                                    [providerCard.provider]: {
                                      apiKey: val,
                                    },
                                  },
                                })
                              }
                              placeholder={
                                providerCard.provider === "openrouter"
                                  ? "sk-or-v1-..."
                                  : "FACTORY_API_KEY"
                              }
                              spellCheck={false}
                            />
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Stored in the operating system credential store and never written to
                              settings.json.
                            </span>
                          </label>
                        </div>
                      ) : null}

                      {/* Home path (Codex only) */}
                      {providerCard.homePathKey ? (
                        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                          <label
                            htmlFor={`provider-install-${providerCard.homePathKey}`}
                            className="block"
                          >
                            <span className="text-xs font-medium text-foreground">
                              CODEX_HOME path
                            </span>
                            <DebouncedSettingsInput
                              id={`provider-install-${providerCard.homePathKey}`}
                              className="mt-1.5"
                              value={codexHomePath}
                              onPersist={(val) =>
                                updateSettings({
                                  providers: {
                                    codex: {
                                      homePath: val,
                                    },
                                  },
                                })
                              }
                              placeholder={providerCard.homePlaceholder}
                              spellCheck={false}
                            />
                            {providerCard.homeDescription ? (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {providerCard.homeDescription}
                              </span>
                            ) : null}
                          </label>
                        </div>
                      ) : null}

                      {/* GitHub Enterprise Host & Token (Copilot only) */}
                      {providerCard.provider === "copilot" ? (
                        <>
                          <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                            <label htmlFor="provider-copilot-ghe-host" className="block">
                              <span className="text-xs font-medium text-foreground">
                                GitHub Enterprise Host (optional)
                              </span>
                              <DebouncedSettingsInput
                                id="provider-copilot-ghe-host"
                                className="mt-1.5"
                                value={settings.providers.copilot?.gheHost ?? ""}
                                onPersist={(val) =>
                                  updateSettings({
                                    providers: {
                                      copilot: {
                                        gheHost: val,
                                      },
                                    },
                                  })
                                }
                                placeholder="https://example.ghe.com"
                                spellCheck={false}
                              />
                              <span className="mt-1 block text-xs text-muted-foreground">
                                Leave blank for github.com. Appends --host to terminal sign-in
                                automatically.
                              </span>
                            </label>
                          </div>
                          <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                            <label htmlFor="provider-copilot-token" className="block">
                              <span className="text-xs font-medium text-foreground">
                                GitHub Token (optional)
                              </span>
                              <DebouncedSettingsInput
                                id="provider-copilot-token"
                                type="password"
                                className="mt-1.5"
                                value={settings.providers.copilot?.token ?? ""}
                                onPersist={(val) =>
                                  updateSettings({
                                    providers: {
                                      copilot: {
                                        token: val,
                                      },
                                    },
                                  })
                                }
                                placeholder="ghp_... or gho_... token"
                                spellCheck={false}
                              />
                              <span className="mt-1 block text-xs text-muted-foreground">
                                For token-based authentication instead of interactive web login.
                              </span>
                            </label>
                          </div>
                        </>
                      ) : null}

                      {/* Account & Session (Log out) */}
                      {providerCard.isAuthenticated && providerCard.logoutCommand ? (
                        <div className="border-t border-border/60 px-4 py-3 sm:px-5 flex items-center justify-between gap-4">
                          <div>
                            <span className="text-xs font-medium text-foreground">
                              Account Session
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Currently authenticated. Disconnect and log out of{" "}
                              {providerDisplayName}.
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1.5 px-2.5 text-xs cursor-pointer shrink-0 text-muted-foreground hover:text-foreground"
                            disabled={providerActionBusy}
                            onClick={() => {
                              const api = readNativeApi();
                              if (!api) return;
                              const secretPatch =
                                providerCard.provider === "copilot"
                                  ? {
                                      providers: {
                                        copilot: {
                                          token: "",
                                          byokApiKey: "",
                                        },
                                      },
                                    }
                                  : providerCard.provider === "opencode"
                                    ? {
                                        providers: {
                                          opencode: {
                                            serverPassword: "",
                                          },
                                        },
                                      }
                                    : providerCard.provider === "kilo"
                                      ? {
                                          providers: {
                                            kilo: {
                                              serverPassword: "",
                                            },
                                          },
                                        }
                                      : {};
                              void api.server
                                .updateSettings(secretPatch)
                                .then(() => {
                                  const isCopilot = providerCard.provider === "copilot";
                                  startProviderAction(
                                    isCopilot
                                      ? {
                                          provider: "copilot",
                                          providerName: providerDisplayName,
                                          command: "copilot",
                                          followUpCommand: "/logout",
                                          kind: "logout",
                                        }
                                      : {
                                          provider: providerCard.provider,
                                          providerName: providerDisplayName,
                                          command: providerCard.logoutCommand!,
                                          kind: "logout",
                                        },
                                  );
                                })
                                .catch(() => {
                                  toastManager.add({
                                    type: "error",
                                    title: `Could not log out of ${providerDisplayName}`,
                                    description:
                                      "Tabs could not clear the provider credentials. The logout command was not started.",
                                  });
                                });
                            }}
                            aria-label={`Log out of ${providerDisplayName}`}
                          >
                            <LogOutIcon className="size-3.5" />
                            Log out
                          </Button>
                        </div>
                      ) : null}

                      {/* Models Section */}
                      <div className="border-t border-border/60 px-4 py-4 sm:px-5">
                        <div className="rounded-xl border border-border/50 bg-muted/10 overflow-hidden shadow-2xs">
                          {(() => {
                            const filterValue = modelFilters[providerCard.provider] ?? "";
                            const isFiltering = filterValue.trim().length > 0;
                            const normalizedFilter = filterValue.trim().toLowerCase();
                            const filteredModels = isFiltering
                              ? providerCard.models.filter(
                                  (m: ServerProviderModel) =>
                                    m.name.toLowerCase().includes(normalizedFilter) ||
                                    m.slug.toLowerCase().includes(normalizedFilter),
                                )
                              : providerCard.models;

                            const hiddenModelsList =
                              settings.providerModelPreferences?.[providerCard.provider as any]
                                ?.hiddenModels ?? [];
                            const hiddenSet = new Set(hiddenModelsList);
                            const hiddenCount = providerCard.models.filter(
                              (m: ServerProviderModel) => !m.isCustom && hiddenSet.has(m.slug),
                            ).length;

                            const defaultModelSlug = getDefaultServerModel(
                              serverProviders,
                              providerCard.provider,
                            );
                            const preserveSlugs = [
                              "auto",
                              ...(defaultModelSlug ? [defaultModelSlug] : []),
                            ];

                            const allTargetHidden = isAllBuiltInModelsHidden(
                              filteredModels,
                              hiddenModelsList,
                              { preserveSlugs },
                            );
                            const builtInCount = filteredModels.filter(
                              (m: ServerProviderModel) => !m.isCustom,
                            ).length;

                            return (
                              <>
                                {/* Section Header */}
                                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-muted/20 border-b border-border/40">
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                      Models
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] px-1.5 py-0 font-mono"
                                      >
                                        {providerCard.models.length}
                                      </Badge>
                                      {hiddenCount > 0 ? (
                                        <Badge
                                          variant="secondary"
                                          className="text-[10px] px-1.5 py-0 text-muted-foreground"
                                        >
                                          {hiddenCount} hidden
                                        </Badge>
                                      ) : null}
                                      {isFiltering ? (
                                        <span className="text-[11px] text-muted-foreground font-normal">
                                          ({filteredModels.length} shown)
                                        </span>
                                      ) : null}
                                      {providerCard.liveProvider?.catalogStatus === "stale" ? (
                                        <Badge
                                          variant="secondary"
                                          className="text-[10px] px-1.5 py-0"
                                        >
                                          Stale
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                                      {providerCard.liveProvider?.catalogStatus === "stale"
                                        ? "Showing the last successful catalog. Refresh to retry discovery."
                                        : isFiltering
                                          ? "Filtered results. Clear search to reorder models."
                                          : "Drag handles to reorder, toggle switches to hide/show in picker."}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {/* Search Filter if provider has > 6 models or actively searching */}
                                    {providerCard.models.length > 6 || isFiltering ? (
                                      <div className="relative">
                                        <SearchIcon className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                                        <Input
                                          value={filterValue}
                                          onChange={(e) =>
                                            setModelFilters((prev) => ({
                                              ...prev,
                                              [providerCard.provider]: e.target.value,
                                            }))
                                          }
                                          placeholder="Filter models..."
                                          className="h-6 text-[11px] pl-6 pr-5 w-32 sm:w-40 bg-background/50 border-border/60"
                                        />
                                        {filterValue ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setModelFilters((prev) => ({
                                                ...prev,
                                                [providerCard.provider]: "",
                                              }))
                                            }
                                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                            aria-label="Clear filter"
                                          >
                                            <XIcon className="size-2.5" />
                                          </button>
                                        ) : null}
                                      </div>
                                    ) : null}

                                    {/* Bulk Toggle Button */}
                                    {builtInCount > 0 ? (
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium cursor-pointer border border-border/40"
                                        onClick={() => {
                                          const nextHidden = nextHiddenModelsForBulkToggle(
                                            filteredModels,
                                            hiddenModelsList,
                                            { preserveSlugs },
                                          );
                                          const nextPrefs = updateHiddenModels(
                                            settings.providerModelPreferences,
                                            providerCard.provider,
                                            nextHidden,
                                          );
                                          updateSettings({
                                            providerModelPreferences: nextPrefs as any,
                                          });
                                        }}
                                        title={
                                          allTargetHidden
                                            ? isFiltering
                                              ? "Enable all matching models for model picker"
                                              : "Enable all built-in models for model picker"
                                            : isFiltering
                                              ? "Disable all matching models from model picker"
                                              : "Disable all built-in models from model picker"
                                        }
                                      >
                                        {allTargetHidden ? (
                                          <>
                                            <EyeIcon className="size-3" />
                                            {isFiltering ? "Enable shown" : "Enable all"}
                                          </>
                                        ) : (
                                          <>
                                            <EyeOffIcon className="size-3" />
                                            {isFiltering ? "Disable shown" : "Disable all"}
                                          </>
                                        )}
                                      </Button>
                                    ) : null}

                                    {providerCard.hasPendingOrderChanges ? (
                                      <Button
                                        size="xs"
                                        variant="default"
                                        className="h-6 gap-1 text-[11px] bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer shadow-xs"
                                        onClick={() => handleSaveModelOrder(providerCard.provider)}
                                        title="Save model order changes"
                                      >
                                        <SaveIcon className="size-3" />
                                        Save Order
                                      </Button>
                                    ) : null}
                                    {settings.providerModelPreferences?.[
                                      providerCard.provider as any
                                    ]?.modelOrder?.length ? (
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                                        onClick={() => {
                                          setDraftModelOrders((existing) => {
                                            const next = {
                                              ...existing,
                                            };
                                            delete next[providerCard.provider];
                                            return next;
                                          });
                                          const nextPrefs = resetModelOrder(
                                            settings.providerModelPreferences,
                                            providerCard.provider,
                                          );
                                          updateSettings({
                                            providerModelPreferences: nextPrefs as any,
                                          });
                                        }}
                                        title="Restore default model order"
                                      >
                                        <RotateCcwIcon className="size-3" />
                                        Restore Default Order
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                {/* Sortable Model List */}
                                <div
                                  ref={(el) => {
                                    modelListRefs.current[providerCard.provider] = el;
                                  }}
                                  className="divide-y divide-border/30 p-1"
                                >
                                  {filteredModels.length === 0 ? (
                                    <div className="py-4 px-3 text-center text-xs text-muted-foreground">
                                      {isFiltering
                                        ? `No models match "${filterValue}".`
                                        : providerCard.provider === "copilot"
                                          ? "Copilot is not currently advertising any selectable models."
                                          : "No models available."}
                                    </div>
                                  ) : null}
                                  <DndContext
                                    collisionDetection={closestCenter}
                                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                                    onDragEnd={(event: DragEndEvent) => {
                                      const { active, over } = event;
                                      if (!over || active.id === over.id) return;
                                      const oldIndex = providerCard.models.findIndex(
                                        (m: ServerProviderModel) => m.slug === active.id,
                                      );
                                      const newIndex = providerCard.models.findIndex(
                                        (m: ServerProviderModel) => m.slug === over.id,
                                      );
                                      if (oldIndex !== -1 && newIndex !== -1) {
                                        const reordered = arrayMove(
                                          [...providerCard.models],
                                          oldIndex,
                                          newIndex,
                                        );
                                        const newOrder = reordered.map(
                                          (m: ServerProviderModel) => m.slug,
                                        );
                                        setDraftModelOrders((existing) => ({
                                          ...existing,
                                          [providerCard.provider]: newOrder,
                                        }));
                                      }
                                    }}
                                  >
                                    <SortableContext
                                      items={filteredModels.map((m: ServerProviderModel) => m.slug)}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      {filteredModels.map((model: ServerProviderModel) => {
                                        const caps = model.capabilities;
                                        const capLabels: string[] = [];
                                        if (caps?.supportsFastMode) capLabels.push("Fast");
                                        if (caps?.supportsThinkingToggle)
                                          capLabels.push("Thinking");
                                        if (
                                          caps?.reasoningEffortLevels &&
                                          caps.reasoningEffortLevels.length > 0
                                        )
                                          capLabels.push("Reasoning");
                                        const isPinned = isPinnedModel(
                                          getPinnedModels(settings),
                                          providerCard.provider,
                                          model.slug,
                                        );
                                        const isHidden =
                                          !model.isCustom && hiddenSet.has(model.slug);

                                        return (
                                          <SortableModelRowItem
                                            key={`${providerCard.provider}:${model.slug}`}
                                            id={model.slug}
                                          >
                                            {(handle) => (
                                              <div
                                                className={cn(
                                                  "group/modelrow flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-accent/40 transition-all",
                                                  isHidden && "opacity-60 bg-muted/20",
                                                )}
                                              >
                                                <div className="flex items-center gap-2 min-w-0">
                                                  {!isFiltering ? (
                                                    <button
                                                      type="button"
                                                      className="cursor-grab active:cursor-grabbing text-muted-foreground/30 group-hover/modelrow:opacity-100 opacity-0 hover:text-foreground transition-all p-0.5 rounded"
                                                      aria-label={`Reorder ${model.name}`}
                                                      {...handle.attributes}
                                                      {...handle.listeners}
                                                    >
                                                      <GripVerticalIcon className="size-3.5" />
                                                    </button>
                                                  ) : null}
                                                  <span
                                                    className={cn(
                                                      "min-w-0 truncate text-xs font-medium",
                                                      isHidden
                                                        ? "text-muted-foreground"
                                                        : "text-foreground/90",
                                                    )}
                                                  >
                                                    {model.name}
                                                  </span>
                                                  {capLabels.map((label) => (
                                                    <span
                                                      key={label}
                                                      className="text-[9px] font-mono px-1.2 py-0.2 rounded bg-muted/60 text-muted-foreground border border-border/30 shrink-0"
                                                    >
                                                      {label}
                                                    </span>
                                                  ))}
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                  <button
                                                    type="button"
                                                    aria-label={
                                                      isPinned
                                                        ? `Unpin ${model.name}`
                                                        : `Pin ${model.name}`
                                                    }
                                                    className={cn(
                                                      "size-6 p-1 rounded-md flex items-center justify-center transition-all cursor-pointer",
                                                      isPinned
                                                        ? "text-amber-500 hover:text-amber-600 bg-amber-500/10"
                                                        : "text-muted-foreground/40 opacity-0 group-hover/modelrow:opacity-100 hover:text-foreground hover:bg-muted",
                                                    )}
                                                    onClick={() => {
                                                      const nextPinned = togglePinnedModel(
                                                        settings,
                                                        providerCard.provider,
                                                        model.slug,
                                                      );
                                                      updateSettings({
                                                        pinnedModels: nextPinned as any,
                                                      });
                                                    }}
                                                  >
                                                    <PinIcon className="size-3.5 fill-current" />
                                                  </button>

                                                  {model.name !== model.slug ? (
                                                    <Tooltip>
                                                      <TooltipTrigger
                                                        render={
                                                          <button
                                                            type="button"
                                                            className="size-6 p-1 rounded-md flex items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground hover:bg-muted cursor-pointer"
                                                            aria-label={`Details for ${model.name}`}
                                                          >
                                                            <InfoIcon className="size-3.5" />
                                                          </button>
                                                        }
                                                      />
                                                      <TooltipPopup side="top" className="max-w-56">
                                                        <code className="text-[11px] text-foreground">
                                                          {model.slug}
                                                        </code>
                                                      </TooltipPopup>
                                                    </Tooltip>
                                                  ) : null}

                                                  {model.isCustom ? (
                                                    <div className="flex items-center gap-1 pl-1">
                                                      <Badge
                                                        variant="secondary"
                                                        className="text-[9px] px-1 py-0 font-normal"
                                                      >
                                                        custom
                                                      </Badge>
                                                      <button
                                                        type="button"
                                                        className="size-5 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                                                        aria-label={`Remove ${model.slug}`}
                                                        onClick={() =>
                                                          removeCustomModel(
                                                            providerCard.provider,
                                                            model.slug,
                                                          )
                                                        }
                                                      >
                                                        <XIcon className="size-3" />
                                                      </button>
                                                    </div>
                                                  ) : (
                                                    <Tooltip>
                                                      <TooltipTrigger
                                                        render={
                                                          <span className="flex items-center pl-1">
                                                            <Switch
                                                              checked={!isHidden}
                                                              onCheckedChange={(checked) => {
                                                                const nextPrefs = toggleHiddenModel(
                                                                  settings.providerModelPreferences,
                                                                  providerCard.provider,
                                                                  model.slug,
                                                                  !checked,
                                                                );
                                                                updateSettings({
                                                                  providerModelPreferences:
                                                                    nextPrefs as any,
                                                                });
                                                              }}
                                                              aria-label={`${!isHidden ? "Hide" : "Show"} ${model.name} in model picker`}
                                                              className="scale-75 origin-right cursor-pointer"
                                                            />
                                                          </span>
                                                        }
                                                      />
                                                      <TooltipPopup side="top">
                                                        {!isHidden
                                                          ? "Shown in model picker"
                                                          : "Hidden from model picker"}
                                                      </TooltipPopup>
                                                    </Tooltip>
                                                  )}
                                                </div>
                                              </div>
                                            )}
                                          </SortableModelRowItem>
                                        );
                                      })}
                                    </SortableContext>
                                  </DndContext>
                                </div>
                              </>
                            );
                          })()}

                          {/* Copilot model identifiers are authoritative and account-scoped. */}
                          {providerCard.provider !== "copilot" ? (
                            <div className="p-2.5 bg-muted/20 border-t border-border/40">
                              <div className="flex items-center gap-2">
                                <Input
                                  value={customModelInput ?? ""}
                                  onChange={(event) =>
                                    setCustomModelInputByProvider((existing) => ({
                                      ...existing,
                                      [providerCard.provider]: event.target.value,
                                    }))
                                  }
                                  placeholder="gpt-6.7-codex-ultra-preview"
                                  className="h-8 text-xs font-mono bg-background"
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      addCustomModel(providerCard.provider);
                                    }
                                  }}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1 text-xs shrink-0 cursor-pointer"
                                  onClick={() => addCustomModel(providerCard.provider)}
                                >
                                  <PlusIcon className="size-3.5" />
                                  Add
                                </Button>
                              </div>
                              {customModelError ? (
                                <div className="mt-1.5 text-[11px] font-medium text-destructive">
                                  {customModelError}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Save Order Footer Bar */}
                          {providerCard.hasPendingOrderChanges ? (
                            <div className="flex items-center justify-between p-2.5 bg-primary/10 border-t border-primary/20">
                              <span className="text-xs text-foreground font-medium">
                                Model preference order changed.
                              </span>
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 gap-1.5 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs"
                                onClick={() => handleSaveModelOrder(providerCard.provider)}
                              >
                                <SaveIcon className="size-3.5" />
                                Save Order
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

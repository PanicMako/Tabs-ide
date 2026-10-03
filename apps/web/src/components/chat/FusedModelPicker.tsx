import {
  type ModelSlug,
  type ProviderOptionChoice,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  PROVIDER_DISPLAY_NAMES,
  type ServerProvider,
  type ServerProviderModel,
} from "@tabs/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@tabs/shared/model";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ChevronDownIcon, LayersIcon, PinIcon, SearchIcon, XIcon, ZapIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ClaudeAI,
  AntigravityIcon,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  GrokIcon,
  type Icon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
} from "../Icons";
import nyanCatSliderWideGif from "~/assets/nyan-cat-slider-wide.gif";
import { cn } from "~/lib/utils";
import { getProviderModels, getProviderSnapshot } from "../../providerModels";
import { PROVIDER_OPTIONS, type ProviderPickerKind } from "../../session-logic";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { getPinnedModels, isPinnedModel, togglePinnedModel } from "../../modelPinning";
import {
  applyCustomModelOrdering,
  getModelScore,
  sortModelsByDefaultSequence,
} from "../../modelOrdering";
import { collectReasoningChoices, formatThinkingHeaderWords } from "../../reasoningOrdering";
import { getActiveFontCombo } from "../../lib/themes";
import { getStoredFontPreferences } from "../../hooks/useTheme";

// ─────────────────────────────────────────────────────────────────────────
// FusedModelPicker — AI Cockpit Matrix design (Aligned Columns & Compact Rows)
// Integrates left-sidebar provider selector, core tracks representing
// reasoning effort levels aligned to global header columns, inline sub-control
// pills (context size, open-code variant, and booleans), and a vertical lever
// on the right side for fastMode (Ultra).
// ─────────────────────────────────────────────────────────────────────────

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  droid: DroidIcon,
  antigravity: AntigravityIcon,
  openrouter: OpenRouterIcon,
};

const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(
  (option): option is typeof option & { available: true } => option.available,
);

const THEME_COLORS = [
  { hex: "#fbbf24", rgb: "251, 191, 38" },
  { hex: "#34d399", rgb: "52, 211, 153" },
  { hex: "#e879f9", rgb: "232, 121, 249" },
  { hex: "#60a5fa", rgb: "96, 165, 250" },
  { hex: "#f97316", rgb: "249, 115, 22" },
];

const EMPTY_CAPABILITIES = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
};

const MODEL_COLUMN_WIDTH_PX = 180;
const TRACK_PADDING_PX = 20;

interface FusedModelPickerProps {
  provider: ProviderPickerKind;
  model: ModelSlug;
  lockedProvider: ProviderPickerKind | null;
  providers: ReadonlyArray<ServerProvider>;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  onProviderModelChange: (
    provider: ProviderPickerKind,
    model: ModelSlug,
    options?: ReadonlyArray<ProviderOptionSelection>,
  ) => void;
  onModelOptionsChange: (options: ReadonlyArray<ProviderOptionSelection> | undefined) => void;
  /** Optional ref to anchor the popup to a specific element (e.g. the composer card) instead of the trigger */
  popupAnchorRef?: React.RefObject<HTMLElement | null>;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  alignOffset?: number;
}

function getCleanModelName(name: string, activeTab: ProviderPickerKind | "pinned" | null): string {
  if (activeTab === "pinned" || activeTab === null) {
    return name;
  }
  const prefixes: Record<string, ReadonlyArray<string>> = {
    claudeAgent: ["Claude "],
    opencode: ["OpenCode ", "opencode/"],
    codex: ["Codex "],
    cursor: ["Cursor "],
    grok: ["Grok "],
  };
  const list = prefixes[activeTab];
  if (!list) return name;
  for (const prefix of list) {
    if (name.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
  }
  return name;
}

export const FusedModelPicker = memo(function FusedModelPicker(props: FusedModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<ProviderPickerKind | "pinned" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [groupPinnedByProvider, setGroupPinnedByProvider] = useState<boolean>(() => {
    try {
      return localStorage.getItem("tabs:group-pinned-by-provider") === "true";
    } catch {
      return false;
    }
  });

  const toggleGroupPinnedByProvider = useCallback(() => {
    setGroupPinnedByProvider((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("tabs:group-pinned-by-provider", String(next));
      } catch {}
      return next;
    });
  }, []);

  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const pinnedList = useMemo(() => getPinnedModels(settings), [settings]);

  const isProviderEnabledInSettings = useCallback(
    (provider: ProviderPickerKind) => {
      const anyEnabled = AVAILABLE_PROVIDER_OPTIONS.some((o) => {
        const cfg = (settings.providers as any)?.[o.value];
        return cfg ? cfg.enabled !== false : true;
      });
      if (!anyEnabled) {
        return true;
      }
      const cfg = (settings.providers as any)?.[provider];
      if (cfg && typeof cfg.enabled === "boolean") {
        return cfg.enabled;
      }
      return true;
    },
    [settings.providers],
  );

  const providerOptions = useMemo(() => {
    if (props.lockedProvider) {
      return AVAILABLE_PROVIDER_OPTIONS.filter((o) => o.value === props.lockedProvider);
    }
    const enabled = AVAILABLE_PROVIDER_OPTIONS.filter((o) => isProviderEnabledInSettings(o.value));
    if (enabled.length === 0) {
      return AVAILABLE_PROVIDER_OPTIONS;
    }
    return enabled;
  }, [props.lockedProvider, isProviderEnabledInSettings]);

  const activeTab = useMemo(() => {
    if (selectedTab === "pinned") return "pinned";
    if (props.lockedProvider) return props.lockedProvider;
    if (selectedTab && providerOptions.some((o) => o.value === selectedTab)) {
      return selectedTab;
    }
    if (providerOptions.some((o) => o.value === props.provider)) {
      return props.provider;
    }
    return providerOptions[0]?.value ?? props.provider;
  }, [selectedTab, props.lockedProvider, props.provider, providerOptions]);
  const activeProvider = props.lockedProvider ?? props.provider;

  const collisionPadding = useMemo(() => ({ top: 12, right: 16, bottom: 12, left: 16 }), []);

  const checkIsPinned = useCallback(
    (providerId: string, modelSlug: string) => {
      return isPinnedModel(pinnedList, providerId, modelSlug);
    },
    [pinnedList],
  );

  const handleTogglePinned = useCallback(
    (providerId: string, modelSlug: string) => {
      const nextPinned = togglePinnedModel(settings, providerId, modelSlug);
      updateSettings({ pinnedModels: nextPinned as any });
    },
    [settings, updateSettings],
  );

  // Aggregated models with provider attribution across all providers
  const allProviderModels = useMemo(() => {
    const result: Array<ServerProviderModel & { providerId: string; providerName: string }> = [];
    for (const providerOption of providerOptions) {
      const providerSnapshot = getProviderSnapshot(props.providers, providerOption.value);
      const providerModels = getProviderModels(props.providers, providerOption.value);
      const name = providerSnapshot?.displayName ?? providerOption.label;
      for (const m of providerModels) {
        result.push({
          ...m,
          providerId: providerOption.value,
          providerName: name,
        });
      }
    }
    return result;
  }, [providerOptions, props.providers]);

  const pinnedModels = useMemo(() => {
    return allProviderModels.filter((m) => isPinnedModel(pinnedList, m.providerId, m.slug));
  }, [allProviderModels, pinnedList]);

  const models = useMemo(() => {
    if (activeTab === "pinned") {
      return pinnedModels;
    }
    const raw = getProviderModels(props.providers, activeTab);
    const prefs = settings.providerModelPreferences?.[activeTab as any];
    const hiddenSet = new Set(prefs?.hiddenModels ?? []);
    const visible = raw.filter(
      (m) => m.isCustom || !hiddenSet.has(m.slug) || m.slug === props.model,
    );
    const customOrder = prefs?.modelOrder;
    return applyCustomModelOrdering(visible, customOrder, activeTab);
  }, [activeTab, pinnedModels, props.providers, props.model, settings.providerModelPreferences]);

  const activeCatalogStatus =
    activeTab === "pinned"
      ? undefined
      : getProviderSnapshot(props.providers, activeTab)?.catalogStatus;
  const emptyCatalogMessage =
    activeCatalogStatus === "failed"
      ? "Model catalog refresh failed. Retry from Settings."
      : activeCatalogStatus === "stale"
        ? "The cached model catalog is unavailable. Retry from Settings."
        : activeCatalogStatus === "loading"
          ? "The model catalog is loading."
          : "No models are available for this provider account.";

  const activeModel = useMemo(() => {
    if (activeTab === "pinned") {
      return (
        pinnedModels.find((m) => m.providerId === props.provider && m.slug === props.model) ??
        pinnedModels[0] ??
        getProviderModels(props.providers, props.provider).find((m) => m.slug === props.model)
      );
    }
    const provModels = getProviderModels(props.providers, activeTab);
    return provModels.find((m) => m.slug === props.model) ?? provModels[0];
  }, [activeTab, pinnedModels, props.providers, props.provider, props.model]);

  const fontCombo = useMemo(() => getActiveFontCombo(getStoredFontPreferences()), []);

  const setModelAndOptions = useCallback(
    (
      provider: ProviderPickerKind,
      slug: string,
      nextOptions?: ReadonlyArray<ProviderOptionSelection>,
    ) => {
      const isTargetClaude = provider === "claudeAgent";
      const targetEffort = nextOptions?.find(
        (o) => o.id === "effort" || o.id === "reasoningEffort" || (o as any).name === "effort",
      )?.value;
      const isTargetUltrathink = isTargetClaude && targetEffort === "ultrathink";
      if (isTargetUltrathink) {
        props.onPromptChange(applyClaudePromptEffortPrefix(props.prompt, "ultrathink"));
      } else if (isClaudeUltrathinkPrompt(props.prompt)) {
        props.onPromptChange(applyClaudePromptEffortPrefix(props.prompt, null));
      }
      // Detect if fast mode is currently active from the current model options
      const currentFastActive =
        props.modelOptions?.some(
          (o) =>
            ((o.id === "fastMode" || o.id === "fast") && o.value === true) ||
            ((o.id === "serviceTier" || o.id === "service_tier" || o.id === "tier") &&
              o.value === "fast"),
        ) ?? false;
      // Forward the current fast-mode state to the new model, so switching
      // models doesn't silently reset Fast Mode to off.
      let finalOptions = nextOptions;
      if (currentFastActive && nextOptions !== undefined) {
        const hasFastOption = nextOptions.some(
          (o) =>
            o.id === "fastMode" ||
            o.id === "fast" ||
            o.id === "serviceTier" ||
            o.id === "service_tier" ||
            o.id === "tier",
        );
        if (!hasFastOption) {
          const targetModel = getProviderModels(props.providers, provider).find(
            (m) => m.slug === slug,
          );
          if (targetModel) {
            const targetDescs = getProviderOptionDescriptors({
              caps: targetModel.capabilities ?? EMPTY_CAPABILITIES,
              selections: nextOptions,
            });
            const targetFastBoolean = targetDescs.find(
              (d) => d.type === "boolean" && (d.id === "fastMode" || d.id === "fast"),
            );
            const targetFastSelect = targetDescs.find(
              (d) =>
                d.type === "select" &&
                (d.id === "serviceTier" || d.id === "service_tier" || d.id === "tier") &&
                (d as any).options?.some((o: any) => (o.id ?? o.value) === "fast"),
            );
            if (targetFastBoolean) {
              finalOptions = [
                ...nextOptions.filter((o) => o.id !== targetFastBoolean.id),
                { id: targetFastBoolean.id, value: true },
              ];
            } else if (targetFastSelect) {
              finalOptions = [
                ...nextOptions.filter((o) => o.id !== targetFastSelect.id),
                { id: targetFastSelect.id, value: "fast" },
              ];
            }
          }
        }
      }
      props.onProviderModelChange(provider, slug, finalOptions);
    },
    [props],
  );

  const descriptors = useMemo(
    () =>
      activeModel
        ? getProviderOptionDescriptors({
            caps: activeModel.capabilities ?? EMPTY_CAPABILITIES,
            selections: props.modelOptions,
          }).filter((d) => d.id !== "agent")
        : [],
    [activeModel, props.modelOptions],
  );

  const selectDescriptors = descriptors.filter(
    (d): d is Extract<ProviderOptionDescriptor, { type: "select" }> => d.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (d): d is Extract<ProviderOptionDescriptor, { type: "boolean" }> => d.type === "boolean",
  );

  // Boolean fast mode (e.g. Claude fastMode) or Select fast tier (e.g. Codex serviceTier with "fast" option)
  const booleanFastModeDescriptor =
    booleanDescriptors.find((d) => d.id === "fastMode" || d.id === "fast") ?? null;
  const selectFastModeDescriptor =
    selectDescriptors.find(
      (d) =>
        (d.id === "serviceTier" || d.id === "service_tier" || d.id === "tier") &&
        d.options.some((o) => (o.id ?? (o as any).value) === "fast"),
    ) ?? null;

  const leverDescriptor = booleanFastModeDescriptor ?? selectFastModeDescriptor ?? null;

  const isUltra = useMemo(() => {
    if (booleanFastModeDescriptor) {
      return booleanFastModeDescriptor.currentValue === true;
    }
    if (selectFastModeDescriptor) {
      const currentVal = getProviderOptionCurrentValue(selectFastModeDescriptor);
      return currentVal === "fast";
    }
    return false;
  }, [booleanFastModeDescriptor, selectFastModeDescriptor]);

  const commitDescriptors = useCallback(
    (next: ReadonlyArray<ProviderOptionDescriptor>) => {
      const selections = buildProviderOptionSelectionsFromDescriptors(next);
      props.onModelOptionsChange(selections);
    },
    [props],
  );

  const handleSelectChange = useCallback(
    (descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>, optionId: string) => {
      const isPromptInjected =
        descriptor.promptInjectedValues && descriptor.promptInjectedValues.length > 0;
      if (isPromptInjected && (descriptor.id === "effort" || descriptor.id === "reasoningEffort")) {
        props.onPromptChange(applyClaudePromptEffortPrefix(props.prompt, optionId));
      } else if (descriptor.id === "effort" || descriptor.id === "reasoningEffort") {
        if (isClaudeUltrathinkPrompt(props.prompt)) {
          props.onPromptChange(applyClaudePromptEffortPrefix(props.prompt, null));
        }
      }
      commitDescriptors(
        descriptors.map((d) =>
          d.id === descriptor.id && d.type === "select" ? { ...d, currentValue: optionId } : d,
        ),
      );
    },
    [commitDescriptors, descriptors, props],
  );

  const handleBooleanChange = useCallback(
    (descriptor: Extract<ProviderOptionDescriptor, { type: "boolean" }>, value: boolean) => {
      commitDescriptors(
        descriptors.map((d) =>
          d.id === descriptor.id && d.type === "boolean" ? { ...d, currentValue: value } : d,
        ),
      );
    },
    [commitDescriptors, descriptors],
  );

  const handleFastModeChange = useCallback(
    (value: boolean) => {
      if (booleanFastModeDescriptor) {
        handleBooleanChange(booleanFastModeDescriptor, value);
      } else if (selectFastModeDescriptor) {
        const defaultOpt =
          selectFastModeDescriptor.options.find(
            (o) => (o.id ?? (o as any).value) !== "fast" && o.isDefault,
          ) ??
          selectFastModeDescriptor.options.find((o) => (o.id ?? (o as any).value) !== "fast") ??
          selectFastModeDescriptor.options[0];
        const defaultVal =
          (defaultOpt ? (defaultOpt.id ?? (defaultOpt as any).value) : "default")?.toString() ??
          "default";
        const nextVal = value ? "fast" : defaultVal;
        handleSelectChange(selectFastModeDescriptor, nextVal);
      }
    },
    [booleanFastModeDescriptor, selectFastModeDescriptor, handleBooleanChange, handleSelectChange],
  );

  // Identify the primary select descriptor (reasoning effort)
  const activePrimarySelect = useMemo(
    () =>
      selectDescriptors.find(
        (d) =>
          d.id === "reasoningEffort" ||
          d.id === "effort" ||
          d.id === "reasoning" ||
          d.id === "variant" ||
          d.id.toLowerCase().includes("effort") ||
          d.id.toLowerCase().includes("reasoning") ||
          d.id.toLowerCase().includes("variant"),
      ) ?? null,
    [selectDescriptors],
  );

  // Precompute option descriptors for models once to prevent redundant calculations during render
  const modelDescriptorsList = useMemo(() => {
    return models.map((m) => {
      const providerId = (m as any).providerId;
      if (providerId === "grok" || m.slug.toLowerCase().startsWith("grok")) {
        return [];
      }
      const caps = m.capabilities ?? EMPTY_CAPABILITIES;
      return getProviderOptionDescriptors({ caps, selections: undefined }).filter(
        (d) => d.id !== "agent",
      );
    });
  }, [models]);

  // Build union of reasoning stops dynamically from model capabilities via reasoningOrdering
  const globalStops = useMemo(() => {
    return collectReasoningChoices(modelDescriptorsList);
  }, [modelDescriptorsList]);

  const matrixMinWidthClass =
    globalStops.length >= 8
      ? "min-w-[40rem]"
      : globalStops.length >= 7
        ? "min-w-[37rem]"
        : globalStops.length >= 6
          ? "min-w-[34rem]"
          : "min-w-[30rem]";

  // Filter models based on search query
  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => {
      const cleanName = getCleanModelName(m.name, activeTab).toLowerCase();
      const fullName = m.name.toLowerCase();
      const slug = m.slug.toLowerCase();
      const subProvider = (m.subProvider ?? "").toLowerCase();
      const providerName = ((m as any).providerName ?? "").toLowerCase();
      return (
        cleanName.includes(query) ||
        fullName.includes(query) ||
        slug.includes(query) ||
        subProvider.includes(query) ||
        providerName.includes(query)
      );
    });
  }, [models, searchQuery, activeTab]);

  // Group filtered models hierarchically by subProvider or provider name
  const groupedModels = useMemo(() => {
    const groups: Array<{
      name: string | null;
      items: Array<ServerProviderModel & { providerId?: string }>;
    }> = [];

    if (activeTab === "pinned") {
      if (!groupPinnedByProvider) {
        return [{ name: null, items: filteredModels }];
      }
      for (const model of filteredModels) {
        const pId = (model as any).providerId;
        const pName =
          (model as any).providerName ??
          PROVIDER_DISPLAY_NAMES[pId as keyof typeof PROVIDER_DISPLAY_NAMES] ??
          pId ??
          "Other";
        let group = groups.find((g) => g.name === pName);
        if (!group) {
          group = { name: pName, items: [] };
          groups.push(group);
        }
        group.items.push(model);
      }
      return groups;
    }

    for (const model of filteredModels) {
      const groupName = model.subProvider ?? null;
      let group = groups.find((g) => g.name === groupName);
      if (!group) {
        group = { name: groupName, items: [] };
        groups.push(group);
      }
      group.items.push(model);
    }
    return groups;
  }, [activeTab, filteredModels, groupPinnedByProvider]);

  const activeTabHeading = useMemo(() => {
    if (activeTab === "pinned") return "pinned";
    if (activeTab === "claudeAgent") return "claude";
    const found = AVAILABLE_PROVIDER_OPTIONS.find((o) => o.value === activeTab)?.label;
    return (found ?? activeTab).toLowerCase();
  }, [activeTab]);

  const triggerLabel = useMemo(() => {
    if (!activeModel) return "Select model";
    const parts = [activeModel.name];
    if (leverDescriptor?.currentValue === true) {
      parts.push("Fast");
    } else if (activePrimarySelect) {
      const value = getProviderOptionCurrentValue(activePrimarySelect);
      const label = activePrimarySelect.options.find((o) => o.id === value)?.label;
      if (label) parts.push(label);
    }
    return parts.join(" · ");
  }, [activeModel, leverDescriptor, activePrimarySelect]);

  const activeColorIndex = useMemo(
    () =>
      Math.max(
        0,
        models.findIndex((m) => m.slug === activeModel?.slug),
      ),
    [models, activeModel],
  );
  const activeColor = THEME_COLORS[activeColorIndex % THEME_COLORS.length] ?? THEME_COLORS[0]!;

  const panelStyle = isUltra
    ? ({
        "--dynamic-ultra-hex": activeColor.hex,
        "--dynamic-ultra-rgb": activeColor.rgb,
      } as React.CSSProperties)
    : undefined;

  const ActiveIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];

  const isExpandedPicker = Boolean(leverDescriptor) || globalStops.length >= 8;

  const showSearch = models.length > 6 || searchQuery.length > 0;

  return (
    <Menu
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setSelectedTab(null);
          setSearchQuery("");
        }
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "min-w-0 max-w-72 justify-start gap-2 overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80",
              props.triggerClassName,
            )}
          />
        }
      >
        <ActiveIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup
        side={props.side ?? "top"}
        sideOffset={props.sideOffset ?? 8}
        align={props.align ?? "start"}
        alignOffset={props.alignOffset ?? 0}
        anchor={props.popupAnchorRef}
        collisionPadding={collisionPadding}
        className="w-auto max-w-[calc(100vw-32px)] p-0 bg-transparent"
      >
        <style>{COSMIC_KEYFRAMES}</style>
        <div
          className="relative flex max-w-[calc(100vw-32px)] gap-6 rounded-[24px] overflow-hidden isolate border border-border bg-popover text-popover-foreground p-6 shadow-xl transition-all duration-300 select-none animate-in fade-in zoom-in-95 duration-150"
          style={panelStyle}
        >
          {/* Provider Sidebar navigation on Left */}
          {(providerOptions.length > 1 ||
            pinnedModels.length > 0 ||
            AVAILABLE_PROVIDER_OPTIONS.length > 1) && (
            <div className="flex flex-col gap-2.5 border-r border-border pr-6">
              {/* 📌 Pinned Models Tab */}
              <Tooltip key="pinned">
                <TooltipTrigger className="inline-flex">
                  <button
                    type="button"
                    title="Pinned Models"
                    onClick={() => {
                      setSelectedTab("pinned");
                      setSearchQuery("");
                    }}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl bg-muted/40 border border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all relative",
                      activeTab === "pinned" && "bg-accent border-border text-foreground shadow-xs",
                    )}
                  >
                    <PinIcon
                      aria-hidden="true"
                      className={cn(
                        "size-5 transition-colors",
                        activeTab === "pinned" ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                    {pinnedModels.length > 0 && (
                      <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-muted border border-border text-[9px] font-bold text-muted-foreground">
                        {pinnedModels.length}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipPopup side="right" className="text-xs">
                  <span>Pinned Models</span>
                </TooltipPopup>
              </Tooltip>

              <div className="h-px w-full bg-border my-0.5" />

              {providerOptions.map((option) => {
                const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
                const snapshot = getProviderSnapshot(props.providers, option.value);
                const disabled = snapshot ? snapshot.status !== "ready" : false;
                const isActive = option.value === activeTab;

                let disabledReason: string | null = null;
                if (disabled) {
                  if (snapshot) {
                    if (!snapshot.installed) {
                      disabledReason =
                        snapshot.message ?? `${option.label} CLI not detected on PATH.`;
                    } else if (snapshot.auth?.status === "authenticated_unentitled") {
                      disabledReason =
                        snapshot.message ??
                        "GitHub account connected, but no active Copilot seat was found.";
                    } else if (snapshot.auth?.status === "unauthenticated") {
                      disabledReason =
                        snapshot.message ??
                        `${option.label} is not authenticated. Please log in in Settings → Providers.`;
                    } else if (snapshot.message) {
                      disabledReason = snapshot.message;
                    } else {
                      disabledReason = `${option.label} is currently unavailable (${snapshot.status}).`;
                    }
                  } else {
                    disabledReason = `${option.label} is currently unavailable.`;
                  }
                }

                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger className="inline-flex">
                      <button
                        type="button"
                        title={
                          disabled && disabledReason
                            ? `${option.label}: ${disabledReason}`
                            : option.label
                        }
                        disabled={disabled}
                        onClick={() => {
                          setSelectedTab(option.value);
                          setSearchQuery("");
                        }}
                        className={cn(
                          "flex size-11 items-center justify-center rounded-xl bg-muted/40 border border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all",
                          isActive && "bg-accent border-border text-foreground shadow-xs",
                          disabled && "cursor-not-allowed opacity-30",
                        )}
                      >
                        <OptionIcon aria-hidden="true" className="size-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipPopup side="right" className="max-w-xs text-xs">
                      {disabled && disabledReason ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-foreground">{option.label}</span>
                          <span className="text-muted-foreground">{disabledReason}</span>
                        </div>
                      ) : (
                        <span>{option.label}</span>
                      )}
                    </TooltipPopup>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {/* Matrix Core containing model rows with horizontal aligned tracks */}
          <div
            className={cn("flex flex-col justify-center overflow-x-hidden", matrixMinWidthClass)}
          >
            {/* Top Toolbar: Provider Info / Model count, Minimizable Search & View toggles */}
            <div className="flex items-center justify-between h-11 mb-3 mr-6 shrink-0 select-none">
              {isSearchOpen || searchQuery ? (
                <div className="relative flex-1 flex items-center">
                  <SearchIcon
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        setSearchQuery("");
                        setIsSearchOpen(false);
                      }
                    }}
                    onKeyUp={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Search all models by name or slug..."
                    autoFocus
                    className="w-full h-9 pl-9 pr-8 text-xs bg-muted/40 hover:bg-muted/60 focus:bg-background border border-border/80 focus:border-ring rounded-xl outline-none text-foreground placeholder:text-muted-foreground/50 transition-all shadow-2xs font-sans"
                  />
                  <button
                    type="button"
                    aria-label="Close search"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchQuery("");
                      setIsSearchOpen(false);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "text-2xl sm:text-3xl font-normal lowercase tracking-tight text-foreground transition-all select-none pl-1.5 overflow-visible",
                        fontCombo.serifClass || "font-serif italic",
                      )}
                      style={{
                        fontFamily: "var(--font-display, var(--font-sans))",
                        fontStyle: "italic",
                      }}
                    >
                      {activeTabHeading}
                    </span>
                    <span className="flex items-center justify-center min-w-6 h-6 px-2 text-xs font-semibold rounded-full bg-muted/70 border border-border/50 text-foreground/80 shadow-2xs">
                      {models.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeTab === "pinned" && pinnedModels.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupPinnedByProvider();
                        }}
                        title={
                          groupPinnedByProvider
                            ? "Switch to flat model list (hide provider headers)"
                            : "Group models by provider headers"
                        }
                        className={cn(
                          "flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer border",
                          groupPinnedByProvider
                            ? "bg-primary/10 text-foreground hover:bg-primary/15 border-primary/25 shadow-2xs"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-border/40",
                        )}
                      >
                        <LayersIcon className="size-3.5" />
                        <span className="text-[11px]">
                          {groupPinnedByProvider ? "Grouped" : "Flat"}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsSearchOpen(true);
                      }}
                      title="Search models"
                      className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer border border-border/40 hover:border-border/80 shadow-2xs"
                    >
                      <SearchIcon className="size-3.5" />
                      <span className="text-[11px]">Search</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Pinned header labels with border line strictly above the scrolling model rows */}
            {globalStops.length > 0 && (
              <div className="relative h-10 mb-2 mr-6 select-none border-b border-border/80 dark:border-white/10 shrink-0">
                {globalStops.map((stop, idx) => {
                  const words = formatThinkingHeaderWords(stop);
                  const fullLabel = words.join(" ");
                  return (
                    <div
                      key={stop.id}
                      title={fullLabel}
                      className={cn(
                        "absolute bottom-1.5 -translate-x-1/2 flex flex-col items-center justify-end text-center font-bold uppercase transition-colors leading-[1.1] pointer-events-none px-0.5",
                        globalStops.length >= 8
                          ? "text-[7.5px] tracking-tight text-muted-foreground/80 dark:text-zinc-400/80"
                          : "text-[8px] tracking-wider text-muted-foreground/80 dark:text-zinc-400/80",
                      )}
                      style={{
                        left: `calc(${MODEL_COLUMN_WIDTH_PX}px + ${TRACK_PADDING_PX}px + (100% - ${MODEL_COLUMN_WIDTH_PX}px - ${TRACK_PADDING_PX * 2}px) * ${idx / (globalStops.length - 1)})`,
                        width: `calc((100% - ${MODEL_COLUMN_WIDTH_PX}px - ${TRACK_PADDING_PX * 2}px) / ${Math.max(1, globalStops.length - 1)})`,
                      }}
                    >
                      {words.map((word, wIdx) => (
                        <span
                          key={wIdx}
                          className="block whitespace-nowrap text-center leading-[1.1]"
                        >
                          {word}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col max-h-[380px] overflow-y-auto pr-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/15 hover:[&::-webkit-scrollbar-thumb]:bg-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              {activeTab === "pinned" && pinnedModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center select-none">
                  <PinIcon className="size-8 text-muted-foreground/40 mb-2.5" />
                  <div className="text-xs font-semibold text-foreground">No Pinned Models Yet</div>
                  <div className="text-[11px] text-muted-foreground max-w-52 mt-1 leading-normal">
                    Click the pin icon next to any model to pin it to your pinned models list.
                  </div>
                </div>
              ) : filteredModels.length === 0 ? (
                <div
                  aria-live="polite"
                  className="flex flex-col items-center justify-center py-10 px-4 text-center select-none"
                  role="status"
                >
                  <SearchIcon className="size-6 text-muted-foreground/40 mb-2" />
                  <div className="text-xs font-semibold text-foreground">
                    {models.length === 0 ? "No models available" : "No matching models found"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {models.length === 0 ? emptyCatalogMessage : `No models match "${searchQuery}"`}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {groupedModels.map((group) => (
                    <div key={group.name ?? "default"} className="flex flex-col gap-1.5">
                      {group.name && (
                        <div className="px-4 pt-2 pb-1 text-[9px] font-extrabold uppercase tracking-widest text-muted-foreground/70 dark:text-zinc-500 border-t border-border/40 dark:border-white/5 mt-2 first:mt-0 first:border-t-0">
                          {group.name}
                        </div>
                      )}
                      {group.items.map((model) => {
                        const modelProvider =
                          (model as { providerId?: string }).providerId ??
                          (activeTab !== "pinned" ? activeTab : props.provider);
                        const isFav = checkIsPinned(modelProvider, model.slug);
                        const isCurrentActive =
                          modelProvider === props.provider && model.slug === props.model;
                        const pinIndex = pinnedModels.findIndex(
                          (m) => m.providerId === modelProvider && m.slug === model.slug,
                        );
                        return (
                          <ModelRow
                            key={`${modelProvider}-${model.slug}`}
                            model={model}
                            isActive={isCurrentActive}
                            ultra={isCurrentActive && isUltra}
                            activeTab={activeTab}
                            isFavorite={isFav}
                            onToggleFavorite={() => handleTogglePinned(modelProvider, model.slug)}
                            themeColor={
                              THEME_COLORS[
                                models.findIndex((m) => m.slug === model.slug) % THEME_COLORS.length
                              ] ?? THEME_COLORS[0]!
                            }
                            selections={isCurrentActive ? props.modelOptions : undefined}
                            globalStops={globalStops}
                            prompt={props.prompt}
                            onPromptChange={props.onPromptChange}
                            onSelect={(nextOptions) =>
                              setModelAndOptions(
                                modelProvider as ProviderPickerKind,
                                model.slug,
                                nextOptions,
                              )
                            }
                            onSelectChange={handleSelectChange}
                            onBooleanChange={handleBooleanChange}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Interactive GSAP Pull-Cord Lamp Toggle on the Right */}
          {leverDescriptor && (
            <PullCordToggle
              label={
                leverDescriptor.id === "serviceTier" ||
                leverDescriptor.id === "service_tier" ||
                leverDescriptor.id === "tier"
                  ? "FAST MODE"
                  : leverDescriptor.label
              }
              engaged={isUltra}
              themeColor={activeColor}
              onChange={handleFastModeChange}
            />
          )}
        </div>
      </MenuPopup>
    </Menu>
  );
});

function isModelSourceBadgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem("tabs_debug_model_sources") === "true" ||
      window.localStorage.getItem("TABS_DEBUG_MODEL_SOURCES") === "true" ||
      Boolean((window as any).__TABS_DEBUG_MODEL_SOURCES__)
    );
  } catch {
    return false;
  }
}

// ── ModelRow Component: aligned stops layout with compact dynamic heights
const ModelRow = memo(function ModelRow(props: {
  model: ServerProviderModel;
  isActive: boolean;
  ultra: boolean;
  activeTab?: ProviderPickerKind | "pinned" | null;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  themeColor: (typeof THEME_COLORS)[number];
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  globalStops: ReadonlyArray<{ id: string; label: string }>;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSelect: (nextOptions?: ReadonlyArray<ProviderOptionSelection>) => void;
  onSelectChange: (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    optionId: string,
  ) => void;
  onBooleanChange: (
    descriptor: Extract<ProviderOptionDescriptor, { type: "boolean" }>,
    value: boolean,
  ) => void;
}) {
  const { sliderAnimationsEnabled, animatedTrackFillEnabled, nyanCatSliderMode } = useSettings();
  const isNyanActive = Boolean(props.ultra || nyanCatSliderMode);
  const providerId = (props.model as { providerId?: string }).providerId;
  const isGrok = providerId === "grok" || props.model.slug.toLowerCase().startsWith("grok");
  const caps = isGrok ? EMPTY_CAPABILITIES : (props.model.capabilities ?? EMPTY_CAPABILITIES);
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: props.isActive ? props.selections : undefined,
  }).filter((d) => d.id !== "agent");

  const selects = descriptors.filter(
    (d): d is Extract<ProviderOptionDescriptor, { type: "select" }> => d.type === "select",
  );
  const booleans = descriptors
    .filter(
      (d): d is Extract<ProviderOptionDescriptor, { type: "boolean" }> => d.type === "boolean",
    )
    .filter((d) => d.id !== "fastMode" && d.id !== "fast");

  const primarySelect = selects.find(
    (d) =>
      d.id === "reasoningEffort" ||
      d.id === "effort" ||
      d.id === "reasoning" ||
      d.id === "variant" ||
      d.id.toLowerCase().includes("effort") ||
      d.id.toLowerCase().includes("reasoning") ||
      d.id.toLowerCase().includes("variant"),
  );
  const secondarySelects = (
    primarySelect ? selects.filter((d) => d.id !== primarySelect.id) : selects
  ).filter(
    (d) =>
      d.id !== "serviceTier" &&
      d.id !== "service_tier" &&
      d.id !== "tier" &&
      !d.options.some((o) => (o.id ?? (o as any).value) === "fast" && d.options.length <= 2),
  );

  const allowedOptionIds = useMemo(
    () =>
      primarySelect && primarySelect.type === "select"
        ? primarySelect.options
            .map((o) => (o.id ?? (o as any).value)?.toString())
            .filter((id): id is string => Boolean(id))
        : [],
    [primarySelect],
  );

  const currentStopId = useMemo(() => {
    if (!primarySelect) return null;
    return getProviderOptionCurrentValue(primarySelect);
  }, [primarySelect]);

  const currentStopIndex = useMemo(() => {
    if (!currentStopId) return -1;
    return props.globalStops.findIndex(
      (s) => s.id === currentStopId || (s as any).value === currentStopId,
    );
  }, [currentStopId, props.globalStops]);

  const nearestAvailable = useCallback(
    (targetIndex: number) => {
      if (allowedOptionIds.length === 0 || props.globalStops.length === 0) {
        return null;
      }
      let bestOptionId: string | null = null;
      let minDistance = Infinity;

      allowedOptionIds.forEach((optId) => {
        const idxInGlobal = props.globalStops.findIndex((s) => s.id === optId);
        if (idxInGlobal >= 0) {
          const dist = Math.abs(idxInGlobal - targetIndex);
          if (dist < minDistance) {
            minDistance = dist;
            bestOptionId = optId;
          }
        }
      });
      return bestOptionId;
    },
    [allowedOptionIds, props.globalStops],
  );

  const [localStopIndex, setLocalStopIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const latestRef = useRef({
    isActive: props.isActive,
    onSelect: props.onSelect,
    onSelectChange: props.onSelectChange,
    descriptors,
    primarySelect,
  });
  useEffect(() => {
    latestRef.current = {
      isActive: props.isActive,
      onSelect: props.onSelect,
      onSelectChange: props.onSelectChange,
      descriptors,
      primarySelect,
    };
  });

  const handleTrackMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = e.currentTarget as HTMLDivElement;
    dragIndexRef.current = null;

    const update = (clientX: number) => {
      const { primarySelect: curPrimary } = latestRef.current;

      if (!curPrimary || curPrimary.type !== "select") return;

      const rect = container.getBoundingClientRect();
      const padding = 20;
      const trackWidth = rect.width - padding * 2;
      const x = Math.max(0, Math.min(clientX - rect.left - padding, trackWidth));
      const percentage = trackWidth > 0 ? x / trackWidth : 0;

      const rawLevel = Math.round(percentage * (props.globalStops.length - 1));
      const resolvedOptionId = nearestAvailable(rawLevel);

      if (resolvedOptionId) {
        const finalIdx = props.globalStops.findIndex((o) => o.id === resolvedOptionId);
        const nextIdx = finalIdx >= 0 ? finalIdx : null;
        dragIndexRef.current = nextIdx;
        setLocalStopIndex(nextIdx);
      }
    };

    update(e.clientX);

    const onMouseMove = (moveEvent: MouseEvent) => {
      update(moveEvent.clientX);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const {
        isActive: curActive,
        onSelect: curSelect,
        onSelectChange: curSelectChange,
        descriptors: curDescriptors,
        primarySelect: curPrimary,
      } = latestRef.current;

      const finalStopIdx = dragIndexRef.current;
      dragIndexRef.current = null;
      setLocalStopIndex(null);

      if (!curPrimary || curPrimary.type !== "select") {
        curSelect(undefined);
        return;
      }

      const finalOptionId =
        finalStopIdx !== null && finalStopIdx >= 0
          ? (props.globalStops[finalStopIdx]?.id ?? null)
          : null;

      if (!curActive) {
        const nextDescriptors = curDescriptors.map((d) =>
          d.id === curPrimary.id && d.type === "select" && finalOptionId
            ? { ...d, currentValue: finalOptionId }
            : d,
        );
        const selections = buildProviderOptionSelectionsFromDescriptors(nextDescriptors);
        curSelect(selections);
      } else if (finalOptionId) {
        curSelectChange(curPrimary, finalOptionId);
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const resolvedIndex = localStopIndex !== null ? localStopIndex : currentStopIndex;

  const percentage =
    props.globalStops.length > 1 && resolvedIndex >= 0
      ? (resolvedIndex / (props.globalStops.length - 1)) * 100
      : 0;

  const fillStyle: React.CSSProperties = props.ultra
    ? {
        width: `calc(20px + (100% - 40px) * ${percentage / 100})`,
        backgroundImage:
          "linear-gradient(90deg, var(--dynamic-ultra-hex)55, var(--dynamic-ultra-hex), #fff)",
        backgroundSize: "200% 100%",
        animation: "fmp-cosmic-gradient 3s linear infinite",
      }
    : animatedTrackFillEnabled
      ? {
          width: `calc(20px + (100% - 40px) * ${percentage / 100})`,
          backgroundColor: props.themeColor.hex,
          backgroundImage: `linear-gradient(90deg, transparent 0%, transparent 40%, rgba(255,255,255,0.03) 44%, rgba(255,255,255,0.08) 47%, rgba(255,255,255,0.16) 49%, rgba(255,255,255,0.28) 51%, rgba(255,255,255,0.16) 52%, rgba(255,255,255,0.06) 54%, transparent 58%, transparent 100%)`,
          backgroundSize: "300% 100%",
          animation: "fmp-cosmic-gradient 3s linear infinite",
        }
      : {
          width: `calc(20px + (100% - 40px) * ${percentage / 100})`,
          backgroundColor: props.themeColor.hex,
        };

  return (
    <div
      onClick={() => {
        if (props.isActive) {
          return;
        }
        props.onSelect(undefined);
      }}
      className={cn(
        "group relative flex items-center rounded-full transition-all duration-200 select-none h-11",
        props.isActive
          ? "bg-accent/80 border border-border/40 dark:bg-white/5 dark:border-transparent"
          : "hover:bg-accent/40 dark:hover:bg-white/[0.03] cursor-pointer",
      )}
    >
      {props.ultra && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70 mix-blend-overlay rounded-full overflow-hidden"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, #fff 1px, transparent 1.5px), radial-gradient(circle at center, rgba(255,255,255,0.8) 1.5px, transparent 2px)",
            backgroundSize: "40px 40px, 30px 30px",
            backgroundPosition: "0 0, 15px 15px",
            animation: "fmp-cosmic-flow 15s linear infinite",
          }}
        />
      )}

      {/* Model Name + inline Segmented Sub-controls */}
      <div
        style={{ width: `${MODEL_COLUMN_WIDTH_PX}px` }}
        className="pl-3.5 pr-2 flex items-center gap-1.5 shrink-0 min-w-0"
      >
        {props.onToggleFavorite && (
          <button
            type="button"
            title={props.isFavorite ? "Unpin model" : "Pin model"}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleFavorite?.();
            }}
            className="shrink-0 p-0.5 rounded-full hover:bg-muted transition-colors focus:outline-none dark:hover:bg-white/10"
          >
            <PinIcon
              className={cn(
                "size-3.5 transition-all",
                props.isFavorite
                  ? "fill-current text-amber-500 opacity-100 scale-100"
                  : "text-muted-foreground opacity-40 hover:opacity-100 hover:text-foreground dark:text-zinc-500 dark:hover:text-zinc-300 scale-90",
              )}
            />
          </button>
        )}
        <span
          className="text-[13px] font-semibold transition-colors truncate"
          style={{
            color: props.isActive ? props.themeColor.hex : undefined,
            textShadow: props.ultra ? `0 0 8px ${props.themeColor.hex}99` : undefined,
          }}
        >
          {props.model.name}
        </span>
        {isModelSourceBadgeEnabled() &&
          (props.model.source === "inferred" || props.model.source === "remote-fallback") && (
            <span
              className="shrink-0 text-[8px] font-semibold tracking-wide uppercase px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20"
              title={`Model capability source: ${props.model.source}`}
            >
              auto
            </span>
          )}

        {/* Inline Secondary Select badges (e.g. 200k, 1M context window) */}
        {props.isActive &&
          secondarySelects.map((descriptor) => {
            const currentVal = getProviderOptionCurrentValue(descriptor);
            const nextIndex =
              (descriptor.options.findIndex((o) => o.id === currentVal) + 1) %
              descriptor.options.length;
            const nextOption = descriptor.options[nextIndex] ?? descriptor.options[0];
            const rawVal =
              descriptor.options.find((o) => o.id === currentVal)?.label ?? currentVal ?? "";
            const displayVal = String(rawVal);
            const isHighTier =
              displayVal.toLowerCase().includes("1m") ||
              displayVal.toLowerCase().includes("large") ||
              displayVal.toLowerCase().includes("max");
            return (
              <button
                key={descriptor.id}
                type="button"
                title={`${descriptor.label}: ${displayVal} (Click to cycle)`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (nextOption) props.onSelectChange(descriptor, nextOption.id);
                }}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-mono font-medium tracking-wide transition-all duration-150 cursor-pointer select-none",
                  isHighTier
                    ? "bg-violet-500/15 border border-violet-500/30 text-violet-600 dark:text-violet-300 shadow-[0_0_8px_rgba(139,92,246,0.2)] hover:bg-violet-500/25"
                    : "bg-foreground/[0.05] dark:bg-white/[0.07] border border-foreground/[0.08] dark:border-white/10 text-muted-foreground/85 dark:text-zinc-300 hover:text-foreground dark:hover:text-white hover:bg-foreground/[0.08] dark:hover:bg-white/[0.12]",
                  "hover:scale-[1.04] active:scale-[0.96]",
                )}
              >
                <span>{displayVal}</span>
                {descriptor.options.length > 1 && (
                  <span className="text-[7.5px] opacity-40 leading-none">⇄</span>
                )}
              </button>
            );
          })}

        {/* Inline Boolean toggle badges (e.g. THINK) */}
        {props.isActive &&
          booleans.map((descriptor) => {
            const isTrue = descriptor.currentValue === true;
            return (
              <button
                key={descriptor.id}
                type="button"
                title={`${descriptor.label}: ${isTrue ? "On" : "Off"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onBooleanChange(descriptor, !isTrue);
                }}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-semibold tracking-wider uppercase transition-all duration-150 cursor-pointer select-none",
                  isTrue
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)] hover:bg-emerald-500/20"
                    : "bg-foreground/[0.04] dark:bg-white/[0.05] border border-foreground/[0.08] dark:border-white/10 text-muted-foreground/70 dark:text-zinc-500 hover:text-foreground dark:hover:text-zinc-300 hover:bg-foreground/[0.07]",
                  "hover:scale-[1.04] active:scale-[0.96]",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full transition-all",
                    isTrue
                      ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_6px_#10b981]"
                      : "bg-muted-foreground/30 dark:bg-zinc-600",
                  )}
                />
                <span>{descriptor.id === "thinking" ? "THINK" : descriptor.label}</span>
              </button>
            );
          })}
      </div>

      {/* Horizontal aligned track container */}
      {primarySelect ? (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={handleTrackMouseDown}
          className="flex-1 relative h-full flex items-center px-5 cursor-grab active:cursor-grabbing"
        >
          {props.isActive && (
            <>
              {isNyanActive ? (
                /* Nyan Cat Unified Animated Rainbow + Running Cat Sprite */
                <div
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 left-1.5 h-[34px] pointer-events-none overflow-hidden z-20 select-none rounded-l-full",
                    sliderAnimationsEnabled &&
                      localStopIndex === null &&
                      "transition-[width] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                  )}
                  style={{
                    width: `calc(44px + (100% - 40px) * ${percentage / 100})`,
                    maskImage: "linear-gradient(to right, transparent 0px, black 12px, black 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to right, transparent 0px, black 12px, black 100%)",
                  }}
                >
                  <img
                    src={nyanCatSliderWideGif}
                    alt="Nyan Cat"
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-[34px] max-w-none pointer-events-none select-none drop-shadow-[0_0_8px_rgba(255,105,180,0.5)]"
                  />
                </div>
              ) : (
                /* Standard Track Fill */
                <div className="absolute top-1/2 -translate-y-1/2 h-5 left-2.5 right-2.5 bg-foreground/5 dark:bg-white/5 rounded-full overflow-hidden pointer-events-none">
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full overflow-hidden",
                      sliderAnimationsEnabled &&
                        localStopIndex === null &&
                        "transition-all duration-200",
                    )}
                    style={fillStyle}
                  >
                    {animatedTrackFillEnabled && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle at center, #fff 1px, transparent 1.5px), radial-gradient(circle at center, rgba(255,255,255,0.8) 1.5px, transparent 2px)",
                          backgroundSize: "40px 40px, 30px 30px",
                          backgroundPosition: "0 0, 15px 15px",
                          animation: "fmp-cosmic-flow 15s linear infinite",
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Aligned stops: solid dots if supported, invisible if not (preserves layout) */}
          <div className="absolute top-1/2 -translate-y-1/2 left-5 right-5 flex justify-between pointer-events-none z-10">
            {props.globalStops.map((stop, oIdx) => {
              const isSupported =
                allowedOptionIds.includes(stop.id) ||
                allowedOptionIds.includes((stop as any).value);
              const isDotActive = props.isActive && oIdx <= resolvedIndex;
              const isUnderRainbow = isNyanActive && props.isActive && oIdx <= resolvedIndex;
              return (
                <div
                  key={stop.id}
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    isSupported ? "bg-foreground/30 dark:bg-zinc-600" : "opacity-0",
                    isDotActive &&
                      isSupported &&
                      (props.ultra
                        ? "bg-white/70 shadow-[0_0_6px_#fff]"
                        : "bg-foreground/60 dark:bg-white/30"),
                    isUnderRainbow && "opacity-0",
                  )}
                />
              );
            })}
          </div>

          {/* Draggable thumb (only in standard mode, since Nyan Cat is built into the unified sprite) */}
          {props.isActive && !isNyanActive && (
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 size-7 bg-popover text-popover-foreground border border-border/60 rounded-full shadow-md z-20 pointer-events-none dark:bg-white dark:border-0 dark:shadow-lg",
                sliderAnimationsEnabled &&
                  localStopIndex === null &&
                  "transition-[left] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
              )}
              style={{
                left: `calc(20px + (100% - 40px) * ${percentage / 100} - 14px)`,
                boxShadow: props.ultra ? `0 0 14px ${props.themeColor.hex}` : undefined,
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 text-[11px] text-muted-foreground/50 font-medium pl-6 pr-4 pointer-events-none select-none italic tracking-wider truncate">
          Reasoning effort not supported by this model
        </div>
      )}
    </div>
  );
});

// ── PullCordToggle Component: Interactive GSAP Pull-Cord Lamp Toggle for Fast Mode
const PullCordToggle = memo(function PullCordToggle(props: {
  label: string;
  engaged: boolean;
  themeColor: (typeof THEME_COLORS)[number];
  onChange: (value: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bulbRef = useRef<HTMLDivElement>(null);
  const cordRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const currentPullYRef = useRef(0);

  // Elastic pull animation on trigger
  const triggerSnap = useCallback(
    (nextState: boolean) => {
      props.onChange(nextState);

      // Squeeze and pop on the bulb
      if (bulbRef.current) {
        gsap.killTweensOf(bulbRef.current);
        gsap
          .timeline()
          .to(bulbRef.current, { scale: 0.93, duration: 0.08, ease: "power1.in" })
          .to(bulbRef.current, { scale: 1.08, duration: 0.18, ease: "power2.out" })
          .to(bulbRef.current, { scale: 1, duration: 0.4, ease: "elastic.out(1.5, 0.4)" });
      }

      // Snap the cord and knob back with elastic spring
      if (cordRef.current && knobRef.current) {
        gsap.killTweensOf([cordRef.current, knobRef.current]);
        gsap.to(cordRef.current, {
          scaleY: 1,
          duration: 0.8,
          ease: "elastic.out(1.3, 0.3)",
        });
        gsap.to(knobRef.current, {
          y: 0,
          duration: 0.8,
          ease: "elastic.out(1.3, 0.3)",
        });
      }
    },
    [props],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    currentPullYRef.current = 0;

    if (cordRef.current && knobRef.current) {
      gsap.killTweensOf([cordRef.current, knobRef.current]);
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaY = Math.max(0, Math.min(36, moveEvent.clientY - startYRef.current));
      currentPullYRef.current = deltaY;

      if (cordRef.current && knobRef.current) {
        const scaleFactor = 1 + deltaY / 48;
        gsap.to(cordRef.current, { scaleY: scaleFactor, duration: 0.05, overwrite: "auto" });
        gsap.to(knobRef.current, { y: deltaY, duration: 0.05, overwrite: "auto" });
      }
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const deltaY = Math.max(0, upEvent.clientY - startYRef.current);
      const isClick = Math.abs(upEvent.clientY - startYRef.current) < 4;

      if (isClick) {
        // Quick click: quick pull down then elastic rebound
        if (cordRef.current && knobRef.current) {
          gsap
            .timeline()
            .to(cordRef.current, { scaleY: 1.45, duration: 0.1, ease: "power2.out" })
            .to(cordRef.current, { scaleY: 1, duration: 0.75, ease: "elastic.out(1.3, 0.3)" }, 0.1);
          gsap
            .timeline()
            .to(knobRef.current, { y: 22, duration: 0.1, ease: "power2.out" })
            .to(knobRef.current, { y: 0, duration: 0.75, ease: "elastic.out(1.3, 0.3)" }, 0.1);
        }
        triggerSnap(!props.engaged);
      } else if (deltaY > 10) {
        // Dragged past threshold: toggle state
        triggerSnap(!props.engaged);
      } else {
        // Cancel drag without toggling
        if (cordRef.current && knobRef.current) {
          gsap.to(cordRef.current, { scaleY: 1, duration: 0.5, ease: "elastic.out(1.2, 0.3)" });
          gsap.to(knobRef.current, { y: 0, duration: 0.5, ease: "elastic.out(1.2, 0.3)" });
        }
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const isLightOn = props.engaged;

  return (
    <div className="flex w-[88px] flex-col items-center justify-center border-l border-border/50 pl-5 dark:border-white/8 select-none shrink-0">
      {/* Top Header Badge */}
      <div className="flex flex-col items-center gap-1 mb-2">
        <span
          className={cn(
            "text-[9.5px] font-mono font-bold tracking-widest uppercase transition-colors duration-300",
            isLightOn
              ? "text-amber-500 dark:text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]"
              : "text-muted-foreground/50",
          )}
        >
          {isLightOn ? "⚡ FAST" : "FAST MODE"}
        </span>
      </div>

      {/* Pull-Cord Lamp Container */}
      <div
        ref={containerRef}
        role="switch"
        aria-checked={isLightOn}
        aria-label="Fast mode pull cord toggle"
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (cordRef.current && knobRef.current) {
              gsap
                .timeline()
                .to(cordRef.current, { scaleY: 1.45, duration: 0.1, ease: "power2.out" })
                .to(
                  cordRef.current,
                  { scaleY: 1, duration: 0.75, ease: "elastic.out(1.3, 0.3)" },
                  0.1,
                );
              gsap
                .timeline()
                .to(knobRef.current, { y: 22, duration: 0.1, ease: "power2.out" })
                .to(knobRef.current, { y: 0, duration: 0.75, ease: "elastic.out(1.3, 0.3)" }, 0.1);
            }
            triggerSnap(!props.engaged);
          }
        }}
        className="relative flex flex-col items-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-xl p-2 select-none"
      >
        {/* Glowing Bulb without any top cap */}
        <div
          ref={bulbRef}
          className={cn(
            "relative size-12 rounded-full transition-all duration-500 ease-out border",
            isLightOn
              ? "border-amber-300/80 shadow-[0_0_35px_rgba(251,191,36,0.65),0_0_60px_rgba(245,158,11,0.35)]"
              : "border-border/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]",
          )}
          style={{
            background: isLightOn
              ? "radial-gradient(circle at 35% 30%, #ffffff 0%, #fbbf24 55%, #d97706 100%)"
              : "radial-gradient(circle at 35% 30%, #475569 0%, #1e293b 100%)",
          }}
        >
          {/* Bulb Filament / Reflection */}
          <div
            className={cn(
              "absolute top-2.5 left-2.5 size-3 rounded-full transition-opacity duration-300 pointer-events-none",
              isLightOn ? "bg-white/80 blur-[0.5px]" : "bg-white/15",
            )}
          />
        </div>

        {/* Hanging Pull Cord */}
        <div
          ref={cordRef}
          className="w-0.5 h-12 bg-zinc-400 dark:bg-zinc-500 origin-top shadow-xs"
        />

        {/* Pull Knob / Bead */}
        <div
          ref={knobRef}
          className={cn(
            "size-4.5 rounded-full border border-zinc-400 dark:border-zinc-500 shadow-md flex items-center justify-center -mt-0.5",
            isLightOn
              ? "bg-gradient-to-b from-amber-400 to-amber-600 border-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.6)]"
              : "bg-gradient-to-b from-zinc-300 to-zinc-500 dark:from-zinc-600 dark:to-zinc-800",
          )}
        >
          <div className="size-1.5 rounded-full bg-white/40 shadow-inner" />
        </div>

        {/* Bottom Status / Tag */}
        <div
          className={cn(
            "mt-2.5 text-[8.5px] font-mono font-bold tracking-widest uppercase transition-all duration-300",
            isLightOn
              ? "text-amber-500 dark:text-amber-400 font-extrabold"
              : "text-muted-foreground/60",
          )}
        >
          {isLightOn ? "ON" : "PULL"}
        </div>
      </div>
    </div>
  );
});

const COSMIC_KEYFRAMES = `
@keyframes fmp-cosmic-gradient {
  0% { background-position: 200% 0%; }
  100% { background-position: -100% 0%; }
}
@keyframes fmp-cosmic-flow {
  0% { background-position: 0 0; }
  100% { background-position: 0 400px; }
}
@keyframes fmp-rainbow-shift {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
@keyframes fmp-rainbow-glow {
  0%, 100% { filter: drop-shadow(0 0 8px rgba(255, 105, 180, 0.6)) drop-shadow(0 0 14px rgba(0, 220, 255, 0.4)); }
  50% { filter: drop-shadow(0 0 14px rgba(255, 230, 0, 0.8)) drop-shadow(0 0 20px rgba(255, 105, 180, 0.6)); }
}
`;

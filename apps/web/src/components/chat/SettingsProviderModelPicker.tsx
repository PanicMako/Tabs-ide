/**
 * Instance-keyed provider/model picker for the Settings page.
 *
 * This is a simplified version of the T3 ProviderModelPicker that uses a
 * Popover with grouped model lists, one section per provider instance.
 * It does NOT touch the existing composer ProviderModelPicker which uses
 * a provider-keyed Menu/MenuSub approach.
 */
import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  PROVIDER_DISPLAY_NAMES,
} from "@tabs/contracts";
import { memo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon, PinIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { AppModelOption } from "../../modelSelection";
import {
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  GrokIcon,
  type Icon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  getPinnedModels,
  isPinnedModel,
  sortModelsWithPinnedFirst,
  togglePinnedModel,
} from "../../modelPinning";

/** Map driver kind slugs to their icon components. */
const DRIVER_ICON: Record<string, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
};

function driverDisplayName(driverKind: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driverKind] ?? driverKind;
}

export const SettingsProviderModelPicker = memo(function SettingsProviderModelPicker(props: {
  activeInstanceId: ProviderInstanceId;
  model: string;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const pinnedModels = getPinnedModels(settings);

  // Resolve the active entry for display
  const activeEntry =
    props.instanceEntries.find((e) => e.instanceId === props.activeInstanceId) ?? null;
  const activeModels = props.modelOptionsByInstance.get(props.activeInstanceId) ?? [];
  const selectedModel = activeModels.find((m) => m.slug === props.model) ?? activeModels[0];
  const triggerModelName = selectedModel?.name ?? props.model;
  const triggerProviderName = activeEntry
    ? driverDisplayName(activeEntry.driverKind)
    : props.activeInstanceId;

  const handleSelect = (instanceId: ProviderInstanceId, modelSlug: string) => {
    props.onInstanceModelChange(instanceId, modelSlug);
    setIsOpen(false);
  };

  const handleTogglePin = (
    e: React.MouseEvent,
    instanceId: ProviderInstanceId,
    modelSlug: string,
  ) => {
    e.stopPropagation();
    const nextPinned = togglePinnedModel(settings, instanceId, modelSlug);
    updateSettings({ pinnedModels: nextPinned as any });
  };

  // Group entries by driver for display
  const enabledEntries = props.instanceEntries.filter((e) => e.enabled && e.isAvailable);

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsOpen(false);
          return;
        }
        setIsOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "outline"}
            className={cn(
              "min-w-0 justify-between gap-2 whitespace-nowrap px-2.5 text-foreground/90 hover:text-foreground",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {activeEntry
            ? (() => {
                const DriverIcon = DRIVER_ICON[activeEntry.driverKind];
                return DriverIcon ? (
                  <DriverIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground/80"
                  />
                ) : null;
              })()
            : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="min-w-0 flex-1 overflow-hidden truncate text-xs font-medium text-foreground/90" />
              }
            >
              {triggerModelName}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {triggerProviderName} — {triggerModelName}
            </TooltipPopup>
          </Tooltip>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-55" />
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-72 shadow-xl">
        <div className="max-h-80 overflow-y-auto p-1.5" data-model-picker-content="true">
          {enabledEntries.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No providers available
            </div>
          ) : (
            enabledEntries.map((entry, entryIndex) => {
              const rawModels = props.modelOptionsByInstance.get(entry.instanceId) ?? [];
              const models = sortModelsWithPinnedFirst(rawModels, pinnedModels, entry.instanceId);
              const DriverIcon = DRIVER_ICON[entry.driverKind];
              if (models.length === 0) return null;
              return (
                <div
                  key={entry.instanceId}
                  className={cn(
                    "space-y-0.5",
                    entryIndex > 0 && "mt-1.5 pt-1.5 border-t border-border/40",
                  )}
                >
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
                    {DriverIcon ? (
                      <DriverIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
                    ) : null}
                    {entry.displayName}
                  </div>
                  {models.map((m) => {
                    const isActive =
                      entry.instanceId === props.activeInstanceId && m.slug === props.model;
                    const isPinned = isPinnedModel(pinnedModels, entry.instanceId, m.slug);
                    return (
                      <div
                        key={`${entry.instanceId}:${m.slug}`}
                        className={cn(
                          "group/row flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                          isActive
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                        )}
                        onClick={() => handleSelect(entry.instanceId, m.slug)}
                      >
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <button
                          type="button"
                          aria-label={isPinned ? `Unpin ${m.name}` : `Pin ${m.name}`}
                          className={cn(
                            "size-5 p-0.5 rounded-sm flex items-center justify-center transition-all",
                            isPinned
                              ? "text-amber-500 hover:text-amber-600"
                              : "text-muted-foreground/30 opacity-0 group-hover/row:opacity-100 hover:text-foreground",
                          )}
                          onClick={(e) => handleTogglePin(e, entry.instanceId, m.slug)}
                        >
                          <PinIcon className="size-3 fill-current" />
                        </button>
                        {isActive ? (
                          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
});

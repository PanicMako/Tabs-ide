import {
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ProviderKind,
  type ProviderModelOptions,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
  type ThreadId,
} from "@tabs/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getDefaultEffort,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  hasEffortLevel,
  isClaudeUltrathinkPrompt,
  trimOrNull,
} from "@tabs/shared/model";
import { memo, useCallback, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { composerDraftActions } from "../../state/composerDrafts";
import { getProviderModelCapabilities } from "../../providerModels";
import { cn } from "~/lib/utils";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

type TraitsPersistence =
  | {
      threadId: ThreadId;
      onModelOptionsChange?: never;
    }
  | {
      threadId?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

function replaceDescriptorCurrentValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  currentValue: string | boolean | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id !== descriptorId
      ? descriptor
      : descriptor.type === "boolean"
        ? {
            ...descriptor,
            ...(typeof currentValue === "boolean" ? { currentValue } : {}),
          }
        : {
            ...descriptor,
            ...(typeof currentValue === "string" ? { currentValue } : {}),
          },
  );
}

function getDescriptorStringValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> | null,
): string | null {
  if (!descriptor) {
    return null;
  }
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : null;
}

// Capability/descriptor-driven trait derivation. Works for any provider/driver
// because it reads generic `optionDescriptors` (select + boolean) rather than
// provider-specific typed option keys.
function deriveDescriptorTraits(
  provider: ProviderKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean,
) {
  const caps = getProviderModelCapabilities(models, model, provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: modelOptions }).filter(
    // The "agent" descriptor (e.g. OpenCode Build/Plan) is surfaced by the
    // standalone Plan toggle in the composer footer — hide it here to avoid a
    // duplicate control in the traits menu.
    (descriptor) => descriptor.id !== "agent",
  );
  const selectDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean",
  );
  const primarySelectDescriptor = selectDescriptors[0] ?? null;

  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(prompt);
  const ultrathinkInBodyText =
    ultrathinkPromptControlled && isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, ""));

  return {
    caps,
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls: descriptors.length > 0,
  };
}

export interface TraitsMenuContentProps {
  provider: ProviderKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  onRequestClose?: () => void;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  onRequestClose,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const setProviderModelOptions = composerDraftActions.setProviderModelOptions;
  const updateModelOptions = useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      if ("onModelOptionsChange" in persistence) {
        persistence.onModelOptionsChange(nextOptions);
        return;
      }
      setProviderModelOptions(persistence.threadId, provider, nextOptions, {
        persistSticky: true,
        model: model ?? null,
      });
    },
    [model, persistence, provider, setProviderModelOptions],
  );
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls,
  } = deriveDescriptorTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  );

  const updateDescriptors = (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
    updateModelOptions(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
    onRequestClose?.();
  };

  const handleSelectChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    value: string,
  ) => {
    if (!value) return;
    if (descriptor.promptInjectedValues?.includes(value)) {
      onPromptChange(applyClaudePromptEffortPrefix(prompt, "ultrathink"));
      onRequestClose?.();
      return;
    }
    if (ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id) return;
    if (ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id) {
      onPromptChange(prompt.replace(/^Ultrathink:\s*/i, ""));
    }
    updateDescriptors(replaceDescriptorCurrentValue(descriptors, descriptor.id, value));
  };

  if (!hasAnyControls) {
    return null;
  }

  return (
    <>
      {selectDescriptors.map((descriptor, index) => (
        <div key={descriptor.id}>
          {index > 0 ? <MenuDivider /> : null}
          <MenuGroup>
            <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
              {descriptor.label}
            </div>
            {ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id ? (
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                Remove Ultrathink from the prompt to change this option.
              </div>
            ) : null}
            <MenuRadioGroup
              value={
                ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id
                  ? "ultrathink"
                  : (getDescriptorStringValue(descriptor) ?? "")
              }
              onValueChange={(value) => handleSelectChange(descriptor, value)}
            >
              {descriptor.options.map((option) => (
                <MenuRadioItem
                  key={option.id}
                  value={option.id}
                  disabled={ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id}
                >
                  {option.label}
                  {option.isDefault ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      ))}
      {booleanDescriptors.map((descriptor, index) => (
        <div key={descriptor.id}>
          {index > 0 || selectDescriptors.length > 0 ? <MenuDivider /> : null}
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              {descriptor.label}
            </div>
            <MenuRadioGroup
              value={descriptor.currentValue === true ? "on" : "off"}
              onValueChange={(value) => {
                updateDescriptors(
                  replaceDescriptorCurrentValue(descriptors, descriptor.id, value === "on"),
                );
              }}
            >
              <MenuRadioItem value="on">On</MenuRadioItem>
              <MenuRadioItem value="off">Off</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      ))}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  triggerVariant,
  triggerClassName,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { descriptors, primarySelectDescriptor, ultrathinkPromptControlled, hasAnyControls } =
    deriveDescriptorTraits(
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
    );

  if (!hasAnyControls) {
    return null;
  }

  const triggerLabels: Array<string> = [];
  for (const descriptor of descriptors) {
    const label =
      ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id
        ? "Ultrathink"
        : descriptor.type === "boolean"
          ? descriptor.id === "fastMode"
            ? descriptor.currentValue === true
              ? "Fast"
              : "Normal"
            : `${descriptor.label} ${descriptor.currentValue === true ? "On" : "Off"}`
          : getProviderOptionCurrentLabel(descriptor);
    if (typeof label === "string" && label.length > 0) {
      triggerLabels.push(label);
    }
  }
  const triggerLabel = triggerLabels.join(" · ");

  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={triggerVariant ?? "ghost"}
            className={cn(
              isCodexStyle
                ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0"
                : "shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3",
              triggerClassName,
            )}
          />
        }
      >
        {isCodexStyle ? (
          <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
            <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </span>
        ) : (
          <>
            <span>{triggerLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <TraitsMenuContent
          provider={provider}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          onRequestClose={() => setIsMenuOpen(false)}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});

// ── Legacy typed-option helpers (Settings text-generation controls) ───────
// The Settings page still drives git text-generation model traits through the
// legacy typed `ProviderModelOptions` shape. These helpers bridge that UI; the
// composer above uses the generic descriptor model end-to-end.

type LegacyProviderOptions = ProviderModelOptions[ProviderKind];

function getRawEffort(
  provider: ProviderKind,
  modelOptions: LegacyProviderOptions | null | undefined,
): string | null {
  if (provider === "codex") {
    return trimOrNull((modelOptions as CodexModelOptions | undefined)?.reasoningEffort);
  }
  return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.effort);
}

function buildNextOptions(
  provider: ProviderKind,
  modelOptions: LegacyProviderOptions | null | undefined,
  patch: Record<string, unknown>,
): LegacyProviderOptions {
  if (provider === "codex") {
    return { ...(modelOptions as CodexModelOptions | undefined), ...patch } as CodexModelOptions;
  }
  return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions;
}

export function buildTraitModelOptions(
  provider: ProviderKind,
  modelOptions: LegacyProviderOptions | null | undefined,
  patch: { effort?: string; thinking?: boolean; fastMode?: boolean },
): LegacyProviderOptions {
  const next: Record<string, unknown> = {};
  if (patch.effort !== undefined) {
    next[provider === "codex" ? "reasoningEffort" : "effort"] = patch.effort;
  }
  if (patch.thinking !== undefined) {
    next.thinking = patch.thinking;
  }
  if (patch.fastMode !== undefined) {
    next.fastMode = patch.fastMode;
  }
  return buildNextOptions(provider, modelOptions, next);
}

export function getSelectedTraits(
  provider: ProviderKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: LegacyProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean,
) {
  const caps = getProviderModelCapabilities(models, model, provider);
  const effortLevels = allowPromptInjectedEffort
    ? caps.reasoningEffortLevels
    : caps.reasoningEffortLevels.filter(
        (option) => !caps.promptInjectedEffortLevels.includes(option.value),
      );
  const defaultEffort = getDefaultEffort(caps);

  const resolvedEffort = getRawEffort(provider, modelOptions);
  const isPromptInjected = resolvedEffort
    ? caps.promptInjectedEffortLevels.includes(resolvedEffort)
    : false;
  const effort =
    resolvedEffort && !isPromptInjected && hasEffortLevel(caps, resolvedEffort)
      ? resolvedEffort
      : defaultEffort && hasEffortLevel(caps, defaultEffort)
        ? defaultEffort
        : null;

  const thinkingEnabled = caps.supportsThinkingToggle
    ? ((modelOptions as ClaudeModelOptions | undefined)?.thinking ?? true)
    : null;

  const fastModeEnabled =
    caps.supportsFastMode &&
    (modelOptions as { fastMode?: boolean } | undefined)?.fastMode === true;

  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    caps.promptInjectedEffortLevels.length > 0 &&
    isClaudeUltrathinkPrompt(prompt);

  return {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    ultrathinkPromptControlled,
  };
}

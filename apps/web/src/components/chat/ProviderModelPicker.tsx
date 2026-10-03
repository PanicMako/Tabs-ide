import { type ModelSlug, type ProviderKind, type ServerProvider } from "@tabs/contracts";
import { resolveSelectableModel } from "@tabs/shared/model";
import { memo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "../../session-logic";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  ClaudeAI,
  AntigravityIcon,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  Gemini,
  GrokIcon,
  Icon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
} from "../Icons";
import { cn } from "~/lib/utils";
import { getProviderSnapshot } from "../../providerModels";
import { useSettingsViewState } from "~/state/scopedStateStore";

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderPickerKind;
  label: string;
  available: true;
} {
  return option.available;
}

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

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);
const COMING_SOON_PROVIDER_OPTIONS = [{ id: "gemini", label: "Gemini", icon: Gemini }] as const;

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

function emptyCatalogLabel(provider: ServerProvider | undefined): string {
  if (provider?.auth.status === "unauthenticated") {
    return provider.message ?? "This provider is not authenticated.";
  }
  switch (provider?.catalogStatus) {
    case "failed":
      return "Model catalog failed to load";
    case "loading":
      return "Model catalog is loading";
    case "stale":
      return "Cached model catalog is unavailable";
    default:
      return "No models available";
  }
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderPickerKind;
  model: ModelSlug;
  lockedProvider: ProviderPickerKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Partial<
    Record<ProviderPickerKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderPickerKind, model: ModelSlug) => void;
}) {
  const navigate = useNavigate();
  const [, updateSettingsViewState] = useSettingsViewState();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeProvider = props.lockedProvider ?? props.provider;
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider] ?? [];
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];
  const handleModelChange = (provider: ProviderPickerKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider] ?? [],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsMenuOpen(false);
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              providerIconClassName(activeProvider, "text-muted-foreground/70"),
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {props.lockedProvider !== null ? (
          <MenuGroup>
            <MenuRadioGroup
              value={props.model}
              onValueChange={(value) => handleModelChange(props.lockedProvider!, value)}
            >
              {(props.modelOptionsByProvider[props.lockedProvider] ?? []).length === 0 ? (
                <MenuItem disabled>
                  {emptyCatalogLabel(
                    getProviderSnapshot(props.providers ?? [], props.lockedProvider),
                  )}
                </MenuItem>
              ) : (
                (props.modelOptionsByProvider[props.lockedProvider] ?? []).map((modelOption) => (
                  <MenuRadioItem
                    key={`${props.lockedProvider}:${modelOption.slug}`}
                    value={modelOption.slug}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {modelOption.name}
                  </MenuRadioItem>
                ))
              )}
            </MenuRadioGroup>
            <MenuDivider />
            <div className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground/80">
              This thread uses{" "}
              <span className="font-medium text-muted-foreground">{props.lockedProvider}</span>.
              Start a new thread to use a different provider (Claude, Codex, …).
            </div>
          </MenuGroup>
        ) : (
          <>
            {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              const liveProvider = props.providers
                ? getProviderSnapshot(props.providers, option.value)
                : undefined;
              if (liveProvider && liveProvider.status !== "ready") {
                const unavailableLabel = !liveProvider.enabled
                  ? "Disabled"
                  : !liveProvider.installed
                    ? "Not installed"
                    : "Unavailable";
                const isUnauthenticated = liveProvider.auth.status === "unauthenticated";
                return (
                  <MenuItem
                    key={option.value}
                    className="items-start"
                    disabled={!isUnauthenticated}
                    onClick={
                      isUnauthenticated
                        ? () => {
                            setIsMenuOpen(false);
                            updateSettingsViewState((current) => ({
                              activeSection: "providers",
                              openProviderDetails: {
                                ...current.openProviderDetails,
                                [option.value]: true,
                              },
                            }));
                            void navigate({ to: "/settings" });
                          }
                        : undefined
                    }
                  >
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 opacity-80",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span>{option.label}</span>
                      {isUnauthenticated && liveProvider.message ? (
                        <span className="max-w-80 whitespace-normal text-[11px] leading-snug text-muted-foreground/80">
                          {liveProvider.message}
                        </span>
                      ) : null}
                    </span>
                    <span className="ms-auto shrink-0 text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                      {isUnauthenticated ? "Sign in" : unavailableLabel}
                    </span>
                  </MenuItem>
                );
              }
              return (
                <MenuSub key={option.value}>
                  <MenuSubTrigger>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    {option.label}
                  </MenuSubTrigger>
                  <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
                    <MenuGroup>
                      <MenuRadioGroup
                        value={props.provider === option.value ? props.model : ""}
                        onValueChange={(value) => handleModelChange(option.value, value)}
                      >
                        {(props.modelOptionsByProvider[option.value] ?? []).length === 0 ? (
                          <MenuItem disabled>{emptyCatalogLabel(liveProvider)}</MenuItem>
                        ) : (
                          (props.modelOptionsByProvider[option.value] ?? []).map((modelOption) => (
                            <MenuRadioItem
                              key={`${option.value}:${modelOption.slug}`}
                              value={modelOption.slug}
                              onClick={() => setIsMenuOpen(false)}
                            >
                              {modelOption.name}
                            </MenuRadioItem>
                          ))
                        )}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
            {UNAVAILABLE_PROVIDER_OPTIONS.length > 0 && <MenuDivider />}
            {UNAVAILABLE_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              return (
                <MenuItem key={option.value} disabled>
                  <OptionIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/85 opacity-80"
                  />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
            {UNAVAILABLE_PROVIDER_OPTIONS.length === 0 && <MenuDivider />}
            {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              return (
                <MenuItem key={option.id} disabled>
                  <OptionIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
});

import type {
  ModelSlug,
  ProviderKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProvider,
} from "@tabs/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
} from "@tabs/shared/model";
import { useNavigate } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { goToSettings } from "~/lib/settingsLayerStore";
import { useSettingsViewState } from "~/state/scopedStateStore";
import { getProviderSnapshot } from "../../providerModels";
import type { ProviderPickerKind } from "../../session-logic";
import { Button, type buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  AVAILABLE_PROVIDER_OPTIONS,
  PROVIDER_ICON_BY_PROVIDER,
  providerIconClassName,
} from "./ProviderModelPicker";
import { deriveDescriptorTraits, replaceDescriptorCurrentValue } from "./TraitsPicker";
import "./compact-model-picker.css";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

interface ModelRow {
  readonly provider: ProviderPickerKind;
  readonly slug: string;
  readonly name: string;
}

/** Plain text of the unavailable state of a provider, or null when it is usable. */
function unavailableReason(provider: ServerProvider | undefined): string | null {
  if (!provider || provider.status === "ready") return null;
  if (!provider.enabled) return "Disabled";
  if (!provider.installed) return "Not installed";
  return provider.auth.status === "unauthenticated" ? "Sign in" : "Unavailable";
}

/**
 * The model picker for tight spaces: one slim panel with a row of provider icons, a search field,
 * the models, and, for the chosen model, its thinking level. It stays open after a model is picked
 * so the thinking level can be set in the same visit. Use the full picker when there is room.
 */
export const CompactModelPicker = memo(function CompactModelPicker(props: {
  provider: ProviderPickerKind;
  model: ModelSlug;
  lockedProvider: ProviderPickerKind | null;
  providers: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Partial<
    Record<ProviderPickerKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
  /** The thinking-level choices already made for the chosen model. */
  modelOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  /** The message being written, for models whose top thinking level is set from the prompt. */
  prompt?: string;
  onPromptChange?: (prompt: string) => void;
  onProviderModelChange: (provider: ProviderPickerKind, model: ModelSlug) => void;
  onModelOptionsChange?: (options: ReadonlyArray<ProviderOptionSelection> | undefined) => void;
  activeProviderIconClassName?: string;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const navigate = useNavigate();
  const [, updateSettingsViewState] = useSettingsViewState();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ProviderPickerKind | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeProvider = props.lockedProvider ?? props.provider;
  const shownProvider = props.lockedProvider ?? tab ?? activeProvider;
  const ActiveIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];
  const tabs = props.lockedProvider
    ? AVAILABLE_PROVIDER_OPTIONS.filter((option) => option.value === props.lockedProvider)
    : AVAILABLE_PROVIDER_OPTIONS;
  const selectedName =
    props.modelOptionsByProvider[activeProvider]?.find((option) => option.slug === props.model)
      ?.name ?? props.model;

  const rows = useMemo<ReadonlyArray<ModelRow>>(() => {
    const needle = query.trim().toLowerCase();
    const sources = needle ? tabs.map((option) => option.value) : [shownProvider];
    return sources.flatMap((provider) =>
      (props.modelOptionsByProvider[provider] ?? [])
        .filter((option) => !needle || option.name.toLowerCase().includes(needle))
        .map((option) => ({ provider, slug: option.slug, name: option.name })),
    );
  }, [props.modelOptionsByProvider, query, shownProvider, tabs]);

  const instance = getProviderSnapshot(props.providers, activeProvider);
  const traits = deriveDescriptorTraits(
    activeProvider as ProviderKind,
    instance?.models ?? [],
    props.model,
    props.prompt ?? "",
    props.modelOptions,
    props.onPromptChange !== undefined,
  );

  const choose = (row: ModelRow) => {
    if (unavailableReason(getProviderSnapshot(props.providers, row.provider))) return;
    props.onProviderModelChange(row.provider, row.slug as ModelSlug);
    setTab(row.provider);
    setQuery("");
    // Nothing more to set for a model without thinking levels, so the choice closes the panel.
    const next = getProviderSnapshot(props.providers, row.provider);
    const more = deriveDescriptorTraits(
      row.provider as ProviderKind,
      next?.models ?? [],
      row.slug,
      props.prompt ?? "",
      undefined,
      false,
    ).hasAnyControls;
    if (!more || !props.onModelOptionsChange) setOpen(false);
  };

  const openSignIn = (provider: ProviderPickerKind) => {
    setOpen(false);
    updateSettingsViewState((current) => ({
      activeSection: "providers",
      openProviderDetails: { ...current.openProviderDetails, [provider]: true },
    }));
    goToSettings(navigate);
  };

  const setLevel = (descriptor: SelectDescriptor, value: string) => {
    if (descriptor.promptInjectedValues?.includes(value)) {
      props.onPromptChange?.(applyClaudePromptEffortPrefix(props.prompt ?? "", "ultrathink"));
      return;
    }
    if (traits.ultrathinkPromptControlled && descriptor.id === traits.primarySelectDescriptor?.id) {
      props.onPromptChange?.((props.prompt ?? "").replace(/^Ultrathink:\s*/i, ""));
    }
    props.onModelOptionsChange?.(
      buildProviderOptionSelectionsFromDescriptors(
        replaceDescriptorCurrentValue(traits.descriptors, descriptor.id, value),
      ),
    );
  };
  const setFlag = (descriptor: BooleanDescriptor, value: boolean) =>
    props.onModelOptionsChange?.(
      buildProviderOptionSelectionsFromDescriptors(
        replaceDescriptorCurrentValue(traits.descriptors, descriptor.id, value),
      ),
    );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (props.disabled) return;
        setOpen(next);
        if (next) {
          setTab(null);
          setQuery("");
          setCursor(0);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            aria-label={`${props.ariaLabel ?? "Model"}: ${selectedName}`}
            disabled={props.disabled}
            className={cn(
              "min-w-0 max-w-44 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/80 hover:text-foreground [&_svg]:mx-0",
              props.triggerClassName,
            )}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ActiveIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              providerIconClassName(activeProvider, "text-muted-foreground/80"),
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 truncate">{selectedName}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="top"
        sideOffset={8}
        initialFocus={searchRef}
        className="cmp-popup"
        viewportClassName="!p-0"
      >
        <div className="cmp" data-testid="compact-model-picker">
          {tabs.length > 1 ? (
            <div className="cmp-rail" role="tablist" aria-label="Provider">
              {tabs.map((option) => {
                const Icon = PROVIDER_ICON_BY_PROVIDER[option.value];
                const reason = unavailableReason(
                  getProviderSnapshot(props.providers, option.value),
                );
                const selected = !query && option.value === shownProvider;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={reason ? `${option.label}, ${reason}` : option.label}
                    title={reason ? `${option.label}: ${reason}` : option.label}
                    data-unavailable={reason !== null}
                    className="cmp-tab no-drag"
                    onClick={() => {
                      if (reason === "Sign in") openSignIn(option.value);
                      else if (!reason) {
                        setTab(option.value);
                        setQuery("");
                        setCursor(0);
                      }
                    }}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn("size-4", providerIconClassName(option.value, ""))}
                    />
                  </button>
                );
              })}
            </div>
          ) : null}
          <label className="cmp-search">
            <SearchIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              aria-label="Search models"
              placeholder="Search models"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCursor((value) => Math.min(rows.length - 1, value + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCursor((value) => Math.max(0, value - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const row = rows[cursor];
                  if (row) choose(row);
                }
              }}
            />
          </label>
          <ul className="cmp-list" role="listbox" aria-label="Models">
            {rows.length === 0 ? (
              <li className="cmp-empty">
                {query ? `No model matches “${query.trim()}”` : "No models available"}
              </li>
            ) : (
              rows.map((row, index) => {
                const selected = row.provider === activeProvider && row.slug === props.model;
                const RowIcon = PROVIDER_ICON_BY_PROVIDER[row.provider];
                return (
                  <li key={`${row.provider}:${row.slug}`} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-active={index === cursor}
                      className="cmp-row no-drag"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => choose(row)}
                    >
                      {query ? (
                        <RowIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      {selected ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {props.onModelOptionsChange && traits.hasAnyControls ? (
            <div className="cmp-think">
              {traits.selectDescriptors.map((descriptor) => {
                const current =
                  traits.ultrathinkPromptControlled &&
                  descriptor.id === traits.primarySelectDescriptor?.id
                    ? "ultrathink"
                    : getProviderOptionCurrentValue(descriptor);
                return (
                  <div key={descriptor.id} className="cmp-think-row">
                    <span className="cmp-think-label">{descriptor.label}</span>
                    <div role="radiogroup" aria-label={descriptor.label} className="cmp-seg">
                      {descriptor.options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={current === option.id}
                          className="cmp-seg-item no-drag"
                          onClick={() => setLevel(descriptor, option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {traits.booleanDescriptors.map((descriptor) => (
                <div key={descriptor.id} className="cmp-think-row">
                  <span className="cmp-think-label">{descriptor.label}</span>
                  <div role="radiogroup" aria-label={descriptor.label} className="cmp-seg">
                    {[
                      { label: "Off", value: false },
                      { label: "On", value: true },
                    ].map((choice) => (
                      <button
                        key={choice.label}
                        type="button"
                        role="radio"
                        aria-checked={(descriptor.currentValue === true) === choice.value}
                        className="cmp-seg-item no-drag"
                        onClick={() => setFlag(descriptor, choice.value)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
});

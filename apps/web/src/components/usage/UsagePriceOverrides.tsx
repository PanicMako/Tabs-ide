import { useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { EnvironmentId } from "@tabs/contracts";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../state/settings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuCheckboxItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompletePopup,
  AutocompleteList,
  AutocompleteItem,
  AutocompleteEmpty,
} from "../ui/autocomplete";
import { USAGE_PRICE_FIELDS } from "./usagePriceForm";
import {
  isEmptyUsagePriceDraft,
  usagePriceCell,
  usagePriceTableChanges,
  usagePriceTableErrors,
  type UsagePriceDraft,
  type UsagePriceField,
} from "./usagePriceTable";
import {
  writeUsagePrices,
  type UsagePriceTarget,
  type UsagePriceWriteResult,
} from "./usagePriceTargets";

export interface UsagePriceOverridesProps {
  readonly initialModelId?: string | undefined;
  readonly onSaved?: () => void;
  readonly usage?: readonly {
    readonly environmentId?: EnvironmentId;
    readonly summary?: {
      readonly buckets?: readonly {
        readonly model: string;
        readonly costSource?: string;
        readonly costUsd?: number;
      }[];
    };
  }[];
  readonly initialSelectedEnvironmentIds?: ReadonlySet<EnvironmentId> | null;
  readonly onOpenChange: (open: boolean) => void;
}

type SaveAttempt = {
  readonly drafts: readonly UsagePriceDraft[];
  readonly destinations: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }[];
  readonly results: ReadonlyMap<
    EnvironmentId,
    UsagePriceWriteResult | { readonly status: "saving" }
  >;
};

export function UsagePriceOverrides({
  usage = [],
  initialModelId,
  onSaved,
  initialSelectedEnvironmentIds = null,
  onOpenChange,
}: UsagePriceOverridesProps) {
  const serverConfig = useServerConfig();
  const currentOverrides = useSettings((s) => s.usagePriceOverrides) ?? {};
  const { updateSettings } = useUpdateSettings();

  const primaryEnvId = serverConfig?.environment?.environmentId ?? EnvironmentId.make("primary");
  const primaryLabel = serverConfig?.environment?.label ?? "Local Environment";

  const environments: readonly UsagePriceTarget[] = [
    {
      environmentId: primaryEnvId,
      label: primaryLabel,
      prices: currentOverrides,
      unavailable: null,
    },
  ];

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<EnvironmentId> | null>(
    initialSelectedEnvironmentIds,
  );
  const selected = environments.filter(
    (environment) => selectedIds === null || selectedIds.has(environment.environmentId),
  );
  const [drafts, setDrafts] = useState<readonly UsagePriceDraft[]>(() =>
    initialModelId && !currentOverrides[initialModelId]
      ? [{ id: "new:initial", model: initialModelId, isNew: true, values: {} }]
      : [],
  );
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState<SaveAttempt | null>(null);
  const focusRowRef = useRef<string | null>(null);
  const nextRowId = useRef(0);

  const customModels = [
    ...new Set(selected.flatMap((environment) => Object.keys(environment.prices ?? {}))),
  ].sort();
  const models = [
    ...new Set([
      ...customModels,
      ...usage.flatMap((u) => u.summary?.buckets?.map((b) => b.model) ?? []),
    ]),
  ].sort();
  const availableModelSuggestions = useMemo(
    () => models.filter((model) => !customModels.includes(model)),
    [models, customModels],
  );

  const newModels = new Set(
    drafts.filter((draft) => draft.isNew).map((draft) => draft.model.trim()),
  );
  const rows: readonly UsagePriceDraft[] = [
    ...customModels
      .filter((model) => attempt === null || !newModels.has(model))
      .map(
        (model) =>
          drafts.find((draft) => draft.id === `model:${model}`) ?? {
            id: `model:${model}`,
            model,
            isNew: false,
            values: {},
          },
      ),
    ...drafts.filter((draft) => draft.isNew),
  ];
  const stagedDrafts = drafts.filter((draft) => !isEmptyUsagePriceDraft(draft));
  const errors = usagePriceTableErrors(selected, stagedDrafts);
  for (const draft of stagedDrafts) {
    if (!draft.isNew) continue;
    if (draft.model.trim() === "") errors.set(draft.id, "Enter a model ID.");
    else if (
      attempt === null &&
      (customModels.includes(draft.model.trim()) ||
        drafts.some((other) => other.id !== draft.id && other.model.trim() === draft.model.trim()))
    )
      errors.set(draft.id, "This model already has a row. Edit its prices there.");
  }
  const showRowError = (row: UsagePriceDraft) =>
    errors.has(row.id) &&
    (row.id !== "new:initial" ||
      Object.values(row.values).some((value) => value !== "") ||
      attempt !== null);
  const failedDestinations =
    attempt?.destinations.filter(
      (destination) => attempt.results.get(destination.environmentId)?.status === "failed",
    ) ?? [];
  const locked = pending || failedDestinations.length > 0;
  const hasChanges = stagedDrafts.length > 0;
  const destinationLabel =
    selected.length === 1 ? selected[0]!.label : `${selected.length} environments`;
  const selectionLabel = selectedIds === null ? "All environments" : destinationLabel;

  // Unpriced models in usage that don't have custom price overrides yet
  const unpricedUsageModels = useMemo(() => {
    const list: string[] = [];
    for (const u of usage) {
      for (const bucket of u.summary?.buckets ?? []) {
        if (bucket.costSource === "unpriced" || bucket.costUsd === 0) {
          if (!customModels.includes(bucket.model) && !list.includes(bucket.model)) {
            list.push(bucket.model);
          }
        }
      }
    }
    return list.filter((m) => !rows.some((r) => r.model === m));
  }, [usage, customModels, rows]);

  const discard = () => {
    setDrafts([]);
    setAttempt(null);
  };

  const selectEnvironments = (next: ReadonlySet<EnvironmentId> | null) => {
    setSelectedIds(next);
    discard();
  };

  const updateDraft = (next: UsagePriceDraft) => {
    setDrafts((previous) => {
      const index = previous.findIndex((draft) => draft.id === next.id);
      if (index === -1) return [...previous, next];
      const copy = [...previous];
      copy[index] = next;
      return copy;
    });
  };

  const editCell = (row: UsagePriceDraft, field: UsagePriceField, value: string) => {
    updateDraft({
      ...row,
      values: { ...row.values, [field]: value },
    });
  };

  const save = async (retry = false) => {
    if (pending) return;
    const destinations = retry ? failedDestinations : selected;
    const edits = retry && attempt ? attempt.drafts : stagedDrafts;
    if (destinations.length === 0 || edits.length === 0) return;
    const targets = destinations.map(
      (destination) =>
        environments.find(
          (environment) => environment.environmentId === destination.environmentId,
        ) ?? { ...destination, prices: null, unavailable: "Environment removed" },
    );
    const changes = new Map(
      targets.map((target) => [target.environmentId, usagePriceTableChanges(target, edits)]),
    );
    setPending(true);
    setAttempt((previous) => ({
      drafts: edits,
      destinations: retry && previous ? previous.destinations : targets,
      results: new Map([
        ...(retry && previous ? previous.results : []),
        ...targets.map((target) => [target.environmentId, { status: "saving" } as const] as const),
      ]),
    }));
    let failed = false;
    await writeUsagePrices({
      targets: targets.map((target) => ({
        ...target,
        unavailable:
          target.unavailable ?? [...changes.get(target.environmentId)!.errors.values()][0] ?? null,
      })),
      changes: new Map([...changes].map(([id, plan]) => [id, plan.changes])),
      write: async (input) => {
        try {
          const saved = await updateSettings(input.input.patch as any);
          return saved === false ? { _tag: "Failure" as const } : { _tag: "Success" as const };
        } catch {
          return { _tag: "Failure" as const };
        }
      },
      onResult: (environmentId, result) => {
        if (result.status === "failed") failed = true;
        setAttempt((previous) =>
          previous === null
            ? null
            : { ...previous, results: new Map(previous.results).set(environmentId, result) },
        );
      },
    });
    setPending(false);
    if (!failed) {
      setDrafts([]);
      onSaved?.();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-2xl sm:max-w-3xl rounded-3xl bg-card/95 border-border/80 backdrop-blur-2xl shadow-2xl p-6 sm:p-7">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-foreground">
              Custom model prices
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Prices apply to all past and future usage on the environments you select.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="grid gap-4.5 pt-2">
          {/* Controls bar: Environment selector + Unit note */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1 border-b border-border/50">
            <div className="flex min-w-0 items-center gap-2">
              <Label
                id="usage-prices-apply-label"
                className="shrink-0 text-xs text-muted-foreground font-medium"
              >
                Apply to
              </Label>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-xs gap-1.5"
                    />
                  }
                  aria-labelledby="usage-prices-apply-label usage-prices-selection"
                  disabled={pending || hasChanges || environments.length <= 1}
                >
                  <span id="usage-prices-selection" className="truncate font-medium">
                    {selectionLabel}
                  </span>
                  <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden />
                </MenuTrigger>
                <MenuPopup align="start" className="w-80 max-w-[calc(100vw-2rem)]">
                  <MenuCheckboxItem
                    checked={selectedIds === null}
                    closeOnClick={false}
                    onCheckedChange={(checked) => selectEnvironments(checked ? null : new Set())}
                  >
                    All environments
                  </MenuCheckboxItem>
                  <MenuSeparator />
                  {environments.map((environment) => (
                    <MenuCheckboxItem
                      key={environment.environmentId}
                      checked={selectedIds === null || selectedIds.has(environment.environmentId)}
                      closeOnClick={false}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected.map((target) => target.environmentId));
                        if (checked) next.add(environment.environmentId);
                        else next.delete(environment.environmentId);
                        selectEnvironments(next.size === environments.length ? null : next);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="min-w-0 flex-1 truncate">{environment.label}</span>
                        {environment.unavailable ? (
                          <span className="text-xs text-muted-foreground">
                            {environment.unavailable}
                          </span>
                        ) : null}
                      </span>
                    </MenuCheckboxItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
            <span className="text-[11px] font-sans tabular-nums text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md border border-border/60">
              USD / 1M tokens
            </span>
          </div>

          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {environments.length === 0
                ? "Connect an environment to set model prices."
                : "Select an environment to see and change its model prices."}
            </p>
          ) : (
            <>
              {/* Quick Suggestions for unpriced models detected in usage */}
              {unpricedUsageModels.length > 0 && !locked ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/30 border border-border/60 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
                    <SparklesIcon className="size-3.5 text-amber-500" />
                    <span>Unpriced models detected:</span>
                  </div>
                  {unpricedUsageModels.slice(0, 3).map((modelName) => (
                    <button
                      key={modelName}
                      type="button"
                      onClick={() => {
                        const id = `new:${nextRowId.current++}`;
                        focusRowRef.current = id;
                        updateDraft({ id, model: modelName, isNew: true, values: {} });
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border/80 hover:border-primary/50 text-xs font-mono text-foreground hover:text-primary transition-all shadow-2xs cursor-pointer"
                    >
                      <PlusIcon className="size-3 text-muted-foreground" />
                      <span>{modelName}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Model Cards List */}
              <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                {rows.length === 0 ? (
                  <div className="py-10 text-center rounded-2xl border border-dashed border-border/80 bg-muted/10 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {selected.some((environment) => environment.prices === null)
                        ? "Some environment prices are unavailable."
                        : "No custom prices configured. Add a model to override automatic rates."}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={locked}
                      onClick={() => {
                        const id = `new:${nextRowId.current++}`;
                        focusRowRef.current = id;
                        updateDraft({ id, model: "", isNew: true, values: {} });
                      }}
                    >
                      <PlusIcon className="size-3.5" />
                      <span>Add custom model price</span>
                    </Button>
                  </div>
                ) : (
                  rows.map((row) => {
                    const isError =
                      showRowError(row) &&
                      (row.model.trim() !== "" ||
                        Object.values(row.values).some((value) => value !== ""));

                    return (
                      <div
                        key={row.id}
                        data-row-id={row.id}
                        className={cn(
                          "rounded-2xl border p-4 space-y-3 transition-all backdrop-blur-sm shadow-xs",
                          row.removed
                            ? "border-border/50 bg-muted/20 opacity-75"
                            : isError
                              ? "border-destructive/40 bg-card/80"
                              : "border-border/80 bg-card/60 hover:border-border",
                        )}
                      >
                        {/* Card Header Row */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {row.isNew ? (
                              <div className="w-full max-w-sm">
                                <Autocomplete
                                  items={availableModelSuggestions}
                                  value={row.model}
                                  onValueChange={(nextValue) =>
                                    updateDraft({ ...row, model: nextValue })
                                  }
                                  autoHighlight
                                  openOnInputClick
                                >
                                  <AutocompleteInput
                                    value={row.model}
                                    ref={(node) => {
                                      if (node && focusRowRef.current === row.id) {
                                        node.focus();
                                        focusRowRef.current = null;
                                      }
                                    }}
                                    aria-label="New model ID"
                                    aria-invalid={
                                      (row.model.trim() !== "" && showRowError(row)) || undefined
                                    }
                                    placeholder="Enter Model ID (e.g. claude-3-haiku)"
                                    autoComplete="off"
                                    spellCheck={false}
                                    disabled={locked}
                                    showTrigger
                                    size="sm"
                                    className="font-mono text-xs w-full rounded-lg"
                                    onChange={(event) =>
                                      updateDraft({ ...row, model: event.target.value })
                                    }
                                  />
                                  <AutocompletePopup
                                    align="start"
                                    className="w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl p-1 z-50"
                                  >
                                    <AutocompleteList className="max-h-60 overflow-y-auto">
                                      {availableModelSuggestions.map((modelName) => (
                                        <AutocompleteItem
                                          key={modelName}
                                          value={modelName}
                                          className="font-mono text-xs cursor-pointer px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                                        >
                                          <span className="truncate">{modelName}</span>
                                          {unpricedUsageModels.includes(modelName) ? (
                                            <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 shrink-0">
                                              Unpriced
                                            </span>
                                          ) : null}
                                        </AutocompleteItem>
                                      ))}
                                      <AutocompleteEmpty className="py-3 px-2 text-xs text-muted-foreground font-sans text-center">
                                        No matching suggested models
                                      </AutocompleteEmpty>
                                    </AutocompleteList>
                                  </AutocompletePopup>
                                </Autocomplete>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={cn(
                                    "font-mono font-bold text-xs text-foreground px-2.5 py-1 rounded-lg bg-muted/60 border border-border/70 truncate",
                                    row.removed && "line-through text-muted-foreground",
                                  )}
                                >
                                  {row.model}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">
                                  Custom override
                                </span>
                              </div>
                            )}
                          </div>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-muted-foreground hover:text-foreground shrink-0 rounded-lg"
                                  disabled={locked}
                                  aria-label={
                                    row.removed
                                      ? `Undo reset for ${row.model}`
                                      : row.isNew
                                        ? "Remove new model"
                                        : `Reset price for ${row.model} to automatic`
                                  }
                                  onClick={() => {
                                    if (row.isNew)
                                      setDrafts((previous) =>
                                        previous.filter((entry) => entry.id !== row.id),
                                      );
                                    else if (row.removed) {
                                      if (Object.keys(row.values).length === 0)
                                        setDrafts((previous) =>
                                          previous.filter((entry) => entry.id !== row.id),
                                        );
                                      else updateDraft({ ...row, removed: false });
                                    } else updateDraft({ ...row, removed: true });
                                  }}
                                >
                                  {row.isNew ? (
                                    <Trash2Icon
                                      className="size-3.5 text-muted-foreground hover:text-destructive"
                                      aria-hidden
                                    />
                                  ) : (
                                    <RotateCcwIcon className="size-3.5" aria-hidden />
                                  )}
                                </Button>
                              }
                            />
                            <TooltipPopup>
                              {row.removed
                                ? "Undo reset"
                                : row.isNew
                                  ? "Remove row"
                                  : "Reset to automatic"}
                            </TooltipPopup>
                          </Tooltip>
                        </div>

                        {/* Inline Error Message */}
                        {isError ? (
                          <div
                            role="alert"
                            className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
                          >
                            <AlertCircleIcon className="size-3.5 shrink-0" />
                            <span>{errors.get(row.id)}</span>
                          </div>
                        ) : null}

                        {/* Card Rates Grid */}
                        {row.removed ? (
                          <div className="py-2.5 px-3 rounded-xl bg-muted/40 border border-dashed border-border/60 text-xs text-muted-foreground flex items-center justify-between">
                            <span>Automatic pricing will be restored upon saving.</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs rounded-lg"
                              onClick={() => updateDraft({ ...row, removed: false })}
                            >
                              Undo
                            </Button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                            {USAGE_PRICE_FIELDS.map((field) => {
                              const cell = usagePriceCell(selected, row.model, field.key);
                              const isRequired = !field.optional;

                              return (
                                <div key={field.key} className="space-y-1">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-foreground">
                                      {field.label}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {isRequired ? "Req" : "Opt"}
                                    </span>
                                  </div>
                                  <div className="relative flex items-center">
                                    <span className="absolute left-2.5 text-xs text-muted-foreground/70 font-sans tabular-nums select-none pointer-events-none">
                                      $
                                    </span>
                                    <Input
                                      autoFocus={
                                        initialModelId === row.model &&
                                        field.key === "inputCostPerMillionTokens"
                                      }
                                      inputMode="decimal"
                                      aria-label={`${field.label} price for ${row.model || "new model"}`}
                                      value={row.values[field.key] ?? (row.isNew ? "" : cell.value)}
                                      placeholder={
                                        row.isNew
                                          ? field.optional
                                            ? "Input rate"
                                            : "0.00"
                                          : cell.placeholder
                                      }
                                      autoComplete="off"
                                      disabled={locked}
                                      className="pl-6 pr-8 font-mono text-xs tabular-nums h-8 rounded-lg border-border/80 focus:border-primary"
                                      onChange={(event) =>
                                        editCell(row, field.key, event.target.value)
                                      }
                                    />
                                    <span className="absolute right-2 text-[10px] text-muted-foreground/50 font-sans tabular-nums select-none pointer-events-none">
                                      /1M
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Add model button at end of list */}
                {rows.length > 0 && !locked ? (
                  <button
                    type="button"
                    onClick={() => {
                      const id = `new:${nextRowId.current++}`;
                      focusRowRef.current = id;
                      updateDraft({ id, model: "", isNew: true, values: {} });
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-border/80 hover:border-primary/50 hover:bg-primary/5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  >
                    <PlusIcon className="size-3.5 text-primary" />
                    <span>Add another model price</span>
                  </button>
                ) : null}
              </div>

              <p className="text-[11px] text-muted-foreground">
                Blank cache rates use the input price. Enter 0 for free tokens.
                {selected.length > 1
                  ? " Mixed cells keep each environment’s rate until you edit them."
                  : ""}
              </p>
            </>
          )}

          {attempt ? (
            <div role="status" className="grid gap-1 text-xs">
              {attempt.destinations.map((destination) => {
                const result = attempt.results.get(destination.environmentId);
                return (
                  <div key={destination.environmentId} className="flex justify-between gap-3">
                    <span className="truncate text-muted-foreground">{destination.label}</span>
                    <span
                      className={
                        result?.status === "failed"
                          ? "text-right text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {result?.status === "failed"
                        ? `Not saved · ${result.error}`
                        : result?.status === "saved"
                          ? "Saved"
                          : "Saving…"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter
          variant="bare"
          className="items-center sm:justify-between pt-2 border-t border-border/50"
        >
          <span className="text-xs text-muted-foreground">
            {hasChanges ? `Changes apply to ${destinationLabel}` : ""}
          </span>
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            {hasChanges ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={discard}
                className="rounded-xl"
              >
                {failedDestinations.length > 0 ? "Discard pending changes" : "Discard changes"}
              </Button>
            ) : null}
            <Button
              size="sm"
              className="rounded-xl font-medium shadow-xs"
              disabled={
                pending ||
                (!hasChanges && failedDestinations.length === 0) ||
                (failedDestinations.length === 0 && (errors.size > 0 || selected.length === 0))
              }
              onClick={() => void save(failedDestinations.length > 0)}
            >
              {pending
                ? "Saving…"
                : failedDestinations.length > 0
                  ? "Retry failed saves"
                  : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

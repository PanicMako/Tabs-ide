import type {
  ModelSelection,
  ModelSlug,
  ProviderInstanceId,
  ProviderOptionSelection,
  ServerProvider,
  SubagentModelSettings,
  SubagentRole,
} from "@tabs/contracts";
import { isSubagentStaffingActive, SUBAGENT_ROLES } from "@tabs/shared/subagents";
import { RotateCcwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { setSubagentModels, useSubagentModels } from "../../state/overmindSettings";
import type { ProviderPickerKind } from "../../session-logic";
import { cn } from "~/lib/utils";
import { resolveProviderIcon } from "../providerIcons";
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
import { Switch } from "../ui/switch";
import { FusedModelPicker } from "./FusedModelPicker";

export const SUBAGENT_ROLE_LABELS: Record<SubagentRole, string> = {
  implementation: "Implementation",
  research: "Research",
  review: "Review",
  design: "Design",
  test: "Testing",
  general: "General",
};

const ROLE_HINTS: Record<SubagentRole, string> = {
  implementation: "Builds features and fixes bugs",
  research: "Reads code and docs, reports back",
  review: "Checks finished work for bugs",
  design: "Layout, visuals and interaction",
  test: "Writes and runs tests",
  general: "Anything without a type",
};

/** A model as the team UI shows it: the thread's lead or a sub-agent choice. */
export interface TeamModel {
  readonly instanceId: string;
  readonly model: string;
}

/** Short name of the model a selection points at, for one-line summaries. */
export function describeSubagentModel(
  choice: TeamModel | null | undefined,
  providers: ReadonlyArray<ServerProvider> | undefined,
): string | null {
  if (!choice) return null;
  const provider = providers?.find((entry) => entry.instanceId === choice.instanceId);
  return provider?.models.find((model) => model.slug === choice.model)?.name ?? choice.model;
}

/** What the composer chip and the Agents pane say about how sub-agents are staffed. */
export function summarizeSubagentModels(
  settings: SubagentModelSettings,
  providers: ReadonlyArray<ServerProvider> | undefined,
): string {
  if (!isSubagentStaffingActive(settings)) return "The lead picks sub-agent models";
  const base = describeSubagentModel(settings.workers, providers) ?? "Lead's choice";
  const overrides = SUBAGENT_ROLES.filter((role) => settings.roles[role] !== undefined).length;
  return overrides > 0 ? `${base} · ${overrides} by task type` : base;
}

/** Providers a sub-agent can run on: enabled, installed and with at least one model. */
export function selectableSubagentProviders(
  providers: ReadonlyArray<ServerProvider> | undefined,
): ReadonlyArray<ServerProvider> {
  return (providers ?? []).filter(
    (provider) => provider.enabled && provider.installed && provider.models.length > 0,
  );
}

function instanceForKind(
  providers: ReadonlyArray<ServerProvider>,
  kind: string,
): ServerProvider | undefined {
  return (
    providers.find((provider) => provider.instanceId === kind) ??
    providers.find((provider) => provider.driver === kind)
  );
}

function selection(
  instanceId: ProviderInstanceId,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): ModelSelection {
  return {
    instanceId,
    model,
    ...(options && options.length > 0
      ? { options: options.map(({ id, value }) => ({ id, value })) }
      : {}),
  };
}

/** Provider logo and model name, read-only. */
function ModelLabel(props: {
  readonly value: TeamModel | null;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly fallback: string;
}) {
  if (!props.value) {
    return <span className="truncate text-muted-foreground">{props.fallback}</span>;
  }
  const driver = props.providers?.find(
    (entry) => entry.instanceId === props.value?.instanceId,
  )?.driver;
  const Icon = resolveProviderIcon(props.value.instanceId, driver);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{describeSubagentModel(props.value, props.providers)}</span>
    </span>
  );
}

/** One model slot: the app's own model picker, including thinking level. */
function ModelSlot(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly value: ModelSelection | null;
  readonly ariaLabel: string;
  readonly onChange: (value: ModelSelection) => void;
}) {
  const instance =
    props.providers.find((provider) => provider.instanceId === props.value?.instanceId) ??
    props.providers[0];
  if (!instance) return null;
  const kind = instance.driver as ProviderPickerKind;
  const model = (props.value?.model ?? instance.models[0]?.slug ?? "") as ModelSlug;
  return (
    <FusedModelPicker
      provider={kind}
      model={model}
      lockedProvider={null}
      providers={props.providers}
      prompt=""
      onPromptChange={() => {}}
      modelOptions={props.value?.options as ReadonlyArray<ProviderOptionSelection> | undefined}
      ariaLabel={props.ariaLabel}
      triggerClassName="max-w-full"
      align="end"
      onProviderModelChange={(nextKind, nextModel, options) => {
        const next = instanceForKind(props.providers, nextKind);
        if (next) props.onChange(selection(next.instanceId, nextModel, options));
      }}
      onModelOptionsChange={(options) => {
        if (props.value) {
          props.onChange(selection(props.value.instanceId, props.value.model, options));
        }
      }}
    />
  );
}

/** A labelled row of the team table: who, what they do, and the model. */
function TeamRow(props: {
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 py-2">
      <div className="min-w-0">
        <p className={cn("text-sm", props.muted ? "text-muted-foreground" : "font-medium")}>
          {props.label}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{props.hint}</p>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">{props.children}</div>
    </div>
  );
}

/**
 * The team editor: the lead stays on this thread's model; with the switch on,
 * every sub-agent Tabs starts runs on the default model unless its task type
 * has its own. The server enforces the choice where the sub-agent starts.
 */
function SubagentTeamEditor(props: {
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly lead: TeamModel | null;
}) {
  const settings = useSubagentModels();
  const providers = selectableSubagentProviders(props.providers);
  const update = (patch: Partial<SubagentModelSettings>) =>
    void setSubagentModels({ ...settings, ...patch });
  const firstChoice = (): ModelSelection | null => {
    if (props.lead) {
      const lead = providers.find((provider) => provider.instanceId === props.lead?.instanceId);
      if (lead) return { instanceId: lead.instanceId, model: props.lead.model };
    }
    const first = providers[0];
    const slug = first?.models[0]?.slug;
    return first && slug ? { instanceId: first.instanceId, model: slug } : null;
  };

  return (
    <div className="space-y-4 text-xs">
      <section
        aria-label="Lead"
        className="rounded-[var(--radius-control)] border border-border/60 px-3"
      >
        <TeamRow label="Lead" hint="Plans, delegates and checks the work">
          <ModelLabel
            value={props.lead}
            providers={props.providers}
            fallback="This thread's model"
          />
        </TeamRow>
        <p className="border-t border-border/50 py-2 text-[11px] text-muted-foreground">
          The lead is this thread's model. Change it from the composer's model picker.
        </p>
      </section>

      <section aria-label="Sub-agent models" className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Choose sub-agent models</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {settings.enabled
                ? "Every sub-agent runs on these models, on any provider, whatever the lead asks for."
                : "Off: the lead picks a model for each sub-agent, usually its own provider."}
            </p>
          </div>
          <Switch
            aria-label="Choose sub-agent models"
            checked={settings.enabled}
            disabled={providers.length === 0}
            onCheckedChange={(enabled) =>
              update({ enabled, workers: settings.workers ?? (enabled ? firstChoice() : null) })
            }
          />
        </div>

        {providers.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Install or enable a provider in Settings to pick sub-agent models.
          </p>
        )}

        {settings.enabled && providers.length > 0 && (
          <div className="divide-y divide-border/50 rounded-[var(--radius-control)] border border-border/60 px-3">
            <TeamRow label="Default" hint="Any task without its own model">
              <ModelSlot
                providers={providers}
                value={settings.workers}
                ariaLabel="Default sub-agent model"
                onChange={(workers) => update({ workers })}
              />
            </TeamRow>
            {SUBAGENT_ROLES.map((role) => {
              const own = settings.roles[role];
              return (
                <TeamRow
                  key={role}
                  label={SUBAGENT_ROLE_LABELS[role]}
                  hint={own === undefined ? `${ROLE_HINTS[role]} · uses default` : ROLE_HINTS[role]}
                  muted={own === undefined}
                >
                  <div
                    className={cn(
                      "flex min-w-0 justify-end transition-opacity",
                      own === undefined && "opacity-60 hover:opacity-100 focus-within:opacity-100",
                    )}
                  >
                    <ModelSlot
                      providers={providers}
                      value={own ?? settings.workers}
                      ariaLabel={`${SUBAGENT_ROLE_LABELS[role]} sub-agent model`}
                      onChange={(choice) =>
                        update({ roles: { ...settings.roles, [role]: choice } })
                      }
                    />
                  </div>
                  {own !== undefined ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Use the default for ${SUBAGENT_ROLE_LABELS[role]}`}
                      title="Use the default"
                      onClick={() => {
                        const { [role]: _removed, ...rest } = settings.roles;
                        update({ roles: rest });
                      }}
                    >
                      <RotateCcwIcon className="size-3" />
                    </Button>
                  ) : (
                    <span aria-hidden="true" className="size-6 shrink-0" />
                  )}
                </TeamRow>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function SubagentTeamDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly lead: TeamModel | null;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Agent team</DialogTitle>
            <DialogDescription>
              Who runs the work in this project. Sub-agents and Overmind tasks both use these
              models.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pt-2">
            <SubagentTeamEditor providers={props.providers} lead={props.lead} />
          </div>
          <DialogFooter className="mt-4">
            <Button onClick={() => props.onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * At-a-glance team: the lead and who sub-agents run on, with one action to
 * edit. Used in the Agents pane, the Overmind dialog and the composer chip.
 */
export function SubagentTeamCard(props: {
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly lead: TeamModel | null;
}) {
  const settings = useSubagentModels();
  const [open, setOpen] = useState(false);
  const active = isSubagentStaffingActive(settings);
  const overrides = SUBAGENT_ROLES.filter((role) => settings.roles[role] !== undefined).length;
  return (
    <section aria-label="Agent team" className="text-xs">
      <div className="divide-y divide-border/50 rounded-[var(--radius-control)] border border-border/60">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="w-20 shrink-0 text-muted-foreground">Lead</span>
          <span className="min-w-0 flex-1">
            <ModelLabel
              value={props.lead}
              providers={props.providers}
              fallback="This thread's model"
            />
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="w-20 shrink-0 text-muted-foreground">Sub-agents</span>
          <span className="min-w-0 flex-1">
            <ModelLabel
              value={active ? settings.workers : null}
              providers={props.providers}
              fallback="Lead decides"
            />
            {active && overrides > 0 && (
              <span className="block text-[11px] text-muted-foreground">
                {overrides} task type{overrides === 1 ? "" : "s"} on their own model
              </span>
            )}
          </span>
          <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
            Edit
          </Button>
        </div>
      </div>
      <SubagentTeamDialog
        open={open}
        onOpenChange={setOpen}
        providers={props.providers}
        lead={props.lead}
      />
    </section>
  );
}

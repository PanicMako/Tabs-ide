import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@tabs/contracts";
import { PlusIcon, TerminalSquareIcon, Trash2Icon } from "lucide-react";
import { useState, type ComponentType } from "react";

import { ensureNativeApi } from "~/nativeApi";
import { refreshServerConfig } from "~/state/settings";
import { FxIcon, KiroIcon } from "../Icons";
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
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { ProviderEnvironmentDialog } from "./ProviderEnvironmentDialog";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

const ACP_DRIVER = ProviderDriverKind.make("acpRegistry");

type Preset = {
  readonly id: string;
  readonly name: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly description: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly badge?: string;
  readonly install?: string;
};

/** Agents that speak ACP over stdio; each becomes a local-command ACP instance. */
export const ACP_AGENT_PRESETS: ReadonlyArray<Preset> = [
  {
    id: "kiro",
    name: "Kiro",
    icon: KiroIcon,
    description: "Kiro's coding agent. Sign in with kiro-cli login first.",
    // V3 engine; --auth-method=cli keeps access tokens inside Kiro.
    command: "kiro-cli",
    args: ["acp", "--agent-engine=v3", "--auth-method=cli"],
    badge: "Early Access",
  },
  {
    id: "fx",
    name: "fx",
    icon: FxIcon,
    description: "The fx agent. Every fx instance on this machine shares its fx login.",
    command: "fx",
    args: ["acp"],
  },
];

type AcpConfig = {
  readonly source?: string;
  readonly commandPath?: string;
  readonly commandArgs?: ReadonlyArray<string>;
};

function acpConfig(instance: ProviderInstanceConfig): AcpConfig {
  return (instance.config ?? {}) as AcpConfig;
}

function presetFor(instance: ProviderInstanceConfig): Preset | undefined {
  const config = acpConfig(instance);
  return ACP_AGENT_PRESETS.find((preset) => preset.command === config.commandPath);
}

/** Lowercase, dash-separated, and unique among existing instance ids. */
export function nextAgentInstanceId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

/** Splits a command line on whitespace, keeping quoted segments together. */
export function splitCommandArgs(value: string): string[] {
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

async function mutate(
  mutation: Parameters<ReturnType<typeof ensureNativeApi>["server"]["mutateProviderInstance"]>[0],
) {
  await ensureNativeApi().server.mutateProviderInstance(mutation);
  await refreshServerConfig();
}

export function CustomAgentProviders(props: {
  readonly instances: Readonly<Record<string, ProviderInstanceConfig>>;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editingEnvironment, setEditingEnvironment] = useState<string | null>(null);
  const agents = Object.entries(props.instances).filter(
    ([, instance]) => instance.driver === ACP_DRIVER,
  );

  const run = (action: () => Promise<void>, failure: string) =>
    action().catch((error) =>
      toastManager.add({
        type: "error",
        title: failure,
        description: error instanceof Error ? error.message : String(error),
      }),
    );

  return (
    <>
      <SettingsSection
        title="Custom agents"
        headerAction={
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="mr-1.5 size-3.5" />
            Add provider
          </Button>
        }
      >
        {agents.length === 0 ? (
          <SettingsRow
            title="No custom agents yet"
            description="Add Kiro, fx, or any agent that speaks the Agent Client Protocol."
          />
        ) : (
          agents.map(([instanceId, instance]) => {
            const preset = presetFor(instance);
            const Icon = preset?.icon ?? TerminalSquareIcon;
            const live = props.serverProviders.find(
              (provider) => provider.instanceId === instanceId,
            );
            const config = acpConfig(instance);
            const enabled = instance.enabled !== false;
            return (
              <SettingsRow
                key={instanceId}
                title={instance.displayName ?? preset?.name ?? instanceId}
                description={
                  live?.message ??
                  [config.commandPath, ...(config.commandArgs ?? [])].filter(Boolean).join(" ")
                }
                status={
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Icon className="size-3.5" />
                    {!enabled
                      ? "Disabled"
                      : live?.status === "ready"
                        ? "Ready"
                        : live?.installed === false
                          ? "Not installed"
                          : (live?.status ?? "Checking…")}
                    {preset?.badge ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-500">
                        {preset.badge}
                      </span>
                    ) : null}
                  </span>
                }
                control={
                  <div className="flex items-center gap-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditingEnvironment(instanceId)}
                    >
                      Variables
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${instance.displayName ?? instanceId}`}
                      onClick={() => setRemoving(instanceId)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                    <Switch
                      aria-label={`Enable ${instance.displayName ?? instanceId}`}
                      checked={enabled}
                      onCheckedChange={(checked) =>
                        void run(
                          () =>
                            mutate({
                              operation: "upsert",
                              instanceId: ProviderInstanceId.make(instanceId),
                              instance: { ...instance, enabled: checked },
                            }),
                          "Could not update agent",
                        )
                      }
                    />
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>
      {editingEnvironment !== null && props.instances[editingEnvironment] ? (
        <ProviderEnvironmentDialog
          instanceId={editingEnvironment}
          instance={props.instances[editingEnvironment]}
          onClose={() => setEditingEnvironment(null)}
        />
      ) : null}
      <AddAgentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        takenIds={
          new Set([
            ...Object.keys(props.instances),
            ...props.serverProviders.map((provider) => provider.instanceId),
          ])
        }
        onCreate={(instanceId, instance) =>
          run(
            () =>
              mutate({
                operation: "create",
                instanceId: ProviderInstanceId.make(instanceId),
                instance,
              }).then(() => setDialogOpen(false)),
            "Could not add agent",
          )
        }
      />
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this agent?</DialogTitle>
            <DialogDescription>
              Threads that used it keep their history but can no longer send messages to it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const instanceId = removing;
                setRemoving(null);
                if (instanceId)
                  void run(
                    () =>
                      mutate({
                        operation: "remove",
                        instanceId: ProviderInstanceId.make(instanceId),
                      }),
                    "Could not remove agent",
                  );
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function AddAgentDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly takenIds: ReadonlySet<string>;
  readonly onCreate: (instanceId: string, instance: ProviderInstanceConfig) => Promise<unknown>;
}) {
  const [choice, setChoice] = useState<string>(ACP_AGENT_PRESETS[0]!.id);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [saving, setSaving] = useState(false);
  const preset = ACP_AGENT_PRESETS.find((entry) => entry.id === choice);
  const custom = choice === "custom";
  const displayName = (custom ? name : (preset?.name ?? "")).trim();
  const commandPath = (custom ? command : command || preset?.command || "").trim();
  const canSave = displayName.length > 0 && commandPath.length > 0 && !saving;

  const reset = (next: string) => {
    setChoice(next);
    setName("");
    setCommand("");
    setArgs("");
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) reset(ACP_AGENT_PRESETS[0]!.id);
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>
            Run another coding agent in Tabs. It must be installed on this machine.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Agent">
            {[...ACP_AGENT_PRESETS, null].map((entry) => {
              const id = entry?.id ?? "custom";
              const Icon = entry?.icon ?? TerminalSquareIcon;
              const selected = choice === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => reset(id)}
                  className={`flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                    selected
                      ? "border-primary/70 bg-primary/10"
                      : "border-border/70 hover:bg-accent/60"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate font-medium">
                    {entry?.name ?? "Local ACP command"}
                  </span>
                  {entry?.badge ? (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-500">
                      {entry.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {preset && !custom ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{preset.description}</p>
              {preset.install ? (
                <p className="text-xs text-muted-foreground">
                  Install: <code className="rounded bg-muted px-1 py-0.5">{preset.install}</code>
                </p>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="agent-binary">Binary path</Label>
                <Input
                  id="agent-binary"
                  placeholder={preset.command}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  placeholder="My agent"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-command">Command</Label>
                <Input
                  id="agent-command"
                  placeholder="my-agent"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-args">Arguments</Label>
                <Input
                  id="agent-args"
                  placeholder="acp"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The command must speak the Agent Client Protocol over stdio.
                </p>
              </div>
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              setSaving(true);
              const instanceId = nextAgentInstanceId(displayName, props.takenIds);
              void props
                .onCreate(instanceId, {
                  driver: ACP_DRIVER,
                  displayName: displayName as ProviderInstanceConfig["displayName"] & string,
                  enabled: true,
                  config: {
                    source: "local",
                    commandPath,
                    commandArgs: custom ? splitCommandArgs(args) : [...(preset?.args ?? [])],
                  },
                })
                .finally(() => setSaving(false));
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

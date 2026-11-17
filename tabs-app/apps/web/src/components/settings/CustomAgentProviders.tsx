import {
  defaultInstanceIdForDriver,
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
import { AddProviderDialog } from "./AddProviderDialog";
import { instanceLoginCommand } from "./addProvider.logic";
import type { ProviderSettingsKey } from "./providerSettings.shared";
import { AntigravityAccount } from "./AntigravityAccount";
import { getDriverOption } from "./providerDriverMeta";
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
  /** Runs a sign-in command in a terminal, as the provider cards do. */
  readonly startProviderAction?: (action: {
    provider: ProviderSettingsKey;
    providerName: string;
    command: string;
    kind: "login";
  }) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editingEnvironment, setEditingEnvironment] = useState<string | null>(null);
  // Everything beyond each provider's built-in default: extra accounts and ACP agents.
  const agents = Object.entries(props.instances).filter(
    ([instanceId, instance]) =>
      instance.driver === ACP_DRIVER || instanceId !== defaultInstanceIdForDriver(instance.driver),
  );
  const labelsByDriver: Record<string, string[]> = {};
  for (const provider of props.serverProviders) {
    if (provider.displayName) (labelsByDriver[provider.driver] ??= []).push(provider.displayName);
  }
  const hasSignedInAccount = (driver: string) =>
    props.serverProviders.some(
      (provider) => provider.driver === driver && provider.auth.status === "authenticated",
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
        title="Accounts and agents"
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
            description="Add another Codex or Claude account, a provider, or any agent from the ACP registry."
          />
        ) : (
          agents.map(([instanceId, instance]) => {
            const preset = presetFor(instance);
            const Icon =
              preset?.icon ?? getDriverOption(instance.driver)?.icon ?? TerminalSquareIcon;
            const live = props.serverProviders.find(
              (provider) => provider.instanceId === instanceId,
            );
            const config = acpConfig(instance);
            const enabled = instance.enabled !== false;
            const baseLogin = live?.lifecycleActions?.find((action) => action.kind === "login");
            const loginCommand =
              instance.driver !== "antigravity" &&
              instance.driver !== ACP_DRIVER &&
              baseLogin?.command
                ? instanceLoginCommand(instance.driver, instance.config, baseLogin.command)
                : null;
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
                    {loginCommand && props.startProviderAction ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          props.startProviderAction?.({
                            provider: instance.driver as ProviderSettingsKey,
                            providerName: instance.displayName ?? instanceId,
                            command: loginCommand,
                            kind: "login",
                          })
                        }
                      >
                        {live?.auth.status === "authenticated" ? "Switch account" : "Sign in"}
                      </Button>
                    ) : null}
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
              >
                {instance.driver === "antigravity" && enabled && live?.installed ? (
                  <div className="-mx-4 mt-3 sm:-mx-5">
                    <AntigravityAccount
                      instanceId={ProviderInstanceId.make(instanceId)}
                      authenticated={live.auth.status === "authenticated"}
                      onComplete={() => void refreshServerConfig()}
                    />
                  </div>
                ) : null}
              </SettingsRow>
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
      <AddProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        instances={props.instances}
        labelsByDriver={labelsByDriver}
        hasSignedInAccount={hasSignedInAccount}
        takenIds={
          new Set([
            ...Object.keys(props.instances),
            ...props.serverProviders.map((provider) => provider.instanceId),
          ])
        }
        onCreate={async (instanceId, instance) => {
          let created = false;
          await run(
            () =>
              mutate({
                operation: "create",
                instanceId: ProviderInstanceId.make(instanceId),
                instance,
              }).then(() => {
                created = true;
                setDialogOpen(false);
              }),
            "Could not add provider",
          );
          return created;
        }}
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

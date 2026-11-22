import type { AcpRegistrySearchAgent, ProviderInstanceConfig } from "@tabs/contracts";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  LoaderCircleIcon,
  SearchIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { ensureNativeApi } from "~/nativeApi";
import { Alert, AlertDescription } from "../ui/alert";
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
import { MuseIcon, PiIcon } from "../Icons";
import {
  accountFolderFieldFor,
  availableInstanceId,
  buildBuiltInInstance,
  buildLocalAcpInstance,
  buildRegistryInstance,
  configuredRegistryAgentIds,
  sharesLoginAcrossInstances,
  suggestAccountLabel,
  validateInstanceId,
} from "./addProvider.logic";
import { DRIVER_OPTIONS } from "./providerDriverMeta";
import { Details, Summary } from "../ui/disclosure";

type IconComponent = ComponentType<{ className?: string }>;

interface BuiltInChoice {
  readonly driver: string;
  readonly label: string;
  readonly icon: IconComponent;
  readonly badge?: string | undefined;
}

const BUILT_IN_CHOICES: ReadonlyArray<BuiltInChoice> = [
  ...DRIVER_OPTIONS.map((option) => ({
    driver: option.value as string,
    label: option.label,
    icon: option.icon,
    badge: option.badgeLabel,
  })),
  { driver: "muse", label: "Muse Code", icon: MuseIcon },
  { driver: "pi", label: "Pi", icon: PiIcon },
];

type Choice =
  | { readonly kind: "builtIn"; readonly choice: BuiltInChoice }
  | { readonly kind: "registry"; readonly agent: AcpRegistrySearchAgent }
  | { readonly kind: "local" };

const SEARCH_DEBOUNCE_MS = 300;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function RegistryIcon(props: { readonly url: string | null; readonly className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!props.url || failed) return <TerminalSquareIcon className={props.className} />;
  return (
    <img
      src={props.url}
      alt=""
      className={`${props.className ?? ""} rounded-[5px] bg-white/90 p-[2px] dark:bg-white`}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * One place to add anything an agent can run on: another account of Codex or Claude,
 * any other built-in provider, an agent from the ACP registry, or your own command.
 */
export function AddProviderDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly instances: Readonly<Record<string, ProviderInstanceConfig>>;
  readonly takenIds: ReadonlySet<string>;
  /** Display names of configured instances per driver, for numbering new accounts. */
  readonly labelsByDriver: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly hasSignedInAccount: (driver: string) => boolean;
  readonly onCreate: (instanceId: string, instance: ProviderInstanceConfig) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<ReadonlyArray<AcpRegistrySearchAgent>>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [accountFolder, setAccountFolder] = useState("");
  const [binaryPath, setBinaryPath] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const added = useMemo(() => configuredRegistryAgentIds(props.instances), [props.instances]);

  const reset = () => {
    setChoice(null);
    setQuery("");
    setName("");
    setAccountFolder("");
    setBinaryPath("");
    setCommand("");
    setArgs("");
    setError(null);
    setPreparingId(null);
  };

  // Searches the registry as the user types; an empty box lists what is available.
  useEffect(() => {
    if (!props.open || choice !== null) return;
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      ensureNativeApi()
        .server.searchAcpRegistry({ query: query.trim() })
        .then((result) => {
          if (cancelled) return;
          setAgents(result.agents);
          setSearchError(null);
        })
        .catch((cause) => {
          if (cancelled) return;
          setAgents([]);
          setSearchError(errorText(cause, "Could not reach the ACP registry."));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.open, choice, query]);

  const needle = query.trim().toLowerCase();
  const builtIns = BUILT_IN_CHOICES.filter((entry) => entry.label.toLowerCase().includes(needle));
  const showLocal =
    needle === "" || "local command acp custom".split(" ").some((word) => word.includes(needle));

  const startBuiltIn = (entry: BuiltInChoice) => {
    const existing = props.labelsByDriver[entry.driver] ?? [];
    const label = existing.length === 0 ? entry.label : suggestAccountLabel(entry.label, existing);
    const instanceId = availableInstanceId(entry.driver, label, props.takenIds);
    setName(label);
    setAccountFolder(accountFolderFieldFor(entry.driver)?.suggest(instanceId) ?? "");
    setChoice({ kind: "builtIn", choice: entry });
    setError(null);
  };

  const startRegistry = async (agent: AcpRegistrySearchAgent) => {
    setPreparingId(agent.id);
    setError(null);
    try {
      const prepared = await ensureNativeApi().server.prepareAcpRegistryAgent({
        agentId: agent.id,
      });
      setName(agent.name);
      setChoice({
        kind: "registry",
        agent: { ...agent, version: prepared.version, distribution: prepared.distribution },
      });
    } catch (cause) {
      setError(errorText(cause, `Could not prepare ${agent.name}.`));
    } finally {
      setPreparingId(null);
    }
  };

  const driver = choice?.kind === "builtIn" ? choice.choice.driver : "acpRegistry";
  const instanceId = availableInstanceId(driver, name, props.takenIds);
  const nameError = name.trim().length === 0 ? "Give this account a name." : null;
  const idError = nameError ?? validateInstanceId(instanceId, new Set());
  const localInvalid = choice?.kind === "local" && command.trim().length === 0;

  const create = () => {
    if (!choice || idError || localInvalid) return;
    const instance =
      choice.kind === "builtIn"
        ? buildBuiltInInstance({ driver, label: name, accountFolder, binaryPath })
        : choice.kind === "registry"
          ? buildRegistryInstance({
              agentId: choice.agent.id,
              label: name,
              iconUrl: choice.agent.icon,
            })
          : buildLocalAcpInstance({ label: name, command, args });
    setSaving(true);
    void props
      .onCreate(instanceId, instance)
      .then((created) => {
        if (created) reset();
      })
      .finally(() => setSaving(false));
  };

  const folderField = choice?.kind === "builtIn" ? accountFolderFieldFor(driver) : undefined;
  const hasAccount = choice?.kind === "builtIn" && props.hasSignedInAccount(driver);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) reset();
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {choice === null
              ? "Add a provider"
              : choice.kind === "builtIn"
                ? `Add ${choice.choice.label}`
                : choice.kind === "registry"
                  ? `Add ${choice.agent.name}`
                  : "Add a local agent"}
          </DialogTitle>
          <DialogDescription>
            {choice === null
              ? "Pick a provider, add another account, or find any agent in the ACP registry."
              : "Choose a name. You can change or remove it later."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {choice === null ? (
            <>
              <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  autoFocus
                  aria-label="Find a provider or agent"
                  placeholder="Search providers and agents…"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {builtIns.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">Providers</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {builtIns.map((entry) => {
                      const Icon = entry.icon;
                      const count = props.labelsByDriver[entry.driver]?.length ?? 0;
                      return (
                        <button
                          key={entry.driver}
                          type="button"
                          onClick={() => startBuiltIn(entry)}
                          className="flex items-center gap-2.5 rounded-md border border-border/70 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60"
                        >
                          <Icon className="provider-brand-icon size-4 shrink-0" />
                          <span className="flex-1 truncate font-medium">{entry.label}</span>
                          {count > 0 ? (
                            <span className="text-[11px] text-muted-foreground">
                              {count} {count === 1 ? "account" : "accounts"}
                            </span>
                          ) : entry.badge ? (
                            <span className="rounded-full border border-border/70 px-1.5 text-[10px] text-muted-foreground">
                              {entry.badge}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  ACP registry
                  {searching ? (
                    <LoaderCircleIcon className="ml-1.5 inline size-3 animate-spin" aria-hidden />
                  ) : null}
                </h3>
                {error ? (
                  <Alert variant="error">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {searchError ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {searchError} Built-in providers and local commands still work.
                  </p>
                ) : agents.length === 0 && !searching ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    No registry agents match “{query.trim()}”.
                  </p>
                ) : (
                  <ul className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/70">
                    {agents.map((agent) => {
                      const isAdded = added.has(agent.id);
                      return (
                        <li key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
                          <RegistryIcon url={agent.icon} className="size-5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{agent.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {agent.description}
                            </div>
                          </div>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={preparingId !== null}
                            onClick={() => void startRegistry(agent)}
                          >
                            {preparingId === agent.id ? (
                              <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />
                            ) : isAdded ? (
                              "Add another"
                            ) : (
                              "Add"
                            )}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              {showLocal ? (
                <button
                  type="button"
                  onClick={() => {
                    setName("");
                    setChoice({ kind: "local" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md border border-border/70 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60"
                >
                  <TerminalSquareIcon className="size-4 shrink-0" />
                  <span className="flex-1">
                    <span className="font-medium">Use your own command</span>
                    <span className="block text-xs text-muted-foreground">
                      Any agent already installed that speaks the Agent Client Protocol.
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                </button>
              ) : null}
            </>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="provider-name">Name</Label>
                <Input
                  id="provider-name"
                  autoFocus
                  value={name}
                  placeholder={choice.kind === "local" ? "My agent" : undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  This is how it appears in the model picker.
                </p>
              </div>
              {hasAccount && (driver === "codex" || driver === "claudeAgent") ? (
                <Alert variant="warning" role="note">
                  <InfoIcon aria-hidden />
                  <AlertDescription>
                    {driver === "codex" ? "Codex" : "Claude Code"} does not fully support multiple
                    accounts — the CLI manages a single login per machine and routing between
                    accounts may be unpredictable. Consider using one account or separate machines
                    instead.
                  </AlertDescription>
                </Alert>
              ) : hasAccount ? (
                <Alert variant="info" role="note">
                  <InfoIcon aria-hidden />
                  <AlertDescription>
                    You already have a signed-in account. Each extra account signs in separately and
                    keeps its own login folder.
                  </AlertDescription>
                </Alert>
              ) : null}
              {folderField ? (
                <div className="space-y-1.5">
                  <Label htmlFor="provider-folder">{folderField.label}</Label>
                  <Input
                    id="provider-folder"
                    value={accountFolder}
                    onChange={(event) => setAccountFolder(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{folderField.hint}</p>
                </div>
              ) : null}
              {choice.kind === "builtIn" && driver === "antigravity" ? (
                <p className="text-xs text-muted-foreground">
                  Each Antigravity account keeps its own Google sign-in. After adding it, use Sign
                  in on its row.
                </p>
              ) : null}
              {choice.kind === "builtIn" && sharesLoginAcrossInstances(driver) ? (
                <p className="text-xs text-muted-foreground">
                  {choice.choice.label} keeps one login per computer, so extra instances share it.
                  Use another instance for a different binary or settings.
                </p>
              ) : null}
              {choice.kind === "builtIn" ? (
                <Details className="text-xs">
                  <Summary className="cursor-pointer text-muted-foreground">Advanced</Summary>
                  <div className="mt-2 space-y-1.5">
                    <Label htmlFor="provider-binary">Binary path</Label>
                    <Input
                      id="provider-binary"
                      placeholder="Detected automatically"
                      value={binaryPath}
                      onChange={(event) => setBinaryPath(event.target.value)}
                    />
                  </div>
                </Details>
              ) : null}
              {choice.kind === "registry" ? (
                <p className="text-xs text-muted-foreground">
                  {choice.agent.name} {choice.agent.version} is ready. Tabs checks it after you add
                  it and shows what is needed to sign in.
                </p>
              ) : null}
              {choice.kind === "local" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="local-command">Command</Label>
                    <Input
                      id="local-command"
                      placeholder="my-agent"
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="local-args">Arguments</Label>
                    <Input
                      id="local-args"
                      placeholder="acp"
                      value={args}
                      onChange={(event) => setArgs(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          {choice !== null ? (
            <Button variant="ghost" className="mr-auto" onClick={() => setChoice(null)}>
              <ArrowLeftIcon className="mr-1.5 size-3.5" />
              Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          {choice !== null ? (
            <Button disabled={saving || idError !== null || localInvalid} onClick={create}>
              <CheckIcon className="mr-1.5 size-3.5" />
              Add
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

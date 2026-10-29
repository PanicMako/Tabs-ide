import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageIcon, PlusIcon, RefreshCwIcon, InfoIcon, SearchIcon } from "lucide-react";
import type { ProviderInstanceId, ServerConfig } from "@tabs/contracts";
import { deepSeekPluginCommand, parseDeepSeekPluginOverrides } from "@tabs/shared/deepSeekPlugins";
import { refreshServerConfig, useServerConfig } from "../../state/settings";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { SettingsSectionHeader } from "./SettingsLayout";
import "./agent-plugins.css";

type Profile = NonNullable<ServerConfig["deepSeekProfiles"]>[number];
type RunCommand = (command: string, profileName: string) => void;

export function AgentPluginsSettings({ onRunCommand }: { onRunCommand: RunCommand }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const config = useServerConfig();
  useEffect(() => {
    void refreshServerConfig().catch(() => undefined);
  }, []);
  const profiles = config?.deepSeekProfiles ?? [];
  const profile = profiles.find((entry) => entry.instanceId === selected) ?? profiles[0];
  return (
    <div className="agent-plugins-page">
      <SettingsSectionHeader
        title="DeepSeek agent plugins"
        description="Add extra tools to the agent that runs your OpenRouter chats."
        actions={
          <Button
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => setHelpOpen(true)}
          >
            <InfoIcon className="size-4" />
            About plugins
          </Button>
        }
      />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogPopup bottomStickOnMobile={false} className="max-w-lg">
          <DialogHeader className="pr-12">
            <DialogTitle>About DeepSeek plugins</DialogTitle>
            <DialogDescription className="text-sm">
              Extra tools for your OpenRouter agent.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="agent-plugins-help">
              <p>
                Your agent already includes core tools. Plugins add capabilities supplied by other
                developers, such as new tools or workflows.
              </p>
              <p>
                Choose <strong>Add plugin</strong> and paste the source from the developer. The
                installer opens in a terminal so you can review its progress.
              </p>
              <p>
                After installation, refresh your list and start a new chat. Plugins and their
                configuration are saved separately for each OpenRouter account.
              </p>
              <a
                href="https://github.com/deepseek-ai/deepseek-harness/tree/master/docs"
                target="_blank"
                rel="noreferrer"
              >
                Read the plugin documentation ↗
              </a>
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button onClick={() => setHelpOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {profiles.length > 1 && (
        <div className="agent-plugins-accounts">
          <span>Account</span>
          <div role="group" aria-label="Plugin account">
            {profiles.map((entry) => (
              <Button
                key={entry.instanceId}
                size="sm"
                variant={entry.instanceId === profile?.instanceId ? "secondary" : "ghost"}
                aria-pressed={entry.instanceId === profile?.instanceId}
                onClick={() => setSelected(entry.instanceId)}
              >
                {entry.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      {profile ? (
        <ProfilePlugins
          key={profile.instanceId}
          profile={profile}
          onRunCommand={onRunCommand}
          windows={config?.environment?.platform.os === "windows"}
        />
      ) : (
        <section className="agent-plugins-list">
          <div className="agent-plugins-empty">
            <PackageIcon aria-hidden="true" />
            <h2>Connect OpenRouter first</h2>
            <p>Enable OpenRouter in Providers to add plugins to its DeepSeek agent.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function ProfilePlugins({
  profile,
  onRunCommand,
  windows,
}: {
  profile: Profile;
  onRunCommand: RunCommand;
  windows: boolean;
}) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const stored = settings.deepSeekPluginPatches?.[profile.instanceId] ?? "[]";
  const [patch, setPatch] = useState(stored);
  const [spec, setSpec] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [installerOpened, setInstallerOpened] = useState(false);
  useEffect(() => {
    setPatch(stored);
  }, [stored]);
  const inventory = useQuery({
    queryKey: ["deepseek-plugin-packages", profile.profileDirectory],
    queryFn: async () => {
      const file = await ensureNativeApi().projects.readFile({
        cwd: profile.profileDirectory,
        relativePath: "package.json",
      });
      const manifest = JSON.parse(file.contents) as {
        dependencies?: Record<string, string>;
        dsh?: { profile?: { bundles?: string[] } };
      };
      return {
        packages: Object.entries(manifest.dependencies ?? {}),
        bundles: manifest.dsh?.profile?.bundles ?? [],
      };
    },
    retry: false,
  });
  const run = (action: "add" | "remove" | "list", value = spec) => {
    try {
      const command = deepSeekPluginCommand(profile, action, value, windows);
      setError(null);
      if (action === "add") {
        setPendingCommand(command);
        setAddOpen(false);
      } else {
        onRunCommand(command, profile.name);
        setInstallerOpened(action !== "list");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the plugin source.");
    }
  };
  const save = async () => {
    try {
      const parsed = parseDeepSeekPluginOverrides(patch);
      setError(null);
      setSaving(true);
      await updateSettings({
        deepSeekPluginPatches: {
          ...settings.deepSeekPluginPatches,
          [profile.instanceId as ProviderInstanceId]: JSON.stringify(parsed, null, 2),
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save plugin configuration.");
    } finally {
      setSaving(false);
    }
  };
  const packages = inventory.data?.packages ?? [];
  const filtered = packages.filter(([name]) =>
    name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <section className="agent-plugins-list" aria-label="Installed plugins">
        <div className="agent-plugins-toolbar">
          <div>
            <h2>
              Installed plugins
              {inventory.data && <span className="agent-plugins-count">{packages.length}</span>}
            </h2>
            <p>{profile.name} · Changes apply to new chats</p>
          </div>
          <div className="agent-plugins-actions">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Refresh plugins"
              disabled={inventory.isFetching}
              onClick={() => {
                void inventory.refetch();
              }}
            >
              <RefreshCwIcon className={`size-4 ${inventory.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                setAddOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              Add plugin
            </Button>
          </div>
        </div>
        {installerOpened && (
          <p role="status" className="agent-plugins-notice">
            Finish in the terminal, then refresh this list. Start a new chat to load your changes.
          </p>
        )}
        {packages.length > 5 && (
          <label className="agent-plugins-search">
            <SearchIcon aria-hidden="true" className="size-4" />
            <Input
              aria-label="Search installed plugins"
              placeholder="Search plugins"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        )}
        {inventory.isPending ? (
          <p className="agent-plugins-loading" role="status">
            Loading your plugins…
          </p>
        ) : inventory.isError ? (
          <div className="agent-plugins-empty">
            <h3>Plugin list unavailable</h3>
            <p>
              This account may not be initialized yet. Open its plugin terminal to check, then
              refresh this list.
            </p>
            <Button variant="outline" size="sm" onClick={() => run("list")}>
              Open plugin terminal
            </Button>
          </div>
        ) : packages.length === 0 ? (
          <div className="agent-plugins-empty">
            <PackageIcon aria-hidden="true" />
            <h3>No plugins added yet</h3>
            <p>
              Your agent already has its core tools.
              <br />
              Add a plugin when you need an extra capability.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="agent-plugins-empty">
            <h3>No matching plugins</h3>
            <p>Try another name.</p>
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Clear search
            </Button>
          </div>
        ) : (
          <ul className="agent-plugins-rows">
            {filtered.map(([name, version]) => (
              <li key={name}>
                <div className="agent-plugins-package">
                  <h3>{name}</h3>
                  <p>
                    {version}
                    <span>
                      {" "}
                      ·{" "}
                      {inventory.data?.bundles.includes(name)
                        ? "Active plugin"
                        : "Supporting package"}
                    </span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => run("remove", name)}
                  aria-label={`Remove ${name}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="agent-plugins-advanced">
        <summary>Advanced plugin configuration</summary>
        <p>
          For plugins that require custom options. Use the entry ID and options from the plugin’s
          documentation.
        </p>
        <Textarea
          aria-label="Plugin configuration JSON"
          className="min-h-44 font-mono text-sm"
          value={patch}
          onChange={(event) => setPatch(event.target.value)}
          spellCheck={false}
        />
        <div className="agent-plugins-advanced-actions">
          <Button
            disabled={saving || patch === stored}
            onClick={() => {
              void save();
            }}
          >
            {saving ? "Saving…" : "Save configuration"}
          </Button>
        </div>
      </details>
      {error && !addOpen && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onOpenChangeComplete={(open) => {
          if (!open && pendingCommand) {
            const command = pendingCommand;
            setPendingCommand(null);
            onRunCommand(command, profile.name);
            setInstallerOpened(true);
          }
        }}
      >
        <DialogPopup bottomStickOnMobile={false} className="max-w-lg">
          <DialogHeader className="pr-12">
            <DialogTitle>Add a DeepSeek plugin</DialogTitle>
            <DialogDescription className="text-sm">
              Paste the package name or source from the plugin developer.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              id="agent-plugin-install"
              className="agent-plugins-add-form"
              onSubmit={(event) => {
                event.preventDefault();
                run("add");
              }}
            >
              <label htmlFor="agent-plugin-package">Plugin source</label>
              <Input
                id="agent-plugin-package"
                placeholder="@author/plugin or github:author/plugin"
                value={spec}
                onChange={(event) => setSpec(event.target.value)}
                aria-describedby="plugin-source-help"
                autoFocus
              />
              <p id="plugin-source-help">
                Choose a plugin compatible with DeepSeek agent mode (ACP). The terminal will show
                installation progress and any prompts.
              </p>
              <div className="agent-plugins-install-target">
                Installing for <strong>{profile.name}</strong>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button variant="ghost" type="button" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="agent-plugin-install" disabled={!spec.trim()}>
              Open installer
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

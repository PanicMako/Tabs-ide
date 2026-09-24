import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { DesktopInstalledExtension, TabsExtensionAssignment } from "@tabs/contracts";
import { projectsAtom } from "~/state/threads";
import { refreshExtensions, useInstalledExtensions } from "~/state/extensions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";

type Tab = "discover" | "installed" | "profiles";

export default function ExtensionsSettings() {
  const [tab, setTab] = useState<Tab>("installed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const extensions = useInstalledExtensions();
  const projects = useAtomValue(projectsAtom);
  const bridge = window.desktopBridge;

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refreshExtensions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const assign = (extension: DesktopInstalledExtension, update: TabsExtensionAssignment) => {
    if (!bridge) return;
    void run(() => bridge.setExtensionAssignment(extension.id, update));
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Extensions"
        description="Full-workspace tools for Tabs projects."
      />
      <div aria-label="Extension settings" className="flex gap-2 px-6">
        {(["discover", "installed", "profiles"] as const).map((item) => (
          <Button
            key={item}
            type="button"
            aria-pressed={tab === item}
            variant={tab === item ? "default" : "outline"}
            onClick={() => setTab(item)}
          >
            {item === "profiles"
              ? "Profiles & Permissions"
              : item[0]!.toUpperCase() + item.slice(1)}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="px-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!bridge ? (
        <SettingsSection title="Desktop only">
          <p className="text-sm text-muted-foreground">
            Extensions are currently available in Tabs desktop.
          </p>
        </SettingsSection>
      ) : tab === "discover" ? (
        <SettingsSection title="Discover">
          <p className="text-sm text-muted-foreground">
            The public Tabs Exchange is not connected yet. In development builds, load an unpacked
            UI-only extension from a local folder or an untrusted local .tabsext archive. Neither
            option grants workspace, network, or account access.
          </p>
          {import.meta.env.DEV ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const directory = await bridge.pickFolder();
                    if (directory) await bridge.installDevelopmentExtension(directory);
                  })
                }
              >
                Load development folder
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const archive = await bridge.pickFile({
                      title: "Select a local Tabs extension package",
                      filters: [{ name: "Tabs extension packages", extensions: ["tabsext"] }],
                    });
                    if (archive) await bridge.installLocalExtensionPackage(archive);
                  })
                }
              >
                Load local package
              </Button>
            </div>
          ) : null}
        </SettingsSection>
      ) : tab === "installed" ? (
        <SettingsSection title="Installed">
          {extensions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No extensions installed.</p>
          ) : (
            extensions.map((extension) => (
              <div
                key={extension.id}
                className="space-y-3 border-b border-border py-4 last:border-0"
              >
                <div>
                  <h3 className="font-medium">{extension.manifest.displayName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {extension.id} · {extension.manifest.version} ·{" "}
                    {extension.source === "local-package" ? "Local package" : "Development folder"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {extension.manifest.description}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={extension.assignment.enabledGlobally}
                    disabled={busy}
                    onChange={(event) =>
                      assign(extension, {
                        ...extension.assignment,
                        enabledGlobally: event.target.checked,
                      })
                    }
                  />
                  Show in all projects
                </label>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Project overrides</p>
                  {projects.map((project) => {
                    const selected = extension.assignment.enabledGlobally
                      ? !extension.assignment.disabledProjectIds.includes(project.id)
                      : extension.assignment.enabledProjectIds.includes(project.id);
                    return (
                      <label key={project.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={busy}
                          onChange={(event) => {
                            const assignment = extension.assignment;
                            const next = event.target.checked;
                            assign(
                              extension,
                              assignment.enabledGlobally
                                ? {
                                    ...assignment,
                                    disabledProjectIds: next
                                      ? assignment.disabledProjectIds.filter(
                                          (id) => id !== project.id,
                                        )
                                      : [...assignment.disabledProjectIds, project.id],
                                  }
                                : {
                                    ...assignment,
                                    enabledProjectIds: next
                                      ? [...assignment.enabledProjectIds, project.id]
                                      : assignment.enabledProjectIds.filter(
                                          (id) => id !== project.id,
                                        ),
                                  },
                            );
                          }}
                        />
                        {project.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </SettingsSection>
      ) : (
        <SettingsSection title="Profiles & Permissions">
          <p className="text-sm text-muted-foreground">
            Profiles currently isolate extension browser storage. Privileged workspace, network, and
            account APIs are not available to development extensions.
          </p>
          {extensions.map((extension) => (
            <div key={extension.id} className="space-y-3 border-b border-border py-4 last:border-0">
              <h3 className="font-medium">{extension.manifest.displayName}</h3>
              <label className="block text-sm">
                Default profile
                <select
                  className="ml-2 rounded border border-border bg-background px-2 py-1"
                  value={extension.assignment.defaultProfileId}
                  disabled={busy}
                  onChange={(event) =>
                    assign(extension, {
                      ...extension.assignment,
                      defaultProfileId: event.target.value,
                    })
                  }
                >
                  {extension.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <Input
                  aria-label={`New profile for ${extension.manifest.displayName}`}
                  placeholder="Profile name"
                  value={profileNames[extension.id] ?? ""}
                  onChange={(event) =>
                    setProfileNames((current) => ({
                      ...current,
                      [extension.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  type="button"
                  disabled={busy || !(profileNames[extension.id] ?? "").trim()}
                  onClick={() =>
                    void run(async () => {
                      const label = (profileNames[extension.id] ?? "").trim();
                      const id = label
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "");
                      await bridge.addExtensionProfile(extension.id, id, label);
                      setProfileNames((current) => ({ ...current, [extension.id]: "" }));
                    })
                  }
                >
                  Add profile
                </Button>
              </div>
              {projects.map((project) => (
                <label key={project.id} className="flex items-center justify-between gap-2 text-sm">
                  {project.name}
                  <select
                    className="rounded border border-border bg-background px-2 py-1"
                    aria-label={`${extension.manifest.displayName} profile for ${project.name}`}
                    value={extension.assignment.profileIdByProjectId[project.id] ?? ""}
                    disabled={busy}
                    onChange={(event) => {
                      const next = { ...extension.assignment.profileIdByProjectId };
                      if (event.target.value) next[project.id] = event.target.value;
                      else delete next[project.id];
                      assign(extension, { ...extension.assignment, profileIdByProjectId: next });
                    }}
                  >
                    <option value="">Use default</option>
                    {extension.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ))}
        </SettingsSection>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
  TabsExtensionAssignment,
} from "@tabs/contracts";
import { projectsAtom } from "~/state/threads";
import { refreshExtensions, useInstalledExtensions } from "~/state/extensions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";

type Tab = "discover" | "installed" | "profiles";

export default function ExtensionsSettings() {
  const [tab, setTab] = useState<Tab>("installed");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profileScopes, setProfileScopes] = useState<Record<string, "shared" | "project">>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [catalog, setCatalog] = useState<DesktopExchangeListing[] | null | undefined>(undefined);
  const [exchangeInstallAvailable, setExchangeInstallAvailable] = useState(false);
  const [checkedUpdates, setCheckedUpdates] = useState<
    Record<string, DesktopExchangeListing | null>
  >({});
  const [preparedInstall, setPreparedInstall] = useState<DesktopPreparedExchangeInstall | null>(
    null,
  );
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const uninstallHeading = useRef<HTMLHeadingElement>(null);
  const uninstallTrigger = useRef<HTMLButtonElement | null>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const reviewReturnExtensionId = useRef<string | null>(null);
  const installedTabButton = useRef<HTMLButtonElement | null>(null);
  const discoverTabButton = useRef<HTMLButtonElement | null>(null);
  const extensions = useInstalledExtensions();
  const projects = useAtomValue(projectsAtom);
  const bridge = window.desktopBridge;
  const availableUpdate = (extension: DesktopInstalledExtension) =>
    Object.hasOwn(checkedUpdates, extension.id)
      ? checkedUpdates[extension.id]
      : extension.availableUpdate;

  useEffect(() => {
    if (tab === "discover" && preparedInstall) reviewHeading.current?.focus();
  }, [preparedInstall, tab]);
  useEffect(() => {
    if (tab === "installed" && uninstallingId) uninstallHeading.current?.focus();
  }, [uninstallingId, tab]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
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
  const searchExchange = async () => {
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setCatalog(undefined);
    try {
      const [listings, available] = await Promise.all([
        bridge.discoverExchangeExtensions(searchQuery.trim()),
        bridge.exchangeInstallAvailable(),
      ]);
      setCatalog(listings);
      setExchangeInstallAvailable(available);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
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
            ref={
              item === "installed"
                ? installedTabButton
                : item === "discover"
                  ? discoverTabButton
                  : undefined
            }
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
      {status ? (
        <p role="status" className="px-6 text-sm text-muted-foreground">
          {status}
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
            Browse approved Exchange listings. Before installation, Tabs checks signed registry
            metadata and the exact package digest. New installations are disabled until you enable
            them for projects below. Development builds can also load a local UI-only package.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void searchExchange();
            }}
          >
            <Input
              aria-label="Search Tabs Exchange extensions"
              placeholder="Search extensions"
              value={searchQuery}
              maxLength={100}
              disabled={busy}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Search Exchange
            </Button>
          </form>
          <p role="status" className="text-sm text-muted-foreground">
            {catalog === null
              ? "No Exchange registry is configured for this desktop build."
              : catalog
                ? `${catalog.length} compatible ${catalog.length === 1 ? "extension" : "extensions"} found.`
                : "Search to view compatible approved extensions."}
          </p>
          {catalog?.length ? (
            <ul className="space-y-3" aria-label="Exchange search results">
              {catalog.map((listing) => (
                <li
                  key={`${listing.registryOrigin}:${listing.id}`}
                  className="rounded border border-border p-3"
                >
                  <h3 className="font-medium">{listing.displayName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {listing.id} · {listing.version} ·{" "}
                    {listing.verifiedPublisher ? "Verified publisher" : "Unverified publisher"}
                  </p>
                  <p className="text-sm">{listing.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Registry: {listing.registryOrigin}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !exchangeInstallAvailable}
                    onClick={(event) => {
                      reviewTrigger.current = event.currentTarget;
                      reviewReturnExtensionId.current = null;
                      void run(async () => {
                        if (preparedInstall) {
                          await bridge.cancelExchangeInstall(preparedInstall.token);
                          setPreparedInstall(null);
                        }
                        setPreparedInstall(await bridge.prepareExchangeInstall(listing));
                      });
                    }}
                  >
                    Review &amp; install {listing.displayName}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {catalog && !exchangeInstallAvailable ? (
            <p role="status" className="text-sm text-muted-foreground">
              Installation is unavailable: this desktop build has no pinned Exchange trust root.
            </p>
          ) : null}
          {preparedInstall ? (
            <section
              aria-labelledby="exchange-install-review"
              className="space-y-2 rounded border border-border p-3"
            >
              <h3
                id="exchange-install-review"
                ref={reviewHeading}
                tabIndex={-1}
                className="font-medium"
              >
                Review {preparedInstall.manifest.displayName}
              </h3>
              <p className="text-sm">
                {preparedInstall.manifest.publisher}.{preparedInstall.manifest.name} · Version{" "}
                {preparedInstall.manifest.version}
                {preparedInstall.replacesVersion
                  ? ` (replaces ${preparedInstall.replacesVersion})`
                  : ""}
              </p>
              <p className="text-sm">
                Requested capabilities:{" "}
                {preparedInstall.manifest.capabilities?.join(", ") || "none"}.
              </p>
              <p className="text-xs text-muted-foreground">
                Registry: {preparedInstall.registryOrigin} · SHA-256: {preparedInstall.digest}
              </p>
              <p className="text-sm text-muted-foreground">
                {preparedInstall.willKeepEnabled
                  ? "Existing project enablement is retained because no capability was added."
                  : "The extension will be disabled until you choose projects and grant requested access."}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await bridge.confirmExchangeInstall(preparedInstall.token);
                      setCheckedUpdates((current) => {
                        const next = { ...current };
                        delete next[
                          `${preparedInstall.manifest.publisher}.${preparedInstall.manifest.name}`
                        ];
                        return next;
                      });
                      setPreparedInstall(null);
                      setTab("installed");
                      requestAnimationFrame(() => installedTabButton.current?.focus());
                    })
                  }
                >
                  Install verified package
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await bridge.cancelExchangeInstall(preparedInstall.token);
                      setPreparedInstall(null);
                      const returnId = reviewReturnExtensionId.current;
                      if (returnId) setTab("installed");
                      requestAnimationFrame(() =>
                        (
                          (returnId
                            ? document.getElementById(`extension-update-${returnId}`)
                            : reviewTrigger.current?.isConnected
                              ? reviewTrigger.current
                              : null) ??
                          (returnId ? installedTabButton.current : discoverTabButton.current)
                        )?.focus(),
                      );
                    })
                  }
                >
                  Cancel install
                </Button>
              </div>
            </section>
          ) : null}
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
                    {extension.source === "exchange"
                      ? `Exchange · ${extension.registryOrigin}`
                      : extension.source === "local-package"
                        ? "Local package"
                        : "Development folder"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {extension.manifest.description}
                  </p>
                  {extension.revoked ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      This version was revoked by its registry. Its tools are disabled. Check
                      Discover for a newer approved version; your profiles and data are retained.
                    </p>
                  ) : null}
                  {extension.disabled ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Disabled. Its tools are hidden; profiles, permissions, and project choices are
                      retained.
                    </p>
                  ) : null}
                  {extension.source === "exchange" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const update = await bridge.checkExtensionUpdate(extension.id);
                            setCheckedUpdates((current) => ({
                              ...current,
                              [extension.id]: update,
                            }));
                            setStatus(
                              update
                                ? `${extension.manifest.displayName} ${update.version} is available for review.`
                                : `No newer compatible approved version of ${extension.manifest.displayName} is available.`,
                            );
                          })
                        }
                      >
                        Check for updates
                      </Button>
                      {availableUpdate(extension) ? (
                        <>
                          <span
                            role={
                              Object.hasOwn(checkedUpdates, extension.id) ? undefined : "status"
                            }
                            className="text-sm text-muted-foreground"
                          >
                            Version {availableUpdate(extension)?.version} is available.
                          </span>
                          <Button
                            id={`extension-update-${extension.id}`}
                            type="button"
                            disabled={busy}
                            onClick={(event) => {
                              const update = availableUpdate(extension);
                              if (!update) return;
                              reviewTrigger.current = event.currentTarget;
                              reviewReturnExtensionId.current = extension.id;
                              void run(async () => {
                                if (preparedInstall) {
                                  await bridge.cancelExchangeInstall(preparedInstall.token);
                                }
                                setPreparedInstall(await bridge.prepareExchangeInstall(update));
                                setTab("discover");
                              });
                            }}
                          >
                            Review update to {availableUpdate(extension)?.version}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!extension.disabled}
                    disabled={busy || extension.revoked}
                    onChange={(event) => {
                      const disabled = !event.target.checked;
                      void run(async () => {
                        await bridge.setExtensionDisabled(extension.id, disabled);
                        setStatus(
                          `${extension.manifest.displayName} ${disabled ? "disabled" : "enabled"}.`,
                        );
                      });
                    }}
                  />
                  Extension enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={extension.assignment.enabledGlobally}
                    disabled={busy || extension.revoked}
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
                          disabled={busy || extension.revoked}
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
                {uninstallingId === extension.id ? (
                  <section
                    aria-labelledby={`uninstall-${extension.id}`}
                    className="space-y-2 rounded border border-destructive/50 p-3"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setUninstallingId(null);
                        requestAnimationFrame(() => uninstallTrigger.current?.focus());
                      }
                    }}
                  >
                    <h4
                      id={`uninstall-${extension.id}`}
                      ref={uninstallHeading}
                      tabIndex={-1}
                      className="font-medium"
                    >
                      Uninstall {extension.manifest.displayName}?
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Its tools and packaged files will be removed. Named profiles and stored data
                      will be retained for a future reinstall; project assignments will be removed.
                      Secure data deletion is not available yet.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await bridge.uninstallExtension(extension.id);
                            setCheckedUpdates((current) => {
                              const next = { ...current };
                              delete next[extension.id];
                              return next;
                            });
                            setUninstallingId(null);
                            setStatus(
                              `${extension.manifest.displayName} uninstalled. Profile data was retained.`,
                            );
                            requestAnimationFrame(() => installedTabButton.current?.focus());
                          })
                        }
                      >
                        Uninstall and retain data
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setUninstallingId(null);
                          requestAnimationFrame(() => uninstallTrigger.current?.focus());
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </section>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={(event) => {
                      uninstallTrigger.current = event.currentTarget;
                      setUninstallingId(extension.id);
                    }}
                  >
                    Uninstall {extension.manifest.displayName}
                  </Button>
                )}
              </div>
            ))
          )}
        </SettingsSection>
      ) : (
        <SettingsSection title="Profiles & Permissions">
          <p className="text-sm text-muted-foreground">
            A shared profile uses one storage space across projects. A project-isolated profile
            keeps browser and non-secret storage separate for each project. Storage access still
            requires a separate grant per project. Workspace, network, and account APIs remain
            unavailable to development extensions.
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
                      {profile.label} ({profile.scope === "project" ? "project-isolated" : "shared"}
                      )
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
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
                <select
                  className="rounded border border-border bg-background px-2 py-1 text-sm"
                  aria-label={`Storage scope for new ${extension.manifest.displayName} profile`}
                  value={profileScopes[extension.id] ?? "shared"}
                  disabled={busy}
                  onChange={(event) =>
                    setProfileScopes((current) => ({
                      ...current,
                      [extension.id]: event.target.value as "shared" | "project",
                    }))
                  }
                >
                  <option value="shared">Shared across projects</option>
                  <option value="project">Isolated per project</option>
                </select>
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
                      await bridge.addExtensionProfile(
                        extension.id,
                        id,
                        label,
                        profileScopes[extension.id] ?? "shared",
                      );
                      setProfileNames((current) => ({ ...current, [extension.id]: "" }));
                    })
                  }
                >
                  Add profile
                </Button>
              </div>
              {projects.map((project) => (
                <div key={project.id} className="space-y-1">
                  <label className="flex items-center justify-between gap-2 text-sm">
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
                          {profile.label} (
                          {profile.scope === "project" ? "project-isolated" : "shared"})
                        </option>
                      ))}
                    </select>
                  </label>
                  {extension.manifest.capabilities?.includes("profile-storage") ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={
                          extension.assignment.storageGrantedProjectIds?.includes(project.id) ??
                          false
                        }
                        disabled={busy}
                        onChange={(event) => {
                          const ids = extension.assignment.storageGrantedProjectIds ?? [];
                          assign(extension, {
                            ...extension.assignment,
                            storageGrantedProjectIds: event.target.checked
                              ? [...ids, project.id]
                              : ids.filter((id) => id !== project.id),
                          });
                        }}
                      />
                      Allow non-secret profile storage for {project.name}
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </SettingsSection>
      )}
    </div>
  );
}

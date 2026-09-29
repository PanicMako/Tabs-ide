import { useEffect, useRef, useState } from "react";
import { PuzzleIcon, SearchIcon, PackageIcon, UsersIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import type {
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
  DesktopExtensionCredentialStatus,
  TabsExtensionAssignment,
} from "@tabs/contracts";
import { projectsAtom } from "~/state/threads";
import { refreshExtensions, useInstalledExtensions } from "~/state/extensions";
import { workspaceShellActions } from "~/state/workspaceShell";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";

type Tab = "discover" | "installed" | "profiles";

export default function ExtensionsSettings() {
  const [tab, setTab] = useState<Tab>("installed");
  const [profileExtensionId, setProfileExtensionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profileScopes, setProfileScopes] = useState<Record<string, "shared" | "project">>({});
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [credentialProfileSelection, setCredentialProfileSelection] = useState<
    Record<string, string>
  >({});
  const [credentialProjectSelection, setCredentialProjectSelection] = useState<
    Record<string, string>
  >({});
  const [credentialHostSelection, setCredentialHostSelection] = useState<Record<string, string>>(
    {},
  );
  const [credentialStatuses, setCredentialStatuses] = useState<
    Record<string, DesktopExtensionCredentialStatus[]>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [catalog, setCatalog] = useState<DesktopExchangeListing[] | null | undefined>(undefined);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null);
  const [catalogPaged, setCatalogPaged] = useState(false);
  const catalogSeenCursors = useRef(new Set<string>());
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
  const activeProfileExtensionId = extensions.some(
    (extension) => extension.id === profileExtensionId,
  )
    ? profileExtensionId
    : extensions[0]?.id;
  const projects = useAtomValue(projectsAtom);
  const bridge = window.desktopBridge;
  const availableUpdate = (extension: DesktopInstalledExtension) =>
    Object.hasOwn(checkedUpdates, extension.id)
      ? checkedUpdates[extension.id]
      : extension.availableUpdate;

  const prevPreparedInstall = useRef<DesktopPreparedExchangeInstall | null>(null);
  useEffect(() => {
    if (tab === "discover" && preparedInstall) {
      reviewHeading.current?.focus();
    } else if (tab === "discover" && !preparedInstall && prevPreparedInstall.current) {
      const id = `${prevPreparedInstall.current.manifest.publisher}.${prevPreparedInstall.current.manifest.name}`;
      const el = document.getElementById(`extension-discover-review-${id}`);
      if (el) el.focus();
      else discoverTabButton.current?.focus();
    }
    prevPreparedInstall.current = preparedInstall;
  }, [preparedInstall, tab]);

  const prevUninstallingId = useRef<string | null>(null);
  useEffect(() => {
    if (tab === "installed" && uninstallingId) {
      uninstallHeading.current?.focus();
    } else if (tab === "installed" && !uninstallingId && prevUninstallingId.current) {
      const id = prevUninstallingId.current;
      const el = document.getElementById(`extension-uninstall-${id}`);
      if (el) el.focus();
      else installedTabButton.current?.focus();
    }
    prevUninstallingId.current = uninstallingId;
  }, [uninstallingId, tab]);
  useEffect(() => {
    if (tab !== "profiles" || !bridge) return;
    let cancelled = false;
    void Promise.all(
      extensions.map(
        async (extension) =>
          [extension.id, await bridge.listExtensionCredentials(extension.id)] as const,
      ),
    )
      .then((entries) => {
        if (!cancelled) setCredentialStatuses(Object.fromEntries(entries));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, bridge, extensions]);

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
    const query = searchQuery.trim();
    setBusy(true);
    setError(null);
    setCatalog(undefined);
    setCatalogCursor(null);
    setCatalogPaged(false);
    setCatalogQuery(query);
    catalogSeenCursors.current.clear();
    try {
      const [page, available] = await Promise.all([
        bridge.discoverExchangeExtensions(query),
        bridge.exchangeInstallAvailable(),
      ]);
      setCatalog(page ? [...page.listings] : null);
      setCatalogCursor(page?.nextCursor ?? null);
      if (page?.nextCursor) catalogSeenCursors.current.add(page.nextCursor);
      setExchangeInstallAvailable(available);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const loadMoreExchange = async () => {
    if (!bridge || !catalogCursor || !catalog) return;
    setBusy(true);
    setError(null);
    const cursor = catalogCursor;
    try {
      const page = await bridge.discoverExchangeExtensions(catalogQuery, cursor);
      if (!page || (page.nextCursor !== null && catalogSeenCursors.current.has(page.nextCursor)))
        throw new Error("Exchange search pagination is invalid.");
      const known = new Set(catalog.map((listing) => listing.id));
      if (page.listings.some((listing) => known.has(listing.id))) {
        throw new Error("Exchange search returned a duplicate extension.");
      }
      setCatalog([...catalog, ...page.listings]);
      setCatalogCursor(page.nextCursor);
      if (page.nextCursor) catalogSeenCursors.current.add(page.nextCursor);
      setCatalogPaged(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="mt-1 flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground">
          <PuzzleIcon className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <SettingsSectionHeader
            title="Extensions"
            description="Your tools, right at home in your workspace."
          />
        </div>
      </div>
      <div
        role="group"
        aria-label="Extension settings views"
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/30 p-1"
      >
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
            variant={tab === item ? "secondary" : "ghost"}
            className={tab === item ? "shadow-sm" : "text-muted-foreground"}
            onClick={() => setTab(item)}
          >
            {item === "discover" ? (
              <SearchIcon aria-hidden="true" className="size-4" />
            ) : item === "installed" ? (
              <PackageIcon aria-hidden="true" className="size-4" />
            ) : (
              <UsersIcon aria-hidden="true" className="size-4" />
            )}
            {item === "profiles"
              ? "Profiles & Permissions"
              : item[0]!.toUpperCase() + item.slice(1)}
            {item === "installed" ? (
              <span className="ml-1 rounded-md bg-background/60 px-1.5 text-xs tabular-nums">
                {extensions.length}
              </span>
            ) : null}
          </Button>
        ))}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
      {status ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        >
          {status}
        </p>
      ) : null}
      {!bridge ? (
        <SettingsSection title="Desktop only" contentClassName="p-5">
          <p className="text-sm text-muted-foreground">
            Extensions are currently available in Tabs desktop.
          </p>
        </SettingsSection>
      ) : tab === "discover" ? (
        <SettingsSection
          title="Discover"
          description="Find your next full-workspace tool."
          contentClassName="space-y-5 p-4 sm:p-5"
        >
          <p className="text-sm text-muted-foreground">
            Browse approved tools built for Tabs. Review access before installing, then choose the
            projects where each tool appears.
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">How installation is verified</summary>
            <p className="mt-2 leading-relaxed">
              Tabs checks signed registry metadata and the exact package digest. New installations
              are disabled until you enable them for projects. Review is not a security guarantee.
            </p>
          </details>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void searchExchange();
            }}
          >
            <Input
              aria-label="Search Tabs Exchange extensions"
              placeholder="Search extensions"
              className="min-w-0 flex-1"
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
                  className="space-y-3 rounded-xl border border-border bg-background/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
                      <PuzzleIcon aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="font-semibold">{listing.displayName}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {listing.id} · {listing.version} · Approved release ·{" "}
                    {listing.verifiedPublisher ? "Verified publisher" : "Unverified publisher"}
                  </p>
                  <p className="text-sm">{listing.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Tabs {listing.tabsCompatibility} · Permissions:{" "}
                    {listing.capabilities.length ? listing.capabilities.join(", ") : "None"}
                  </p>
                  {listing.releaseNotes ? (
                    <details className="text-sm">
                      <summary>Release notes</summary>
                      <p className="whitespace-pre-wrap">{listing.releaseNotes}</p>
                    </details>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["Source", listing.sourceUrl],
                        ["Support", listing.supportUrl],
                        ["Privacy", listing.privacyUrl],
                      ] as const
                    ).map(([label, url]) =>
                      url ? (
                        <Button
                          key={label}
                          type="button"
                          variant="link"
                          className="h-auto p-0"
                          onClick={() => void bridge.openExternal(url)}
                        >
                          {label}
                        </Button>
                      ) : null,
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Registry: {listing.registryOrigin}
                  </p>
                  <Button
                    id={`extension-discover-review-${listing.id}`}
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
          {catalog && (catalogCursor || catalogPaged) ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || !catalogCursor}
              onClick={() => void loadMoreExchange()}
            >
              {catalogCursor ? "Load more extensions" : "All results loaded"}
            </Button>
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
              onKeyDown={(event) => {
                if (event.key === "Escape" && !busy) {
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
                  });
                }
              }}
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
              {preparedInstall.requiresManualReview ? (
                <p className="text-sm" role="status">
                  This update includes a versioned migration of Tabs profile storage. Tabs backs up
                  the existing values and restores them if the new tool fails its first load.
                  Browser-local storage is not covered by this backup.
                </p>
              ) : null}
              {preparedInstall.manifest.networkHosts?.length ? (
                <p className="text-sm">
                  Requested network hosts: {preparedInstall.manifest.networkHosts.join(", ")}.
                </p>
              ) : null}
              {preparedInstall.replacesVersion &&
              (preparedInstall.addedCapabilities.length ||
                preparedInstall.addedNetworkHosts.length ||
                preparedInstall.addedAiTools.length) ? (
                <div className="text-sm" role="status">
                  <p>This update requests additional access:</p>
                  <ul className="list-disc pl-5">
                    {preparedInstall.addedCapabilities.map((capability) => (
                      <li key={capability}>Capability: {capability}</li>
                    ))}
                    {preparedInstall.addedNetworkHosts.map((host) => (
                      <li key={host}>Network host: {host}</li>
                    ))}
                    {preparedInstall.addedAiTools.map((commandId) => (
                      <li key={commandId}>AI-callable command: {commandId}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preparedInstall.manifest.contributes.commands?.length ? (
                <div className="text-sm">
                  <p>Packaged computation commands (no privileged access):</p>
                  <ul className="list-disc pl-5">
                    {preparedInstall.manifest.contributes.commands.map((command) => (
                      <li key={command.id}>
                        {command.label}: {command.description}
                        {command.aiCallable ? " (AI-callable after project grant)" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preparedInstall.manifest.contributes.commands?.some(
                (command) => command.aiCallable,
              ) ? (
                <p className="text-sm">
                  AI-callable commands require a separate grant for each project before agents can
                  see or run them.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Registry: {preparedInstall.registryOrigin} · SHA-256: {preparedInstall.digest}
              </p>
              <p className="text-sm text-muted-foreground">
                {preparedInstall.willKeepEnabled
                  ? "Existing project enablement is retained because no capability, network host, or AI-callable command was added."
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
                      const returnId = reviewReturnExtensionId.current;
                      const listingId = `${preparedInstall.manifest.publisher}.${preparedInstall.manifest.name}`;
                      await bridge.cancelExchangeInstall(preparedInstall.token);
                      setPreparedInstall(null);
                      if (returnId) setTab("installed");
                      requestAnimationFrame(() =>
                        (
                          (returnId
                            ? document.getElementById(`extension-update-${returnId}`)
                            : document.getElementById(`extension-discover-review-${listingId}`)) ??
                          (reviewTrigger.current?.isConnected ? reviewTrigger.current : null) ??
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
        <SettingsSection
          title="Installed"
          description="Manage tools and choose where they appear."
          contentClassName="divide-y divide-border"
        >
          {extensions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <PuzzleIcon aria-hidden="true" className="size-8 text-muted-foreground" />
              <h3 className="text-sm font-medium">No extensions installed.</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add a tool from the Exchange or load a local package in a development build.
              </p>
              <Button variant="outline" onClick={() => setTab("discover")}>
                Explore extensions
              </Button>
            </div>
          ) : (
            extensions.map((extension) => (
              <div
                key={extension.id}
                role="group"
                aria-label={`${extension.manifest.displayName} installation and project settings`}
                className="space-y-4 p-4 sm:p-5"
              >
                <div>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
                      <PuzzleIcon aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="min-w-0 flex-1 font-semibold">
                      {extension.manifest.displayName}
                    </h3>
                    <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                      {extension.revoked ? "Revoked" : extension.disabled ? "Disabled" : "Enabled"}
                    </span>
                  </div>
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
                  {extension.manifest.contributes.commands?.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pure commands:{" "}
                      {extension.manifest.contributes.commands
                        .map((command) => command.label)
                        .join(", ")}
                    </p>
                  ) : null}
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
                    <div className="mt-2 space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(extension.updatesPinned)}
                          disabled={busy}
                          onChange={(event) => {
                            const pinned = event.target.checked;
                            void run(async () => {
                              await bridge.setExtensionUpdatesPinned(extension.id, pinned);
                              setCheckedUpdates((current) => {
                                const next = { ...current };
                                delete next[extension.id];
                                return next;
                              });
                              setStatus(
                                pinned
                                  ? `Background update checks are paused for ${extension.manifest.displayName}. Manual checks remain available.`
                                  : `Background update checks are enabled for ${extension.manifest.displayName}.`,
                              );
                            });
                          }}
                        />
                        Pin {extension.manifest.displayName} at version {extension.manifest.version}
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`Check ${extension.manifest.displayName} for updates`}
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
                        {availableUpdate(extension) &&
                        (!extension.updatesPinned ||
                          Object.hasOwn(checkedUpdates, extension.id)) ? (
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
                    </div>
                  ) : null}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${extension.manifest.displayName}`}
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
                    aria-label={`Show ${extension.manifest.displayName} in all projects`}
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
                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Project overrides</p>
                  {projects.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Add a project to choose where this tool appears.
                    </p>
                  ) : null}
                  {projects.map((project) => {
                    const selected = extension.assignment.enabledGlobally
                      ? !extension.assignment.disabledProjectIds.includes(project.id)
                      : extension.assignment.enabledProjectIds.includes(project.id);
                    return (
                      <label key={project.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Show ${extension.manifest.displayName} in ${project.name}`}
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
                    aria-describedby={`uninstall-description-${extension.id}`}
                    className="space-y-2 rounded border border-destructive/50 p-3"
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !busy) {
                        const extId = extension.id;
                        setUninstallingId(null);
                        requestAnimationFrame(() =>
                          (
                            document.getElementById(`extension-uninstall-${extId}`) ??
                            (uninstallTrigger.current?.isConnected
                              ? uninstallTrigger.current
                              : null) ??
                            installedTabButton.current
                          )?.focus(),
                        );
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
                    <p
                      id={`uninstall-description-${extension.id}`}
                      className="text-sm text-muted-foreground"
                    >
                      Its tools, packaged files, and project assignments will be removed. Choose
                      whether to retain named profiles and local data for a future reinstall or
                      remove them from Tabs. This is not a secure erase of backups or disk history.
                      {!extension.dataDeletionAvailable
                        ? " Data deletion is unavailable because its storage inventory is incomplete or contains legacy data."
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await bridge.uninstallExtension(extension.id);
                            workspaceShellActions.removeExtensionToolPreferences(extension.id);
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
                      {extension.dataDeletionAvailable ? (
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await bridge.uninstallExtension(extension.id, true);
                              workspaceShellActions.removeExtensionToolPreferences(extension.id);
                              setCheckedUpdates((current) => {
                                const next = { ...current };
                                delete next[extension.id];
                                return next;
                              });
                              setUninstallingId(null);
                              setStatus(
                                `${extension.manifest.displayName} uninstalled. Its inventoried local data and profiles were removed from Tabs.`,
                              );
                              requestAnimationFrame(() => installedTabButton.current?.focus());
                            })
                          }
                        >
                          Uninstall and delete local data
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const extId = extension.id;
                          setUninstallingId(null);
                          requestAnimationFrame(() =>
                            (
                              document.getElementById(`extension-uninstall-${extId}`) ??
                              (uninstallTrigger.current?.isConnected
                                ? uninstallTrigger.current
                                : null) ??
                              installedTabButton.current
                            )?.focus(),
                          );
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </section>
                ) : (
                  <Button
                    id={`extension-uninstall-${extension.id}`}
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
        <SettingsSection
          title="Profiles & Permissions"
          description="Keep accounts separate. Stay in control of access."
          contentClassName="space-y-5 p-4 sm:p-5"
        >
          <p className="text-sm text-muted-foreground">
            A shared profile uses one storage space across projects. A project-isolated profile
            keeps browser and non-secret storage separate for each project. Workspace access,
            network and credential use, and AI-callable commands each require a separate project
            grant. Saved credentials are encrypted by the operating system and never shown again in
            Settings. Start a new agent session after granting AI tools so it discovers them.
          </p>
          {extensions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-5 py-8 text-center">
              <UsersIcon aria-hidden="true" className="size-7 text-muted-foreground" />
              <h3 className="text-sm font-medium">Your accounts, kept separate.</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Install an extension to create Work and Personal profiles and manage access for each
                project.
              </p>
              <Button variant="outline" onClick={() => setTab("discover")}>
                Explore extensions
              </Button>
            </div>
          ) : null}
          {extensions.length > 0 ? (
            <label className="flex flex-col gap-2 text-sm font-medium sm:flex-row sm:items-center sm:justify-between">
              Manage an extension
              <select
                aria-label="Extension to manage profiles and permissions"
                className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal sm:max-w-xs"
                value={activeProfileExtensionId}
                onChange={(event) => setProfileExtensionId(event.target.value)}
              >
                {extensions.map((extension) => (
                  <option key={extension.id} value={extension.id}>
                    {extension.manifest.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {extensions
            .filter((extension) => extension.id === activeProfileExtensionId)
            .map((extension) => (
              <div
                key={extension.id}
                role="group"
                aria-label={`${extension.manifest.displayName} profiles and permissions`}
                className="space-y-5 rounded-xl border border-border bg-background/40 p-4"
              >
                <div className="flex items-center gap-3">
                  <PuzzleIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                  <h3 className="font-semibold">{extension.manifest.displayName}</h3>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {extension.profiles.length} profiles
                  </span>
                </div>
                <label className="block text-sm">
                  Default profile
                  <select
                    className="ml-2 rounded border border-border bg-background px-2 py-1"
                    aria-label={`Default profile for ${extension.manifest.displayName}`}
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
                        {profile.label} (
                        {profile.scope === "project" ? "project-isolated" : "shared"})
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
                    aria-label={`Add profile for ${extension.manifest.displayName}`}
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
                {extension.manifest.capabilities?.includes("credentials") ? (
                  <div className="space-y-3 rounded border border-border p-3">
                    <h4 className="text-sm font-medium">Account credentials</h4>
                    <p className="text-xs text-muted-foreground">
                      A saved token is sent as a Bearer credential only to its named HTTPS host when
                      this extension asks for it in a project where credential use is allowed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <label className="text-sm">
                        Account profile
                        <select
                          className="ml-2 rounded border border-border bg-background px-2 py-1"
                          value={
                            credentialProfileSelection[extension.id] ??
                            extension.profiles[0]?.id ??
                            ""
                          }
                          disabled={busy}
                          onChange={(event) => {
                            setCredentialProfileSelection((current) => ({
                              ...current,
                              [extension.id]: event.target.value,
                            }));
                            setCredentialValues({});
                          }}
                        >
                          {extension.profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        Service host
                        <select
                          className="ml-2 rounded border border-border bg-background px-2 py-1"
                          value={
                            credentialHostSelection[extension.id] ??
                            extension.manifest.networkHosts?.[0] ??
                            ""
                          }
                          disabled={busy}
                          onChange={(event) => {
                            setCredentialHostSelection((current) => ({
                              ...current,
                              [extension.id]: event.target.value,
                            }));
                            setCredentialValues({});
                          }}
                        >
                          {(extension.manifest.networkHosts ?? []).map((host) => (
                            <option key={host} value={host}>
                              {host}
                            </option>
                          ))}
                        </select>
                      </label>
                      {extension.profiles.find(
                        (profile) =>
                          profile.id ===
                          (credentialProfileSelection[extension.id] ?? extension.profiles[0]?.id),
                      )?.scope === "project" ? (
                        <label className="text-sm">
                          Project
                          <select
                            className="ml-2 rounded border border-border bg-background px-2 py-1"
                            value={
                              credentialProjectSelection[extension.id] ?? projects[0]?.id ?? ""
                            }
                            disabled={busy}
                            onChange={(event) => {
                              setCredentialProjectSelection((current) => ({
                                ...current,
                                [extension.id]: event.target.value,
                              }));
                              setCredentialValues({});
                            }}
                          >
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                    {extension.profiles
                      .filter(
                        (profile) =>
                          profile.id ===
                          (credentialProfileSelection[extension.id] ?? extension.profiles[0]?.id),
                      )
                      .flatMap((profile) =>
                        (profile.scope === "project"
                          ? projects
                              .map((project) => project.id)
                              .filter(
                                (id) =>
                                  id ===
                                  (credentialProjectSelection[extension.id] ?? projects[0]?.id),
                              )
                          : [undefined]
                        ).flatMap((projectId) =>
                          (extension.manifest.networkHosts ?? [])
                            .filter(
                              (host) =>
                                host ===
                                (credentialHostSelection[extension.id] ??
                                  extension.manifest.networkHosts?.[0]),
                            )
                            .map((host) => {
                              const key = JSON.stringify([
                                extension.id,
                                profile.id,
                                projectId ?? null,
                                host,
                              ]);
                              const list = credentialStatuses[extension.id];
                              const saved =
                                Array.isArray(list) &&
                                list.some(
                                  (status) =>
                                    status.profileId === profile.id &&
                                    status.projectId === projectId &&
                                    status.host === host,
                                );
                              const label = `${extension.manifest.displayName} ${profile.label}${projectId ? ` for ${projects.find((project) => project.id === projectId)?.name ?? projectId}` : ""} credential for ${host}`;
                              return (
                                <div key={key} className="space-y-1">
                                  <label className="block text-sm">
                                    {label} ({saved ? "Saved" : "Not set"})
                                    <Input
                                      className="mt-1"
                                      type="password"
                                      autoComplete="off"
                                      value={credentialValues[key] ?? ""}
                                      disabled={busy}
                                      onChange={(event) =>
                                        setCredentialValues((current) => ({
                                          ...current,
                                          [key]: event.target.value,
                                        }))
                                      }
                                    />
                                  </label>
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      aria-label={`Save token for ${label}`}
                                      disabled={busy || !(credentialValues[key] ?? "").trim()}
                                      onClick={() =>
                                        void run(async () => {
                                          await bridge?.setExtensionCredential(
                                            extension.id,
                                            profile.id,
                                            host,
                                            credentialValues[key] ?? "",
                                            projectId,
                                          );
                                          setCredentialValues((current) => ({
                                            ...current,
                                            [key]: "",
                                          }));
                                          const statuses = await bridge?.listExtensionCredentials(
                                            extension.id,
                                          );
                                          if (statuses)
                                            setCredentialStatuses((current) => ({
                                              ...current,
                                              [extension.id]: statuses,
                                            }));
                                        })
                                      }
                                    >
                                      Save token
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      aria-label={`Remove token for ${label}`}
                                      disabled={busy || !saved}
                                      onClick={() =>
                                        void run(async () => {
                                          await bridge?.setExtensionCredential(
                                            extension.id,
                                            profile.id,
                                            host,
                                            null,
                                            projectId,
                                          );
                                          const statuses = await bridge?.listExtensionCredentials(
                                            extension.id,
                                          );
                                          if (statuses)
                                            setCredentialStatuses((current) => ({
                                              ...current,
                                              [extension.id]: statuses,
                                            }));
                                        })
                                      }
                                    >
                                      Remove token
                                    </Button>
                                  </div>
                                </div>
                              );
                            }),
                        ),
                      )}
                  </div>
                ) : null}
                {(credentialStatuses[extension.id] ?? [])
                  .filter(
                    (saved) =>
                      !extension.manifest.capabilities?.includes("credentials") ||
                      !extension.manifest.networkHosts?.includes(saved.host) ||
                      !extension.profiles.some((profile) => profile.id === saved.profileId) ||
                      (saved.projectId !== undefined &&
                        !projects.some((project) => project.id === saved.projectId)),
                  )
                  .map((saved) => (
                    <div key={JSON.stringify(saved)} className="flex items-center gap-2 text-sm">
                      <span>
                        Retained credential for {saved.profileId}
                        {saved.projectId ? ` / ${saved.projectId}` : ""} at {saved.host}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`Remove retained token for ${extension.manifest.displayName} ${saved.profileId}${saved.projectId ? ` in ${saved.projectId}` : ""} at ${saved.host}`}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await bridge?.setExtensionCredential(
                              extension.id,
                              saved.profileId,
                              saved.host,
                              null,
                              saved.projectId,
                            );
                            const statuses = await bridge?.listExtensionCredentials(extension.id);
                            if (statuses)
                              setCredentialStatuses((current) => ({
                                ...current,
                                [extension.id]: statuses,
                              }));
                          })
                        }
                      >
                        Remove retained token
                      </Button>
                    </div>
                  ))}
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="space-y-3 rounded-xl border border-border bg-muted/20 p-4"
                  >
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
                          assign(extension, {
                            ...extension.assignment,
                            profileIdByProjectId: next,
                          });
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
                          aria-label={`Allow ${extension.manifest.displayName} profile storage in ${project.name}`}
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
                    {extension.manifest.capabilities?.includes("workspace-read") ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Allow ${extension.manifest.displayName} to read workspace files in ${project.name}`}
                          checked={
                            extension.assignment.workspaceReadGrantedProjectIds?.includes(
                              project.id,
                            ) ?? false
                          }
                          disabled={busy}
                          onChange={(event) => {
                            const ids = extension.assignment.workspaceReadGrantedProjectIds ?? [];
                            assign(extension, {
                              ...extension.assignment,
                              workspaceReadGrantedProjectIds: event.target.checked
                                ? [...ids, project.id]
                                : ids.filter((id) => id !== project.id),
                            });
                          }}
                        />
                        Allow read-only workspace files for {project.name}
                      </label>
                    ) : null}
                    {extension.manifest.capabilities?.includes("git-status") ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Allow ${extension.manifest.displayName} to read Git status in ${project.name}`}
                          checked={
                            extension.assignment.gitStatusGrantedProjectIds?.includes(project.id) ??
                            false
                          }
                          disabled={busy}
                          onChange={(event) => {
                            const ids = extension.assignment.gitStatusGrantedProjectIds ?? [];
                            assign(extension, {
                              ...extension.assignment,
                              gitStatusGrantedProjectIds: event.target.checked
                                ? [...ids, project.id]
                                : ids.filter((id) => id !== project.id),
                            });
                          }}
                        />
                        Allow read-only Git status for {project.name}
                      </label>
                    ) : null}
                    {extension.manifest.capabilities?.includes("network") ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Allow ${extension.manifest.displayName} network access in ${project.name}`}
                          checked={
                            extension.assignment.networkGrantedProjectIds?.includes(project.id) ??
                            false
                          }
                          disabled={busy}
                          onChange={(event) => {
                            const ids = extension.assignment.networkGrantedProjectIds ?? [];
                            assign(extension, {
                              ...extension.assignment,
                              networkGrantedProjectIds: event.target.checked
                                ? [...ids, project.id]
                                : ids.filter((id) => id !== project.id),
                            });
                          }}
                        />
                        Allow HTTPS requests to {extension.manifest.networkHosts?.join(", ")} for{" "}
                        {project.name}
                      </label>
                    ) : null}
                    {extension.manifest.capabilities?.includes("credentials") ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Allow ${extension.manifest.displayName} credential use in ${project.name}`}
                          checked={
                            extension.assignment.credentialGrantedProjectIds?.includes(
                              project.id,
                            ) ?? false
                          }
                          disabled={busy}
                          onChange={(event) => {
                            const ids = extension.assignment.credentialGrantedProjectIds ?? [];
                            assign(extension, {
                              ...extension.assignment,
                              credentialGrantedProjectIds: event.target.checked
                                ? [...ids, project.id]
                                : ids.filter((id) => id !== project.id),
                            });
                          }}
                        />
                        Allow account credential use for {project.name}
                      </label>
                    ) : null}
                    {extension.manifest.capabilities?.includes("ai-tools") ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`Allow agents to run ${extension.manifest.displayName} commands in ${project.name}`}
                          checked={
                            extension.assignment.aiToolGrantedProjectIds?.includes(project.id) ??
                            false
                          }
                          disabled={busy}
                          onChange={(event) => {
                            const ids = extension.assignment.aiToolGrantedProjectIds ?? [];
                            assign(extension, {
                              ...extension.assignment,
                              aiToolGrantedProjectIds: event.target.checked
                                ? [...ids, project.id]
                                : ids.filter((id) => id !== project.id),
                            });
                          }}
                        />
                        Allow agents to run {extension.manifest.displayName} commands for{" "}
                        {project.name}
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

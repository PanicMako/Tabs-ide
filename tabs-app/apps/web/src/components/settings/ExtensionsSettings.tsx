import { useCallback, useEffect, useRef, useState } from "react";
import {
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
  UsersIcon,
  FolderCodeIcon,
  PackageIcon,
  ShieldCheckIcon,
  CheckIcon,
  Code2Icon,
  GlobeIcon,
  FolderIcon,
  LayersIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { TabsExtensionIcon } from "~/components/Icons";
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
import { Switch } from "../ui/switch";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "../ui/alert-dialog";
import { RadioGroup, Radio } from "../ui/radio-group";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "../ui/popover";
import { filterExchangeListings } from "~/lib/exchangeDiscovery";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { RegistryConnectionCard, type RegistryConnection } from "./RegistryConnectionCard";
import { ExtensionChoice, ExtensionCheckbox, ExtensionSwitch } from "./ExtensionChoice";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  ExtensionMarketplace,
  ExtensionLogo,
  InstalledExtensionLogo,
} from "./ExtensionMarketplace";
import "./extensions-settings.css";

type Tab = "discover" | "installed" | "profiles";

const PUBLISHER_FILTER_OPTIONS = [
  {
    value: "all" as const,
    label: "All publishers",
    description: "Browse tools from all registered publishers",
    icon: UsersIcon,
  },
  {
    value: "verified" as const,
    label: "Verified publishers",
    description: "Publisher identities checked by Tabs",
    icon: ShieldCheckIcon,
    iconColor: "text-blue-500 dark:text-blue-400",
  },
] as const;

const ACCESS_FILTER_OPTIONS = [
  {
    value: "all" as const,
    label: "Any access",
    description: "Include tools with all capability levels",
    icon: LayersIcon,
  },
  {
    value: "none" as const,
    label: "No permissions",
    description: "Zero external access; fully sandboxed",
    icon: ShieldCheckIcon,
    iconColor: "text-emerald-500 dark:text-emerald-400",
  },
  {
    value: "network" as const,
    label: "Network access",
    description: "Can call remote APIs and network endpoints",
    icon: GlobeIcon,
    iconColor: "text-sky-500 dark:text-sky-400",
  },
  {
    value: "workspace-read" as const,
    label: "Workspace files",
    description: "Can read project files in your workspace",
    icon: FolderIcon,
    iconColor: "text-amber-500 dark:text-amber-400",
  },
] as const;

export default function ExtensionsSettings({ onBack }: { onBack?: () => void } = {}) {
  const extensions = useInstalledExtensions();
  const [tab, setTab] = useState<Tab>(extensions.length ? "installed" : "discover");
  const [managedExtensionId, setManagedExtensionId] = useState<string | null>(null);
  const [manageSection, setManageSection] = useState<"projects" | "accounts" | "advanced">(
    "projects",
  );
  useEffect(() => setManageSection("projects"), [managedExtensionId]);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [profileExtensionId, setProfileExtensionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [operationBusy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const busy = operationBusy || catalogBusy;
  const filterButton = useRef<HTMLButtonElement>(null);
  const pendingInstall = useRef<DesktopExchangeListing | null>(null);
  const [registryConnection, setRegistryConnection] = useState<RegistryConnection | null>(null);
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
  const [publisherFilter, setPublisherFilter] = useState<"all" | "verified">("all");
  const [accessFilter, setAccessFilter] = useState<"all" | "none" | "network" | "workspace-read">(
    "all",
  );
  const filteredCatalog = filterExchangeListings(catalog ?? [], publisherFilter, accessFilter);
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
  const [uninstallDataAction, setUninstallDataAction] = useState<"retain" | "delete">("retain");
  const [installDetailsOpen, setInstallDetailsOpen] = useState(false);
  useEffect(() => setInstallDetailsOpen(false), [preparedInstall?.token]);
  const installListing = catalog?.find(
    (listing) =>
      preparedInstall &&
      listing.registryOrigin === preparedInstall.registryOrigin &&
      listing.digest === preparedInstall.digest &&
      listing.id === `${preparedInstall.manifest.publisher}.${preparedInstall.manifest.name}`,
  );
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const uninstallHeading = useRef<HTMLHeadingElement>(null);
  const uninstallTrigger = useRef<HTMLButtonElement | null>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const reviewReturnExtensionId = useRef<string | null>(null);
  const installedTabButton = useRef<HTMLButtonElement | null>(null);
  const discoverTabButton = useRef<HTMLButtonElement | null>(null);
  const activeProfileExtensionId = extensions.some(
    (extension) => extension.id === profileExtensionId,
  )
    ? profileExtensionId
    : extensions[0]?.id;
  const projects = useAtomValue(projectsAtom);
  const bridge = window.desktopBridge;
  useEffect(() => {
    let disposed = false;
    void bridge
      ?.getRegistryConnection?.()
      .then((connection) => {
        if (!disposed) setRegistryConnection(connection);
      })
      .catch(() => {
        if (!disposed) setError("Could not load registry connection status.");
      });
    return () => {
      disposed = true;
    };
  }, [bridge]);
  useEffect(() => {
    if (managedExtensionId && !extensions.some((extension) => extension.id === managedExtensionId))
      setManagedExtensionId(null);
    if (tab === "installed" && managedExtensionId)
      document.getElementById(`extension-manage-${managedExtensionId}`)?.focus();
    if (tab === "profiles") {
      setTab("installed");
      if (activeProfileExtensionId) {
        setManagedExtensionId(activeProfileExtensionId);
      }
      setManageSection("accounts");
    }
  }, [managedExtensionId, tab, extensions, activeProfileExtensionId]);
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
    if ((tab !== "installed" || manageSection !== "accounts") && tab !== "profiles") return;
    if (!bridge) return;
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
  }, [tab, manageSection, bridge, extensions]);

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

  const uninstallingExtension = uninstallingId
    ? (extensions.find((extension) => extension.id === uninstallingId) ?? null)
    : null;

  const closeUninstallDialog = useCallback(() => {
    const extId = uninstallingId;
    setUninstallingId(null);
    setUninstallDataAction("retain");
    requestAnimationFrame(() =>
      (
        (extId ? document.getElementById(`extension-uninstall-${extId}`) : null) ??
        (uninstallTrigger.current?.isConnected ? uninstallTrigger.current : null) ??
        installedTabButton.current
      )?.focus(),
    );
  }, [uninstallingId]);

  const handleConfirmUninstall = useCallback(() => {
    if (!uninstallingExtension) return;
    const ext = uninstallingExtension;
    const deleteData = uninstallDataAction === "delete" && ext.dataDeletionAvailable;
    void run(async () => {
      await bridge?.uninstallExtension(ext.id, deleteData);
      workspaceShellActions.removeExtensionToolPreferences(ext.id);
      setCheckedUpdates((current) => {
        const next = { ...current };
        delete next[ext.id];
        return next;
      });
      setUninstallingId(null);
      setUninstallDataAction("retain");
      setStatus(
        deleteData
          ? `${ext.manifest.displayName} uninstalled. Its inventoried local data and profiles were removed from Tabs.`
          : `${ext.manifest.displayName} uninstalled. Profile data was retained.`,
      );
      requestAnimationFrame(() => installedTabButton.current?.focus());
    });
  }, [bridge, run, uninstallDataAction, uninstallingExtension]);
  const assign = (extension: DesktopInstalledExtension, update: TabsExtensionAssignment) => {
    if (!bridge) return;
    void run(() => bridge.setExtensionAssignment(extension.id, update));
  };
  const catalogGeneration = useRef(0);
  useEffect(
    () => () => {
      catalogGeneration.current++;
    },
    [],
  );
  const searchExchange = async (override?: string) => {
    if (!bridge) return;
    const generation = ++catalogGeneration.current;
    const query = (override ?? searchQuery).trim();
    setCatalogBusy(true);
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
      if (generation !== catalogGeneration.current) return;
      setCatalog(page ? [...page.listings] : null);
      setCatalogCursor(page?.nextCursor ?? null);
      if (page?.nextCursor) catalogSeenCursors.current.add(page.nextCursor);
      setExchangeInstallAvailable(available);
    } catch (cause) {
      if (generation === catalogGeneration.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === catalogGeneration.current) setCatalogBusy(false);
    }
  };
  const loadMoreExchange = async () => {
    if (!bridge || !catalogCursor || !catalog) return;
    const generation = catalogGeneration.current;
    setCatalogBusy(true);
    setError(null);
    const cursor = catalogCursor;
    try {
      const page = await bridge.discoverExchangeExtensions(catalogQuery, cursor);
      if (generation !== catalogGeneration.current) return;
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
      if (generation === catalogGeneration.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === catalogGeneration.current) setCatalogBusy(false);
    }
  };

  useEffect(() => {
    if (tab !== "discover" || !registryConnection?.origin || !bridge) return;
    void searchExchange();
    // A connection or view change starts a fresh catalog lookup, not each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, registryConnection?.origin, registryConnection?.trusted, bridge]);

  return (
    <div className="extensions-settings space-y-4">
      <SettingsSectionHeader
        title="Extensions"
        description="Find tools for your workspace."
        preTitle={
          onBack ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to Labs"
              className="size-8 shrink-0 rounded-full border-border/80 bg-background/60 hover:bg-accent hover:border-foreground/30 text-muted-foreground hover:text-foreground shadow-xs transition-colors active:scale-95"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : undefined
        }
        actions={
          <RegistryConnectionCard
            compact
            bridge={bridge}
            connection={registryConnection}
            open={connectionOpen}
            onOpenChange={(open) => {
              setConnectionOpen(open);
              if (!open) pendingInstall.current = null;
            }}
            busy={busy}
            onConnected={(connection) => {
              setRegistryConnection(connection);
              setExchangeInstallAvailable(Boolean(connection.trusted));
              setPreparedInstall(null);
              setCatalog(undefined);
              setCatalogCursor(null);
              setTab("discover");
              const pending = pendingInstall.current;
              pendingInstall.current = null;
              if (
                connection.trusted &&
                pending &&
                pending.registryOrigin === connection.origin &&
                bridge
              ) {
                reviewReturnExtensionId.current = null;
                void run(async () => {
                  setPreparedInstall(await bridge.prepareExchangeInstall(pending));
                });
              }
            }}
          />
        }
      />
      <div role="group" aria-label="Extension settings views" className="extension-view-tabs">
        <button
          ref={discoverTabButton}
          type="button"
          aria-pressed={tab === "discover"}
          onClick={() => setTab("discover")}
        >
          Browse
        </button>
        <button
          ref={installedTabButton}
          type="button"
          aria-pressed={tab !== "discover"}
          onClick={() => {
            setTab("installed");
            setManagedExtensionId(null);
          }}
        >
          Installed <span>{extensions.length}</span>
        </button>
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
        <section
          className="extension-discover space-y-4 flex-1 flex flex-col min-h-0"
          aria-label="Browse extensions"
        >
          <form
            className="extension-search"
            onSubmit={(event) => {
              event.preventDefault();
              void searchExchange();
            }}
          >
            <SearchIcon className="market-search-icon size-4.5 shrink-0" aria-hidden="true" />
            <Input
              unstyled
              aria-label="Search Tabs Exchange extensions"
              placeholder="Search extensions"
              className="min-w-0 flex-1 border-0 bg-transparent shadow-none"
              value={searchQuery}
              maxLength={100}
              disabled={busy}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Popover>
              <PopoverTrigger
                ref={filterButton}
                className="market-filter-trigger"
                aria-label="Filters"
              >
                <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
                Filters
                {(publisherFilter !== "all" || accessFilter !== "all") && (
                  <span className="market-filter-count">
                    {Number(publisherFilter !== "all") + Number(accessFilter !== "all")}
                  </span>
                )}
              </PopoverTrigger>
              <PopoverPopup
                hasBackdrop
                backdropClassName="market-filter-backdrop"
                side="bottom"
                align="end"
                sideOffset={6}
                className="market-filter-popover border-border/80 bg-popover/95 p-3 shadow-2xl backdrop-blur-md"
                aria-label="Extension filters"
                finalFocus={filterButton}
              >
                <div className="market-filter-options">
                  <div className="market-filter-header">
                    <PopoverTitle className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <SlidersHorizontalIcon className="size-3.5 text-primary" aria-hidden="true" />
                      Filters
                    </PopoverTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="market-filter-reset h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      disabled={publisherFilter === "all" && accessFilter === "all"}
                      onClick={() => {
                        setPublisherFilter("all");
                        setAccessFilter("all");
                      }}
                    >
                      Reset filters
                    </Button>
                  </div>
                  <div className="market-filter-columns">
                    <div className="market-filter-group" role="group" aria-label="Publisher filter">
                      <span className="market-filter-section-title">Publisher</span>
                      <div className="market-filter-list">
                        {PUBLISHER_FILTER_OPTIONS.map((opt) => {
                          const isSelected = publisherFilter === opt.value;
                          const Icon = opt.icon;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              aria-label={opt.label}
                              aria-description={opt.description}
                              aria-pressed={isSelected}
                              className={cn("market-filter-card", isSelected && "is-selected")}
                              onClick={() => setPublisherFilter(opt.value)}
                            >
                              <div
                                className={cn(
                                  "market-filter-card-icon",
                                  "iconColor" in opt && opt.iconColor,
                                )}
                              >
                                <Icon className="size-3.5" aria-hidden="true" />
                              </div>
                              <span className="market-filter-card-title">{opt.label}</span>
                              {isSelected && (
                                <CheckIcon
                                  className="size-3.5 text-foreground shrink-0 market-filter-check"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="market-filter-hint" aria-hidden="true">
                        <ShieldCheckIcon className="size-3 text-blue-400 shrink-0 mt-0.5" />
                        <span>Publisher identity checked by Exchange.</span>
                      </div>
                    </div>
                    <div
                      className="market-filter-group"
                      role="group"
                      aria-label="Requested access filter"
                    >
                      <span className="market-filter-section-title">Requested access</span>
                      <div className="market-filter-list">
                        {ACCESS_FILTER_OPTIONS.map((opt) => {
                          const isSelected = accessFilter === opt.value;
                          const Icon = opt.icon;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              aria-label={opt.label}
                              aria-description={opt.description}
                              aria-pressed={isSelected}
                              className={cn("market-filter-card", isSelected && "is-selected")}
                              onClick={() => setAccessFilter(opt.value)}
                            >
                              <div
                                className={cn(
                                  "market-filter-card-icon",
                                  "iconColor" in opt && opt.iconColor,
                                )}
                              >
                                <Icon className="size-3.5" aria-hidden="true" />
                              </div>
                              <span className="market-filter-card-title">{opt.label}</span>
                              {isSelected && (
                                <CheckIcon
                                  className="size-3.5 text-foreground shrink-0 market-filter-check"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverPopup>
            </Popover>
            <Button type="submit" variant="default" aria-label="Search Exchange" disabled={busy}>
              {catalogBusy ? "Searching…" : "Search"}
            </Button>
          </form>
          {(publisherFilter !== "all" || accessFilter !== "all") && (
            <div className="market-filter-toolbar" aria-label="Filter loaded Exchange results">
              {publisherFilter !== "all" && (
                <button
                  className="market-active-filter"
                  type="button"
                  aria-label="Remove verified publishers filter"
                  onClick={() => setPublisherFilter("all")}
                >
                  Verified publishers <XIcon className="size-3" aria-hidden="true" />
                </button>
              )}
              {accessFilter !== "all" && (
                <button
                  className="market-active-filter"
                  type="button"
                  aria-label="Remove requested access filter"
                  onClick={() => setAccessFilter("all")}
                >
                  {
                    {
                      none: "No permissions",
                      network: "Network access",
                      "workspace-read": "Workspace files",
                    }[accessFilter]
                  }{" "}
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <p role="status" className="sr-only">
            {catalogBusy
              ? "Loading extensions"
              : catalog
                ? `${filteredCatalog.length} matching extensions`
                : "Browse extensions"}
          </p>
          {catalog === null && (
            <div className="extension-empty">
              <h3>Exchange is unavailable</h3>
              <p>Check your connection and try again.</p>
              <Button variant="outline" onClick={() => void searchExchange()}>
                Try again
              </Button>
            </div>
          )}
          {catalog && filteredCatalog.length === 0 && (
            <div className="extension-empty">
              <h3>No matching extensions</h3>
              <p>Try another name or clear the filters.</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setSearchQuery("");
                  setPublisherFilter("all");
                  setAccessFilter("all");
                  void searchExchange("");
                }}
              >
                Browse all extensions
              </Button>
            </div>
          )}
          <ExtensionMarketplace
            listings={filteredCatalog}
            bridge={bridge}
            installed={extensions}
            busy={busy}
            onManage={(id) => {
              setManagedExtensionId(id);
              setTab("installed");
            }}
            onInstall={(listing, trigger) => {
              if (!exchangeInstallAvailable) {
                pendingInstall.current = listing;
                setConnectionOpen(true);
                return;
              }
              reviewTrigger.current = trigger;
              reviewReturnExtensionId.current = null;
              void run(async () => {
                if (preparedInstall) {
                  await bridge.cancelExchangeInstall(preparedInstall.token);
                  setPreparedInstall(null);
                }
                setPreparedInstall(await bridge.prepareExchangeInstall(listing));
              });
            }}
          />
          {catalogCursor || catalogPaged ? (
            <Button
              variant="outline"
              disabled={busy || !catalogCursor}
              onClick={() => void loadMoreExchange()}
            >
              {catalogCursor ? "Load more extensions" : "All extensions loaded"}
            </Button>
          ) : null}
          {preparedInstall ? (
            <Dialog
              open
              onOpenChange={(open) => {
                if (open || busy) return;
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
              }}
            >
              <DialogPopup
                className="extension-install-dialog max-w-lg gap-4 overflow-y-auto p-6"
                showCloseButton={false}
                initialFocus={reviewHeading}
                finalFocus={false}
              >
                <div className="extension-install-heading">
                  {installListing ? (
                    <ExtensionLogo bridge={bridge} listing={installListing} large />
                  ) : (
                    <span className="extension-install-symbol">
                      <PackageIcon className="size-6" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <DialogTitle
                      id="exchange-install-review"
                      ref={reviewHeading}
                      tabIndex={-1}
                      className="text-xl font-semibold"
                    >
                      {preparedInstall.replacesVersion ? "Update" : "Install"}{" "}
                      {preparedInstall.manifest.displayName}?
                    </DialogTitle>
                    <p className="extension-install-byline">
                      {preparedInstall.manifest.publisher} <span aria-hidden="true">·</span> v
                      {preparedInstall.manifest.version}
                      {preparedInstall.replacesVersion
                        ? ` (from ${preparedInstall.replacesVersion})`
                        : ""}
                    </p>
                  </div>
                </div>
                <DialogDescription className="text-sm text-muted-foreground">
                  {preparedInstall.replacesVersion
                    ? "Check what changes before updating."
                    : "Ready to add to your workspace."}
                </DialogDescription>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <div className="extension-install-access rounded-xl border border-border bg-muted/30 p-4 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" />
                    {preparedInstall.manifest.capabilities?.length
                      ? "Requested access"
                      : "No extra project permissions"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {preparedInstall.manifest.capabilities?.length
                      ? preparedInstall.manifest.capabilities
                          .map(
                            (capability) =>
                              ({
                                "profile-storage": "Save extension data",
                                "workspace-read": "Read workspace files",
                                "git-status": "Read Git status",
                                network: "Network access",
                                credentials: "Use saved credentials",
                                "ai-tools": "Offer tools to agents",
                              })[capability] ?? capability,
                          )
                          .join(", ")
                      : "This extension doesn’t request access to your project files, network, or saved credentials."}
                  </p>
                </div>
                {preparedInstall.requiresManualReview ? (
                  <p className="text-sm" role="status">
                    This update includes a versioned migration of Tabs profile storage. Tabs backs
                    up the existing values and restores them if the new tool fails its first load.
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
                <div className="extension-install-technical">
                  <button
                    type="button"
                    className="extension-install-details-trigger"
                    aria-expanded={installDetailsOpen}
                    aria-controls="extension-install-details"
                    onClick={() => setInstallDetailsOpen((open) => !open)}
                  >
                    Technical details{" "}
                    <ChevronDownIcon
                      className={cn("size-3.5", installDetailsOpen && "rotate-180")}
                      aria-hidden="true"
                    />
                  </button>
                  {installDetailsOpen && (
                    <dl id="extension-install-details" className="extension-install-details">
                      <div>
                        <dt>Registry</dt>
                        <dd>{preparedInstall.registryOrigin}</dd>
                      </div>
                      <div>
                        <dt>Package</dt>
                        <dd>
                          {preparedInstall.manifest.publisher}.{preparedInstall.manifest.name}
                        </dd>
                      </div>
                      <div>
                        <dt>SHA-256 fingerprint</dt>
                        <dd>
                          <code>{preparedInstall.digest}</code>
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {preparedInstall.willKeepEnabled
                    ? "Existing project enablement is retained because no capability, network host, or AI-callable command was added."
                    : "After installation, choose which projects can use this extension."}
                </p>
                <div className="flex flex-row-reverse gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    aria-label={`Install ${preparedInstall.manifest.displayName}`}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        try {
                          await bridge.confirmExchangeInstall(preparedInstall.token);
                        } catch (cause) {
                          // Confirmation consumes its preparation token, even on
                          // failure. Require fresh verification before retrying.
                          const returnId = reviewReturnExtensionId.current;
                          setPreparedInstall(null);
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
                          throw new Error(
                            `${cause instanceof Error ? cause.message : "Installation failed."} Review the package again before retrying.`,
                          );
                        }
                        setCheckedUpdates((current) => {
                          const next = { ...current };
                          delete next[
                            `${preparedInstall.manifest.publisher}.${preparedInstall.manifest.name}`
                          ];
                          return next;
                        });
                        setPreparedInstall(null);
                        setManagedExtensionId(null);
                        setTab("installed");
                        setStatus(
                          `${preparedInstall.manifest.displayName} installed. Choose Manage to select the projects where it appears.`,
                        );
                        requestAnimationFrame(() => installedTabButton.current?.focus());
                      })
                    }
                  >
                    {busy ? "Installing…" : preparedInstall.replacesVersion ? "Update" : "Install"}
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
                              : document.getElementById(
                                  `extension-discover-review-${listingId}`,
                                )) ??
                            (reviewTrigger.current?.isConnected ? reviewTrigger.current : null) ??
                            (returnId ? installedTabButton.current : discoverTabButton.current)
                          )?.focus(),
                        );
                      })
                    }
                  >
                    Cancel
                  </Button>
                </div>
              </DialogPopup>
            </Dialog>
          ) : null}
          <div className="extension-dev-footer">
            {import.meta.env.DEV ? (
              <div className="extension-dev-panel">
                <div className="extension-dev-panel-header">
                  <div className="extension-dev-panel-title-group">
                    <div className="extension-dev-badge">
                      <Code2Icon className="size-3.5" aria-hidden="true" />
                      <span>Developer</span>
                    </div>
                    <div>
                      <h4
                        className="extension-dev-heading"
                        style={{
                          fontFamily: "var(--font-display, var(--font-sans))",
                          letterSpacing: "var(--font-section-tracking, -0.01em)",
                        }}
                      >
                        Sideload Extensions
                      </h4>
                      <p
                        className="extension-dev-subheading"
                        style={{
                          fontFamily: "var(--font-supporting, var(--font-sans))",
                          fontStyle: "var(--font-supporting-style, normal)",
                        }}
                      >
                        Test unpacked local folders or built packages during development.
                      </p>
                    </div>
                  </div>
                  <div className="extension-dev-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="extension-dev-btn"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const directory = await bridge.pickFolder();
                          if (directory) await bridge.installDevelopmentExtension(directory);
                        })
                      }
                    >
                      <FolderCodeIcon className="size-4" aria-hidden="true" />
                      Load development folder
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="extension-dev-btn"
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
                      <PackageIcon className="size-4" aria-hidden="true" />
                      Load local package
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <details className="extension-verification-details text-xs text-muted-foreground">
              <summary className="cursor-pointer inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
                <ShieldCheckIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>How installation is verified</span>
              </summary>
              <p className="mt-2.5 pl-5 leading-relaxed text-muted-foreground/90 border-l border-border/60">
                Tabs checks signed registry metadata and the exact package digest. New installations
                are disabled until you enable them for projects. Review is not a security guarantee.
              </p>
            </details>
          </div>
        </section>
      ) : (
        <div className="extension-installed-view flex-1 flex flex-col min-h-0">
          <SettingsSection
            title={managedExtensionId ? "Extension settings" : "Your extensions"}
            description={
              managedExtensionId
                ? "Choose where it appears and manage its access."
                : "Your tools, ready when you need them."
            }
            className={cn("installed-settings-section", managedExtensionId && "is-managing")}
            contentClassName="extension-installed-content"
          >
            {extensions.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-16 text-center">
                <TabsExtensionIcon
                  aria-hidden="true"
                  className="size-9 text-muted-foreground/80 mb-1"
                />
                <h3 className="text-sm font-semibold">No extensions installed.</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Add a tool from the Exchange or load a local package in a development build.
                </p>
                <Button variant="outline" className="mt-2" onClick={() => setTab("discover")}>
                  Explore extensions
                </Button>
              </div>
            ) : !managedExtensionId ? (
              <ul className="market-installed-list" aria-label="Installed extensions">
                {extensions.map((extension) => (
                  <li key={extension.id}>
                    <button
                      type="button"
                      className="market-listing"
                      aria-label={`Manage ${extension.manifest.displayName}`}
                      onClick={() => setManagedExtensionId(extension.id)}
                    >
                      <InstalledExtensionLogo bridge={bridge} extension={extension} />
                      <span className="market-listing-copy">
                        <strong>{extension.manifest.displayName}</strong>
                        <span>{extension.manifest.description}</span>
                        <small>
                          {extension.manifest.publisher} · v{extension.manifest.version}
                        </small>
                      </span>
                      <span className="market-installed-status">
                        {extension.revoked
                          ? "Revoked"
                          : extension.disabled
                            ? "Disabled"
                            : extension.assignment.enabledGlobally
                              ? "All projects"
                              : extension.assignment.enabledProjectIds.length
                                ? `${extension.assignment.enabledProjectIds.length} projects`
                                : "Choose projects"}
                      </span>
                      <span className="installed-manage-label">
                        Manage <ChevronRightIcon className="size-3.5" aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <Button
                  className="installed-back-button"
                  variant="ghost"
                  onClick={() => setManagedExtensionId(null)}
                >
                  <ArrowLeftIcon className="size-3.5" aria-hidden="true" /> Back to installed
                </Button>
                {extensions
                  .filter((extension) => extension.id === managedExtensionId)
                  .map((extension) => (
                    <div
                      key={extension.id}
                      role="group"
                      aria-label={`${extension.manifest.displayName} installation and project settings`}
                      className="extension-installed-card"
                    >
                      <div className="installed-manage-hero">
                        <div className="mb-3 flex items-center gap-3">
                          <InstalledExtensionLogo bridge={bridge} extension={extension} />
                          <h3
                            id={`extension-manage-${extension.id}`}
                            tabIndex={-1}
                            className="installed-manage-title min-w-0 flex-1 font-semibold"
                            style={{
                              fontFamily: "var(--font-display, var(--font-sans))",
                              letterSpacing: "var(--font-section-tracking, -0.01em)",
                            }}
                          >
                            {extension.manifest.displayName}
                          </h3>
                          <label className="installed-hero-enable">
                            <Switch
                              aria-label={`Enable ${extension.manifest.displayName}`}
                              checked={!extension.disabled}
                              disabled={busy || extension.revoked}
                              onCheckedChange={(checked) => {
                                const disabled = !checked;
                                void run(async () => {
                                  await bridge.setExtensionDisabled(extension.id, disabled);
                                  setStatus(
                                    `${extension.manifest.displayName} ${disabled ? "disabled" : "enabled"}.`,
                                  );
                                });
                              }}
                            />
                            <span>{extension.disabled ? "Paused" : "Enabled"}</span>
                          </label>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {extension.manifest.publisher} · v{extension.manifest.version} ·{" "}
                          {extension.source === "exchange"
                            ? "Tabs Exchange"
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
                            Browse for a newer approved version; your profiles and data are
                            retained.
                          </p>
                        ) : null}
                        {extension.disabled ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Disabled. Its tools are hidden; profiles, permissions, and project
                            choices are retained.
                          </p>
                        ) : null}
                      </div>
                      <nav className="installed-manage-nav" aria-label="Extension management">
                        <button
                          type="button"
                          aria-pressed={manageSection === "projects"}
                          onClick={() => setManageSection("projects")}
                        >
                          <FolderIcon className="size-4" aria-hidden="true" />
                          Projects
                        </button>
                        <button
                          type="button"
                          aria-pressed={manageSection === "accounts"}
                          onClick={() => {
                            setProfileExtensionId(extension.id);
                            setManageSection("accounts");
                          }}
                        >
                          <UsersIcon className="size-4" aria-hidden="true" />
                          Accounts & access
                        </button>
                        <button
                          type="button"
                          aria-pressed={manageSection === "advanced"}
                          onClick={() => setManageSection("advanced")}
                        >
                          <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
                          Advanced
                        </button>
                      </nav>
                      {manageSection === "projects" ? (
                        <div className="installed-project-workspace">
                          <section className="installed-control-section installed-projects-section">
                            <div>
                              <h4>Choose your projects</h4>
                              <p className="installed-control-help">
                                Where would you like this extension to appear?
                              </p>
                            </div>
                            <div
                              className="installed-project-scope"
                              role="group"
                              aria-label="Project availability"
                            >
                              <button
                                type="button"
                                disabled={busy || extension.revoked}
                                aria-pressed={!extension.assignment.enabledGlobally}
                                onClick={() =>
                                  assign(extension, {
                                    ...extension.assignment,
                                    enabledGlobally: false,
                                  })
                                }
                              >
                                <span>Selected projects</span>
                                <small>Choose from the list below</small>
                              </button>
                              <button
                                type="button"
                                disabled={busy || extension.revoked}
                                aria-pressed={extension.assignment.enabledGlobally}
                                onClick={() =>
                                  assign(extension, {
                                    ...extension.assignment,
                                    enabledGlobally: true,
                                  })
                                }
                              >
                                <span>All projects</span>
                                <small>Includes projects you add later</small>
                              </button>
                            </div>
                            <p className="installed-selection-hint">
                              {extension.assignment.enabledGlobally
                                ? "Toggle a project off to exclude it."
                                : "Toggle a project on to add it to your workspace."}
                            </p>
                            <div
                              className="installed-project-list"
                              role="group"
                              aria-label="Choose projects"
                            >
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
                                  <label
                                    key={project.id}
                                    className="installed-project-row flex items-center gap-3 text-sm"
                                  >
                                    <span className="installed-project-avatar" aria-hidden="true">
                                      <ProjectFavicon
                                        project={{
                                          workspaceRoot: project.cwd ?? "",
                                          title: project.title ?? project.name,
                                          faviconPath: project.faviconPath,
                                          projectIcon: project.projectIcon,
                                          environmentId: project.environmentId,
                                        }}
                                        className="size-4"
                                      />
                                    </span>
                                    <span className="installed-project-name flex-1">
                                      {project.name}
                                    </span>
                                    <ExtensionSwitch
                                      aria-label={`Show ${extension.manifest.displayName} in ${project.name}`}
                                      checked={selected}
                                      disabled={busy || extension.revoked}
                                      onCheckedChange={(checked) => {
                                        const assignment = extension.assignment;
                                        const next = checked;
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
                                  </label>
                                );
                              })}
                            </div>
                          </section>
                          <aside className="installed-project-guide">
                            <div className="installed-guide-art" aria-hidden="true">
                              <FolderIcon className="size-7" />
                              <CheckIcon className="size-4" />
                            </div>
                            <h4>Right where you work.</h4>
                            <p>Selected projects get this extension in their tools toolbar.</p>
                            <span>
                              <CheckIcon className="size-3.5" aria-hidden="true" />
                              Your choices save automatically
                            </span>
                            {extension.disabled && (
                              <p>
                                Enable the switch above when you’re ready. Your project choices will
                                stay here.
                              </p>
                            )}
                          </aside>
                        </div>
                      ) : manageSection === "accounts" ? (
                        <div className="installed-project-workspace">
                          <div className="space-y-5 min-w-0">
                            <section className="installed-control-section installed-projects-section">
                              <div>
                                <h4>Accounts & access</h4>
                                <p className="installed-control-help">
                                  Manage named accounts, storage isolation, and project permissions
                                  for {extension.manifest.displayName}.
                                </p>
                              </div>
                            </section>

                            {/* Card 1: Profiles & Storage Scopes */}
                            <section className="installed-control-section space-y-4">
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <h4>Profiles</h4>
                                  <p className="installed-control-help">
                                    Use separate profiles to partition data for work, personal, or
                                    client projects.
                                  </p>
                                </div>
                                <span className="text-xs text-muted-foreground font-medium shrink-0">
                                  {extension.profiles.length}{" "}
                                  {extension.profiles.length === 1 ? "profile" : "profiles"}
                                </span>
                              </div>

                              {/* Default profile row */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground">
                                    Default profile
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    Automatically used across projects unless assigned a specific
                                    override below.
                                  </div>
                                </div>
                                <div className="shrink-0">
                                  <ExtensionChoice
                                    className="w-full sm:w-56"
                                    aria-label={`Default profile for ${extension.manifest.displayName}`}
                                    value={extension.assignment.defaultProfileId}
                                    disabled={busy}
                                    onValueChange={(value) =>
                                      assign(extension, {
                                        ...extension.assignment,
                                        defaultProfileId: value,
                                      })
                                    }
                                  >
                                    {extension.profiles.map((profile) => (
                                      <option key={profile.id} value={profile.id}>
                                        {profile.label} (
                                        {profile.scope === "project"
                                          ? "project-isolated"
                                          : "shared"}
                                        )
                                      </option>
                                    ))}
                                  </ExtensionChoice>
                                </div>
                              </div>

                              {/* Configured Profiles List */}
                              <div className="space-y-2">
                                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
                                  Configured profiles
                                </div>
                                <div className="divide-y divide-border/40 rounded-xl border border-border/70 bg-background/50 overflow-hidden">
                                  {extension.profiles.map((profile) => {
                                    const isDefault =
                                      (extension.assignment.defaultProfileId ??
                                        extension.profiles[0]?.id) === profile.id;
                                    return (
                                      <div
                                        key={profile.id}
                                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                                      >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <UsersIcon
                                            className="size-4 text-muted-foreground shrink-0"
                                            aria-hidden="true"
                                          />
                                          <span className="font-medium text-foreground truncate">
                                            {profile.label}
                                          </span>
                                          {isDefault ? (
                                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
                                              Default
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className="text-xs text-muted-foreground">
                                            {profile.scope === "project"
                                              ? "Isolated per project"
                                              : "Shared across projects"}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Create New Profile Box */}
                              <div className="rounded-xl border border-dashed border-border/90 bg-muted/10 p-3.5 space-y-3">
                                <div>
                                  <div className="text-sm font-medium text-foreground">
                                    Create a new profile
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    Add a separate account workspace for this extension.
                                  </div>
                                </div>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                                  <Input
                                    aria-label={`New profile for ${extension.manifest.displayName}`}
                                    placeholder="Profile name (e.g. Work, Personal)"
                                    className="flex-1"
                                    value={profileNames[extension.id] ?? ""}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setProfileNames((current) => ({
                                        ...current,
                                        [extension.id]: event.target.value,
                                      }))
                                    }
                                  />
                                  <ExtensionChoice
                                    className="w-full sm:w-52 text-sm"
                                    aria-label={`Storage scope for new ${extension.manifest.displayName} profile`}
                                    value={profileScopes[extension.id] ?? "shared"}
                                    disabled={busy}
                                    onValueChange={(value) =>
                                      setProfileScopes((current) => ({
                                        ...current,
                                        [extension.id]: value as "shared" | "project",
                                      }))
                                    }
                                  >
                                    <option value="shared">Shared across projects</option>
                                    <option value="project">Isolated per project</option>
                                  </ExtensionChoice>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    aria-label={`Add profile for ${extension.manifest.displayName}`}
                                    disabled={busy || !(profileNames[extension.id] ?? "").trim()}
                                    onClick={() =>
                                      void run(async () => {
                                        const label = (profileNames[extension.id] ?? "").trim();
                                        const id = label
                                          .toLowerCase()
                                          .replace(/[^a-z0-9]+/g, "-")
                                          .replace(/^-|-$/g, "");
                                        await bridge?.addExtensionProfile(
                                          extension.id,
                                          id,
                                          label,
                                          profileScopes[extension.id] ?? "shared",
                                        );
                                        setProfileNames((current) => ({
                                          ...current,
                                          [extension.id]: "",
                                        }));
                                        setStatus(`Profile "${label}" created.`);
                                      })
                                    }
                                  >
                                    Add profile
                                  </Button>
                                </div>
                              </div>
                            </section>

                            {/* Card 2: Per-Project Profile Assignments */}
                            <section className="installed-control-section space-y-4">
                              <div>
                                <h4>Project profile assignments</h4>
                                <p className="installed-control-help">
                                  Specify which profile {extension.manifest.displayName} should use
                                  in each of your projects.
                                </p>
                              </div>

                              <div className="divide-y divide-border/60 rounded-xl border border-border/80 bg-background/50 overflow-hidden">
                                {projects.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-muted-foreground">
                                    No projects available in Tabs.
                                  </div>
                                ) : null}
                                {projects.map((project) => {
                                  const currentOverride =
                                    extension.assignment.profileIdByProjectId[project.id] ?? "";
                                  const defaultProfile = extension.profiles.find(
                                    (p) =>
                                      p.id ===
                                      (extension.assignment.defaultProfileId ??
                                        extension.profiles[0]?.id),
                                  );
                                  const hasCapabilities =
                                    extension.manifest.capabilities?.includes("profile-storage") ||
                                    extension.manifest.capabilities?.includes("workspace-read") ||
                                    extension.manifest.capabilities?.includes("git-status") ||
                                    extension.manifest.capabilities?.includes("ai-tools");

                                  return (
                                    <div key={project.id} className="p-3.5 space-y-3">
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <span
                                            className="installed-project-avatar"
                                            aria-hidden="true"
                                          >
                                            <ProjectFavicon
                                              project={{
                                                workspaceRoot: project.cwd ?? "",
                                                title: project.title ?? project.name,
                                                faviconPath: project.faviconPath,
                                                projectIcon: project.projectIcon,
                                                environmentId: project.environmentId,
                                              }}
                                              className="size-4"
                                            />
                                          </span>
                                          <div className="min-w-0">
                                            <span className="font-medium text-sm text-foreground truncate block">
                                              {project.name}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground block">
                                              {currentOverride
                                                ? `Profile: ${
                                                    extension.profiles.find(
                                                      (p) => p.id === currentOverride,
                                                    )?.label ?? currentOverride
                                                  }`
                                                : `Using default (${defaultProfile?.label ?? "Default"})`}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="shrink-0">
                                          <ExtensionChoice
                                            className="w-full sm:w-48 text-xs"
                                            aria-label={`${extension.manifest.displayName} profile for ${project.name}`}
                                            value={currentOverride}
                                            disabled={busy}
                                            onValueChange={(value) => {
                                              const next = {
                                                ...extension.assignment.profileIdByProjectId,
                                              };
                                              if (value) next[project.id] = value;
                                              else delete next[project.id];
                                              assign(extension, {
                                                ...extension.assignment,
                                                profileIdByProjectId: next,
                                              });
                                            }}
                                          >
                                            <option value="">
                                              Use default ({defaultProfile?.label ?? "Default"})
                                            </option>
                                            {extension.profiles.map((profile) => (
                                              <option key={profile.id} value={profile.id}>
                                                {profile.label} (
                                                {profile.scope === "project"
                                                  ? "isolated"
                                                  : "shared"}
                                                )
                                              </option>
                                            ))}
                                          </ExtensionChoice>
                                        </div>
                                      </div>

                                      {/* Permissions checklist for this project */}
                                      {hasCapabilities ? (
                                        <div className="pt-2.5 border-t border-border/40 grid gap-2 ps-1">
                                          {extension.manifest.capabilities?.includes(
                                            "profile-storage",
                                          ) ? (
                                            <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
                                              <ExtensionCheckbox
                                                aria-label={`Allow ${extension.manifest.displayName} profile storage in ${project.name}`}
                                                checked={
                                                  extension.assignment.storageGrantedProjectIds?.includes(
                                                    project.id,
                                                  ) ?? false
                                                }
                                                disabled={busy}
                                                onCheckedChange={(checked) => {
                                                  const ids =
                                                    extension.assignment.storageGrantedProjectIds ??
                                                    [];
                                                  assign(extension, {
                                                    ...extension.assignment,
                                                    storageGrantedProjectIds: checked
                                                      ? [...ids, project.id]
                                                      : ids.filter((id) => id !== project.id),
                                                  });
                                                }}
                                              />
                                              <span>Allow non-secret profile storage</span>
                                            </label>
                                          ) : null}

                                          {extension.manifest.capabilities?.includes(
                                            "workspace-read",
                                          ) ? (
                                            <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
                                              <ExtensionCheckbox
                                                aria-label={`Allow ${extension.manifest.displayName} to read workspace files in ${project.name}`}
                                                checked={
                                                  extension.assignment.workspaceReadGrantedProjectIds?.includes(
                                                    project.id,
                                                  ) ?? false
                                                }
                                                disabled={busy}
                                                onCheckedChange={(checked) => {
                                                  const ids =
                                                    extension.assignment
                                                      .workspaceReadGrantedProjectIds ?? [];
                                                  assign(extension, {
                                                    ...extension.assignment,
                                                    workspaceReadGrantedProjectIds: checked
                                                      ? [...ids, project.id]
                                                      : ids.filter((id) => id !== project.id),
                                                  });
                                                }}
                                              />
                                              <span>Allow reading workspace files</span>
                                            </label>
                                          ) : null}

                                          {extension.manifest.capabilities?.includes(
                                            "git-status",
                                          ) ? (
                                            <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
                                              <ExtensionCheckbox
                                                aria-label={`Allow ${extension.manifest.displayName} to read Git status in ${project.name}`}
                                                checked={
                                                  extension.assignment.gitStatusGrantedProjectIds?.includes(
                                                    project.id,
                                                  ) ?? false
                                                }
                                                disabled={busy}
                                                onCheckedChange={(checked) => {
                                                  const ids =
                                                    extension.assignment
                                                      .gitStatusGrantedProjectIds ?? [];
                                                  assign(extension, {
                                                    ...extension.assignment,
                                                    gitStatusGrantedProjectIds: checked
                                                      ? [...ids, project.id]
                                                      : ids.filter((id) => id !== project.id),
                                                  });
                                                }}
                                              />
                                              <span>Allow reading Git repository status</span>
                                            </label>
                                          ) : null}

                                          {extension.manifest.capabilities?.includes("ai-tools") ? (
                                            <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
                                              <ExtensionCheckbox
                                                aria-label={`Allow agents to run ${extension.manifest.displayName} commands in ${project.name}`}
                                                checked={
                                                  extension.assignment.aiToolGrantedProjectIds?.includes(
                                                    project.id,
                                                  ) ?? false
                                                }
                                                disabled={busy}
                                                onCheckedChange={(checked) => {
                                                  const ids =
                                                    extension.assignment.aiToolGrantedProjectIds ??
                                                    [];
                                                  assign(extension, {
                                                    ...extension.assignment,
                                                    aiToolGrantedProjectIds: checked
                                                      ? [...ids, project.id]
                                                      : ids.filter((id) => id !== project.id),
                                                  });
                                                }}
                                              />
                                              <span>
                                                Allow agents to run commands in chat threads
                                              </span>
                                            </label>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </section>

                            {/* Card 3: Account Credentials (if applicable) */}
                            {extension.manifest.capabilities?.includes("credentials") ? (
                              <section className="installed-control-section space-y-4">
                                <div>
                                  <h4>Account credentials</h4>
                                  <p className="installed-control-help">
                                    Saved tokens are encrypted on your OS keychain and sent as
                                    Bearer credentials only to verified HTTPS endpoints.
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  <label className="text-xs font-medium text-foreground flex flex-col gap-1.5">
                                    Account profile
                                    <ExtensionChoice
                                      aria-label="Account profile"
                                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-normal"
                                      value={
                                        credentialProfileSelection[extension.id] ??
                                        extension.profiles[0]?.id ??
                                        ""
                                      }
                                      disabled={busy}
                                      onValueChange={(value) => {
                                        setCredentialProfileSelection((current) => ({
                                          ...current,
                                          [extension.id]: value,
                                        }));
                                        setCredentialValues({});
                                      }}
                                    >
                                      {extension.profiles.map((profile) => (
                                        <option key={profile.id} value={profile.id}>
                                          {profile.label}
                                        </option>
                                      ))}
                                    </ExtensionChoice>
                                  </label>

                                  <label className="text-xs font-medium text-foreground flex flex-col gap-1.5">
                                    Service host
                                    <ExtensionChoice
                                      aria-label="Service host"
                                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-normal"
                                      value={
                                        credentialHostSelection[extension.id] ??
                                        extension.manifest.networkHosts?.[0] ??
                                        ""
                                      }
                                      disabled={busy}
                                      onValueChange={(value) => {
                                        setCredentialHostSelection((current) => ({
                                          ...current,
                                          [extension.id]: value,
                                        }));
                                        setCredentialValues({});
                                      }}
                                    >
                                      {(extension.manifest.networkHosts ?? []).map((host) => (
                                        <option key={host} value={host}>
                                          {host}
                                        </option>
                                      ))}
                                    </ExtensionChoice>
                                  </label>

                                  {extension.profiles.find(
                                    (profile) =>
                                      profile.id ===
                                      (credentialProfileSelection[extension.id] ??
                                        extension.profiles[0]?.id),
                                  )?.scope === "project" ? (
                                    <label className="text-xs font-medium text-foreground flex flex-col gap-1.5">
                                      Project
                                      <ExtensionChoice
                                        aria-label="Credential project"
                                        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-normal"
                                        value={
                                          credentialProjectSelection[extension.id] ??
                                          projects[0]?.id ??
                                          ""
                                        }
                                        disabled={busy}
                                        onValueChange={(value) => {
                                          setCredentialProjectSelection((current) => ({
                                            ...current,
                                            [extension.id]: value,
                                          }));
                                          setCredentialValues({});
                                        }}
                                      >
                                        {projects.map((project) => (
                                          <option key={project.id} value={project.id}>
                                            {project.name}
                                          </option>
                                        ))}
                                      </ExtensionChoice>
                                    </label>
                                  ) : null}
                                </div>

                                {extension.profiles
                                  .filter(
                                    (profile) =>
                                      profile.id ===
                                      (credentialProfileSelection[extension.id] ??
                                        extension.profiles[0]?.id),
                                  )
                                  .flatMap((profile) =>
                                    (profile.scope === "project"
                                      ? projects
                                          .map((project) => project.id)
                                          .filter(
                                            (id) =>
                                              id ===
                                              (credentialProjectSelection[extension.id] ??
                                                projects[0]?.id),
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
                                          const label = `${extension.manifest.displayName} ${profile.label}${
                                            projectId
                                              ? ` for ${projects.find((project) => project.id === projectId)?.name ?? projectId}`
                                              : ""
                                          } credential for ${host}`;
                                          return (
                                            <div
                                              key={key}
                                              className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3.5"
                                            >
                                              <label className="block text-xs font-medium text-foreground">
                                                {label} ({saved ? "Token saved" : "No token set"})
                                                <Input
                                                  className="mt-1.5"
                                                  type="password"
                                                  autoComplete="off"
                                                  placeholder="Enter secret token or API key"
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
                                              <div className="flex items-center gap-2">
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  disabled={
                                                    busy || !(credentialValues[key] ?? "").trim()
                                                  }
                                                  onClick={() =>
                                                    void run(async () => {
                                                      await bridge?.setExtensionCredential(
                                                        extension.id,
                                                        profile.id,
                                                        host,
                                                        (credentialValues[key] ?? "").trim(),
                                                        projectId,
                                                      );
                                                      setCredentialValues((current) => ({
                                                        ...current,
                                                        [key]: "",
                                                      }));
                                                      const statuses =
                                                        await bridge?.listExtensionCredentials(
                                                          extension.id,
                                                        );
                                                      if (statuses)
                                                        setCredentialStatuses((current) => ({
                                                          ...current,
                                                          [extension.id]: statuses,
                                                        }));
                                                      setStatus("Credential saved securely.");
                                                    })
                                                  }
                                                >
                                                  Save token
                                                </Button>
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  size="sm"
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
                                                      const statuses =
                                                        await bridge?.listExtensionCredentials(
                                                          extension.id,
                                                        );
                                                      if (statuses)
                                                        setCredentialStatuses((current) => ({
                                                          ...current,
                                                          [extension.id]: statuses,
                                                        }));
                                                      setStatus("Credential removed.");
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
                              </section>
                            ) : null}
                          </div>

                          {/* Right Column: Explanatory Guide Card */}
                          <aside className="installed-project-guide">
                            <div className="installed-guide-art" aria-hidden="true">
                              <UsersIcon className="size-7" />
                              <ShieldCheckIcon className="size-4" />
                            </div>
                            <h4>Accounts & access</h4>
                            <p>Keep personal and work context separate across your projects.</p>
                            <div className="space-y-3 mt-4 text-xs text-muted-foreground leading-relaxed">
                              <div>
                                <strong className="text-foreground block font-medium mb-0.5">
                                  Shared profiles
                                </strong>
                                One shared storage space across all projects. Great for personal
                                notes and global tools.
                              </div>
                              <div>
                                <strong className="text-foreground block font-medium mb-0.5">
                                  Project-isolated profiles
                                </strong>
                                Keeps storage, caches, and history strictly confined to each
                                project. Recommended for client work.
                              </div>
                            </div>
                            <span>
                              <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
                              Your choices save automatically
                            </span>
                          </aside>
                        </div>
                      ) : (
                        <div className="installed-advanced-workspace">
                          <div className="installed-advanced-intro">
                            <h4>Advanced settings</h4>
                            <p>Version updates and installation options.</p>
                          </div>
                          {extension.source === "exchange" ? (
                            <section className="installed-control-section space-y-4">
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <h4>Updates</h4>
                                  <p className="installed-control-help">
                                    Stay current, or keep the version you’re using.
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    aria-label={`Check ${extension.manifest.displayName} for updates`}
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        const update = await bridge.checkExtensionUpdate(
                                          extension.id,
                                        );
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
                                </div>
                              </div>
                              {availableUpdate(extension) &&
                              (!extension.updatesPinned ||
                                Object.hasOwn(checkedUpdates, extension.id)) ? (
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                                  <span
                                    role={
                                      Object.hasOwn(checkedUpdates, extension.id)
                                        ? undefined
                                        : "status"
                                    }
                                    className="text-sm font-medium text-foreground"
                                  >
                                    Version {availableUpdate(extension)?.version} is available.
                                  </span>
                                  <Button
                                    id={`extension-update-${extension.id}`}
                                    type="button"
                                    size="sm"
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
                                        setPreparedInstall(
                                          await bridge.prepareExchangeInstall(update),
                                        );
                                        setTab("discover");
                                      });
                                    }}
                                  >
                                    Review update to {availableUpdate(extension)?.version}
                                  </Button>
                                </div>
                              ) : null}
                              <div className="border-t border-border/50 pt-3.5">
                                <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
                                  <div className="min-w-0">
                                    <span className="text-sm font-medium text-foreground block">
                                      Pin {extension.manifest.displayName} at version{" "}
                                      {extension.manifest.version}
                                    </span>
                                    <span className="text-xs text-muted-foreground block mt-0.5">
                                      Pause automatic background update checks and retain this
                                      version.
                                    </span>
                                  </div>
                                  <ExtensionSwitch
                                    aria-label={`Pin ${extension.manifest.displayName} at version ${extension.manifest.version}`}
                                    checked={Boolean(extension.updatesPinned)}
                                    disabled={busy}
                                    onCheckedChange={(checked) => {
                                      const pinned = checked;
                                      void run(async () => {
                                        await bridge.setExtensionUpdatesPinned(
                                          extension.id,
                                          pinned,
                                        );
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
                                </label>
                              </div>
                            </section>
                          ) : null}
                          <section className="installed-control-section installed-removal-section">
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <h4>Installation</h4>
                                <p className="installed-control-help">
                                  Remove this tool from Tabs. You can choose whether to keep its
                                  data.
                                </p>
                                {extension.registryOrigin && (
                                  <p className="installed-origin mt-1.5">
                                    {extension.registryOrigin}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {extension.source === "development" &&
                                  bridge?.reloadDevelopmentExtension && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(async () => {
                                          await bridge.reloadDevelopmentExtension!(extension.id);
                                        })
                                      }
                                    >
                                      Reload development build
                                    </Button>
                                  )}
                                <Button
                                  id={`extension-uninstall-${extension.id}`}
                                  type="button"
                                  variant="destructive-outline"
                                  disabled={busy}
                                  onClick={(event) => {
                                    uninstallTrigger.current = event.currentTarget;
                                    setUninstallDataAction("retain");
                                    setUninstallingId(extension.id);
                                  }}
                                >
                                  Uninstall {extension.manifest.displayName}
                                </Button>
                              </div>
                            </div>
                          </section>
                        </div>
                      )}
                    </div>
                  ))}
              </>
            )}
          </SettingsSection>
        </div>
      )}

      {uninstallingExtension ? (
        <AlertDialog
          open={uninstallingExtension !== null}
          onOpenChange={(open) => {
            if (!open && !busy) closeUninstallDialog();
          }}
        >
          <AlertDialogPopup className="max-w-md gap-5 p-6" initialFocus={uninstallHeading}>
            <AlertDialogHeader className="text-left sm:text-left gap-1.5 p-0">
              <AlertDialogTitle
                id={`uninstall-${uninstallingExtension.id}`}
                ref={uninstallHeading}
                tabIndex={-1}
                className="text-lg font-semibold text-foreground tracking-tight"
              >
                Uninstall {uninstallingExtension.manifest.displayName}?
              </AlertDialogTitle>
              <AlertDialogDescription
                id={`uninstall-description-${uninstallingExtension.id}`}
                className="text-sm text-muted-foreground leading-relaxed"
              >
                Its tools, packaged files, and project assignments will be removed. Choose what to
                do with local data and named profiles:
              </AlertDialogDescription>
            </AlertDialogHeader>

            <RadioGroup
              value={uninstallDataAction}
              onValueChange={(val) => setUninstallDataAction(val as "retain" | "delete")}
              className="gap-2.5 my-1"
              aria-label="Local data retention options"
            >
              <label
                htmlFor="uninstall-option-retain"
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3.5 transition-colors cursor-pointer select-none",
                  uninstallDataAction === "retain"
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                    : "border-border/60 hover:bg-muted/30 hover:border-border",
                )}
                onClick={() => setUninstallDataAction("retain")}
              >
                <Radio
                  id="uninstall-option-retain"
                  aria-label="Retain local data and profiles"
                  value="retain"
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      Retain local data and profiles
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Recommended
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Keep named profiles and local files in Tabs so you can pick up where you left
                    off if you reinstall later.
                  </p>
                </div>
              </label>

              <label
                htmlFor="uninstall-option-delete"
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3.5 transition-colors select-none",
                  !uninstallingExtension.dataDeletionAvailable
                    ? "opacity-50 cursor-not-allowed border-border/40 bg-muted/10"
                    : uninstallDataAction === "delete"
                      ? "border-destructive/50 bg-destructive/5 ring-1 ring-destructive/20 cursor-pointer"
                      : "border-border/60 hover:bg-muted/30 hover:border-border cursor-pointer",
                )}
                onClick={() => {
                  if (uninstallingExtension.dataDeletionAvailable) {
                    setUninstallDataAction("delete");
                  }
                }}
              >
                <Radio
                  id="uninstall-option-delete"
                  aria-label="Delete local data and profiles"
                  value="delete"
                  disabled={!uninstallingExtension.dataDeletionAvailable}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    Delete local data and profiles
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Permanently remove inventoried local files, cached state, and profiles from
                    Tabs.
                    {!uninstallingExtension.dataDeletionAvailable ? (
                      <span className="block mt-1 text-xs text-amber-500/90 font-medium">
                        Data deletion is unavailable because storage inventory is incomplete or
                        contains legacy data.
                      </span>
                    ) : null}
                  </p>
                </div>
              </label>
            </RadioGroup>

            <AlertDialogFooter className="p-0 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={closeUninstallDialog}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={handleConfirmUninstall}
              >
                {uninstallDataAction === "delete"
                  ? "Uninstall and delete data"
                  : "Uninstall and retain data"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </div>
  );
}

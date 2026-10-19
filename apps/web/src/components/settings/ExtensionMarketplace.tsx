import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeftIcon, ArrowUpRightIcon, CheckIcon } from "lucide-react";
import type {
  DesktopBridge,
  DesktopExchangeListing,
  DesktopInstalledExtension,
} from "@tabs/contracts";
import { Button } from "../ui/button";
import { PublisherVerifiedBadge } from "../PublisherVerifiedBadge";

type Asset = { type: string; data: string } | null;
function useListingAsset(
  bridge: DesktopBridge,
  listing: DesktopExchangeListing,
  kind: "icon" | "readme" | "screenshot",
  enabled: boolean,
  index?: number,
) {
  const [result, setResult] = useState<{ asset: Asset; loading: boolean; error: boolean }>({
    asset: null,
    loading: enabled,
    error: false,
  });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult({ asset: null, loading: enabled, error: false });
    if (enabled && bridge.getExchangeListingAsset) {
      void bridge
        .getExchangeListingAsset(listing, kind, index)
        .then((asset) => {
          if (!cancelled) setResult({ asset, loading: false, error: false });
        })
        .catch(() => {
          if (!cancelled) setResult({ asset: null, loading: false, error: true });
        });
    } else setResult({ asset: null, loading: false, error: false });
    return () => {
      cancelled = true;
    };
  }, [bridge, listing, kind, index, enabled, attempt]);
  return { ...result, retry: () => retry((n) => n + 1) };
}
export function ExtensionLogo({
  bridge,
  listing,
  large = false,
}: {
  bridge: DesktopBridge;
  listing: DesktopExchangeListing;
  large?: boolean;
}) {
  const { asset } = useListingAsset(bridge, listing, "icon", Boolean(listing.listingAssets?.icon));
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset]);
  return (
    <span className={`market-logo ${large ? "is-large" : ""}`} aria-hidden="true">
      {asset && !failed ? (
        <img src={asset.data} alt="" onError={() => setFailed(true)} />
      ) : (
        listing.displayName.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
function Screenshot({
  bridge,
  listing,
  index,
}: {
  bridge: DesktopBridge;
  listing: DesktopExchangeListing;
  index: number;
}) {
  const { asset } = useListingAsset(bridge, listing, "screenshot", true, index);
  return asset ? (
    <img
      src={asset.data}
      alt={`${listing.displayName} preview ${index + 1}`}
      className="market-screenshot"
      loading="lazy"
    />
  ) : null;
}
function ExtensionDetails({
  bridge,
  listing,
  installed,
  busy,
  onInstall,
  onManage,
  onBack,
}: {
  bridge: DesktopBridge;
  listing: DesktopExchangeListing;
  installed?: DesktopInstalledExtension | undefined;
  busy: boolean;
  onInstall: (listing: DesktopExchangeListing, trigger: HTMLButtonElement) => void;
  onManage: (id: string) => void;
  onBack: () => void;
}) {
  const [view, setView] = useState<"overview" | "release" | "access">("overview");
  const readme = useListingAsset(bridge, listing, "readme", Boolean(listing.listingAssets?.readme));
  const openLink = (href: string | undefined) => {
    if (!href) return;
    try {
      const url = new URL(href);
      if (url.protocol === "https:" && !url.username && !url.password)
        void bridge.openExternal(url.href);
    } catch {
      /* Invalid publisher URLs are not opened. */
    }
  };
  return (
    <article className="market-detail" aria-labelledby="market-detail-title">
      <Button variant="ghost" className="market-mobile-back" onClick={onBack}>
        <ArrowLeftIcon className="size-4" /> All extensions
      </Button>
      <header className="market-detail-header">
        <ExtensionLogo bridge={bridge} listing={listing} large />
        <div className="min-w-0 flex-1">
          <h3 id="market-detail-title" tabIndex={-1}>
            {listing.displayName}
          </h3>
          <p className="market-byline">
            {listing.namespace} {listing.verifiedPublisher && <PublisherVerifiedBadge />}{" "}
            <span>v{listing.version}</span>
          </p>
          <p className="market-summary">{listing.description}</p>
          {installed ? (
            <Button onClick={() => onManage(installed.id)} variant="outline">
              <CheckIcon className="size-3.5" /> Manage extension
            </Button>
          ) : (
            <Button
              id={`extension-discover-review-${listing.id}`}
              disabled={busy}
              aria-label={`Review & install ${listing.displayName}`}
              onClick={(event) => onInstall(listing, event.currentTarget)}
            >
              Install
            </Button>
          )}
        </div>
      </header>
      <div
        className="market-detail-tabs"
        role="group"
        aria-label={`${listing.displayName} details`}
      >
        {(["overview", "release", "access"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {item === "overview" ? "Overview" : item === "release" ? "Release notes" : "Access"}
          </button>
        ))}
      </div>
      <div className="market-detail-body">
        {view === "overview" ? (
          <>
            {readme.loading && (
              <p role="status" className="market-muted">
                Loading description…
              </p>
            )}
            {readme.asset ? (
              <div className="market-markdown">
                <ReactMarkdown
                  skipHtml
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <button
                        type="button"
                        className="market-inline-link"
                        onClick={() => openLink(href)}
                      >
                        {children}
                        <ArrowUpRightIcon className="inline size-3" />
                      </button>
                    ),
                    input: ({ checked, type }) =>
                      type === "checkbox" ? (
                        <span
                          role="img"
                          aria-label={checked ? "Completed" : "Incomplete"}
                          className="market-readonly-check"
                        >
                          {checked ? "✓" : "○"}
                        </span>
                      ) : null,
                    img: ({ alt }) => <span className="market-muted">{alt ? `[${alt}]` : ""}</span>,
                  }}
                >
                  {readme.asset.data.slice(0, 100_000)}
                </ReactMarkdown>
                {readme.asset.data.length > 100_000 && (
                  <p>Read the full description on Exchange below.</p>
                )}
              </div>
            ) : (
              !readme.loading && (
                <>
                  <h4>About {listing.displayName}</h4>
                  <p className="market-description">{listing.description}</p>
                </>
              )
            )}
            {readme.error && (
              <div className="market-readme-error" role="status">
                The full description could not load.{" "}
                <button type="button" onClick={readme.retry}>
                  Try again
                </button>
              </div>
            )}
            {Array.from(
              { length: Math.min(listing.listingAssets?.screenshots ?? 0, 6) },
              (_, index) => (
                <Screenshot key={index} bridge={bridge} listing={listing} index={index} />
              ),
            )}
          </>
        ) : view === "release" ? (
          <>
            <h4>Version {listing.version}</h4>
            <p className="market-description whitespace-pre-wrap">
              {listing.releaseNotes ||
                "The publisher has not added release notes for this version."}
            </p>
          </>
        ) : (
          <>
            <h4>
              {listing.capabilities.length
                ? "Requested access"
                : "No project permissions requested"}
            </h4>
            <p className="market-description">
              {listing.capabilities.length
                ? "You review access before installing and choose which projects can use it."
                : "This extension does not request project capabilities. You still choose where it appears."}
            </p>
            <ul className="market-capabilities">
              {listing.capabilities.map((capability) => (
                <li key={capability}>
                  {(
                    {
                      "profile-storage": "Store extension data",
                      "workspace-read": "Read workspace files",
                      "git-status": "Read Git status",
                      network: "Use network connections",
                      credentials: "Use saved credentials",
                      "ai-tools": "Provide tools to agents",
                    } as Record<string, string>
                  )[capability] ?? capability}
                </li>
              ))}
            </ul>
            <p className="market-muted">
              Tabs verifies the signed package before installation. Approval does not guarantee that
              an extension is safe.
            </p>
          </>
        )}
        <footer className="market-resources">
          <button
            type="button"
            onClick={() =>
              openLink(`${listing.registryOrigin}/extensions/${listing.namespace}/${listing.name}`)
            }
          >
            View on Exchange <ArrowUpRightIcon className="size-3" />
          </button>
          {(
            [
              ["Source", listing.sourceUrl],
              ["Support", listing.supportUrl],
              ["Privacy", listing.privacyUrl],
            ] as const
          ).map(([label, href]) =>
            href ? (
              <button key={label} type="button" onClick={() => openLink(href)}>
                {label} <ArrowUpRightIcon className="size-3" />
              </button>
            ) : null,
          )}
          <details>
            <summary>Extension information</summary>
            <dl>
              <dt>Identifier</dt>
              <dd>{listing.id}</dd>
              <dt>Works with Tabs</dt>
              <dd>{listing.tabsCompatibility}</dd>
              <dt>Registry</dt>
              <dd>{listing.registryOrigin}</dd>
              {listing.verifiedPublisher && (
                <>
                  <dt>Publisher identity</dt>
                  <dd>
                    <PublisherVerifiedBadge showLabel />
                  </dd>
                </>
              )}
            </dl>
          </details>
        </footer>
      </div>
    </article>
  );
}
export function ExtensionMarketplace({
  listings,
  bridge,
  installed,
  busy,
  onInstall,
  onManage,
}: {
  listings: readonly DesktopExchangeListing[];
  bridge: DesktopBridge;
  installed: readonly DesktopInstalledExtension[];
  busy: boolean;
  onInstall: (listing: DesktopExchangeListing, trigger: HTMLButtonElement) => void;
  onManage: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const selected =
    listings.find((item) => `${item.registryOrigin}:${item.id}` === selectedId) ?? listings[0];
  if (!selected) return null;
  return (
    <div className={`market-browser ${detailOpen ? "is-detail-open" : ""}`}>
      <div className="market-list">
        <p className="market-list-label">
          All extensions <span>{listings.length}</span>
        </p>
        <ul
          ref={listRef}
          aria-label="Exchange search results"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const buttons = Array.from(
              listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
            );
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : Math.max(
                      0,
                      Math.min(buttons.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
                    );
            event.preventDefault();
            buttons[next]?.focus();
            buttons[next]?.click();
          }}
        >
          {listings.map((listing) => (
            <li key={`${listing.registryOrigin}:${listing.id}`}>
              <button
                className="market-listing"
                type="button"
                aria-label={`View ${listing.displayName}`}
                aria-pressed={selected === listing}
                onClick={() => {
                  setSelectedId(`${listing.registryOrigin}:${listing.id}`);
                  setDetailOpen(true);
                  if (window.matchMedia?.("(max-width: 760px)").matches)
                    requestAnimationFrame(() =>
                      document.getElementById("market-detail-title")?.focus(),
                    );
                }}
              >
                <ExtensionLogo bridge={bridge} listing={listing} />
                <span className="market-listing-copy">
                  <strong>{listing.displayName}</strong>
                  <span>{listing.description}</span>
                  <small>
                    {listing.namespace}
                    {listing.verifiedPublisher && <PublisherVerifiedBadge />}
                    {installed.some(
                      (item) =>
                        item.id === listing.id && item.registryOrigin === listing.registryOrigin,
                    ) && <CheckIcon className="size-3" aria-label="Installed" />}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ExtensionDetails
        key={`${selected.registryOrigin}:${selected.id}:${selected.version}:${selected.digest}`}
        bridge={bridge}
        listing={selected}
        installed={installed.find(
          (item) => item.id === selected.id && item.registryOrigin === selected.registryOrigin,
        )}
        busy={busy}
        onInstall={onInstall}
        onManage={onManage}
        onBack={() => {
          setDetailOpen(false);
          requestAnimationFrame(() =>
            listRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus(),
          );
        }}
      />
    </div>
  );
}

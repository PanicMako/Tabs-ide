import { request } from "./api";
import { extensionMarkdown } from "../../../../marketing/src/lib/extension-markdown";

interface Release {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  verified?: boolean;
  first_published_at?: string | null;
  manifest: {
    displayName: string;
    description: string;
    engines: { tabs: string; api: string };
    capabilities?: unknown[];
    releaseNotes?: string;
    supportUrl?: string;
    privacyUrl?: string;
    sourceUrl?: string;
    listing?: {
      icon?: string;
      readme?: string;
      externalServices?: string;
      license?: string;
      screenshots?: Array<{ path: string; alt: string }>;
    };
  };
}
const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const identity = /^\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/?$/.exec(
  location.pathname,
);
const namespace = identity?.[1];
const name = identity?.[2];
const base = `/v1/extensions/${namespace}/${name}`;
let generation = 0;
let active: AbortController | undefined;
let head: Release | undefined;
let historyCursor: string | null = null;
let historyLoaded = false;
let historyBusy = false;
let historyAbort: AbortController | undefined;
const historySeen = new Set<string>();
const selector = node<HTMLSelectElement>("extension-version");
function validRelease(value: unknown): Release {
  const release = value as Release;
  if (
    !release ||
    release.namespace !== namespace ||
    release.name !== name ||
    typeof release.version !== "string" ||
    !/^[0-9A-Za-z.+-]{1,128}$/.test(release.version) ||
    typeof release.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(release.digest) ||
    !release.manifest ||
    typeof release.manifest.displayName !== "string" ||
    release.manifest.displayName.length > 500 ||
    typeof release.manifest.description !== "string" ||
    release.manifest.description.length > 500 ||
    !release.manifest.engines ||
    typeof release.manifest.engines.tabs !== "string" ||
    typeof release.manifest.engines.api !== "string"
  )
    throw new Error("Invalid published release response.");
  return release;
}
function option(release: Release) {
  if ([...selector.options].some((entry) => entry.value === release.version)) return;
  const entry = document.createElement("option");
  entry.value = release.version;
  entry.textContent = release.version;
  node(
    release.version.split("+")[0]!.includes("-") ? "extension-prerelease" : "extension-stable",
  ).append(entry);
}
function render(release: Release) {
  const manifest = release.manifest;
  const previews = node("extension-preview-images");
  previews.replaceChildren();
  const screenshots = manifest.listing?.screenshots;
  node("extension-previews").hidden = !Array.isArray(screenshots) || !screenshots.length;
  if (Array.isArray(screenshots) && screenshots.length <= 6)
    for (const [index, screenshot] of screenshots.entries()) {
      if (!screenshot || typeof screenshot.alt !== "string" || screenshot.alt.length > 300)
        continue;
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.alt = screenshot.alt;
      image.loading = "lazy";
      image.src = `${base}/versions/${encodeURIComponent(release.version)}/assets/screenshot/${index}`;
      const caption = document.createElement("figcaption");
      caption.textContent = `Preview ${index + 1}`;
      image.addEventListener(
        "error",
        () => {
          image.remove();
          caption.textContent = `Preview ${index + 1} unavailable. Retry the overview to reconnect.`;
        },
        { once: true },
      );
      figure.append(image, caption);
      previews.append(figure);
    }
  node("extension-title").textContent = manifest.displayName;
  node("extension-description").textContent = manifest.description;
  node("extension-identity").textContent =
    `${namespace}.${name} · ${head?.verified ? "Verified publisher" : "Publisher not verified"}`;
  const siteName =
    document.querySelector<HTMLMetaElement>('meta[name="exchange-site-name"]')?.content ??
    "Tabs Exchange";
  document.title = `${manifest.displayName} · ${siteName}`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", manifest.description);
  const metadata = node("extension-metadata");
  metadata.replaceChildren();
  for (const [label, value] of [
    ["Release", release.version],
    ["Tabs", manifest.engines.tabs],
    ["API", manifest.engines.api],
    ["Digest", release.digest],
    ["License", manifest.listing?.license ?? "Not specified"],
    ["First published", release.first_published_at ?? "Historical date unavailable"],
  ]) {
    const term = document.createElement("dt");
    term.textContent = label!;
    const detail = document.createElement("dd");
    detail.textContent = value!;
    metadata.append(term, detail);
  }
  const permissions = node("extension-permissions");
  permissions.replaceChildren();
  for (const capability of manifest.capabilities?.length
    ? manifest.capabilities
    : ["No privileged capabilities requested"]) {
    const item = document.createElement("li");
    item.textContent = typeof capability === "string" ? capability : JSON.stringify(capability);
    permissions.append(item);
  }
  node("extension-services").textContent =
    manifest.listing?.externalServices ?? "No external-service subscription disclosed.";
  node("extension-release-notes").textContent =
    manifest.releaseNotes ?? "No release notes supplied.";
  node("extension-install-identity").textContent =
    `Registry: ${location.origin} · Extension: ${namespace}.${name}`;
  const download = node<HTMLAnchorElement>("extension-download");
  download.href = `${base}/versions/${encodeURIComponent(release.version)}/download`;
  const resources = node("extension-links");
  resources.replaceChildren();
  for (const [label, href] of [
    ["Support", manifest.supportUrl],
    ["Privacy", manifest.privacyUrl],
    ["Source", manifest.sourceUrl],
  ]) {
    if (!href) continue;
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const link = document.createElement("a");
      link.textContent = label!;
      link.href = url.href;
      link.rel = "noopener noreferrer";
      resources.append(link, document.createTextNode(" "));
    } catch {
      /* Ignore malformed publisher links. */
    }
  }
  const icon = node<HTMLImageElement>("extension-icon");
  icon.hidden = !manifest.listing?.icon;
  icon.removeAttribute("src");
  if (manifest.listing?.icon)
    icon.src = `${base}/versions/${encodeURIComponent(release.version)}/assets/icon`;
  option(release);
  selector.value = new URLSearchParams(location.search).get("version") ?? "";
  selector.dispatchEvent(new Event("tabs-select-sync"));
  node("extension-overview").hidden = false;
}
async function readme(release: Release, current: number, signal: AbortSignal) {
  node("extension-readme").replaceChildren();
  node("extension-readme-retry").hidden = true;
  if (!release.manifest.listing?.readme) {
    node("extension-readme-status").textContent = "No README supplied.";
    return;
  }
  node("extension-readme-status").textContent = "Loading packaged README…";
  try {
    const markdown = await request<string>(
      `${base}/versions/${encodeURIComponent(release.version)}/assets/readme`,
      "GET",
      undefined,
      signal,
      "text",
    );
    if (generation !== current) return;
    node("extension-readme").append(
      extensionMarkdown(
        markdown,
        release.manifest.listing.icon,
        `${base}/versions/${encodeURIComponent(release.version)}/assets/icon`,
      ),
    );
    node("extension-readme-status").textContent = "";
  } catch (error) {
    if (generation !== current || signal.aborted) return;
    node("extension-readme-status").textContent =
      error instanceof Error ? error.message : "README unavailable.";
    node("extension-readme-retry").hidden = false;
  }
}
async function load() {
  active?.abort();
  active = new AbortController();
  const signal = active.signal;
  const current = ++generation;
  node("extension-status").textContent = "Loading published release…";
  node("extension-error").hidden = true;
  try {
    if (!identity) throw new Error("Invalid extension identity.");
    const version = new URLSearchParams(location.search).get("version");
    if (version && !/^[0-9A-Za-z.+-]{1,128}$/.test(version))
      throw new Error("Invalid selected release. Remove the version filter.");
    {
      const candidate = validRelease(
        await request<unknown>(`${base}/overview`, "GET", undefined, signal),
      );
      if (generation !== current) return;
      head = candidate;
    }
    const release = version
      ? validRelease(
          await request<unknown>(
            `${base}/versions/${encodeURIComponent(version)}`,
            "GET",
            undefined,
            signal,
          ),
        )
      : head;
    if (generation !== current) return;
    render(release);
    node("extension-status").textContent = `Showing published release ${release.version}.`;
    void readme(release, current, signal);
  } catch (error) {
    if (generation !== current || signal.aborted) return;
    node("extension-overview").hidden = true;
    node("extension-error").hidden = false;
    node("extension-error-message").textContent =
      error instanceof Error ? error.message : "Overview unavailable.";
    node("extension-status").textContent = "Published release could not be loaded.";
  }
}
async function history() {
  if (historyBusy || (historyLoaded && !historyCursor)) return;
  historyBusy = true;
  historyAbort = new AbortController();
  const signal = historyAbort.signal;
  const more = node<HTMLButtonElement>("extension-history-more");
  more.disabled = true;
  node("extension-history-status").textContent = "Loading release history…";
  try {
    const page = await request<{ versions: unknown[]; nextCursor: string | null }>(
      `${base}${historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}` : ""}`,
      "GET",
      undefined,
      signal,
    );
    if (signal.aborted) return;
    if (
      !Array.isArray(page.versions) ||
      page.versions.length > 100 ||
      (page.nextCursor !== null &&
        (typeof page.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(page.nextCursor))) ||
      (page.nextCursor && page.nextCursor === historyCursor)
    )
      throw new Error("Invalid release-history pagination.");
    const releases = page.versions.map(validRelease);
    for (const release of releases) {
      if (historySeen.has(release.version)) continue;
      historySeen.add(release.version);
      option(release);
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.textContent = `${release.version}${release.version.split("+")[0]!.includes("-") ? " (prerelease)" : ""}`;
      link.href = `${location.pathname}?${new URLSearchParams({ version: release.version })}`;
      item.append(link);
      node("extension-history-list").append(item);
    }
    historyCursor = page.nextCursor;
    historyLoaded = true;
    more.hidden = !historyCursor;
    more.textContent = "Load more releases";
    node("extension-history-status").textContent = `${historySeen.size} published releases shown.`;
  } catch (error) {
    if (signal.aborted) return;
    node("extension-history-status").textContent =
      error instanceof Error ? error.message : "History unavailable.";
    more.textContent = "Retry release history";
  } finally {
    historyBusy = false;
    more.disabled = false;
  }
}
selector.addEventListener("change", () => {
  const params = new URLSearchParams(location.search);
  if (selector.value) params.set("version", selector.value);
  else params.delete("version");
  historyPush(params);
  void load();
});
function historyPush(params: URLSearchParams) {
  window.history.pushState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}
node("extension-retry").addEventListener("click", () => {
  head = undefined;
  void load();
});
node("extension-readme-retry").addEventListener("click", () => void load());
node("extension-history-more").addEventListener("click", () => void history());
node<HTMLDetailsElement>("extension-history").addEventListener("toggle", () => {
  if (node<HTMLDetailsElement>("extension-history").open && !historyLoaded) void history();
});
node<HTMLImageElement>("extension-icon").addEventListener("error", () => {
  node("extension-icon").hidden = true;
});
node<HTMLAnchorElement>("extension-signin").href =
  `/auth/github/start?${new URLSearchParams({ returnTo: `${location.pathname}${location.search}` })}`;
window.addEventListener("popstate", () => void load());
window.addEventListener("pagehide", () => {
  generation++;
  active?.abort();
  historyAbort?.abort();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    head = undefined;
    void load();
  }
});
void load();

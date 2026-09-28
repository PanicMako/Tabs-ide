import type { DesktopExchangeListing } from "@tabs/contracts";
import {
  extensionApiRangeCompatible,
  validateTabsExtensionManifest,
} from "@tabs/shared/extensions";
import { compareSemverVersions, satisfiesSemverRange } from "@tabs/shared/semver";

const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_VERSION_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_FALLBACK_CONCURRENCY = 4;
const DIGEST = /^[a-f0-9]{64}$/;
const SEGMENT = /^[a-z][a-z0-9-]{1,62}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function configuredExchangeOrigin(
  value: string | undefined,
  development: boolean,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (
      url.protocol !== "https:" &&
      !(development && url.protocol === "http:" && url.hostname === "localhost")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

async function boundedJson(response: Response, maxBytes = MAX_CATALOG_BYTES): Promise<unknown> {
  if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error(`Exchange catalog request failed (${response.status}).`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new Error("Exchange catalog is too large.");
  if (!response.body) throw new Error("Exchange catalog has no response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error("Exchange catalog is too large.");
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Catalog content is untrusted and must never authorize an install or update. */
export async function discoverExchangeExtensions(
  origin: string,
  tabsVersion: string,
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<DesktopExchangeListing[]> {
  if (query.length > 100) throw new Error("Exchange search query is too long.");
  const url = new URL("/v1/extensions", origin);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "30");
  const response = await fetcher(url.href, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.url !== url.href) throw new Error("Exchange catalog changed origin or path.");
  const document = await boundedJson(response);
  if (!record(document) || !Array.isArray(document.extensions) || document.extensions.length > 30) {
    throw new Error("Exchange catalog response is invalid.");
  }
  const seen = new Set<string>();
  const candidates: Array<
    | DesktopExchangeListing
    | { readonly fallback: true; readonly namespace: string; readonly name: string }
  > = [];
  for (const item of document.extensions) {
    if (
      !record(item) ||
      typeof item.namespace !== "string" ||
      !SEGMENT.test(item.namespace) ||
      typeof item.name !== "string" ||
      !SEGMENT.test(item.name) ||
      typeof item.digest !== "string" ||
      !DIGEST.test(item.digest) ||
      typeof item.version !== "string" ||
      typeof item.verified !== "boolean"
    ) {
      throw new Error("Exchange catalog contains an invalid listing.");
    }
    const id = `${item.namespace}.${item.name}`;
    if (seen.has(id)) throw new Error("Exchange catalog contains duplicate listings.");
    seen.add(id);
    if (
      !record(item.manifest) ||
      item.manifest.publisher !== item.namespace ||
      item.manifest.name !== item.name ||
      item.manifest.version !== item.version
    ) {
      throw new Error("Exchange listing identity does not match its manifest.");
    }
    const validated = validateTabsExtensionManifest(item.manifest, tabsVersion);
    if (!validated.ok) {
      const engines = item.manifest.engines;
      if (
        record(engines) &&
        ((typeof engines.tabs === "string" && !satisfiesSemverRange(tabsVersion, engines.tabs)) ||
          (typeof engines.api === "string" && !extensionApiRangeCompatible(engines.api)))
      ) {
        candidates.push({ fallback: true, namespace: item.namespace, name: item.name });
      }
      continue;
    }
    if (validated.id !== id || validated.manifest.version !== item.version) {
      throw new Error("Exchange listing identity does not match its manifest.");
    }
    candidates.push({
      registryOrigin: origin,
      id,
      namespace: item.namespace,
      name: item.name,
      version: item.version,
      digest: item.digest,
      displayName: validated.manifest.displayName,
      description: validated.manifest.description,
      verifiedPublisher: item.verified,
      tabsCompatibility: validated.manifest.engines.tabs,
      capabilities: validated.manifest.capabilities ?? [],
      ...(validated.manifest.releaseNotes !== undefined && {
        releaseNotes: validated.manifest.releaseNotes,
      }),
      ...(validated.manifest.sourceUrl !== undefined && {
        sourceUrl: validated.manifest.sourceUrl,
      }),
      ...(validated.manifest.supportUrl !== undefined && {
        supportUrl: validated.manifest.supportUrl,
      }),
      ...(validated.manifest.privacyUrl !== undefined && {
        privacyUrl: validated.manifest.privacyUrl,
      }),
    });
  }
  const listings: Array<DesktopExchangeListing | null> = [];
  for (let index = 0; index < candidates.length; index += MAX_FALLBACK_CONCURRENCY) {
    const batch = candidates.slice(index, index + MAX_FALLBACK_CONCURRENCY);
    listings.push(
      ...(await Promise.all(
        batch.map(
          async (candidate): Promise<DesktopExchangeListing | null> =>
            "fallback" in candidate
              ? ((
                  await discoverExchangeVersions(
                    origin,
                    tabsVersion,
                    candidate.namespace,
                    candidate.name,
                    fetcher,
                  )
                )[0] ?? null)
              : candidate,
        ),
      )),
    );
  }
  return listings.filter((listing): listing is DesktopExchangeListing => listing !== null);
}

/** Version listings are hints only; callers must verify candidates through TUF. */
export async function discoverExchangeVersions(
  origin: string,
  tabsVersion: string,
  namespace: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<DesktopExchangeListing[]> {
  if (!SEGMENT.test(namespace) || !SEGMENT.test(name)) {
    throw new Error("Invalid Exchange extension identity.");
  }
  const url = new URL(`/v1/extensions/${namespace}/${name}`, origin);
  const seen = new Set<string>();
  const seenCursors = new Set<string>();
  const listings: DesktopExchangeListing[] = [];
  for (let page = 0; page < 10; page += 1) {
    const response = await fetcher(url.href, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.url !== url.href) throw new Error("Exchange version list changed origin or path.");
    const document = await boundedJson(response, MAX_VERSION_PAGE_BYTES);
    if (!record(document) || !Array.isArray(document.versions) || document.versions.length > 100) {
      throw new Error("Exchange version list is invalid.");
    }
    for (const item of document.versions) {
      if (
        !record(item) ||
        item.namespace !== namespace ||
        item.name !== name ||
        typeof item.version !== "string" ||
        typeof item.digest !== "string" ||
        !DIGEST.test(item.digest) ||
        typeof item.verified !== "boolean" ||
        seen.has(item.version)
      ) {
        throw new Error("Exchange version list contains an invalid release.");
      }
      seen.add(item.version);
      const validated = validateTabsExtensionManifest(item.manifest, tabsVersion);
      if (!validated.ok) continue;
      if (validated.id !== `${namespace}.${name}` || validated.manifest.version !== item.version) {
        throw new Error("Exchange version identity does not match its manifest.");
      }
      listings.push({
        registryOrigin: origin,
        id: validated.id,
        namespace,
        name,
        version: item.version,
        digest: item.digest,
        displayName: validated.manifest.displayName,
        description: validated.manifest.description,
        verifiedPublisher: item.verified,
        tabsCompatibility: validated.manifest.engines.tabs,
        capabilities: validated.manifest.capabilities ?? [],
        ...(validated.manifest.releaseNotes !== undefined && {
          releaseNotes: validated.manifest.releaseNotes,
        }),
        ...(validated.manifest.sourceUrl !== undefined && {
          sourceUrl: validated.manifest.sourceUrl,
        }),
        ...(validated.manifest.supportUrl !== undefined && {
          supportUrl: validated.manifest.supportUrl,
        }),
        ...(validated.manifest.privacyUrl !== undefined && {
          privacyUrl: validated.manifest.privacyUrl,
        }),
      });
    }
    const cursor = document.nextCursor;
    if (cursor === null || cursor === undefined) {
      return listings.toSorted((left, right) => compareSemverVersions(right.version, left.version));
    }
    if (
      typeof cursor !== "string" ||
      cursor.length === 0 ||
      cursor.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(cursor) ||
      document.versions.length === 0 ||
      seenCursors.has(cursor)
    ) {
      throw new Error("Exchange version pagination is invalid.");
    }
    seenCursors.add(cursor);
    url.searchParams.set("cursor", cursor);
  }
  throw new Error("Exchange version list exceeds the client page limit.");
}

export interface ListingMetadata {
  readonly title: string;
  readonly description: string;
  readonly url: string;
}

export function listingMetadata(
  manifest: unknown,
  origin: string,
  path: string,
): ListingMetadata | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  const { displayName, description } = manifest as Record<string, unknown>;
  if (
    typeof displayName !== "string" ||
    !displayName.trim() ||
    displayName.length > 500 ||
    typeof description !== "string" ||
    !description.trim() ||
    description.length > 500
  )
    return undefined;
  const url = new URL(path, origin);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin !== new URL(origin).origin ||
    !/^\/extensions\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{1,62}\/?$/.test(url.pathname)
  )
    return undefined;
  return { title: `${displayName} · Tabs Exchange`, description, url: url.href };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderListingMetadata(html: string, metadata: ListingMetadata): string {
  // This attribute is already escaped by the app-owned static build.
  const brand = /<meta name="exchange-site-name" content="([^"<>]*)"\s*\/?>/.exec(html)?.[1];
  const title = escapeHtml(metadata.title).replace(
    / · Tabs Exchange$/,
    () => ` · ${brand ?? "Tabs Exchange"}`,
  );
  const description = escapeHtml(metadata.description);
  const url = escapeHtml(metadata.url);
  const replaced = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/?>/,
      () => `<meta name="description" content="${description}">`,
    );
  return replaced.replace(
    "</head>",
    () =>
      `<link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"></head>`,
  );
}

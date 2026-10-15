const EXCHANGE_ID = /^[a-z][a-z0-9-]{1,62}$/;

export function isExchangeIdentifier(value: unknown): value is string {
  return typeof value === "string" && EXCHANGE_ID.test(value);
}

export function extensionDetailHref(namespace: unknown, name: unknown): string | null {
  if (!isExchangeIdentifier(namespace) || !isExchangeIdentifier(name)) return null;
  return `/extensions/${namespace}/${name}`;
}

export function safePublisherUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

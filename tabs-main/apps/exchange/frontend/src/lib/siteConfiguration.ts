function publicLink(value: string, label: string): string {
  if (/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(value) && !value.includes("//")) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a local path or HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || value.length > 2048)
    throw new Error(`${label} must be a local path or HTTPS URL without credentials.`);
  return url.href;
}

export function exchangeSiteConfiguration(environment: Record<string, string | undefined>) {
  const name = environment.EXCHANGE_WEB_SITE_NAME?.trim() || "Tabs Exchange";
  if (name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error("EXCHANGE_WEB_SITE_NAME must contain 1 to 80 printable characters.");
  return {
    name,
    docs: publicLink(
      environment.EXCHANGE_WEB_DOCS_URL?.trim() || "/docs/extensions",
      "EXCHANGE_WEB_DOCS_URL",
    ),
    support: environment.EXCHANGE_WEB_SUPPORT_URL?.trim()
      ? publicLink(environment.EXCHANGE_WEB_SUPPORT_URL.trim(), "EXCHANGE_WEB_SUPPORT_URL")
      : undefined,
  };
}

/** Remote pages and subframes must never acquire the Tabs desktop bridge. */
export function isTrustedTabsUrl(rawUrl: string, scheme: string, devUrl?: string): boolean {
  if (!rawUrl) return false;
  if (rawUrl.startsWith("/") && !rawUrl.startsWith("//") && !rawUrl.includes("\\")) return true;
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return false;
    if (url.protocol === `${scheme}:` && url.hostname === "app" && !url.port) return true;
    return Boolean(
      devUrl && url.origin === new URL(devUrl).origin && /^https?:$/.test(url.protocol),
    );
  } catch {
    return false;
  }
}

export function isTrustedIpcFrame(input: {
  senderId: number;
  trustedIds: readonly number[];
  isMainFrame: boolean;
  frameUrl: string;
  scheme: string;
  devUrl?: string;
}): boolean {
  return (
    input.trustedIds.includes(input.senderId) &&
    input.isMainFrame &&
    !input.frameUrl.startsWith("/") &&
    isTrustedTabsUrl(input.frameUrl, input.scheme, input.devUrl)
  );
}

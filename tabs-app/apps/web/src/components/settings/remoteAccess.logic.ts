import { setPairingTokenOnUrl } from "@tabs/shared/remote";

/** The address another device types or scans. The server's `/pair` page redeems the token. */
export function buildPairingLinkUrl(baseUrl: string, credential: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/pair";
  url.search = "";
  return setPairingTokenOnUrl(url, credential).toString();
}

export interface AccessClientSummary {
  readonly label?: string | undefined;
  readonly deviceType?: string | undefined;
  readonly os?: string | undefined;
  readonly browser?: string | undefined;
}

/** A name a person recognizes: the label they gave it, else "Chrome on macOS", else the kind. */
export function describeAccessClient(client: AccessClientSummary): {
  readonly name: string;
  readonly detail: string;
} {
  const platform = [client.browser, client.os].filter(Boolean).join(" on ");
  const name = client.label?.trim() || platform || fallbackDeviceName(client.deviceType);
  return { name, detail: client.label?.trim() && platform ? platform : "" };
}

function fallbackDeviceName(deviceType: string | undefined): string {
  switch (deviceType) {
    case "desktop":
      return "Desktop";
    case "mobile":
      return "Phone";
    case "tablet":
      return "Tablet";
    default:
      return "Unknown device";
  }
}

export const ENDPOINT_KIND_LABEL: Record<string, string> = {
  lan: "Local network",
  tailnet: "Tailscale",
};

/** Whole seconds left before a pairing link stops working, never negative. */
export function secondsUntil(isoDate: string, nowMs: number): number {
  const target = Date.parse(isoDate);
  return Number.isNaN(target) ? 0 : Math.max(0, Math.floor((target - nowMs) / 1_000));
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

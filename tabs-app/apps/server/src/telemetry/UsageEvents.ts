import type { ClientActivityReportInput } from "@tabs/contracts";
import { createHash } from "node:crypto";

/** All other operational events and all caller properties are excluded at the delivery boundary. */
export function basicUsageEvent(event: string): string | undefined {
  if (event === "server.boot.heartbeat") return "tabs.installation.opened";
  if (event === "provider.turn.sent" || event === "client.interacted")
    return "tabs.installation.active";
  return undefined;
}

/** Reuse the local activity signal, forwarding none of its identifying or workspace fields. */
export function isActiveUsageReport(
  report: Pick<
    ClientActivityReportInput,
    "visible" | "focused" | "recentlyInteracted" | "appState"
  >,
): boolean {
  return (
    report.visible && report.focused && report.recentlyInteracted && report.appState === "active"
  );
}

/** Stable daily UUID lets PostHog deduplicate restarts and ambiguous delivery retries. */
export function dailyUsageEventUuid(identifier: string, event: string, day: string): string {
  const hash = createHash("sha256").update(`${identifier}:${event}:${day}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

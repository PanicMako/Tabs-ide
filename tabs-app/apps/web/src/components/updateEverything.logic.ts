import type { DesktopUpdateState, ProviderDriverKind, ServerProvider } from "@tabs/contracts";
import { collectProviderUpdateCandidates } from "../providerUpdateNotification";
import { resolveDesktopUpdateButtonAction } from "./desktopUpdate.logic";

export type UpdateItem =
  | {
      readonly kind: "provider";
      readonly id: string;
      readonly label: string;
      readonly from: string | null;
      readonly to: string;
      readonly driver: ProviderDriverKind;
    }
  | {
      readonly kind: "app";
      readonly id: "app";
      readonly label: string;
      readonly from: string | null;
      readonly to: string;
      /** Downloaded updates only need the restart; available ones download first. */
      readonly needsDownload: boolean;
    };

export type UpdateItemStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface UpdateItemResult {
  readonly status: UpdateItemStatus;
  readonly message?: string;
}

/** Providers first and the app last, because installing the app update restarts Tabs. */
export function buildUpdateEverythingItems(
  desktop: DesktopUpdateState | null,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<UpdateItem> {
  const driverByInstance = new Map(providers.map((p) => [p.instanceId, p.driver] as const));
  const items: UpdateItem[] = [];
  for (const candidate of collectProviderUpdateCandidates(providers)) {
    const driver = driverByInstance.get(candidate.instanceId as never);
    if (!driver) continue;
    items.push({
      kind: "provider",
      id: candidate.instanceId,
      label: candidate.displayName,
      from: candidate.currentVersion,
      to: candidate.latestVersion,
      driver,
    });
  }
  if (desktop?.enabled) {
    const action = resolveDesktopUpdateButtonAction(desktop);
    const to = action === "install" ? desktop.downloadedVersion : desktop.availableVersion;
    if (action !== "none" && to) {
      items.push({
        kind: "app",
        id: "app",
        label: "Tabs",
        from: desktop.currentVersion,
        to,
        needsDownload: action === "download",
      });
    }
  }
  return items;
}

export interface UpdateEverythingRunners {
  readonly updateProvider: (item: Extract<UpdateItem, { kind: "provider" }>) => Promise<void>;
  /** Downloads if needed, then installs and restarts. Resolves only if the restart did not happen. */
  readonly updateApp: (item: Extract<UpdateItem, { kind: "app" }>) => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The update did not finish.";
}

/**
 * Runs every update in order and reports each one's status as it goes. One failure never stops
 * the other providers, but it does hold back the app restart: restarting would hide the failure
 * and drop the running agents, so the app waits until the providers are sorted out.
 */
export async function runUpdateEverything(
  items: ReadonlyArray<UpdateItem>,
  runners: UpdateEverythingRunners,
  onStatus: (id: string, result: UpdateItemResult) => void,
): Promise<ReadonlyMap<string, UpdateItemResult>> {
  const results = new Map<string, UpdateItemResult>();
  const set = (id: string, result: UpdateItemResult) => {
    results.set(id, result);
    onStatus(id, result);
  };
  for (const item of items) set(item.id, { status: "pending" });
  let providerFailed = false;
  for (const item of items) {
    if (item.kind === "app" && providerFailed) {
      set(item.id, {
        status: "skipped",
        message: "Held back so a failed provider update is not hidden by the restart.",
      });
      continue;
    }
    set(item.id, { status: "running" });
    try {
      if (item.kind === "provider") await runners.updateProvider(item);
      else await runners.updateApp(item);
      set(item.id, { status: "done" });
    } catch (error) {
      if (item.kind === "provider") providerFailed = true;
      set(item.id, { status: "failed", message: messageOf(error) });
    }
  }
  return results;
}

export function describeUpdateItem(item: UpdateItem): string {
  return item.from ? `${item.from} → ${item.to}` : item.to;
}

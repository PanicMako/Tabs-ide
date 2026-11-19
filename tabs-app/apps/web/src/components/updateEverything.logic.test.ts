import type { DesktopUpdateState, ServerProvider } from "@tabs/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  buildUpdateEverythingItems,
  describeUpdateItem,
  runUpdateEverything,
  type UpdateItem,
} from "./updateEverything.logic";

const provider = (instanceId: string, latest: string | null): ServerProvider =>
  ({
    instanceId,
    driver: "codex",
    displayName: instanceId,
    enabled: true,
    installed: true,
    version: "1.0.0",
    versionAdvisory: latest
      ? { status: "behind_latest", currentVersion: "1.0.0", latestVersion: latest }
      : { status: "current" },
  }) as unknown as ServerProvider;

const desktop = (overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState =>
  ({
    enabled: true,
    status: "available",
    currentVersion: "2.7.0",
    availableVersion: "2.8.0",
    downloadedVersion: null,
    ...overrides,
  }) as DesktopUpdateState;

describe("buildUpdateEverythingItems", () => {
  it("lists out-of-date providers first and the app last", () => {
    const items = buildUpdateEverythingItems(desktop(), [
      provider("b", "2.0.0"),
      provider("a", "3.0.0"),
      provider("c", null),
    ]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "app"]);
    expect(items.at(-1)).toMatchObject({ kind: "app", to: "2.8.0", needsDownload: true });
  });

  it("only needs the restart when the app update is already downloaded", () => {
    const items = buildUpdateEverythingItems(
      desktop({ status: "downloaded", downloadedVersion: "2.8.0" }),
      [],
    );
    expect(items).toEqual([
      expect.objectContaining({ kind: "app", to: "2.8.0", needsDownload: false }),
    ]);
  });

  it("is empty when nothing is out of date or desktop updates are off", () => {
    expect(
      buildUpdateEverythingItems(desktop({ status: "up-to-date" }), [provider("a", null)]),
    ).toEqual([]);
    expect(buildUpdateEverythingItems(desktop({ enabled: false }), [])).toEqual([]);
    expect(buildUpdateEverythingItems(null, [])).toEqual([]);
  });

  it("describes a version change", () => {
    const [item] = buildUpdateEverythingItems(null, [provider("a", "3.0.0")]);
    expect(describeUpdateItem(item as UpdateItem)).toBe("1.0.0 → 3.0.0");
  });
});

describe("runUpdateEverything", () => {
  const items = (): ReadonlyArray<UpdateItem> =>
    buildUpdateEverythingItems(desktop(), [provider("a", "3.0.0"), provider("b", "2.0.0")]);

  it("updates in order and reports each status", async () => {
    const order: string[] = [];
    const seen: string[] = [];
    const results = await runUpdateEverything(
      items(),
      {
        updateProvider: async (item) => void order.push(item.id),
        updateApp: async () => void order.push("app"),
      },
      (id, result) => seen.push(`${id}:${result.status}`),
    );
    expect(order).toEqual(["a", "b", "app"]);
    expect([...results.values()].map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(seen.slice(0, 3)).toEqual(["a:pending", "b:pending", "app:pending"]);
  });

  it("keeps going after a provider fails but holds back the app restart", async () => {
    const updateApp = vi.fn(async () => undefined);
    const results = await runUpdateEverything(
      items(),
      {
        updateProvider: async (item) => {
          if (item.id === "a") throw new Error("disk full");
        },
        updateApp,
      },
      () => undefined,
    );
    expect(results.get("a")).toEqual({ status: "failed", message: "disk full" });
    expect(results.get("b")).toEqual({ status: "done" });
    expect(results.get("app")?.status).toBe("skipped");
    expect(updateApp).not.toHaveBeenCalled();
  });

  it("reports an app failure without losing the provider results", async () => {
    const results = await runUpdateEverything(
      items(),
      {
        updateProvider: async () => undefined,
        updateApp: async () => {
          throw new Error("offline");
        },
      },
      () => undefined,
    );
    expect(results.get("a")?.status).toBe("done");
    expect(results.get("app")).toEqual({ status: "failed", message: "offline" });
  });
});

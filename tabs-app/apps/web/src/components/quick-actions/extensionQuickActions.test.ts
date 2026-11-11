import { describe, expect, it } from "vitest";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { extensionToolbarToolId } from "../../extensionToolbarTools";
import { actionRunId, orderedActions } from "./actions";
import { extensionLauncherActions } from "./extensionQuickActions";

function installed(overrides: Partial<DesktopInstalledExtension> = {}): DesktopInstalledExtension {
  return {
    id: "acme.deploys",
    source: "local",
    revoked: false,
    disabled: false,
    manifest: {
      manifestVersion: 1,
      publisher: "acme",
      name: "deploys",
      version: "1.0.0",
      displayName: "Deploys",
      description: "Deploy board",
      engines: { tabs: ">=2.0.0", api: "^1.8.0" },
      contributes: {
        tools: [{ id: "board", label: "Deploy board", entry: "index.html" }],
        quickActions: [{ id: "open-board", label: "Deploys", icon: "rocket", tool: "board" }],
      },
    },
    ...overrides,
  } as unknown as DesktopInstalledExtension;
}

describe("extension quick actions", () => {
  it("turns a contributed entry into a launcher action that opens its toolbar tool", () => {
    const extension = installed();
    const [action] = extensionLauncherActions([extension]);
    expect(action).toMatchObject({
      label: "Deploys",
      icon: "rocket",
      group: "Extensions",
      detail: "Open Deploy board · Deploys",
    });
    expect(actionRunId(action!)).toBe("extension-tool");
    expect(action!.custom.query).toBe(extensionToolbarToolId(extension, "board"));
    // It joins the launcher after the built-ins, and can be reordered like any action.
    const ordered = orderedActions([action!.id], [], [], [action!]);
    expect(ordered[0]?.id).toBe(action!.id);
  });

  it("contributes nothing from disabled or revoked packages", () => {
    expect(extensionLauncherActions([installed({ disabled: true })])).toEqual([]);
    expect(extensionLauncherActions([installed({ revoked: true })])).toEqual([]);
  });
});

import type { DesktopInstalledExtension, ProjectToolDefinition } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import {
  mergeExtensionToolbarTools,
  preserveUnavailableExtensionTools,
  extensionToolbarToolId,
} from "./extensionToolbarTools";

const builtin: ProjectToolDefinition = {
  id: "agents",
  kind: "agents",
  label: "Agents",
  visible: true,
};
const extensionTool: ProjectToolDefinition = {
  id: "ext:https%3A%2F%2Fexchange.tabs.test:demo.notes:main",
  kind: "extension",
  label: "Old label",
  visible: false,
  extensionId: "demo.notes",
  extensionToolId: "main",
};
const extension = {
  id: "demo.notes",
  source: "exchange",
  registryOrigin: "https://exchange.tabs.test",
  manifest: { contributes: { tools: [{ id: "main", label: "Notes" }] } },
  assignment: {
    enabledGlobally: false,
    enabledProjectIds: ["project-a"],
    disabledProjectIds: [],
  },
} as unknown as DesktopInstalledExtension;

describe("extension toolbar tools", () => {
  it("preserves saved order and visibility while using verified package labels", () => {
    expect(mergeExtensionToolbarTools([extensionTool, builtin], [extension], "project-a")).toEqual([
      { ...extensionTool, label: "Notes" },
      builtin,
    ]);
  });

  it("adds newly enabled tools and removes unavailable tools from the active toolbar", () => {
    expect(mergeExtensionToolbarTools([builtin], [extension], "project-a")).toEqual([
      builtin,
      { ...extensionTool, label: "Notes", visible: true },
    ]);
    expect(mergeExtensionToolbarTools([extensionTool, builtin], [extension], "project-b")).toEqual([
      builtin,
    ]);
    expect(
      mergeExtensionToolbarTools(
        [extensionTool, builtin],
        [{ ...extension, revoked: true }],
        "project-a",
      ),
    ).toEqual([builtin]);
  });

  it("rejects saved contribution identity mismatches and retains disabled preferences", () => {
    expect(
      mergeExtensionToolbarTools(
        [{ ...extensionTool, extensionToolId: "other" }],
        [extension],
        "project-a",
      ),
    ).toEqual([{ ...extensionTool, label: "Notes", visible: true }]);
    expect(preserveUnavailableExtensionTools([extensionTool, builtin], [builtin])).toEqual([
      builtin,
      extensionTool,
    ]);
  });

  it("does not transfer toolbar preferences to a same-named package from another origin", () => {
    const other = { ...extension, registryOrigin: "https://other.example" };
    expect(extensionToolbarToolId(other, "main")).not.toBe(extensionTool.id);
    expect(mergeExtensionToolbarTools([extensionTool], [other], "project-a")).toEqual([
      {
        ...extensionTool,
        id: extensionToolbarToolId(other, "main"),
        label: "Notes",
        visible: true,
      },
    ]);
  });
});

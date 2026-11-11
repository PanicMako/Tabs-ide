// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { extensionToolbarToolId } from "./extensionToolbarTools";
import { extensionPaletteCommands } from "./extensionPaletteCommands";
import { requestOpenExtensionTool, useOpenExtensionToolRequests } from "./extensionToolRequests";

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
      engines: { tabs: ">=2.0.0", api: "^1.9.0" },
      contributes: {
        tools: [{ id: "board", label: "Deploy board", entry: "index.html" }],
        paletteCommands: [
          { id: "open-board", title: "Deploys: open board", keywords: ["ship"], tool: "board" },
        ],
      },
    },
    ...overrides,
  } as unknown as DesktopInstalledExtension;
}

describe("extension Command Palette entries", () => {
  it("are searchable by keyword, package and tool name and target the toolbar tool", () => {
    const extension = installed();
    const [command] = extensionPaletteCommands([extension]);
    expect(command).toMatchObject({
      title: "Deploys: open board",
      description: "Deploys · Deploy board",
      toolbarToolId: extensionToolbarToolId(extension, "board"),
    });
    expect(command!.searchTerms).toEqual(["ship", "deploys", "deploy board", "extension"]);
  });

  it("drop out with paused, revoked or incompatible packages", () => {
    const cases: Partial<DesktopInstalledExtension>[] = [
      { disabled: true },
      { revoked: true },
      { compatibilityError: "Needs a newer Tabs." },
    ];
    for (const overrides of cases)
      expect(extensionPaletteCommands([installed(overrides)])).toEqual([]);
  });
});

describe("open-extension-tool requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reach the workspace and report its answer back to the caller", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const open = vi.fn(async (id: string) => {
      if (id === "missing") throw new Error("Not on in this project.");
    });
    function Workspace() {
      useOpenExtensionToolRequests(open);
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Workspace />));
    await expect(requestOpenExtensionTool("ext:tool")).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith("ext:tool");
    await expect(requestOpenExtensionTool("missing")).rejects.toThrow("Not on in this project.");
    await act(async () => root.unmount());
    // With no workspace mounted, the caller is told what to do.
    await expect(requestOpenExtensionTool("ext:tool")).rejects.toThrow("Open a project first.");
  });
});

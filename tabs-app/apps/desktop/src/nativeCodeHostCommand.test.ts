import { describe, expect, it, vi } from "vitest";

import { handleNativeCodeHostCommand } from "./nativeCodeHostCommand";

function createDependencies() {
  return {
    clipboard: {
      readText: vi.fn(() => "/workspace/file.ts"),
      writeText: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
      showItemInFolder: vi.fn(),
      trashItem: vi.fn(async () => undefined),
    },
    webContents: { paste: vi.fn() },
  };
}

describe("embedded Code native-host commands", () => {
  it("writes and reads the system clipboard using VS Code's channel argument layout", async () => {
    const dependencies = createDependencies();

    await expect(
      handleNativeCodeHostCommand(
        "writeClipboardText",
        [42, "/workspace/file.ts", "clipboard"],
        dependencies,
      ),
    ).resolves.toEqual({ handled: true, value: undefined });
    await expect(
      handleNativeCodeHostCommand("readClipboardText", [42, "selection"], dependencies),
    ).resolves.toEqual({ handled: true, value: "/workspace/file.ts" });

    expect(dependencies.clipboard.writeText).toHaveBeenCalledWith(
      "/workspace/file.ts",
      "clipboard",
    );
    expect(dependencies.clipboard.readText).toHaveBeenCalledWith("selection");
  });

  it("opens extension authentication URLs through the operating system", async () => {
    const dependencies = createDependencies();
    const url = "https://github.com/login/oauth/authorize?client_id=test";

    await expect(
      handleNativeCodeHostCommand("openExternal", [42, url], dependencies),
    ).resolves.toEqual({ handled: true, value: true });
    expect(dependencies.shell.openExternal).toHaveBeenCalledWith(url);
  });

  it("supports explorer reveal, trash, and paste operations", async () => {
    const dependencies = createDependencies();

    await handleNativeCodeHostCommand("showItemInFolder", [42, "/workspace/file.ts"], dependencies);
    await handleNativeCodeHostCommand("moveItemToTrash", [42, "/workspace/old.ts"], dependencies);
    await handleNativeCodeHostCommand("triggerPaste", [42], dependencies);

    expect(dependencies.shell.showItemInFolder).toHaveBeenCalledWith("/workspace/file.ts");
    expect(dependencies.shell.trashItem).toHaveBeenCalledWith("/workspace/old.ts");
    expect(dependencies.webContents.paste).toHaveBeenCalledOnce();
  });

  it("leaves unsupported native-host commands to the existing compatibility handler", async () => {
    await expect(
      handleNativeCodeHostCommand("getOSProperties", [42], createDependencies()),
    ).resolves.toEqual({ handled: false });
  });
});

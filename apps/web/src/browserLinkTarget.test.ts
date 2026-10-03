import { ProjectId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { workspaceShellActions } from "./state/workspaceShell";
import {
  isWebUrl,
  openLinkInIntegratedBrowser,
  resolveBrowserLinkTarget,
} from "./browserLinkTarget";

const projectId = ProjectId.makeUnsafe("project-1");

describe("browser link target", () => {
  it("uses the integrated browser for ordinary web links when configured", () => {
    expect(
      resolveBrowserLinkTarget({
        url: "https://example.com/docs",
        preference: "app",
        projectId,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe("app");
  });

  it.each([
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ])("uses the system browser for a modifier click", ({ metaKey, ctrlKey }) => {
    expect(
      resolveBrowserLinkTarget({
        url: "https://example.com",
        preference: "app",
        projectId,
        metaKey,
        ctrlKey,
      }),
    ).toBe("system");
  });

  it("keeps non-web schemes out of the integrated browser", () => {
    expect(isWebUrl("mailto:hello@example.com")).toBe(false);
    expect(
      resolveBrowserLinkTarget({
        url: "mailto:hello@example.com",
        preference: "app",
        projectId,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe("system");
  });

  it("navigates and reveals the project browser atomically", () => {
    const setUrl = vi
      .spyOn(workspaceShellActions, "setBrowserCurrentUrl")
      .mockImplementation(() => {});
    const setTool = vi.spyOn(workspaceShellActions, "setActiveTool").mockImplementation(() => {});

    openLinkInIntegratedBrowser(projectId, "https://example.com/docs");

    expect(setUrl).toHaveBeenCalledWith(projectId, "https://example.com/docs", "browser");
    expect(setTool).toHaveBeenCalledWith(projectId, "browser");
    setUrl.mockRestore();
    setTool.mockRestore();
  });
});

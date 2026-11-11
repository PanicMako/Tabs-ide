// @vitest-environment happy-dom
import { createDefaultProjectWorkspaceSettings } from "./workspaceShellStore";
import { DEFAULT_BROWSER_LINK_TARGET, effectiveBrowserLinkTarget } from "@tabs/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorLinkForClick,
  isWebUrl,
  openLink,
  registerInAppLinkHost,
  resolveBrowserLinkTarget,
} from "./browserLinkTarget";
import {
  addScratchBrowserTool,
  findScratchBrowserForUrl,
  isTemporaryWorkspaceTool,
  scratchBrowserLabelForUrl,
} from "./temporaryWorkspaceTools";

const baseInput = {
  url: "https://example.com/docs",
  preference: "app" as const,
  canOpenInApp: true,
  metaKey: false,
  ctrlKey: false,
};

describe("resolveBrowserLinkTarget", () => {
  it("uses Tabs for ordinary web links when configured", () => {
    expect(resolveBrowserLinkTarget(baseInput)).toBe("app");
  });

  it.each([
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ])("uses the system browser for a modifier click", ({ metaKey, ctrlKey }) => {
    expect(resolveBrowserLinkTarget({ ...baseInput, metaKey, ctrlKey })).toBe("system");
  });

  it("keeps non-web schemes out of Tabs", () => {
    expect(isWebUrl("mailto:hello@example.com")).toBe(false);
    expect(resolveBrowserLinkTarget({ ...baseInput, url: "mailto:hello@example.com" })).toBe(
      "system",
    );
  });

  it("falls back to the system browser when no surface can show a Scratch Browser", () => {
    expect(resolveBrowserLinkTarget({ ...baseInput, canOpenInApp: false })).toBe("system");
  });

  it("honours the system preference", () => {
    expect(resolveBrowserLinkTarget({ ...baseInput, preference: "system" })).toBe("system");
  });
});

describe("effectiveBrowserLinkTarget", () => {
  it("defaults to opening in Tabs", () => {
    expect(DEFAULT_BROWSER_LINK_TARGET).toBe("app");
    expect(effectiveBrowserLinkTarget({})).toBe("app");
  });

  it("ignores a stored system value nobody chose", () => {
    expect(effectiveBrowserLinkTarget({ browserLinkTarget: "system" })).toBe("app");
  });

  it("keeps an explicit system choice", () => {
    expect(
      effectiveBrowserLinkTarget({ browserLinkTarget: "system", browserLinkTargetChosen: true }),
    ).toBe("system");
  });
});

describe("openLink", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands web links to the registered in-app host", async () => {
    const host = vi.fn(() => true);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const unregister = registerInAppLinkHost(host);
    await expect(openLink("https://example.com/a")).resolves.toBe("app");
    expect(host).toHaveBeenCalledWith("https://example.com/a");
    expect(open).not.toHaveBeenCalled();
    unregister();
  });

  it("falls back to the system browser when the host declines", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const unregister = registerInAppLinkHost(() => false);
    await expect(openLink("https://example.com/b")).resolves.toBe("system");
    expect(open).toHaveBeenCalledWith("https://example.com/b", "_blank", "noopener,noreferrer");
    unregister();
  });

  it("uses the system browser for a modifier click", async () => {
    const host = vi.fn(() => true);
    vi.spyOn(window, "open").mockImplementation(() => null);
    const unregister = registerInAppLinkHost(host);
    await expect(openLink("https://example.com/c", { metaKey: true })).resolves.toBe("system");
    expect(host).not.toHaveBeenCalled();
    unregister();
  });
});

describe("anchorLinkForClick", () => {
  const click = (anchor: HTMLElement, init: MouseEventInit = {}) => {
    document.body.append(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    Object.defineProperty(event, "target", { value: anchor });
    const result = anchorLinkForClick(event, "http://localhost:5733");
    anchor.remove();
    return result;
  };
  const anchor = (href: string, attrs: Record<string, string> = {}) => {
    const element = document.createElement("a");
    element.href = href;
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };

  it("claims links that leave the app", () => {
    expect(click(anchor("https://github.com/acme/repo"))).toBe("https://github.com/acme/repo");
    expect(click(anchor("http://localhost:5733/docs", { target: "_blank" }))).toBe(
      "http://localhost:5733/docs",
    );
  });

  it("leaves in-app navigation, downloads and opted-out links alone", () => {
    expect(click(anchor("http://localhost:5733/settings"))).toBeNull();
    expect(click(anchor("https://example.com/file.zip", { download: "" }))).toBeNull();
    expect(click(anchor("https://example.com", { "data-link-target": "system" }))).toBeNull();
    expect(click(anchor("mailto:someone@example.com"))).toBeNull();
  });

  it("ignores clicks a component already handled", () => {
    const element = anchor("https://example.com");
    document.body.append(element);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, "target", { value: element });
    event.preventDefault();
    expect(anchorLinkForClick(event, "http://localhost:5733")).toBeNull();
    element.remove();
  });
});

describe("scratch browser tools", () => {
  it("adds a temporary isolated Scratch Browser and finds it again by URL", () => {
    const settings = addScratchBrowserTool(createDefaultProjectWorkspaceSettings(), {
      id: "scratch-1",
      label: "example.com",
      url: "https://example.com/docs",
    });
    const tool = settings.tools.find((entry) => entry.id === "scratch-1");
    expect(tool && isTemporaryWorkspaceTool(tool)).toBe(true);
    expect(settings.customEmbeds.find((entry) => entry.id === "scratch-1")).toMatchObject({
      url: "https://example.com/docs",
      partitionMode: "isolated",
      resumeLastVisitedPage: true,
    });
    expect(findScratchBrowserForUrl(settings, "https://example.com/docs")).toBe("scratch-1");
    expect(findScratchBrowserForUrl(settings, "https://example.com/other")).toBeNull();
  });

  it("labels tabs by host", () => {
    expect(scratchBrowserLabelForUrl("https://www.github.com/acme")).toBe("github.com");
    expect(scratchBrowserLabelForUrl("not a url")).toBe("Scratch browser");
  });
});

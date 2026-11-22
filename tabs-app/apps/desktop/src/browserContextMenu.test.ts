import { describe, expect, it, vi } from "vitest";
import {
  buildBrowserContextMenuItems,
  pendingFromParams,
  runBrowserContextMenuAction,
  validateContextMenuReply,
  type BrowserContextMenuParams,
} from "./browserContextMenu";

const base: BrowserContextMenuParams = {
  x: 10,
  y: 20,
  linkURL: "",
  srcURL: "",
  mediaType: "none",
  selectionText: "",
  isEditable: false,
  misspelledWord: "",
  dictionarySuggestions: [],
  canGoBack: true,
  canGoForward: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  pageUrl: "https://example.com/",
};
const ids = (p: Partial<BrowserContextMenuParams>) =>
  buildBrowserContextMenuItems({ ...base, ...p }).map((i) => i.id);

describe("browser context menu items", () => {
  it("always offers navigation, open externally and inspect", () => {
    expect(ids({})).toEqual(["back", "forward", "reload", "open-page-external", "inspect"]);
    const items = buildBrowserContextMenuItems(base);
    expect(items.find((i) => i.id === "back")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "forward")?.disabled).toBe(true);
  });

  it("adds link actions only for http(s)/mailto links", () => {
    expect(ids({ linkURL: "https://a.dev/x" })).toContain("copy-link");
    expect(ids({ linkURL: "https://a.dev/x" })).toContain("open-link-external");
    expect(ids({ linkURL: "javascript:alert(1)" })).not.toContain("open-link-external");
    expect(ids({ linkURL: "file:///etc/passwd" })).not.toContain("copy-link");
  });

  it("adds Copy image for images and Copy for selections", () => {
    expect(ids({ mediaType: "image", srcURL: "https://a.dev/i.png" })).toContain("copy-image");
    expect(ids({ selectionText: "hi", canCopy: true })).toContain("copy");
  });

  it("puts spelling suggestions first in editable fields", () => {
    const list = ids({
      isEditable: true,
      misspelledWord: "teh",
      dictionarySuggestions: ["the", "tech"],
    });
    expect(list.slice(0, 3)).toEqual(["spell:0", "spell:1", "add-to-dictionary"]);
    expect(list).toContain("paste");
  });
});

describe("context menu reply validation", () => {
  const { pending } = pendingFromParams({ ...base, canGoBack: false });
  const map = new Map([["tok", pending]]);

  it("accepts offered ids and dismissals", () => {
    expect(validateContextMenuReply({ token: "tok", id: "reload" }, map)?.id).toBe("reload");
    expect(validateContextMenuReply({ token: "tok", id: null }, map)?.id).toBeNull();
  });

  it("rejects unknown tokens, unoffered or disabled ids and bad types", () => {
    expect(validateContextMenuReply({ token: "nope", id: "reload" }, map)).toBeNull();
    expect(validateContextMenuReply({ token: "tok", id: "back" }, map)).toBeNull();
    expect(validateContextMenuReply({ token: "tok", id: "copy-link" }, map)).toBeNull();
    expect(validateContextMenuReply({ token: 5, id: "reload" }, map)).toBeNull();
    expect(validateContextMenuReply({ token: "tok", id: 3 }, map)).toBeNull();
    expect(validateContextMenuReply({ token: "x".repeat(200), id: null }, map)).toBeNull();
  });
});

describe("running actions", () => {
  const contents = () => ({
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    copyImageAt: vi.fn(),
    replaceMisspelling: vi.fn(),
    inspectElement: vi.fn(),
    openDevToolsIfClosed: vi.fn(),
    addWordToDictionary: vi.fn(),
  });
  const effects = () => ({ writeClipboardText: vi.fn(), openExternal: vi.fn() });

  it("maps ids to their effects", () => {
    const c = contents();
    const e = effects();
    const { pending } = pendingFromParams({
      ...base,
      linkURL: "https://a.dev/x",
      isEditable: true,
      misspelledWord: "teh",
      dictionarySuggestions: ["the"],
    });
    runBrowserContextMenuAction("copy-link", pending, c, e);
    expect(e.writeClipboardText).toHaveBeenCalledWith("https://a.dev/x");
    runBrowserContextMenuAction("open-link-external", pending, c, e);
    expect(e.openExternal).toHaveBeenCalledWith("https://a.dev/x");
    runBrowserContextMenuAction("spell:0", pending, c, e);
    expect(c.replaceMisspelling).toHaveBeenCalledWith("the");
    runBrowserContextMenuAction("add-to-dictionary", pending, c, e);
    expect(c.addWordToDictionary).toHaveBeenCalledWith("teh");
    runBrowserContextMenuAction("inspect", pending, c, e);
    expect(c.inspectElement).toHaveBeenCalledWith(10, 20);
    runBrowserContextMenuAction("spell:9", pending, c, e);
    expect(c.replaceMisspelling).toHaveBeenCalledTimes(1);
  });

  it("never opens an unsafe link externally", () => {
    const c = contents();
    const e = effects();
    const { pending } = pendingFromParams({ ...base, linkURL: "file:///etc/passwd" });
    runBrowserContextMenuAction("open-link-external", pending, c, e);
    expect(e.openExternal).not.toHaveBeenCalled();
  });
});

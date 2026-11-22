import type { ContextMenuItem } from "@tabs/contracts";

/**
 * Right-click menu for embedded browser panes. The page lives in a native view that paints above
 * the app's DOM, so the main process snapshots it, the renderer draws the themed menu over the
 * snapshot, and the chosen id comes back here. The renderer only ever returns an item id; what
 * each id does is decided in this file from state captured at right-click time.
 */
export interface BrowserContextMenuParams {
  readonly x: number;
  readonly y: number;
  readonly linkURL: string;
  readonly srcURL: string;
  readonly mediaType: string;
  readonly selectionText: string;
  readonly isEditable: boolean;
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly pageUrl: string;
}

export const MAX_SPELL_SUGGESTIONS = 5;

export function isSafeExternalHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function buildBrowserContextMenuItems(
  params: BrowserContextMenuParams,
): ContextMenuItem<string>[] {
  const items: ContextMenuItem<string>[] = [];
  const group = (label: string) => items.push({ id: `header:${label}`, label, header: true });

  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SPELL_SUGGESTIONS);
    if (suggestions.length === 0) {
      items.push({ id: "no-suggestions", label: "No spelling suggestions", disabled: true });
    }
    suggestions.forEach((word, index) => items.push({ id: `spell:${index}`, label: word }));
    items.push({ id: "add-to-dictionary", label: `Add "${params.misspelledWord}" to dictionary` });
  }

  if (params.linkURL && isSafeExternalHttpUrl(params.linkURL)) {
    items.push({ id: "open-link-external", label: "Open link in browser" });
    items.push({ id: "copy-link", label: "Copy link address" });
  }
  if (params.mediaType === "image" && params.srcURL) {
    items.push({ id: "copy-image", label: "Copy image" });
  }

  if (params.isEditable) {
    items.push({ id: "cut", label: "Cut", disabled: !params.canCut });
    items.push({ id: "copy", label: "Copy", disabled: !params.canCopy });
    items.push({ id: "paste", label: "Paste", disabled: !params.canPaste });
    items.push({ id: "select-all", label: "Select all" });
  } else if (params.selectionText) {
    items.push({ id: "copy", label: "Copy", disabled: !params.canCopy });
  }

  if (items.length > 0) group("Page");
  items.push({ id: "back", label: "Back", disabled: !params.canGoBack });
  items.push({ id: "forward", label: "Forward", disabled: !params.canGoForward });
  items.push({ id: "reload", label: "Reload" });
  items.push({ id: "open-page-external", label: "Open page in browser" });
  items.push({ id: "inspect", label: "Inspect element" });
  return items;
}

export interface PendingBrowserContextMenu {
  readonly params: BrowserContextMenuParams;
  readonly allowedIds: ReadonlySet<string>;
}

export function pendingFromParams(params: BrowserContextMenuParams): {
  pending: PendingBrowserContextMenu;
  items: ContextMenuItem<string>[];
} {
  const items = buildBrowserContextMenuItems(params);
  return {
    items,
    pending: {
      params,
      allowedIds: new Set(
        items.filter((item) => !item.header && !item.disabled).map((item) => item.id),
      ),
    },
  };
}

/** Validates the renderer's reply: a known pending token and an id we offered, or null. */
export function validateContextMenuReply(
  raw: { token: unknown; id: unknown },
  pending: ReadonlyMap<string, PendingBrowserContextMenu>,
): { token: string; id: string | null; menu: PendingBrowserContextMenu } | null {
  if (typeof raw.token !== "string" || raw.token.length === 0 || raw.token.length > 100) {
    return null;
  }
  const menu = pending.get(raw.token);
  if (!menu) return null;
  if (raw.id === null) return { token: raw.token, id: null, menu };
  if (typeof raw.id !== "string" || !menu.allowedIds.has(raw.id)) return null;
  return { token: raw.token, id: raw.id, menu };
}

/** The subset of Electron's WebContents these actions use (kept narrow so it is testable). */
export interface BrowserMenuContents {
  goBack(): void;
  goForward(): void;
  reload(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  copyImageAt(x: number, y: number): void;
  replaceMisspelling(word: string): void;
  inspectElement(x: number, y: number): void;
  openDevToolsIfClosed(): void;
  addWordToDictionary(word: string): void;
}

export interface BrowserMenuEffects {
  writeClipboardText(text: string): void;
  openExternal(url: string): void;
}

export function runBrowserContextMenuAction(
  id: string,
  menu: PendingBrowserContextMenu,
  contents: BrowserMenuContents,
  effects: BrowserMenuEffects,
): void {
  const { params } = menu;
  if (id.startsWith("spell:")) {
    const word = params.dictionarySuggestions[Number(id.slice("spell:".length))];
    if (word) contents.replaceMisspelling(word);
    return;
  }
  switch (id) {
    case "add-to-dictionary":
      if (params.misspelledWord) contents.addWordToDictionary(params.misspelledWord);
      return;
    case "open-link-external":
      if (isSafeExternalHttpUrl(params.linkURL)) effects.openExternal(params.linkURL);
      return;
    case "copy-link":
      effects.writeClipboardText(params.linkURL);
      return;
    case "copy-image":
      contents.copyImageAt(params.x, params.y);
      return;
    case "cut":
      contents.cut();
      return;
    case "copy":
      contents.copy();
      return;
    case "paste":
      contents.paste();
      return;
    case "select-all":
      contents.selectAll();
      return;
    case "back":
      contents.goBack();
      return;
    case "forward":
      contents.goForward();
      return;
    case "reload":
      contents.reload();
      return;
    case "open-page-external":
      if (isSafeExternalHttpUrl(params.pageUrl)) effects.openExternal(params.pageUrl);
      return;
    case "inspect":
      contents.openDevToolsIfClosed();
      contents.inspectElement(params.x, params.y);
      return;
    default:
      return;
  }
}

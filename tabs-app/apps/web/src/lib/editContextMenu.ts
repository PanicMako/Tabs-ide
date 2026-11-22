import type { ContextMenuItem } from "@tabs/contracts";

import { showContextMenuFallback } from "../contextMenuFallback";

/**
 * Right-click on text: a themed Cut / Copy / Paste / Select all menu instead of the
 * operating system's. Surfaces that own their context menu (Monaco, xterm, anything that
 * already called preventDefault) are left alone.
 */
const SELF_MANAGED = ".monaco-editor, .xterm, [data-native-context-menu]";

type EditId = string;

export function isEditableTarget(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return (
      !el.readOnly && !el.disabled && /^(text|search|url|tel|email|password|number|)$/.test(el.type)
    );
  }
  return el.isContentEditable;
}

export const ADD_TO_DICTIONARY_ID = "add-to-dictionary";
const SPELL_PREFIX = "spell:";

export function spellSuggestionId(index: number): string {
  return `${SPELL_PREFIX}${index}`;
}

export function buildEditMenu(args: {
  editable: boolean;
  hasSelection: boolean;
  misspelledWord?: string;
  suggestions?: readonly string[];
}): ContextMenuItem<EditId>[] {
  const items: ContextMenuItem<EditId>[] = [];
  if (args.editable && args.misspelledWord) {
    const suggestions = args.suggestions ?? [];
    if (suggestions.length === 0) {
      items.push({ id: "no-suggestions", label: "No spelling suggestions", disabled: true });
    }
    suggestions.forEach((word, index) => items.push({ id: spellSuggestionId(index), label: word }));
    items.push({ id: ADD_TO_DICTIONARY_ID, label: `Add "${args.misspelledWord}" to dictionary` });
    items.push({ id: "edit-header", label: "Edit", header: true });
  }
  if (args.editable) items.push({ id: "cut", label: "Cut", disabled: !args.hasSelection });
  items.push({ id: "copy", label: "Copy", disabled: !args.hasSelection });
  if (args.editable) items.push({ id: "paste", label: "Paste" });
  items.push({ id: "select-all", label: "Select all" });
  return items;
}

function selectionText(target: HTMLElement): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return (target.value ?? "").slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? "";
}

async function run(
  id: EditId,
  target: HTMLElement | null,
  spelling: { word: string; suggestions: readonly string[] } | null,
) {
  const bridge = window.desktopBridge;
  if (id === ADD_TO_DICTIONARY_ID) {
    if (spelling) await bridge?.addWordToDictionary?.(spelling.word);
    return;
  }
  if (id.startsWith(SPELL_PREFIX)) {
    const word = spelling?.suggestions[Number(id.slice(SPELL_PREFIX.length))];
    target?.focus();
    if (word) await bridge?.replaceMisspelling?.(word);
    return;
  }
  target?.focus();
  if (id === "paste") {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (text) document.execCommand("insertText", false, text);
    return;
  }
  if (id === "select-all") {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.select();
    } else document.execCommand("selectAll");
    return;
  }
  document.execCommand(id);
}

const RECENT_MS = 750;

export function installEditContextMenu(doc: Document = document): () => void {
  let last: { target: HTMLElement | null; x: number; y: number; at: number } | null = null;

  const showEditable = (
    target: HTMLElement | null,
    point: { x: number; y: number },
    spelling: { word: string; suggestions: readonly string[] } | null,
  ) => {
    const text = target ? selectionText(target) : "";
    void showContextMenuFallback(
      buildEditMenu({
        editable: true,
        hasSelection: text.length > 0,
        misspelledWord: spelling?.word ?? "",
        suggestions: spelling?.suggestions ?? [],
      }),
      point,
    ).then((id) => (id ? run(id, target, spelling) : undefined));
  };

  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const origin = event.target instanceof Element ? event.target : null;
    if (!origin || origin.closest(SELF_MANAGED)) return;
    const field = origin.closest("input, textarea, [contenteditable]");
    const editable = isEditableTarget(field);
    const target = editable ? (field as HTMLElement) : null;
    if (editable && window.desktopBridge?.onEditContextMenu) {
      // Electron reports spellcheck results for editable fields; its event draws the menu.
      // Do not preventDefault: that would stop Electron from emitting its event at all.
      last = { target, x: event.clientX, y: event.clientY, at: Date.now() };
      return;
    }
    const text = target ? selectionText(target) : (window.getSelection()?.toString() ?? "");
    event.preventDefault();
    if (!editable && text.length === 0) return;
    void showContextMenuFallback(buildEditMenu({ editable, hasSelection: text.length > 0 }), {
      x: event.clientX,
      y: event.clientY,
    }).then((id) => (id ? run(id, target, null) : undefined));
  };
  doc.addEventListener("contextmenu", onContextMenu);

  const offBridge = window.desktopBridge?.onEditContextMenu?.((params) => {
    const recent = last && Date.now() - last.at < RECENT_MS ? last : null;
    const target =
      recent?.target ?? (doc.activeElement instanceof HTMLElement ? doc.activeElement : null);
    showEditable(
      target,
      recent ? { x: recent.x, y: recent.y } : { x: params.x, y: params.y },
      params.misspelledWord
        ? { word: params.misspelledWord, suggestions: params.dictionarySuggestions }
        : null,
    );
  });

  return () => {
    doc.removeEventListener("contextmenu", onContextMenu);
    offBridge?.();
  };
}

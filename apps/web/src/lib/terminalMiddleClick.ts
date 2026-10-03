export interface TerminalMiddleClickTarget {
  focus: () => void;
  clearSelection: () => void;
  paste: (data: string) => void;
}

export interface TerminalMiddleClickOptions {
  readClipboardText?: ((type?: "clipboard" | "selection") => Promise<string>) | undefined;
  clipboardReader?: (() => Promise<string>) | undefined;
  platform?: string | undefined;
}

/**
 * Handles terminal middle-click (button === 1 / auxclick).
 * On Linux and primary-selection capable environments, middle-click reads the primary
 * selection (or fallback clipboard) and pastes it directly into the terminal,
 * ensuring native X11/Wayland middle-click paste behavior in the terminal drawer.
 */
export async function handleTerminalMiddleClick(
  event: Pick<MouseEvent, "button" | "preventDefault" | "stopPropagation">,
  terminal: TerminalMiddleClickTarget,
  options: TerminalMiddleClickOptions = {},
): Promise<boolean> {
  if (event.button !== 1) return false;

  event.preventDefault();
  event.stopPropagation();

  terminal.focus();
  terminal.clearSelection();

  try {
    let text = "";
    if (options.readClipboardText) {
      try {
        text = await options.readClipboardText("selection");
      } catch {
        text = "";
      }
      if (!text) {
        text = await options.readClipboardText("clipboard");
      }
    } else if (options.clipboardReader) {
      text = await options.clipboardReader();
    } else if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      text = await navigator.clipboard.readText();
    }

    if (text) {
      terminal.paste(text);
      return true;
    }
  } catch {
    // Ignore clipboard access errors (e.g. permission denied)
  }

  return true;
}

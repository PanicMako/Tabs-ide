import type { App, BrowserWindow, Input, View, WebContents } from "electron";
import type { KeybindingShortcut } from "@tabs/contracts";
import { matchesShortcut } from "@tabs/shared/keybindings";

export function matchesNativeQuickActionsInput(
  input: Input,
  shortcut: KeybindingShortcut | undefined,
  platform: string,
): boolean {
  if (!shortcut || input.type !== "keyDown" || input.isAutoRepeat || input.isComposing)
    return false;
  return matchesShortcut(
    {
      key: input.key,
      code: input.code,
      metaKey: input.meta,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift,
    },
    shortcut,
    platform === "darwin" ? "MacIntel" : platform,
  );
}

function containsContents(view: View, contents: WebContents): boolean {
  return (
    ("webContents" in view && view.webContents === contents) ||
    view.children.some((child) => containsContents(child, contents))
  );
}

/** Intercept only the configured launcher chord in attached, Tabs-owned native views. */
export function installNativeQuickActionsForwarding(options: {
  app: Pick<App, "on" | "removeListener">;
  getWindows: () => readonly BrowserWindow[];
  getShortcut: () => KeybindingShortcut | undefined;
  forward: (window: BrowserWindow) => void;
  platform?: string;
}): () => void {
  const registrations = new Map<WebContents, () => void>();
  const attach = (_event: Electron.Event, contents: WebContents) => {
    const inputHandler = (event: Electron.Event, input: Input) => {
      if (
        !matchesNativeQuickActionsInput(
          input,
          options.getShortcut(),
          options.platform ?? process.platform,
        )
      )
        return;
      const owner = options
        .getWindows()
        .find(
          (window) =>
            !window.isDestroyed() &&
            window.webContents !== contents &&
            containsContents(window.contentView, contents),
        );
      if (!owner) return;
      // Cancel both Code-OSS/browser handling and the native menu accelerator,
      // so a chord opens exactly one launcher and never reaches a terminal.
      event.preventDefault();
      options.forward(owner);
    };
    const dispose = () => {
      contents.removeListener("before-input-event", inputHandler);
      contents.removeListener("destroyed", dispose);
      registrations.delete(contents);
    };
    contents.on("before-input-event", inputHandler);
    contents.once("destroyed", dispose);
    registrations.set(contents, dispose);
  };
  options.app.on("web-contents-created", attach);
  return () => {
    options.app.removeListener("web-contents-created", attach);
    for (const dispose of registrations.values()) dispose();
  };
}

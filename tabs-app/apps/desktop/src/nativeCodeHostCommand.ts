export interface NativeCodeHostCommandDependencies {
  clipboard: {
    readText(type?: "selection" | "clipboard"): string | Promise<string>;
    writeText(text: string, type?: "selection" | "clipboard"): void | Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): void;
    trashItem(path: string): Promise<void>;
  };
  webContents?: {
    paste(): void;
  };
}

export type NativeCodeHostCommandResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly value: unknown };

/**
 * Implements the OS-facing subset of VS Code's native-host IPC contract that
 * an embedded workbench still needs. Keeping this dispatcher independent from
 * Electron makes the compatibility boundary explicit and regression-testable.
 */
export async function handleNativeCodeHostCommand(
  command: string,
  args: readonly unknown[],
  dependencies: NativeCodeHostCommandDependencies,
): Promise<NativeCodeHostCommandResult> {
  // NativeHostServiceChannel prepends the window id to every call.
  const firstArgument = args[1];
  const secondArgument = args[2];

  switch (command) {
    case "readClipboardText":
      return {
        handled: true,
        value: await dependencies.clipboard.readText(
          firstArgument === "selection" ? "selection" : "clipboard",
        ),
      };
    case "writeClipboardText":
      if (typeof firstArgument === "string") {
        await dependencies.clipboard.writeText(
          firstArgument,
          secondArgument === "selection" ? "selection" : "clipboard",
        );
      }
      return { handled: true, value: undefined };
    case "triggerPaste":
      dependencies.webContents?.paste();
      return { handled: true, value: undefined };
    case "openExternal":
      if (typeof firstArgument !== "string") {
        return { handled: true, value: false };
      }
      await dependencies.shell.openExternal(firstArgument);
      return { handled: true, value: true };
    case "showItemInFolder":
      if (typeof firstArgument === "string") {
        dependencies.shell.showItemInFolder(firstArgument);
      }
      return { handled: true, value: undefined };
    case "moveItemToTrash":
      if (typeof firstArgument === "string") {
        await dependencies.shell.trashItem(firstArgument);
      }
      return { handled: true, value: undefined };
    default:
      return { handled: false };
  }
}

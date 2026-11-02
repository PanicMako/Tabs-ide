import * as FS from "node:fs";
import * as Path from "node:path";
import type { AppDetailsOptions, ShortcutDetails } from "electron";

/** Windows shell APIs cannot read a resource through Electron's virtual ASAR filesystem. */
export function diskIconPath(
  path: string,
  exists: (path: string) => boolean = FS.existsSync,
): string | null {
  const physical = path.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return exists(physical) ? physical : null;
}
export function windowsIconDetails(appId: string, icon: string): AppDetailsOptions {
  return { appId, appIconPath: icon, appIconIndex: 0 };
}
export function isOwnedShortcut(
  link: Pick<ShortcutDetails, "target" | "appUserModelId">,
  executable: string,
  appId: string,
): boolean {
  return (
    link.appUserModelId === appId &&
    Path.win32.normalize(link.target).toLowerCase() ===
      Path.win32.normalize(executable).toLowerCase()
  );
}
/** Update only existing shortcuts for this executable and application identity. */
export function updateWindowsIconShortcuts(options: {
  roots: readonly string[];
  executable: string;
  appId: string;
  icon: string;
  read: (path: string) => ShortcutDetails;
  write: (path: string, operation: "update", details: ShortcutDetails) => boolean;
  report: (message: string) => void;
}): void {
  const visit = (folder: string, depth: number) => {
    let entries: FS.Dirent[];
    try {
      entries = FS.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = Path.join(folder, entry.name);
      if (entry.isDirectory() && depth > 0) {
        visit(path, depth - 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".lnk")) continue;
      try {
        const link = options.read(path);
        if (!isOwnedShortcut(link, options.executable, options.appId) || link.icon === options.icon)
          continue;
        if (!options.write(path, "update", { ...link, icon: options.icon, iconIndex: 0 }))
          options.report(`Could not update app shortcut icon: ${path}`);
      } catch {
        /* A stale or unreadable shortcut must not prevent other icons updating. */
      }
    }
  };
  for (const root of new Set(options.roots)) visit(root, 2);
}

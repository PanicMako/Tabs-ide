import desktopPackage from "../package.json" with { type: "json" };

/** Electron's development launcher reports Electron's version, not Tabs'. */
export function extensionHostVersion(application: {
  readonly isPackaged: boolean;
  getVersion(): string;
}): string {
  return application.isPackaged ? application.getVersion() : desktopPackage.version;
}

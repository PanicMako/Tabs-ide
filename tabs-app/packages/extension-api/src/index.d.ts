export declare const TABS_EXTENSION_API_VERSION: "1.9.0";

export interface TabsExtensionStorageMigration {
  readonly from: number;
  readonly to: number;
  /** Rename top-level keys in each shared or project-isolated profile document. */
  readonly renames: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export type TabsExtensionCapability =
  | "profile-storage"
  | "workspace-read"
  | "git-status"
  | "network"
  | "credentials"
  | "ai-tools";

export interface TabsExtensionTool {
  readonly id: string;
  readonly label: string;
  readonly entry: string;
  readonly icon?: string;
}

/** Icon names a quick action may use; they match the launcher's built-in set. */
export type TabsExtensionQuickActionIcon =
  | "star"
  | "link"
  | "zap"
  | "book"
  | "rocket"
  | "bug"
  | "database"
  | "cloud"
  | "play"
  | "flask"
  | "terminal"
  | "browser"
  | "code"
  | "search";

/**
 * An entry in the Tabs Quick Actions launcher that opens one of this
 * extension's tools in the active project. Requires engines.api >=1.8.0.
 * It grants nothing: the tool still runs with only its granted capabilities.
 */
export interface TabsExtensionQuickAction {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: TabsExtensionQuickActionIcon;
  /** The id of a tool in contributes.tools. */
  readonly tool: string;
}

/**
 * A color theme shown in Settings → Themes. Tabs derives every surface,
 * editor color and readable text color from these five values, so a theme
 * cannot hide controls or break contrast. Requires engines.api >=1.9.0.
 */
export interface TabsExtensionTheme {
  readonly id: string;
  readonly label: string;
  readonly appearance: "dark" | "light";
  /** Six-digit hex colors, e.g. "#101113". */
  readonly colors: {
    readonly background: string;
    readonly foreground: string;
    readonly card: string;
    readonly border: string;
    readonly primary: string;
  };
}

/** A Command Palette entry that opens one of this extension's tools. Requires engines.api >=1.9.0. */
export interface TabsExtensionPaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Extra lowercase search words. */
  readonly keywords?: ReadonlyArray<string>;
  /** The id of a tool in contributes.tools. */
  readonly tool: string;
}

export interface TabsExtensionCommand {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Pure JSON command exposed to agents only after a per-project grant. */
  readonly aiCallable?: boolean;
}

/** Logic commands run in a disposable, JSON-only runtime with no host capabilities. */
export interface TabsExtensionManifest {
  readonly manifestVersion: 1;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly releaseNotes?: string;
  readonly sourceUrl?: string;
  readonly supportUrl?: string;
  readonly privacyUrl?: string;
  /** Packaged presentation metadata; requires engines.api >=1.6.0. */
  readonly listing?: {
    readonly readme?: string;
    readonly icon?: string;
    /** Up to six packaged raster previews with accessible descriptions; requires engines.api >=1.7.0. */
    readonly screenshots?: ReadonlyArray<{ readonly path: string; readonly alt: string }>;
    readonly license?: string;
    readonly categories?: ReadonlyArray<string>;
    readonly keywords?: ReadonlyArray<string>;
    readonly externalServices?: string;
  };
  readonly engines: {
    readonly tabs: string;
    /** Omission is treated as API v1 for older packages. New packages should declare it. */
    readonly api?: string;
  };
  readonly capabilities?: ReadonlyArray<TabsExtensionCapability>;
  readonly networkHosts?: ReadonlyArray<string>;
  /** Omission means schema version 1; migrations are host-run before first activation. */
  readonly storage?: {
    readonly version: number;
    readonly migrations?: ReadonlyArray<TabsExtensionStorageMigration>;
  };
  readonly logic?: { readonly entry: string };
  readonly contributes: {
    /** At least one tool, unless the package only contributes themes. */
    readonly tools: ReadonlyArray<TabsExtensionTool>;
    readonly commands?: ReadonlyArray<TabsExtensionCommand>;
    /** Launcher entries; requires engines.api >=1.8.0. */
    readonly quickActions?: ReadonlyArray<TabsExtensionQuickAction>;
    /** Color themes; requires engines.api >=1.9.0. */
    readonly themes?: ReadonlyArray<TabsExtensionTheme>;
    /** Command Palette entries; requires engines.api >=1.9.0. */
    readonly paletteCommands?: ReadonlyArray<TabsExtensionPaletteCommand>;
  };
}

export type TabsExtensionJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<TabsExtensionJsonValue>
  | { readonly [key: string]: TabsExtensionJsonValue };

/** Calls are authorized against the active extension, project, and assigned profile. */
export interface TabsExtensionHostBridge {
  readonly storage: {
    get(key: string): Promise<TabsExtensionJsonValue | null>;
    set(key: string, value: TabsExtensionJsonValue): Promise<void>;
    delete(key: string): Promise<void>;
  };
  readonly workspace: {
    readText(relativePath: string): Promise<string>;
  };
  readonly git: {
    status(): Promise<{ readonly branch: string; readonly dirty: boolean }>;
  };
  readonly network: {
    getText(url: string, options?: { readonly useProfileCredential?: boolean }): Promise<string>;
  };
  readonly logic: {
    invoke(commandId: string, input: TabsExtensionJsonValue): Promise<TabsExtensionJsonValue>;
  };
}

declare global {
  interface Window {
    readonly tabsExtension: TabsExtensionHostBridge;
  }
}

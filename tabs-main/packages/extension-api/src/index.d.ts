export declare const TABS_EXTENSION_API_VERSION: "1.0.0";

export type TabsExtensionCapability = "profile-storage" | "workspace-read" | "network";

export interface TabsExtensionTool {
  readonly id: string;
  readonly label: string;
  readonly entry: string;
  readonly icon?: string;
}

/** Manifest v1 describes packaged static UI; logic contributions are not supported yet. */
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
  readonly engines: {
    readonly tabs: string;
    /** Omission is treated as API v1 for older packages. New packages should declare it. */
    readonly api?: string;
  };
  readonly capabilities?: ReadonlyArray<TabsExtensionCapability>;
  readonly networkHosts?: ReadonlyArray<string>;
  readonly contributes: { readonly tools: ReadonlyArray<TabsExtensionTool> };
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
  readonly network: {
    getText(url: string): Promise<string>;
  };
}

declare global {
  interface Window {
    readonly tabsExtension: TabsExtensionHostBridge;
  }
}

export declare const TABS_EXTENSION_API_VERSION: "1.3.0";

export type TabsExtensionCapability =
  | "profile-storage"
  | "workspace-read"
  | "network"
  | "credentials"
  | "ai-tools";

export interface TabsExtensionTool {
  readonly id: string;
  readonly label: string;
  readonly entry: string;
  readonly icon?: string;
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
  readonly engines: {
    readonly tabs: string;
    /** Omission is treated as API v1 for older packages. New packages should declare it. */
    readonly api?: string;
  };
  readonly capabilities?: ReadonlyArray<TabsExtensionCapability>;
  readonly networkHosts?: ReadonlyArray<string>;
  readonly logic?: { readonly entry: string };
  readonly contributes: {
    readonly tools: ReadonlyArray<TabsExtensionTool>;
    readonly commands?: ReadonlyArray<TabsExtensionCommand>;
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

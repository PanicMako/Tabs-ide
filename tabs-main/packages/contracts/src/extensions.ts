import * as Schema from "effect/Schema";

/** The first package format is intentionally UI-only. Logic permissions require a separate runtime. */
export const TabsExtensionTool = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  entry: Schema.String,
  icon: Schema.optionalKey(Schema.String),
});
export type TabsExtensionTool = typeof TabsExtensionTool.Type;

export const TabsExtensionManifest = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  publisher: Schema.String,
  name: Schema.String,
  version: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  releaseNotes: Schema.optionalKey(Schema.String),
  sourceUrl: Schema.optionalKey(Schema.String),
  supportUrl: Schema.optionalKey(Schema.String),
  privacyUrl: Schema.optionalKey(Schema.String),
  engines: Schema.Struct({ tabs: Schema.String }),
  capabilities: Schema.optionalKey(Schema.Array(Schema.Literal("profile-storage"))),
  contributes: Schema.Struct({ tools: Schema.Array(TabsExtensionTool) }),
});
export type TabsExtensionManifest = typeof TabsExtensionManifest.Type;

export const TabsExtensionAssignment = Schema.Struct({
  extensionId: Schema.String,
  enabledGlobally: Schema.Boolean,
  enabledProjectIds: Schema.Array(Schema.String),
  disabledProjectIds: Schema.Array(Schema.String),
  defaultProfileId: Schema.String,
  profileIdByProjectId: Schema.Record(Schema.String, Schema.String),
  storageGrantedProjectIds: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type TabsExtensionAssignment = typeof TabsExtensionAssignment.Type;

export interface DesktopInstalledExtension {
  readonly id: string;
  readonly manifest: TabsExtensionManifest;
  readonly assignment: TabsExtensionAssignment;
  readonly profiles: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly scope?: "shared" | "project";
  }>;
  readonly source: "development" | "local-package" | "exchange";
  readonly digest?: string;
  /** Origin is part of the package identity; a different registry cannot replace it. */
  readonly registryOrigin?: string;
  /** A signed registry status check removed this exact version or digest. */
  readonly revoked?: true;
  /** Stops tools and bridge access without erasing assignments, profiles, or data. */
  readonly disabled?: true;
  /** Informational update hint; installation still requires a fresh signed review. */
  readonly availableUpdate?: DesktopExchangeListing;
}

export interface DesktopPreparedExchangeInstall {
  readonly token: string;
  readonly registryOrigin: string;
  readonly digest: string;
  readonly manifest: TabsExtensionManifest;
  readonly replacesVersion?: string;
  readonly willKeepEnabled: boolean;
}

/** Informational catalog data; it is not an installation authorization. */
export interface DesktopExchangeListing {
  readonly registryOrigin: string;
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly displayName: string;
  readonly description: string;
  readonly verifiedPublisher: boolean;
  readonly tabsCompatibility: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly releaseNotes?: string;
  readonly sourceUrl?: string;
  readonly supportUrl?: string;
  readonly privacyUrl?: string;
}

export interface DesktopExtensionViewInput {
  readonly extensionId: string;
  readonly toolId: string;
  readonly projectId: string;
  readonly profileId: string;
}

export interface DesktopExtensionBoundsInput extends DesktopExtensionViewInput {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

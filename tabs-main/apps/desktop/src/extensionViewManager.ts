import * as FS from "node:fs";
import * as Path from "node:path";
import * as Crypto from "node:crypto";
import { type BrowserWindow, type Session, WebContentsView, session } from "electron";
import { extractTabsext, inspectTabsext } from "@tabs/extension-package";
import {
  TabsExtensionAssignment,
  type DesktopExtensionBoundsInput,
  type DesktopExtensionViewInput,
  type DesktopInstalledExtension,
  type DesktopExtensionCredentialStatus,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import {
  extensionPermissionIncrease,
  extensionProfileForProject,
  isExtensionEnabledForProject,
  validateTabsExtensionManifest,
} from "@tabs/shared/extensions";
import { compareSemverVersions } from "@tabs/shared/semver";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";
import { ExtensionStorage, type ExtensionStorageOperation } from "./extensionStorage";
import { ExtensionCredentials, type CredentialCryptography } from "./extensionCredentials";
import { extensionNetworkGetText, validateExtensionNetworkUrl } from "./extensionNetwork";
import { runExtensionLogicSpike } from "./extensionLogicSpike";

const SCHEME = "tabs-extension";
const MAX_FILES = 1_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PROFILE_ID = /^[a-z][a-z0-9-]{0,62}$/;
const MAX_PARTITIONS = 1_024;

interface StoredExtension extends DesktopInstalledExtension {
  readonly directory: string;
  readonly dataInventoryVersion?: 1;
  readonly usedPartitions?: ReadonlyArray<string>;
  readonly pendingRollback?: {
    readonly manifest: DesktopInstalledExtension["manifest"];
    readonly assignment: TabsExtensionAssignment;
    readonly digest: string;
    readonly directory: string;
  };
}

interface RetainedProfiles {
  readonly id: string;
  readonly source: DesktopInstalledExtension["source"];
  readonly registryOrigin?: string;
  readonly profiles: DesktopInstalledExtension["profiles"];
  readonly dataInventoryVersion?: 1;
  readonly usedPartitions?: ReadonlyArray<string>;
}

interface ActiveView {
  readonly key: string;
  readonly view: WebContentsView;
  readonly projectId: string;
  readonly extensionId: string;
  readonly profileId: string;
}

/** Registry origin is part of storage and Chromium partition identity. */
export function extensionDataIdentity(
  extensionId: string,
  registryOrigin?: string,
  source?: DesktopInstalledExtension["source"],
): string {
  if (!registryOrigin) {
    return source === "local-package" ? `local-package-${extensionId}` : extensionId;
  }
  const originHash = Crypto.createHash("sha256").update(registryOrigin).digest("hex");
  return `exchange-${originHash}-${extensionId}`;
}

function retainedProfilesIdentity(
  id: string,
  source: DesktopInstalledExtension["source"],
  registryOrigin?: string,
): string {
  return JSON.stringify([id, source, registryOrigin ?? null]);
}

export function extensionSessionPartition(
  extensionId: string,
  profileId: string,
  scope: "shared" | "project" | undefined,
  projectId: string,
  registryOrigin?: string,
  source?: DesktopInstalledExtension["source"],
): string {
  const projectSuffix =
    scope === "project" ? `:${Crypto.createHash("sha256").update(projectId).digest("hex")}` : "";
  return `persist:tabs-extension:${extensionDataIdentity(extensionId, registryOrigin, source)}:${profileId}${projectSuffix}`;
}

function inspectDirectory(root: string): void {
  let count = 0;
  let bytes = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > 16) throw new Error("Extension directory is too deeply nested.");
    for (const entry of FS.readdirSync(directory, { withFileTypes: true })) {
      count++;
      if (count > MAX_FILES) throw new Error("Extension has too many files or directories.");
      const path = Path.join(directory, entry.name);
      const stat = FS.lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error("Extension directories may contain only regular files and directories.");
      }
      if (stat.isDirectory()) {
        visit(path, depth + 1);
      } else {
        bytes += stat.size;
        if (count > MAX_FILES || bytes > MAX_TOTAL_BYTES) {
          throw new Error("Extension exceeds the development size limit.");
        }
      }
    }
  };
  visit(root, 0);
}

export class ExtensionViewManager {
  private readonly installed = new Map<string, StoredExtension>();
  private readonly deleting = new Set<string>();
  private deletionEpoch = 0;
  private readonly configuredSessions = new Set<string>();
  private readonly networkRequests = new Set<{
    readonly extensionId: string;
    readonly controller: AbortController;
  }>();
  private readonly logicRequests = new Set<{
    readonly extensionId: string;
    readonly controller: AbortController;
  }>();
  private active: ActiveView | null = null;
  private readonly storage: ExtensionStorage;
  private readonly credentials: ExtensionCredentials | null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly coordinator: NativeViewStackCoordinator,
    private readonly statePath: string,
    private readonly tabsVersion: string,
    private readonly allowDevelopment: boolean,
    cryptography?: CredentialCryptography,
    private readonly networkGetText: typeof extensionNetworkGetText = extensionNetworkGetText,
    private readonly logicRun: typeof runExtensionLogicSpike = runExtensionLogicSpike,
  ) {
    this.storage = new ExtensionStorage(Path.join(Path.dirname(statePath), "extension-storage"));
    this.credentials = cryptography
      ? new ExtensionCredentials(
          Path.join(Path.dirname(statePath), "extension-credentials"),
          cryptography,
        )
      : null;
    this.load();
  }

  invokeStorage(sender: Electron.WebContents, operation: ExtensionStorageOperation): unknown {
    const active = this.active;
    if (!active || active.view.webContents !== sender || sender.isDestroyed()) {
      throw new Error("Extension view is no longer active.");
    }
    const installed = this.requireInstalled(active.extensionId);
    this.assertNotDeleting(installed.id);
    if (installed.revoked) throw new Error("This extension version has been revoked.");
    if (installed.disabled) throw new Error("This extension is disabled.");
    if (!installed.manifest.capabilities?.includes("profile-storage")) {
      throw new Error("Extension did not request profile storage.");
    }
    if (
      !isExtensionEnabledForProject(installed.assignment, active.projectId) ||
      !installed.assignment.storageGrantedProjectIds?.includes(active.projectId) ||
      extensionProfileForProject(installed.assignment, active.projectId) !== active.profileId
    ) {
      throw new Error("Profile storage permission is not granted for this project.");
    }
    const profile = this.requireProfile(installed, active.profileId);
    return this.storage.invoke(
      {
        extensionId: extensionDataIdentity(
          active.extensionId,
          installed.registryOrigin,
          installed.source,
        ),
        profileId: active.profileId,
        ...(profile.scope === "project" ? { projectId: active.projectId } : {}),
      },
      operation,
      { allowLegacy: installed.dataInventoryVersion !== 1 },
    );
  }

  async invokeWorkspaceRead(
    sender: Electron.WebContents,
    relativePath: string,
    read: (projectId: string, relativePath: string) => Promise<string>,
  ): Promise<string> {
    const active = this.active;
    if (!active || active.view.webContents !== sender || sender.isDestroyed()) {
      throw new Error("Extension view is no longer active.");
    }
    if (typeof relativePath !== "string" || !relativePath || relativePath.length > 240) {
      throw new Error("Invalid workspace path.");
    }
    const authorize = () => {
      const installed = this.requireInstalled(active.extensionId);
      this.assertNotDeleting(installed.id);
      if (installed.revoked || installed.disabled) throw new Error("Extension is unavailable.");
      if (!installed.manifest.capabilities?.includes("workspace-read")) {
        throw new Error("Extension did not request workspace read access.");
      }
      if (
        !isExtensionEnabledForProject(installed.assignment, active.projectId) ||
        !installed.assignment.workspaceReadGrantedProjectIds?.includes(active.projectId) ||
        extensionProfileForProject(installed.assignment, active.projectId) !== active.profileId
      ) {
        throw new Error("Workspace read access is not granted for this project.");
      }
    };
    authorize();
    const contents = await read(active.projectId, relativePath);
    if (this.active !== active || sender.isDestroyed()) {
      throw new Error("Extension view changed during workspace read.");
    }
    authorize();
    return contents;
  }

  async invokeNetworkGetText(
    sender: Electron.WebContents,
    rawUrl: string,
    useProfileCredential = false,
  ): Promise<string> {
    const active = this.active;
    if (!active || active.view.webContents !== sender || sender.isDestroyed()) {
      throw new Error("Extension view is no longer active.");
    }
    const authorize = () => {
      const installed = this.requireInstalled(active.extensionId);
      this.assertNotDeleting(installed.id);
      if (
        installed.revoked ||
        installed.disabled ||
        !installed.manifest.capabilities?.includes("network") ||
        !isExtensionEnabledForProject(installed.assignment, active.projectId) ||
        !installed.assignment.networkGrantedProjectIds?.includes(active.projectId) ||
        extensionProfileForProject(installed.assignment, active.projectId) !== active.profileId
      ) {
        throw new Error("Network access is not granted for this project.");
      }
      if (
        useProfileCredential &&
        (!installed.manifest.capabilities?.includes("credentials") ||
          !installed.assignment.credentialGrantedProjectIds?.includes(active.projectId))
      ) {
        throw new Error("Credential access is not granted for this project.");
      }
      return installed;
    };
    const installed = authorize();
    const hosts = installed.manifest.networkHosts ?? [];
    const host = validateExtensionNetworkUrl(rawUrl, hosts).hostname;
    const profile = this.requireProfile(installed, active.profileId);
    const bearerToken = useProfileCredential
      ? this.requireCredentials().get({
          extensionId: extensionDataIdentity(
            installed.id,
            installed.registryOrigin,
            installed.source,
          ),
          profileId: active.profileId,
          ...(profile.scope === "project" ? { projectId: active.projectId } : {}),
          host,
        })
      : null;
    if (useProfileCredential && !bearerToken)
      throw new Error("No credential is saved for this profile and host.");
    const controller = new AbortController();
    const request = { extensionId: installed.id, controller };
    this.networkRequests.add(request);
    let result: string;
    try {
      result = await this.networkGetText(
        rawUrl,
        hosts,
        bearerToken ?? undefined,
        undefined,
        controller.signal,
      );
    } finally {
      this.networkRequests.delete(request);
    }
    if (this.active !== active || sender.isDestroyed())
      throw new Error("Extension view changed during network request.");
    authorize();
    return result;
  }

  async invokeLogic(
    sender: Electron.WebContents,
    commandId: string,
    input: unknown,
  ): Promise<unknown> {
    const active = this.active;
    if (!active || active.view.webContents !== sender || sender.isDestroyed()) {
      throw new Error("Extension view is no longer active.");
    }
    if (typeof commandId !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(commandId)) {
      throw new Error("Invalid extension command ID.");
    }
    const authorize = () => {
      const installed = this.requireInstalled(active.extensionId);
      this.assertNotDeleting(installed.id);
      if (
        installed.revoked ||
        installed.disabled ||
        !isExtensionEnabledForProject(installed.assignment, active.projectId) ||
        extensionProfileForProject(installed.assignment, active.projectId) !== active.profileId ||
        !installed.manifest.logic?.entry ||
        !installed.manifest.contributes.commands?.some((command) => command.id === commandId)
      ) {
        throw new Error("Extension command is unavailable for this project.");
      }
      return installed;
    };
    const installed = authorize();
    if (
      this.logicRequests.size >= 4 ||
      [...this.logicRequests].filter((request) => request.extensionId === installed.id).length >= 2
    ) {
      throw new Error("Too many extension commands are running.");
    }
    const entry = installed.manifest.logic!.entry;
    const file = this.resolveAsset(installed.directory, entry);
    if (FS.statSync(file).size > 256 * 1024) {
      throw new Error("Extension logic exceeds its size limit.");
    }
    const source = FS.readFileSync(file, "utf8");
    const controller = new AbortController();
    const request = { extensionId: installed.id, controller };
    this.logicRequests.add(request);
    try {
      const result = await this.logicRun(
        source,
        { commandId, input },
        { signal: controller.signal },
      );
      if (this.active !== active || sender.isDestroyed()) {
        throw new Error("Extension view changed during command.");
      }
      const current = authorize();
      if (
        current.directory !== installed.directory ||
        current.manifest.version !== installed.manifest.version ||
        current.digest !== installed.digest
      ) {
        throw new Error("Extension package changed during command.");
      }
      return result;
    } finally {
      this.logicRequests.delete(request);
    }
  }

  listCredentialStatuses(extensionId: string): ReadonlyArray<DesktopExtensionCredentialStatus> {
    const installed = this.requireInstalled(extensionId);
    return this.requireCredentials()
      .list(extensionDataIdentity(installed.id, installed.registryOrigin, installed.source))
      .map(({ profileId, projectId, host }) =>
        projectId === undefined ? { profileId, host } : { profileId, projectId, host },
      );
  }

  setProfileCredential(
    extensionId: string,
    profileId: string,
    host: string,
    value: string | null,
    projectId?: string,
  ): void {
    const installed = this.requireInstalled(extensionId);
    this.assertNotDeleting(extensionId);
    if (value !== null) {
      if (installed.revoked) throw new Error("Revoked extensions cannot receive credentials.");
      if (
        !installed.manifest.capabilities?.includes("credentials") ||
        !installed.manifest.networkHosts?.includes(host)
      ) {
        throw new Error("Extension did not request credentials for this host.");
      }
    }
    if (value !== null) {
      const profile = this.requireProfile(installed, profileId);
      if ((profile.scope === "project") !== (projectId !== undefined)) {
        throw new Error("Credential scope does not match the selected profile.");
      }
    }
    const identity = {
      extensionId: extensionDataIdentity(installed.id, installed.registryOrigin, installed.source),
      profileId,
      ...(projectId ? { projectId } : {}),
      host,
    };
    if (value === null) this.requireCredentials().delete(identity);
    else this.requireCredentials().set(identity, value);
    if (this.active?.extensionId === extensionId) this.hide();
  }

  private requireCredentials(): ExtensionCredentials {
    if (!this.credentials) throw new Error("Extension credential storage is unavailable.");
    return this.credentials;
  }

  list(): DesktopInstalledExtension[] {
    return [...this.installed.values()].map((entry) => this.publicEntry(entry));
  }

  installDevelopment(directory: string): DesktopInstalledExtension {
    if (!this.allowDevelopment)
      throw new Error("Development extensions are disabled in this build.");
    if (!Path.isAbsolute(directory)) throw new Error("Select an absolute extension directory.");
    const root = FS.realpathSync(directory);
    if (!FS.statSync(root).isDirectory()) throw new Error("Extension source is not a directory.");
    inspectDirectory(root);
    const manifestPath = Path.join(root, "tabs-extension.json");
    const raw = FS.readFileSync(manifestPath);
    if (raw.byteLength > 64 * 1024) throw new Error("Extension manifest is too large.");
    const parsed = validateTabsExtensionManifest(
      JSON.parse(raw.toString("utf8")),
      this.tabsVersion,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    this.assertNotDeleting(parsed.id);
    for (const tool of parsed.manifest.contributes.tools) {
      this.resolveAsset(root, tool.entry);
      if (tool.icon) this.resolveAsset(root, tool.icon);
    }
    if (parsed.manifest.logic) this.resolveAsset(root, parsed.manifest.logic.entry);
    const previous = this.installed.get(parsed.id);
    if (previous && previous.source !== "development") {
      throw new Error("Uninstall the existing extension before changing its source.");
    }
    const retained = this.readRetainedRecord(parsed.id, "development");
    const assignment: TabsExtensionAssignment = previous?.assignment ?? {
      extensionId: parsed.id,
      enabledGlobally: false,
      enabledProjectIds: [],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {},
    };
    const addedNetworkHosts =
      extensionPermissionIncrease(parsed.manifest, previous?.manifest).addedNetworkHosts.length > 0;
    const safeAssignment = {
      ...assignment,
      ...(parsed.manifest.capabilities?.includes("profile-storage") &&
      !previous?.manifest.capabilities?.includes("profile-storage")
        ? { storageGrantedProjectIds: [] }
        : {}),
      ...(parsed.manifest.capabilities?.includes("workspace-read") &&
      !previous?.manifest.capabilities?.includes("workspace-read")
        ? { workspaceReadGrantedProjectIds: [] }
        : {}),
      ...(parsed.manifest.capabilities?.includes("network") &&
      (!previous?.manifest.capabilities?.includes("network") || addedNetworkHosts)
        ? { networkGrantedProjectIds: [] }
        : {}),
      ...(parsed.manifest.capabilities?.includes("credentials") &&
      (!previous?.manifest.capabilities?.includes("credentials") || addedNetworkHosts)
        ? { credentialGrantedProjectIds: [] }
        : {}),
    };
    const next: StoredExtension = {
      id: parsed.id,
      manifest: parsed.manifest,
      assignment: safeAssignment,
      profiles: previous?.profiles ?? retained?.profiles ?? [{ id: "default", label: "Default" }],
      ...(previous?.disabled ? { disabled: true } : {}),
      ...this.dataInventoryFields(previous, retained),
      source: "development",
      directory: root,
    };
    this.installed.set(parsed.id, next);
    this.hide();
    this.save();
    return this.publicEntry(next);
  }

  async installLocalPackage(archive: string): Promise<DesktopInstalledExtension> {
    const deletionEpoch = this.deletionEpoch;
    if (this.deleting.size) throw new Error("Extension data deletion is in progress.");
    if (!this.allowDevelopment)
      throw new Error("Local extension packages are disabled in this build.");
    if (!Path.isAbsolute(archive) || !archive.endsWith(".tabsext")) {
      throw new Error("Select an absolute .tabsext archive.");
    }
    const inspected = await inspectTabsext(archive, this.tabsVersion);
    this.assertInstallEpoch(inspected.id, deletionEpoch);
    const packagesRoot = Path.join(Path.dirname(this.statePath), "extension-packages");
    const directory = Path.join(packagesRoot, inspected.id, inspected.digest);
    const previous = this.installed.get(inspected.id);
    if (previous && previous.source !== "local-package") {
      throw new Error("Uninstall the existing extension before changing its source.");
    }
    const retained = this.readRetainedRecord(inspected.id, "local-package");
    if (FS.existsSync(directory)) {
      if (previous?.source === "local-package" && previous.digest === inspected.digest) {
        return this.publicEntry(previous);
      }
      throw new Error("This package digest has already been extracted; remove it before retrying.");
    }
    await extractTabsext({
      archive,
      destination: directory,
      expectedDigest: inspected.digest,
      tabsVersion: this.tabsVersion,
    });
    this.assertInstallEpoch(inspected.id, deletionEpoch, directory);
    const assignment = previous?.assignment ?? {
      extensionId: inspected.id,
      enabledGlobally: false,
      enabledProjectIds: [],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {},
    };
    const addedNetworkHosts =
      extensionPermissionIncrease(inspected.manifest, previous?.manifest).addedNetworkHosts.length >
      0;
    const next: StoredExtension = {
      id: inspected.id,
      manifest: inspected.manifest,
      assignment: {
        ...assignment,
        ...(inspected.manifest.capabilities?.includes("profile-storage") &&
        !previous?.manifest.capabilities?.includes("profile-storage")
          ? { storageGrantedProjectIds: [] }
          : {}),
        ...(inspected.manifest.capabilities?.includes("workspace-read") &&
        !previous?.manifest.capabilities?.includes("workspace-read")
          ? { workspaceReadGrantedProjectIds: [] }
          : {}),
        ...(inspected.manifest.capabilities?.includes("network") &&
        (!previous?.manifest.capabilities?.includes("network") || addedNetworkHosts)
          ? { networkGrantedProjectIds: [] }
          : {}),
        ...(inspected.manifest.capabilities?.includes("credentials") &&
        (!previous?.manifest.capabilities?.includes("credentials") || addedNetworkHosts)
          ? { credentialGrantedProjectIds: [] }
          : {}),
      },
      profiles: previous?.profiles ?? retained?.profiles ?? [{ id: "default", label: "Default" }],
      ...(previous?.disabled ? { disabled: true } : {}),
      ...this.dataInventoryFields(previous, retained),
      source: "local-package",
      digest: inspected.digest,
      directory,
    };
    this.hide();
    this.installed.set(inspected.id, next);
    try {
      this.save();
    } catch (error) {
      if (previous) this.installed.set(inspected.id, previous);
      else this.installed.delete(inspected.id);
      throw error;
    }
    return this.publicEntry(next);
  }

  /** Caller must first resolve and download this exact digest through trusted TUF metadata. */
  async installVerifiedExchangePackage(
    archive: string,
    registryOrigin: string,
    expectedDigest: string,
    options: { readonly silent?: boolean } = {},
  ): Promise<DesktopInstalledExtension> {
    const deletionEpoch = this.deletionEpoch;
    if (this.deleting.size) throw new Error("Extension data deletion is in progress.");
    const origin = new URL(registryOrigin);
    if (origin.origin !== registryOrigin || origin.protocol !== "https:") {
      throw new Error("Invalid trusted Exchange origin.");
    }
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
      throw new Error("Invalid signed package digest.");
    }
    const inspected = await inspectTabsext(archive, this.tabsVersion);
    this.assertInstallEpoch(inspected.id, deletionEpoch);
    if (options.silent && !this.canApplySilentUpdate(inspected.id)) {
      throw new Error("Extension is not at a safe update boundary.");
    }
    if (inspected.digest !== expectedDigest) {
      throw new Error("Package digest differs from signed metadata.");
    }
    const previous = this.installed.get(inspected.id);
    if (previous && previous.source !== "exchange") {
      throw new Error("Uninstall the existing extension before changing its source.");
    }
    if (previous?.registryOrigin && previous.registryOrigin !== registryOrigin) {
      throw new Error("A same-named extension from another registry is already installed.");
    }
    if (previous && !previous.digest) throw new Error("Installed Exchange package lacks a digest.");
    if (previous) {
      const comparison = compareSemverVersions(
        inspected.manifest.version,
        previous.manifest.version,
      );
      if (comparison < 0) throw new Error("Exchange cannot downgrade an installed extension.");
      if (comparison === 0 && previous.digest !== expectedDigest) {
        throw new Error("An installed Exchange version cannot change its package digest.");
      }
      if (previous.pendingRollback && comparison > 0) {
        throw new Error(
          "Activate or roll back the pending Exchange update before installing another.",
        );
      }
    }
    const retained = this.readRetainedRecord(inspected.id, "exchange", registryOrigin);
    const packagesRoot = Path.join(Path.dirname(this.statePath), "extension-packages");
    const directory = Path.join(packagesRoot, inspected.id, inspected.digest);
    if (FS.existsSync(directory)) {
      if (
        previous?.source === "exchange" &&
        previous.digest === inspected.digest &&
        previous.registryOrigin === registryOrigin
      ) {
        if (previous.revoked) throw new Error("This extension version has been revoked.");
        return this.publicEntry(previous);
      }
      throw new Error("This package digest was already extracted; remove it before retrying.");
    }
    await extractTabsext({
      archive,
      destination: directory,
      expectedDigest,
      tabsVersion: this.tabsVersion,
    });
    this.assertInstallEpoch(inspected.id, deletionEpoch, directory);
    if (options.silent && !this.canApplySilentUpdate(inspected.id)) {
      FS.rmSync(directory, { recursive: true, force: true });
      throw new Error("Extension became active during update preparation.");
    }
    const increase = extensionPermissionIncrease(inspected.manifest, previous?.manifest);
    const increased =
      previous?.revoked ||
      increase.addedCapabilities.length > 0 ||
      increase.addedNetworkHosts.length > 0;
    if (options.silent && increased) {
      FS.rmSync(directory, { recursive: true, force: true });
      throw new Error("Silent updates cannot add permissions or network hosts.");
    }
    const assignment: TabsExtensionAssignment = previous?.assignment ?? {
      extensionId: inspected.id,
      enabledGlobally: false,
      enabledProjectIds: [],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {},
    };
    const next: StoredExtension = {
      id: inspected.id,
      manifest: inspected.manifest,
      assignment: increased
        ? {
            ...assignment,
            enabledGlobally: false,
            enabledProjectIds: [],
            storageGrantedProjectIds: [],
            workspaceReadGrantedProjectIds: [],
            networkGrantedProjectIds: [],
            credentialGrantedProjectIds: [],
          }
        : assignment,
      profiles: previous?.profiles ?? retained?.profiles ?? [{ id: "default", label: "Default" }],
      ...(previous?.disabled ? { disabled: true } : {}),
      ...(previous?.updatesPinned ? { updatesPinned: true } : {}),
      ...this.dataInventoryFields(previous, retained),
      source: "exchange",
      digest: expectedDigest,
      registryOrigin,
      directory,
      ...(previous && !previous.revoked && previous.digest && previous.digest !== expectedDigest
        ? {
            pendingRollback: {
              manifest: previous.manifest,
              assignment: previous.assignment,
              digest: previous.digest,
              directory: previous.directory,
            },
          }
        : {}),
    };
    if (!options.silent) this.hide();
    this.installed.set(inspected.id, next);
    try {
      this.save();
    } catch (error) {
      if (previous) this.installed.set(inspected.id, previous);
      else this.installed.delete(inspected.id);
      throw error;
    }
    return this.publicEntry(next);
  }

  canApplySilentUpdate(extensionId: string): boolean {
    const current = this.installed.get(extensionId);
    return Boolean(
      current?.source === "exchange" &&
      !current.disabled &&
      !current.revoked &&
      !current.updatesPinned &&
      !current.pendingRollback &&
      !this.deleting.has(extensionId) &&
      this.active?.extensionId !== extensionId &&
      (current.assignment.enabledGlobally || current.assignment.enabledProjectIds.length > 0),
    );
  }

  /** Only call after a fresh, signed registry check for this exact installed digest. */
  revokeIfCurrent(extensionId: string, registryOrigin: string, digest: string): boolean {
    const current = this.installed.get(extensionId);
    if (
      !current ||
      current.source !== "exchange" ||
      current.registryOrigin !== registryOrigin ||
      current.digest !== digest ||
      current.revoked
    ) {
      return false;
    }
    const next: StoredExtension = { ...current, revoked: true };
    this.installed.set(extensionId, next);
    if (this.active?.extensionId === extensionId) this.hide();
    this.save();
    return true;
  }

  /** Uninstall executable code and assignments; retain profiles and their data. */
  uninstall(extensionId: string): void {
    this.assertNotDeleting(extensionId);
    this.uninstallInternal(extensionId, true);
  }

  /** Explicit deletion is unavailable for older installs with unenumerated legacy data. */
  async uninstallAndDeleteData(extensionId: string): Promise<void> {
    const current = this.requireInstalled(extensionId);
    this.assertNotDeleting(extensionId);
    if (!this.canDeleteData(current)) {
      throw new Error(
        "Data deletion is unavailable because this installation has incomplete or legacy storage inventory.",
      );
    }
    this.assertSafeUninstallPackage(current);
    const retainedPath = this.retainedProfilesPath(
      current.id,
      current.source,
      current.registryOrigin,
    );
    let retainedExists = false;
    try {
      const stat = FS.lstatSync(retainedPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Retained extension profile record is invalid.");
      }
      retainedExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.deleting.add(extensionId);
    this.deletionEpoch++;
    try {
      if (this.active?.extensionId === extensionId) this.hide();
      for (const partition of current.usedPartitions ?? []) {
        const extensionSession = session.fromPartition(partition);
        await extensionSession.closeAllConnections();
        await extensionSession.clearData();
        await extensionSession.clearAuthCache();
        await extensionSession.clearCodeCaches({ urls: [] });
        extensionSession.flushStorageData();
        await extensionSession.cookies.flushStore();
      }
      this.storage.removeNamespace(
        extensionDataIdentity(current.id, current.registryOrigin, current.source),
      );
      this.credentials?.removeNamespace(
        extensionDataIdentity(current.id, current.registryOrigin, current.source),
      );
      if (retainedExists) FS.unlinkSync(retainedPath);
      this.uninstallInternal(extensionId, false);
    } finally {
      this.deleting.delete(extensionId);
    }
  }

  private uninstallInternal(extensionId: string, retainData: boolean): void {
    const current = this.requireInstalled(extensionId);
    this.assertSafeUninstallPackage(current);
    if (retainData) this.writeRetainedProfiles(current);
    if (this.active?.extensionId === extensionId) this.hide();
    const packagesRoot = Path.join(Path.dirname(this.statePath), "extension-packages");
    const packageDirectory = Path.join(packagesRoot, extensionId);
    let movedPackage: string | null = null;
    if (current.source !== "development" && FS.existsSync(packageDirectory)) {
      if (FS.lstatSync(packagesRoot).isSymbolicLink()) {
        throw new Error("Extension packages root is a symbolic link.");
      }
      if (FS.lstatSync(packageDirectory).isSymbolicLink()) {
        throw new Error("Extension package directory is a symbolic link.");
      }
      const expected = Path.join(packageDirectory, current.digest ?? "");
      if (Path.resolve(current.directory) !== expected) {
        throw new Error("Extension package directory identity mismatch.");
      }
      movedPackage = Path.join(
        packagesRoot,
        `.uninstalled-${extensionId}-${Crypto.randomBytes(8).toString("hex")}`,
      );
      if (FS.existsSync(movedPackage)) throw new Error("Extension package staging path exists.");
      FS.renameSync(packageDirectory, movedPackage);
    }
    this.installed.delete(extensionId);
    try {
      this.save();
    } catch (error) {
      this.installed.set(extensionId, current);
      if (movedPackage) FS.renameSync(movedPackage, packageDirectory);
      throw error;
    }
    if (movedPackage) {
      try {
        FS.rmSync(movedPackage, { recursive: true, force: true });
      } catch (cause) {
        throw new Error("Extension uninstalled, but its package cache could not be removed.", {
          cause,
        });
      }
    }
  }

  private assertSafeUninstallPackage(current: StoredExtension): void {
    if (current.source === "development") return;
    const packagesRoot = Path.join(Path.dirname(this.statePath), "extension-packages");
    const packageDirectory = Path.join(packagesRoot, current.id);
    if (!FS.existsSync(packageDirectory)) return;
    if (
      FS.lstatSync(packagesRoot).isSymbolicLink() ||
      FS.lstatSync(packageDirectory).isSymbolicLink()
    ) {
      throw new Error("Extension package directory is a symbolic link.");
    }
    if (Path.resolve(current.directory) !== Path.join(packageDirectory, current.digest ?? "")) {
      throw new Error("Extension package directory identity mismatch.");
    }
  }

  setAssignment(extensionId: string, assignment: TabsExtensionAssignment): void {
    this.assertNotDeleting(extensionId);
    const current = this.requireInstalled(extensionId);
    if (current.revoked) throw new Error("This extension version has been revoked.");
    const validated = Schema.decodeUnknownSync(TabsExtensionAssignment)(assignment);
    if (validated.extensionId !== extensionId) throw new Error("Assignment identity mismatch.");
    if (!this.profileExists(current, validated.defaultProfileId)) {
      throw new Error("Default profile does not exist.");
    }
    for (const profileId of Object.values(validated.profileIdByProjectId)) {
      if (!this.profileExists(current, profileId))
        throw new Error("Assigned profile does not exist.");
    }
    this.installed.set(extensionId, { ...current, assignment: validated });
    this.hide();
    this.save();
  }

  setDisabled(extensionId: string, disabled: boolean): void {
    this.assertNotDeleting(extensionId);
    const current = this.requireInstalled(extensionId);
    if (!disabled && current.revoked) throw new Error("A revoked extension cannot be enabled.");
    if (Boolean(current.disabled) === disabled) return;
    const { disabled: _disabled, ...enabled } = current;
    const next: StoredExtension = disabled ? { ...current, disabled: true } : enabled;
    this.installed.set(extensionId, next);
    try {
      this.save();
    } catch (error) {
      this.installed.set(extensionId, current);
      throw error;
    }
    if (disabled && this.active?.extensionId === extensionId) this.hide();
  }

  setUpdatesPinned(extensionId: string, pinned: boolean): void {
    this.assertNotDeleting(extensionId);
    const current = this.requireInstalled(extensionId);
    if (current.source !== "exchange") throw new Error("Only Exchange extensions can pin updates.");
    if (Boolean(current.updatesPinned) === pinned) return;
    const { updatesPinned: _updatesPinned, ...unpinned } = current;
    this.installed.set(extensionId, pinned ? { ...current, updatesPinned: true } : unpinned);
    try {
      this.save();
    } catch (error) {
      this.installed.set(extensionId, current);
      throw error;
    }
  }

  addProfile(
    extensionId: string,
    id: string,
    label: string,
    scope: "shared" | "project" = "shared",
  ): void {
    this.assertNotDeleting(extensionId);
    const current = this.requireInstalled(extensionId);
    if (!PROFILE_ID.test(id) || !label.trim() || label.length > 80) {
      throw new Error("Invalid profile name.");
    }
    if (this.profileExists(current, id)) throw new Error("Profile already exists.");
    if (scope !== "shared" && scope !== "project") throw new Error("Invalid profile scope.");
    this.installed.set(extensionId, {
      ...current,
      profiles: [...current.profiles, { id, label: label.trim(), scope }],
    });
    this.save();
  }

  async activate(input: DesktopExtensionViewInput): Promise<void> {
    this.assertNotDeleting(input.extensionId);
    const installed = this.requireInstalled(input.extensionId);
    if (installed.revoked) throw new Error("This extension version has been revoked.");
    if (installed.disabled) throw new Error("This extension is disabled.");
    if (!isExtensionEnabledForProject(installed.assignment, input.projectId)) {
      throw new Error("Extension is not enabled for this project.");
    }
    if (extensionProfileForProject(installed.assignment, input.projectId) !== input.profileId) {
      throw new Error("Extension profile assignment mismatch.");
    }
    const profile = this.requireProfile(installed, input.profileId);
    const tool = installed.manifest.contributes.tools.find((item) => item.id === input.toolId);
    if (!tool) throw new Error("Unknown extension tool.");
    const key = [input.projectId, input.extensionId, input.toolId, input.profileId].join(":");
    if (this.active?.key === key) {
      this.coordinator.attachToolView(this.active.view);
      return;
    }
    this.hide();
    try {
      await this.activateView(installed, input, profile.scope, tool.entry, key);
      this.finishPendingUpdate(installed);
    } catch (error) {
      this.hide();
      if (installed.pendingRollback) {
        this.rollbackPendingUpdate(installed);
        throw new Error("Exchange update failed to activate and was rolled back.", {
          cause: error,
        });
      }
      throw error;
    }
  }

  private async activateView(
    installed: StoredExtension,
    input: DesktopExtensionViewInput,
    scope: "shared" | "project" | undefined,
    entry: string,
    key: string,
  ): Promise<void> {
    this.resolveAsset(installed.directory, entry);
    const partition = extensionSessionPartition(
      input.extensionId,
      input.profileId,
      scope,
      input.projectId,
      installed.registryOrigin,
      installed.source,
    );
    if (!installed.usedPartitions?.includes(partition)) {
      const known = installed.usedPartitions ?? [];
      if (known.length >= MAX_PARTITIONS) {
        throw new Error("Extension has used too many browser partitions.");
      }
      this.installed.set(installed.id, {
        ...installed,
        usedPartitions: [...known, partition],
      });
      try {
        this.save();
      } catch (error) {
        this.installed.set(installed.id, installed);
        throw error;
      }
    }
    const extensionSession = session.fromPartition(partition);
    this.configureSession(extensionSession, partition, installed);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        preload: Path.join(__dirname, "extensionPreload.js"),
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    this.active = {
      key,
      view,
      projectId: input.projectId,
      extensionId: input.extensionId,
      profileId: input.profileId,
    };
    this.coordinator.attachToolView(view);
    await view.webContents.loadURL(
      `${SCHEME}://${installed.id}/${entry}?project=${encodeURIComponent(input.projectId)}&profile=${encodeURIComponent(input.profileId)}`,
    );
  }

  private finishPendingUpdate(installed: StoredExtension): void {
    if (!installed.pendingRollback) return;
    const current = this.requireInstalled(installed.id);
    if (current.digest !== installed.digest)
      throw new Error("Extension changed during activation.");
    const { pendingRollback: _pendingRollback, ...stable } = current;
    this.installed.set(installed.id, stable);
    try {
      this.save();
    } catch (error) {
      this.installed.set(installed.id, current);
      throw error;
    }
  }

  private rollbackPendingUpdate(installed: StoredExtension): void {
    const previous = installed.pendingRollback;
    if (!previous) return;
    const current = this.requireInstalled(installed.id);
    if (current.digest !== installed.digest) throw new Error("Extension changed during rollback.");
    const packageRoot = FS.realpathSync(
      Path.join(Path.dirname(this.statePath), "extension-packages"),
    );
    if (!this.validPendingRollback(current, packageRoot)) {
      const { pendingRollback: _pendingRollback, ...rest } = current;
      this.installed.set(installed.id, { ...rest, disabled: true });
      try {
        this.save();
      } catch (error) {
        this.installed.set(installed.id, current);
        throw error;
      }
      throw new Error("Previous Exchange package is unavailable; extension was disabled.");
    }
    const { pendingRollback: _pendingRollback, ...rest } = current;
    const restored: StoredExtension = {
      ...rest,
      manifest: previous.manifest,
      assignment: previous.assignment,
      digest: previous.digest,
      directory: previous.directory,
    };
    this.installed.set(installed.id, restored);
    try {
      this.save();
    } catch (error) {
      this.installed.set(installed.id, current);
      throw error;
    }
  }

  setBounds(input: DesktopExtensionBoundsInput): void {
    const key = [input.projectId, input.extensionId, input.toolId, input.profileId].join(":");
    if (this.active?.key !== key) return;
    const { view } = this.active;
    if (!input.visible) {
      this.coordinator.detachToolView(view);
      return;
    }
    if (![input.x, input.y, input.width, input.height].every(Number.isFinite)) return;
    this.coordinator.attachToolView(view);
    view.setBounds({
      x: Math.max(0, Math.round(input.x)),
      y: Math.max(0, Math.round(input.y)),
      width: Math.max(0, Math.round(input.width)),
      height: Math.max(0, Math.round(input.height)),
    });
  }

  hide(): void {
    if (!this.active) return;
    for (const request of this.networkRequests) {
      if (request.extensionId === this.active.extensionId) request.controller.abort();
    }
    for (const request of this.logicRequests) {
      if (request.extensionId === this.active.extensionId) request.controller.abort();
    }
    this.coordinator.detachToolView(this.active.view);
    this.active.view.webContents.close();
    this.active = null;
  }

  private configureSession(
    extensionSession: Session,
    partition: string,
    installed: StoredExtension,
  ): void {
    if (this.configuredSessions.has(partition)) return;
    const allowedHost = installed.id;
    extensionSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    extensionSession.setPermissionCheckHandler(() => false);
    extensionSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      try {
        const url = new URL(details.url);
        callback({ cancel: url.protocol !== `${SCHEME}:` || url.hostname !== allowedHost });
      } catch {
        callback({ cancel: true });
      }
    });
    extensionSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
          ],
        },
      });
    });
    extensionSession.protocol.registerFileProtocol(SCHEME, (request, callback) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== allowedHost) throw new Error("Extension origin mismatch.");
        const current = this.requireInstalled(allowedHost);
        callback({
          path: this.resolveAsset(current.directory, decodeURIComponent(url.pathname.slice(1))),
        });
      } catch {
        callback({ error: -6 });
      }
    });
    this.configuredSessions.add(partition);
  }

  private resolveAsset(root: string, relative: string): string {
    if (
      !relative ||
      relative.startsWith("/") ||
      relative.includes("\\") ||
      relative.includes("\0")
    ) {
      throw new Error("Invalid extension asset path.");
    }
    const pieces = relative.split("/");
    if (pieces.some((piece) => !piece || piece === "." || piece === "..")) {
      throw new Error("Invalid extension asset path.");
    }
    const path = FS.realpathSync(Path.join(root, ...pieces));
    const canonicalRoot = FS.realpathSync(root);
    if (!path.startsWith(`${canonicalRoot}${Path.sep}`) || !FS.statSync(path).isFile()) {
      throw new Error("Extension asset escapes its package.");
    }
    return path;
  }

  private publicEntry(stored: StoredExtension): DesktopInstalledExtension {
    const {
      directory: _directory,
      dataInventoryVersion: _dataInventoryVersion,
      usedPartitions: _usedPartitions,
      pendingRollback: _pendingRollback,
      ...entry
    } = stored;
    return { ...entry, dataDeletionAvailable: this.canDeleteData(stored) };
  }

  private canDeleteData(entry: StoredExtension): boolean {
    return (
      entry.dataInventoryVersion === 1 &&
      !this.storage.hasLegacyFiles() &&
      this.validPartitionInventory(entry, entry.id, entry.source, entry.registryOrigin)
    );
  }

  private assertNotDeleting(extensionId: string): void {
    if (this.deleting.has(extensionId)) throw new Error("Extension data deletion is in progress.");
  }

  private assertInstallEpoch(extensionId: string, expectedEpoch: number, extracted?: string): void {
    if (expectedEpoch === this.deletionEpoch && !this.deleting.has(extensionId)) return;
    if (extracted && FS.existsSync(extracted) && !FS.lstatSync(extracted).isSymbolicLink()) {
      FS.rmSync(extracted, { recursive: true, force: true });
    }
    throw new Error("Extension data changed during package install; retry the install.");
  }

  private requireInstalled(id: string): StoredExtension {
    const installed = this.installed.get(id);
    if (!installed) throw new Error("Extension is not installed.");
    return installed;
  }

  private dataInventoryFields(
    previous: StoredExtension | undefined,
    retained: RetainedProfiles | null,
  ): Pick<StoredExtension, "dataInventoryVersion" | "usedPartitions"> {
    const existing = previous ?? retained;
    return {
      usedPartitions: existing?.usedPartitions ?? [],
      ...(existing
        ? existing.dataInventoryVersion === 1
          ? { dataInventoryVersion: 1 as const }
          : {}
        : this.storage.hasLegacyFiles()
          ? {}
          : { dataInventoryVersion: 1 as const }),
    };
  }

  private retainedProfilesPath(
    id: string,
    source: DesktopInstalledExtension["source"],
    registryOrigin?: string,
  ): string {
    const hash = Crypto.createHash("sha256")
      .update(retainedProfilesIdentity(id, source, registryOrigin))
      .digest("hex");
    return Path.join(Path.dirname(this.statePath), "retained-extension-profiles", `${hash}.json`);
  }

  private readRetainedRecord(
    id: string,
    source: DesktopInstalledExtension["source"],
    registryOrigin?: string,
  ): RetainedProfiles | null {
    try {
      const path = this.retainedProfilesPath(id, source, registryOrigin);
      const stat = FS.lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return null;
      const value = JSON.parse(FS.readFileSync(path, "utf8")) as RetainedProfiles;
      if (
        value.id !== id ||
        value.source !== source ||
        value.registryOrigin !== registryOrigin ||
        !Array.isArray(value.profiles) ||
        value.profiles.length === 0 ||
        value.profiles.length > 100 ||
        new Set(value.profiles.map((profile) => profile.id)).size !== value.profiles.length ||
        value.profiles.some(
          (profile) =>
            !PROFILE_ID.test(profile.id) ||
            !profile.label.trim() ||
            profile.label.length > 80 ||
            (profile.scope !== undefined &&
              profile.scope !== "shared" &&
              profile.scope !== "project"),
        ) ||
        !this.validPartitionInventory(value, id, source, registryOrigin)
      ) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  private writeRetainedProfiles(entry: StoredExtension): void {
    const path = this.retainedProfilesPath(entry.id, entry.source, entry.registryOrigin);
    FS.mkdirSync(Path.dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${Crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      FS.writeFileSync(
        temporary,
        JSON.stringify({
          id: entry.id,
          source: entry.source,
          registryOrigin: entry.registryOrigin,
          profiles: entry.profiles,
          dataInventoryVersion: entry.dataInventoryVersion,
          usedPartitions: entry.usedPartitions,
        }),
        { flag: "wx", mode: 0o600 },
      );
      FS.renameSync(temporary, path);
    } finally {
      if (FS.existsSync(temporary)) FS.unlinkSync(temporary);
    }
  }

  private validPartitionInventory(
    value: Pick<StoredExtension, "dataInventoryVersion" | "usedPartitions">,
    id: string,
    source: DesktopInstalledExtension["source"],
    registryOrigin?: string,
  ): boolean {
    if (value.dataInventoryVersion !== undefined && value.dataInventoryVersion !== 1) return false;
    if (value.usedPartitions === undefined) return value.dataInventoryVersion !== 1;
    if (!Array.isArray(value.usedPartitions) || value.usedPartitions.length > MAX_PARTITIONS) {
      return false;
    }
    const prefix = `persist:tabs-extension:${extensionDataIdentity(id, registryOrigin, source)}:`;
    return (
      new Set(value.usedPartitions).size === value.usedPartitions.length &&
      value.usedPartitions.every(
        (partition) =>
          typeof partition === "string" &&
          partition.startsWith(prefix) &&
          partition.length <= prefix.length + 130 &&
          /^[a-z0-9:.-]+$/.test(partition),
      )
    );
  }

  private profileExists(extension: StoredExtension, profileId: string): boolean {
    return extension.profiles.some((profile) => profile.id === profileId);
  }

  private requireProfile(extension: StoredExtension, profileId: string) {
    const profile = extension.profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error("Unknown extension profile.");
    return profile;
  }

  private load(): void {
    try {
      const entries = JSON.parse(FS.readFileSync(this.statePath, "utf8")) as StoredExtension[];
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        try {
          if (!entry || typeof entry.directory !== "string") continue;
          let safeEntry = entry;
          if (
            entry.source !== "exchange" &&
            (!this.allowDevelopment ||
              (entry.source !== "development" && entry.source !== "local-package"))
          )
            continue;
          if (entry.revoked !== undefined && entry.revoked !== true) continue;
          if (entry.disabled !== undefined && entry.disabled !== true) continue;
          if (entry.updatesPinned !== undefined && entry.updatesPinned !== true) continue;
          if (!this.validPartitionInventory(entry, entry.id, entry.source, entry.registryOrigin)) {
            continue;
          }
          const result = validateTabsExtensionManifest(entry.manifest, this.tabsVersion);
          if (!result.ok || result.id !== entry.id || !Array.isArray(entry.profiles)) continue;
          if (
            entry.profiles.length === 0 ||
            new Set(entry.profiles.map((profile) => profile?.id)).size !== entry.profiles.length ||
            entry.profiles.some(
              (profile) =>
                !profile ||
                typeof profile.id !== "string" ||
                !PROFILE_ID.test(profile.id) ||
                typeof profile.label !== "string" ||
                !profile.label.trim() ||
                profile.label.length > 80 ||
                (profile.scope !== undefined &&
                  profile.scope !== "shared" &&
                  profile.scope !== "project"),
            )
          ) {
            continue;
          }
          if (!FS.existsSync(entry.directory)) continue;
          inspectDirectory(entry.directory);
          const diskManifest = JSON.parse(
            FS.readFileSync(Path.join(entry.directory, "tabs-extension.json"), "utf8"),
          );
          const diskResult = validateTabsExtensionManifest(diskManifest, this.tabsVersion);
          if (!diskResult.ok || diskResult.id !== entry.id) continue;
          if (JSON.stringify(diskResult.manifest) !== JSON.stringify(entry.manifest)) continue;
          if (entry.source === "local-package" || entry.source === "exchange") {
            if (entry.source === "exchange") {
              if (typeof entry.registryOrigin !== "string") continue;
              const origin = new URL(entry.registryOrigin);
              if (origin.origin !== entry.registryOrigin || origin.protocol !== "https:") continue;
            }
            if (!entry.digest || !/^[a-f0-9]{64}$/.test(entry.digest)) continue;
            const expected = Path.join(
              Path.dirname(this.statePath),
              "extension-packages",
              entry.id,
              entry.digest,
            );
            if (Path.resolve(entry.directory) !== expected) continue;
            if (FS.lstatSync(entry.directory).isSymbolicLink()) continue;
            if (FS.lstatSync(Path.dirname(entry.directory)).isSymbolicLink()) continue;
            const packageRoot = FS.realpathSync(
              Path.join(Path.dirname(this.statePath), "extension-packages"),
            );
            if (!FS.realpathSync(entry.directory).startsWith(`${packageRoot}${Path.sep}`)) {
              continue;
            }
            if (entry.pendingRollback && !this.validPendingRollback(entry, packageRoot)) {
              const { pendingRollback: _pendingRollback, ...withoutRollback } = entry;
              safeEntry = { ...withoutRollback, disabled: true };
            }
          } else if (entry.pendingRollback) {
            continue;
          }
          const assignment = Schema.decodeUnknownSync(TabsExtensionAssignment)(entry.assignment);
          if (
            assignment.extensionId !== entry.id ||
            !this.profileExists(entry, assignment.defaultProfileId)
          )
            continue;
          this.installed.set(entry.id, { ...safeEntry, assignment });
        } catch {
          // A damaged entry must not prevent other development tools from loading.
        }
      }
    } catch {
      // An absent or invalid local development index must not prevent Tabs from starting.
    }
  }

  private validPendingRollback(entry: StoredExtension, packageRoot: string): boolean {
    const previous = entry.pendingRollback;
    if (!previous || entry.source !== "exchange" || !entry.digest) return false;
    try {
      if (!/^[a-f0-9]{64}$/.test(previous.digest) || previous.digest === entry.digest) return false;
      const parsed = validateTabsExtensionManifest(previous.manifest, this.tabsVersion);
      if (
        !parsed.ok ||
        parsed.id !== entry.id ||
        compareSemverVersions(previous.manifest.version, entry.manifest.version) >= 0
      )
        return false;
      const expected = Path.join(
        Path.dirname(this.statePath),
        "extension-packages",
        entry.id,
        previous.digest,
      );
      if (
        Path.resolve(previous.directory) !== expected ||
        FS.lstatSync(previous.directory).isSymbolicLink() ||
        FS.lstatSync(Path.dirname(previous.directory)).isSymbolicLink() ||
        !FS.realpathSync(previous.directory).startsWith(`${packageRoot}${Path.sep}`)
      )
        return false;
      inspectDirectory(previous.directory);
      const disk = JSON.parse(
        FS.readFileSync(Path.join(previous.directory, "tabs-extension.json"), "utf8"),
      );
      if (JSON.stringify(disk) !== JSON.stringify(previous.manifest)) return false;
      const assignment = Schema.decodeUnknownSync(TabsExtensionAssignment)(previous.assignment);
      return (
        assignment.extensionId === entry.id &&
        this.profileExists(entry, assignment.defaultProfileId) &&
        Object.values(assignment.profileIdByProjectId).every((id) => this.profileExists(entry, id))
      );
    } catch {
      return false;
    }
  }

  private save(): void {
    FS.mkdirSync(Path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    FS.writeFileSync(temporary, JSON.stringify([...this.installed.values()]));
    FS.renameSync(temporary, this.statePath);
  }
}

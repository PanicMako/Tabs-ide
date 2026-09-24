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
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import {
  extensionProfileForProject,
  isExtensionEnabledForProject,
  validateTabsExtensionManifest,
} from "@tabs/shared/extensions";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";
import { ExtensionStorage, type ExtensionStorageOperation } from "./extensionStorage";

const SCHEME = "tabs-extension";
const MAX_FILES = 1_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PROFILE_ID = /^[a-z][a-z0-9-]{0,62}$/;

interface StoredExtension extends DesktopInstalledExtension {
  readonly directory: string;
}

interface ActiveView {
  readonly key: string;
  readonly view: WebContentsView;
  readonly projectId: string;
  readonly extensionId: string;
  readonly profileId: string;
}

export function extensionSessionPartition(
  extensionId: string,
  profileId: string,
  scope: "shared" | "project" | undefined,
  projectId: string,
): string {
  const projectSuffix =
    scope === "project" ? `:${Crypto.createHash("sha256").update(projectId).digest("hex")}` : "";
  return `persist:tabs-extension:${extensionId}:${profileId}${projectSuffix}`;
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
  private readonly configuredSessions = new Set<string>();
  private active: ActiveView | null = null;
  private readonly storage: ExtensionStorage;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly coordinator: NativeViewStackCoordinator,
    private readonly statePath: string,
    private readonly tabsVersion: string,
    private readonly allowDevelopment: boolean,
  ) {
    this.storage = new ExtensionStorage(Path.join(Path.dirname(statePath), "extension-storage"));
    this.load();
  }

  invokeStorage(sender: Electron.WebContents, operation: ExtensionStorageOperation): unknown {
    const active = this.active;
    if (!active || active.view.webContents !== sender || sender.isDestroyed()) {
      throw new Error("Extension view is no longer active.");
    }
    const installed = this.requireInstalled(active.extensionId);
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
        extensionId: active.extensionId,
        profileId: active.profileId,
        ...(profile.scope === "project" ? { projectId: active.projectId } : {}),
      },
      operation,
    );
  }

  list(): DesktopInstalledExtension[] {
    return [...this.installed.values()].map(
      ({ directory: _directory, ...publicEntry }) => publicEntry,
    );
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
    for (const tool of parsed.manifest.contributes.tools) {
      this.resolveAsset(root, tool.entry);
      if (tool.icon) this.resolveAsset(root, tool.icon);
    }
    const previous = this.installed.get(parsed.id);
    const assignment: TabsExtensionAssignment = previous?.assignment ?? {
      extensionId: parsed.id,
      enabledGlobally: false,
      enabledProjectIds: [],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {},
    };
    const safeAssignment =
      parsed.manifest.capabilities?.includes("profile-storage") &&
      !previous?.manifest.capabilities?.includes("profile-storage")
        ? { ...assignment, storageGrantedProjectIds: [] }
        : assignment;
    const next: StoredExtension = {
      id: parsed.id,
      manifest: parsed.manifest,
      assignment: safeAssignment,
      profiles: previous?.profiles ?? [{ id: "default", label: "Default" }],
      source: "development",
      directory: root,
    };
    this.installed.set(parsed.id, next);
    this.hide();
    this.save();
    return this.publicEntry(next);
  }

  async installLocalPackage(archive: string): Promise<DesktopInstalledExtension> {
    if (!this.allowDevelopment)
      throw new Error("Local extension packages are disabled in this build.");
    if (!Path.isAbsolute(archive) || !archive.endsWith(".tabsext")) {
      throw new Error("Select an absolute .tabsext archive.");
    }
    const inspected = await inspectTabsext(archive, this.tabsVersion);
    const packagesRoot = Path.join(Path.dirname(this.statePath), "extension-packages");
    const directory = Path.join(packagesRoot, inspected.id, inspected.digest);
    const previous = this.installed.get(inspected.id);
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
    const assignment = previous?.assignment ?? {
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
      assignment:
        inspected.manifest.capabilities?.includes("profile-storage") &&
        !previous?.manifest.capabilities?.includes("profile-storage")
          ? { ...assignment, storageGrantedProjectIds: [] }
          : assignment,
      profiles: previous?.profiles ?? [{ id: "default", label: "Default" }],
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

  setAssignment(extensionId: string, assignment: TabsExtensionAssignment): void {
    const current = this.requireInstalled(extensionId);
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

  addProfile(
    extensionId: string,
    id: string,
    label: string,
    scope: "shared" | "project" = "shared",
  ): void {
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
    const installed = this.requireInstalled(input.extensionId);
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
    this.resolveAsset(installed.directory, tool.entry);
    const partition = extensionSessionPartition(
      input.extensionId,
      input.profileId,
      profile.scope,
      input.projectId,
    );
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
    try {
      await view.webContents.loadURL(
        `${SCHEME}://${installed.id}/${tool.entry}?project=${encodeURIComponent(input.projectId)}&profile=${encodeURIComponent(input.profileId)}`,
      );
    } catch (error) {
      this.hide();
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
    if (!path.startsWith(`${root}${Path.sep}`) || !FS.statSync(path).isFile()) {
      throw new Error("Extension asset escapes its package.");
    }
    return path;
  }

  private publicEntry({
    directory: _directory,
    ...entry
  }: StoredExtension): DesktopInstalledExtension {
    return entry;
  }

  private requireInstalled(id: string): StoredExtension {
    const installed = this.installed.get(id);
    if (!installed) throw new Error("Extension is not installed.");
    return installed;
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
    if (!this.allowDevelopment) return;
    try {
      const entries = JSON.parse(FS.readFileSync(this.statePath, "utf8")) as StoredExtension[];
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        try {
          if (!entry || typeof entry.directory !== "string") continue;
          if (entry.source !== "development" && entry.source !== "local-package") continue;
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
          if (entry.source === "local-package") {
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
          }
          const assignment = Schema.decodeUnknownSync(TabsExtensionAssignment)(entry.assignment);
          if (
            assignment.extensionId !== entry.id ||
            !this.profileExists(entry, assignment.defaultProfileId)
          )
            continue;
          this.installed.set(entry.id, { ...entry, assignment });
        } catch {
          // A damaged entry must not prevent other development tools from loading.
        }
      }
    } catch {
      // An absent or invalid local development index must not prevent Tabs from starting.
    }
  }

  private save(): void {
    FS.mkdirSync(Path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    FS.writeFileSync(temporary, JSON.stringify([...this.installed.values()]));
    FS.renameSync(temporary, this.statePath);
  }
}

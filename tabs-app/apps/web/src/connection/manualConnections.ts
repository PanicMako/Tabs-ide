import {
  bootstrapRemoteBearerSession,
  resolveRemoteWebSocketConnectionUrl,
} from "@tabs/client-runtime/authorization";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  RelayConnectionRegistration,
  RelayConnectionTarget,
  SshConnectionProfile,
  SshConnectionRegistration,
  SshConnectionTarget,
} from "@tabs/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@tabs/client-runtime/environment";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
} from "@tabs/client-runtime/platform";
import {
  AuthStandardClientScopes,
  type DesktopSshEnvironmentTarget,
  type EnvironmentId,
} from "@tabs/contracts";
import { resolveRemotePairingTarget } from "@tabs/shared/remote";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/unstable/http";

const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeUnknownSync(CatalogJson);
const encodeCatalog = Schema.encodeSync(CatalogJson);
const WEB_CONNECTION_CATALOG_KEY = "tabs:connection-catalog";

export interface SavedManualConnection {
  readonly environmentId: string;
  readonly label: string;
  readonly kind: "remote" | "ssh" | "relay";
}

async function readCatalog() {
  const raw = window.desktopBridge?.getConnectionCatalog
    ? await window.desktopBridge.getConnectionCatalog()
    : localStorage.getItem(WEB_CONNECTION_CATALOG_KEY);
  if (!raw) return EMPTY_CONNECTION_CATALOG_DOCUMENT;
  try {
    return decodeCatalog(raw);
  } catch {
    return EMPTY_CONNECTION_CATALOG_DOCUMENT;
  }
}

async function writeCatalog(catalog: typeof ConnectionCatalogDocument.Type) {
  const encoded = encodeCatalog(catalog);
  if (window.desktopBridge?.setConnectionCatalog) {
    const stored = await window.desktopBridge.setConnectionCatalog(encoded);
    if (stored !== true) throw new Error("Desktop connection storage is unavailable.");
    return;
  }
  localStorage.setItem(WEB_CONNECTION_CATALOG_KEY, encoded);
}

export async function removeRelayConnections(): Promise<void> {
  const catalog = await readCatalog();
  const next = catalog.targets
    .filter((target) => target._tag === "RelayConnectionTarget")
    .reduce((current, target) => removeConnectionFromCatalog(current, target), catalog);
  if (next !== catalog) await writeCatalog(next);
}

export async function listManualConnections(): Promise<readonly SavedManualConnection[]> {
  const catalog = await readCatalog();
  return catalog.targets.map((target) => ({
    environmentId: target.environmentId,
    label: target.label,
    kind:
      target._tag === "SshConnectionTarget"
        ? "ssh"
        : target._tag === "RelayConnectionTarget"
          ? "relay"
          : "remote",
  }));
}

export async function registerManualRemote(input: { host: string; pairingCode: string }) {
  const target = resolveRemotePairingTarget(input);
  const descriptor = await Effect.runPromise(
    fetchRemoteEnvironmentDescriptor({ httpBaseUrl: target.httpBaseUrl }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );
  const access = await Effect.runPromise(
    bootstrapRemoteBearerSession({
      httpBaseUrl: target.httpBaseUrl,
      credential: target.credential,
      scopes: AuthStandardClientScopes,
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const connectionId = `bearer:${descriptor.environmentId}`;
  const registration = new BearerConnectionRegistration({
    target: new BearerConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      connectionId,
    }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: target.httpBaseUrl,
      wsBaseUrl: target.wsBaseUrl,
    }),
    credential: new BearerConnectionCredential({ token: access.access_token }),
  });
  await writeCatalog(registerConnectionInCatalog(await readCatalog(), registration));
  return descriptor.environmentId;
}

export async function registerManualSsh(target: DesktopSshEnvironmentTarget) {
  const bridge = window.desktopBridge;
  if (!bridge) throw new Error("SSH environments are only available in the desktop app.");
  const bootstrap = await bridge.ensureSshEnvironment(target, { issuePairingToken: true });
  if (!bootstrap.pairingToken)
    throw new Error("The SSH environment did not issue a pairing token.");
  const descriptor = await bridge.fetchSshEnvironmentDescriptor(bootstrap.httpBaseUrl);
  await bridge.bootstrapSshBearerSession(bootstrap.httpBaseUrl, bootstrap.pairingToken);
  const connectionId = `ssh:${descriptor.environmentId}`;
  const registration = new SshConnectionRegistration({
    target: new SshConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      connectionId,
    }),
    profile: new SshConnectionProfile({
      connectionId,
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      target: bootstrap.target,
    }),
  });
  await writeCatalog(registerConnectionInCatalog(await readCatalog(), registration));
  return descriptor.environmentId;
}

export async function registerRelayConnection(input: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}): Promise<void> {
  await writeCatalog(
    registerConnectionInCatalog(
      await readCatalog(),
      new RelayConnectionRegistration({
        target: new RelayConnectionTarget(input),
      }),
    ),
  );
}

export async function removeManualConnection(environmentId: string) {
  const catalog = await readCatalog();
  const target = catalog.targets.find((entry) => entry.environmentId === environmentId);
  if (!target) return;
  if (target._tag === "SshConnectionTarget") {
    const profile = catalog.profiles.find(
      (entry) =>
        entry._tag === "SshConnectionProfile" && entry.connectionId === target.connectionId,
    );
    if (profile?._tag === "SshConnectionProfile") {
      await window.desktopBridge?.disconnectSshEnvironment(profile.target).catch(() => undefined);
    }
  }
  await writeCatalog(removeConnectionFromCatalog(catalog, target));
}

export async function resolveManualConnectionSocketUrl(environmentId: string): Promise<string> {
  const catalog = await readCatalog();
  const target = catalog.targets.find((entry) => entry.environmentId === environmentId);
  if (!target) throw new Error("The saved environment no longer exists.");

  let socketUrl: string;
  if (target._tag === "BearerConnectionTarget") {
    const profile = catalog.profiles.find(
      (entry) =>
        entry._tag === "BearerConnectionProfile" && entry.connectionId === target.connectionId,
    );
    const credential = catalog.credentials.find(
      (entry) => entry.connectionId === target.connectionId,
    );
    if (
      profile?._tag !== "BearerConnectionProfile" ||
      credential?.credential._tag !== "BearerConnectionCredential"
    ) {
      throw new Error("This environment's saved connection details are incomplete.");
    }
    socketUrl = await Effect.runPromise(
      resolveRemoteWebSocketConnectionUrl({
        httpBaseUrl: profile.httpBaseUrl,
        wsBaseUrl: profile.wsBaseUrl,
        bearerToken: credential.credential.token,
        connectionMethod: "direct",
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    );
  } else if (target._tag === "SshConnectionTarget") {
    const profile = catalog.profiles.find(
      (entry) =>
        entry._tag === "SshConnectionProfile" && entry.connectionId === target.connectionId,
    );
    if (profile?._tag !== "SshConnectionProfile") {
      throw new Error("This SSH environment's saved connection details are incomplete.");
    }
    const bridge = window.desktopBridge;
    if (!bridge) throw new Error("SSH environments are only available in the desktop app.");
    const bootstrap = await bridge.ensureSshEnvironment(profile.target, {
      issuePairingToken: true,
    });
    if (!bootstrap.pairingToken)
      throw new Error("The SSH environment did not issue a pairing token.");
    const access = await bridge.bootstrapSshBearerSession(
      bootstrap.httpBaseUrl,
      bootstrap.pairingToken,
    );
    socketUrl = await Effect.runPromise(
      resolveRemoteWebSocketConnectionUrl({
        httpBaseUrl: bootstrap.httpBaseUrl,
        wsBaseUrl: bootstrap.wsBaseUrl,
        bearerToken: access.access_token,
        connectionMethod: "ssh",
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    );
  } else {
    const { resolveRelayConnectionSocketUrl } = await import("~/cloud/runtime");
    socketUrl = await resolveRelayConnectionSocketUrl(target.environmentId);
  }

  return socketUrl;
}

export async function connectManualConnection(environmentId: string): Promise<never> {
  const socketUrl = await resolveManualConnectionSocketUrl(environmentId);
  const destination = new URL(window.location.href);
  destination.searchParams.set("tabsWsUrl", socketUrl);
  destination.searchParams.set("tabsEnvironmentId", environmentId);
  window.location.assign(destination);
  return await new Promise<never>(() => undefined);
}

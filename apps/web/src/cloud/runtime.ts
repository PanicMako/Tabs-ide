import { remoteHttpClientLayer } from "@tabs/client-runtime/rpc";
import {
  RemoteEnvironmentAuthorization,
  remoteEnvironmentAuthorizationLayer,
  TokenStore,
} from "@tabs/client-runtime/authorization";
import { ConnectionBlockedError, mapManagedRelayError } from "@tabs/client-runtime/connection";
import * as ClientCapabilities from "@tabs/client-runtime/platform";
import { ManagedRelay, managedRelaySessionAtom } from "@tabs/client-runtime/relay";
import { AuthStandardClientScopes, type EnvironmentId } from "@tabs/contracts";
import {
  RelayEnvironmentConnectScope,
  RelayEnvironmentStatusScope,
  type RelayClientEnvironmentRecord,
  type RelayEnvironmentStatusResponse,
} from "@tabs/contracts/relay";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { browserCryptoLayer } from "./dpop";
import { managedRelayClientLayer } from "./managedRelayLayer";
import { resolveCloudPublicConfig } from "./publicConfig";
import { clientPresentationMetadata } from "~/connection/clientMetadata";
import { appAtomRegistry } from "~/state/atomRegistry";

const httpLayer = remoteHttpClientLayer((input, init) => globalThis.fetch(input, init));
const relayUrl = resolveCloudPublicConfig().relayUrl ?? "http://relay.invalid";
const tokenCache = new Map<string, TokenStore.RemoteDpopAccessToken>();
const tokenStoreLayer = TokenStore.layer({
  get: (environmentId) => Effect.succeed(Option.fromNullishOr(tokenCache.get(environmentId))),
  put: (token) =>
    Effect.sync(() => {
      tokenCache.set(token.environmentId, token);
    }),
  remove: (environmentId) =>
    Effect.sync(() => {
      tokenCache.delete(environmentId);
    }),
});
const presentationLayer = Layer.succeed(
  ClientCapabilities.ClientPresentation,
  ClientCapabilities.ClientPresentation.of({
    metadata: clientPresentationMetadata({
      appVersion: import.meta.env.APP_VERSION ?? "0.0.0",
      hosted: window.location.protocol === "https:",
      identity: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
      },
      desktopBridge: window.desktopBridge,
    }),
    scopes: AuthStandardClientScopes,
  }),
);
const relayLayer = managedRelayClientLayer(relayUrl).pipe(Layer.provide(httpLayer));
const remoteAuthorizationLayer = remoteEnvironmentAuthorizationLayer.pipe(
  Layer.provideMerge(relayLayer),
  Layer.provideMerge(tokenStoreLayer),
  Layer.provideMerge(presentationLayer),
  Layer.provideMerge(httpLayer),
);
const layer = Layer.mergeAll(httpLayer, browserCryptoLayer, relayLayer, remoteAuthorizationLayer);

export const managedRelayRuntime = ManagedRuntime.make(layer);

async function requireSessionToken(): Promise<string> {
  const session = appAtomRegistry.get(managedRelaySessionAtom);
  if (!session) throw new Error("Sign in to Tabs Connect first.");
  const token = await Effect.runPromise(session.readClerkToken());
  if (!token) throw new Error("The Tabs Connect session token is unavailable.");
  return token;
}

export async function listManagedRelayEnvironments(): Promise<
  ReadonlyArray<{
    readonly environment: RelayClientEnvironmentRecord;
    readonly status: RelayEnvironmentStatusResponse | null;
  }>
> {
  const clerkToken = await requireSessionToken();
  const environments = await managedRelayRuntime.runPromise(
    ManagedRelay.ManagedRelayClient.pipe(
      Effect.flatMap((client) => client.listEnvironments({ clerkToken })),
    ),
  );
  return Promise.all(
    environments.map(async (environment) => {
      const status = await managedRelayRuntime.runPromise(
        ManagedRelay.ManagedRelayClient.pipe(
          Effect.flatMap((client) =>
            client.getEnvironmentStatus({
              clerkToken,
              scopes: [RelayEnvironmentStatusScope, RelayEnvironmentConnectScope],
              environmentId: environment.environmentId,
            }),
          ),
          Effect.option,
        ),
      );
      return { environment, status: Option.getOrNull(status) };
    }),
  );
}

export async function deregisterManagedRelayEnvironment(
  environmentId: EnvironmentId,
): Promise<void> {
  const clerkToken = await requireSessionToken();
  await managedRelayRuntime.runPromise(
    ManagedRelay.ManagedRelayClient.pipe(
      Effect.flatMap((client) => client.unlinkEnvironment({ clerkToken, environmentId })),
    ),
  );
}

export async function resolveRelayConnectionSocketUrl(
  environmentId: EnvironmentId,
): Promise<string> {
  const session = appAtomRegistry.get(managedRelaySessionAtom);
  if (!session) throw new Error("Sign in to Tabs Connect before connecting this environment.");
  return managedRelayRuntime.runPromise(
    Effect.gen(function* () {
      const token = yield* session.readClerkToken();
      if (!token)
        return yield* new ConnectionBlockedError({
          reason: "authentication",
          detail: "The Tabs Connect session token is unavailable.",
        });
      const relay = yield* ManagedRelay.ManagedRelayClient;
      const remote = yield* RemoteEnvironmentAuthorization;
      const authorized = yield* remote.authorizeDpop({
        expectedEnvironmentId: environmentId,
        obtainBootstrap: relay
          .connectEnvironment({
            clerkToken: token,
            scopes: [RelayEnvironmentConnectScope],
            environmentId,
          })
          .pipe(Effect.mapError(mapManagedRelayError)),
      });
      return authorized.socketUrl;
    }),
  );
}

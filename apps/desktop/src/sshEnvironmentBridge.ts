import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
} from "@tabs/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@tabs/client-runtime/environment";
import type { DesktopSshEnvironmentTarget, DesktopSshPasswordPromptRequest } from "@tabs/contracts";
import { layer as netServiceLayer } from "@tabs/shared/Net";
import * as SshAuth from "@tabs/ssh/auth";
import { discoverSshHosts } from "@tabs/ssh/config";
import { SshPasswordPromptError } from "@tabs/ssh/errors";
import { resolveLoopbackSshHttpBaseUrl, SshEnvironmentManager } from "@tabs/ssh/tunnel";
import type { BrowserWindow } from "electron";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

export const SSH_PASSWORD_PROMPT_CHANNEL = "desktop:ssh-password-prompt";

interface PendingPrompt {
  readonly resolve: (password: string | null) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const pendingPrompts = new Map<string, PendingPrompt>();

const makePasswordPrompt = (
  getWindow: () => BrowserWindow | null,
): SshAuth.SshPasswordPrompt["Service"] => ({
  isAvailable: true,
  request: (input) =>
    Effect.tryPromise({
      try: () =>
        new Promise<string | null>((resolve, reject) => {
          const window = getWindow();
          if (!window || window.isDestroyed()) {
            reject(new Error("Tabs window is unavailable for SSH authentication."));
            return;
          }
          const requestId = crypto.randomUUID();
          const timeout = setTimeout(
            () => {
              pendingPrompts.delete(requestId);
              reject(new Error(`SSH authentication timed out for ${input.destination}.`));
            },
            3 * 60 * 1_000,
          );
          timeout.unref();
          pendingPrompts.set(requestId, {
            timeout,
            resolve: (password) => {
              clearTimeout(timeout);
              pendingPrompts.delete(requestId);
              resolve(password);
            },
          });
          const request: DesktopSshPasswordPromptRequest = {
            requestId,
            destination: input.destination,
            username: input.username,
            prompt: input.prompt,
            expiresAt: new Date(Date.now() + 3 * 60 * 1_000).toISOString(),
          };
          window.webContents.send(SSH_PASSWORD_PROMPT_CHANNEL, request);
          if (window.isMinimized()) window.restore();
          window.focus();
        }),
      catch: (cause) =>
        new SshPasswordPromptError({
          message: cause instanceof Error ? cause.message : "SSH authentication failed.",
          cause,
        }),
    }),
});

export function resolveSshPasswordPrompt(requestId: string, password: string | null): boolean {
  const pending = pendingPrompts.get(requestId.trim());
  if (!pending) return false;
  pending.resolve(password);
  return true;
}

export interface SshEnvironmentBridgeOptions {
  readonly getWindow: () => BrowserWindow | null;
  readonly cliPackageSpec: string;
}

export async function createSshEnvironmentBridge(options: SshEnvironmentBridgeOptions) {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const promptLayer = Layer.succeed(
    SshAuth.SshPasswordPrompt,
    SshAuth.SshPasswordPrompt.of(makePasswordPrompt(options.getWindow)),
  );
  const operationLayer = Layer.mergeAll(
    promptLayer,
    NodeServices.layer,
    NodeHttpClient.layerUndici,
    netServiceLayer,
  );
  const managerLayer = SshEnvironmentManager.layer({
    resolveCliPackageSpec: () => options.cliPackageSpec,
  }).pipe(Layer.provideMerge(operationLayer));
  const managerContext = await Effect.runPromise(
    Layer.build(managerLayer).pipe(Scope.provide(scope)),
  );
  const manager = await Effect.runPromise(
    Effect.service(SshEnvironmentManager).pipe(Effect.provide(managerContext)),
  );
  const runManager = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect.pipe(Effect.provide(operationLayer)) as Effect.Effect<A, E, never>);
  const runHttp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(NodeHttpClient.layerUndici)) as Effect.Effect<A, E, never>,
    );
  const loopback = (httpBaseUrl: string) =>
    Effect.runPromise(resolveLoopbackSshHttpBaseUrl(httpBaseUrl));

  return {
    discoverHosts: () =>
      Effect.runPromise(discoverSshHosts({}).pipe(Effect.provide(NodeServices.layer))),
    ensureEnvironment: (target: DesktopSshEnvironmentTarget, issuePairingToken = true) =>
      runManager(manager.ensureEnvironment(target, { issuePairingToken })),
    disconnectEnvironment: (target: DesktopSshEnvironmentTarget) =>
      runManager(manager.disconnectEnvironment(target)),
    fetchDescriptor: async (httpBaseUrl: string) =>
      runHttp(
        fetchRemoteEnvironmentDescriptor({
          httpBaseUrl: await loopback(httpBaseUrl),
        }),
      ),
    bootstrapBearerSession: async (httpBaseUrl: string, credential: string) =>
      runHttp(
        bootstrapRemoteBearerSession({
          httpBaseUrl: await loopback(httpBaseUrl),
          credential,
        }),
      ),
    fetchSessionState: async (httpBaseUrl: string, bearerToken: string) =>
      runHttp(
        fetchRemoteSessionState({
          httpBaseUrl: await loopback(httpBaseUrl),
          bearerToken,
        }),
      ),
    issueWebSocketTicket: async (httpBaseUrl: string, bearerToken: string) =>
      runHttp(
        issueRemoteWebSocketTicket({
          httpBaseUrl: await loopback(httpBaseUrl),
          bearerToken,
        }),
      ),
    close: async () => {
      for (const prompt of pendingPrompts.values()) prompt.resolve(null);
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}

export type SshEnvironmentBridge = Awaited<ReturnType<typeof createSshEnvironmentBridge>>;

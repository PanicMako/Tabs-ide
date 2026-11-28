import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { DeviceComparisonError } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import type { AgentDeviceGrant } from "./AgentDeviceControl.ts";
import { agentDeviceObject, managedAgentDeviceRpc } from "./AgentDeviceCommand.ts";
import {
  assertNoCoordinates,
  deviceRpcData,
  mutatingDeviceVerbs,
  needsDeviceSnapshot,
  privacySnapshotCommand,
  refreshDeviceReference,
  safeDeviceResult,
  safeDeviceSnapshot,
} from "./AgentDevicePrivacy.ts";
import type { AgentDeviceEndpoint } from "./DeviceHost.ts";
import { AGENT_DEVICE_VERSION } from "./DeviceToolchain.ts";

const MAX_RPC_BYTES = 1024 * 1024;
/** Mirrors the caps in DeviceSemanticDriver: input verbs are quick, launches and captures are slow. */
export const AGENT_DEVICE_INPUT_TIMEOUT_MS = 45_000;
export const AGENT_DEVICE_LONG_TIMEOUT_MS = 240_000;
const inputVerbs = new Set([
  "click",
  "press",
  "fill",
  "scroll",
  "swipe",
  "type",
  "longpress",
  "gesture",
  "back",
  "home",
  "app-switcher",
  "keyboard",
]);
export const agentDeviceTimeoutMs = (verb: string) =>
  inputVerbs.has(verb) ? AGENT_DEVICE_INPUT_TIMEOUT_MS : AGENT_DEVICE_LONG_TIMEOUT_MS;
const unavailable = () =>
  new DeviceComparisonError({ reason: "The selected device host did not complete the command." });

type Dispatch = <A>(
  grant: AgentDeviceGrant,
  operation: (
    endpoint: AgentDeviceEndpoint,
    canDispatch: () => boolean,
  ) => Effect.Effect<A, DeviceComparisonError>,
  usesSession: boolean,
) => Effect.Effect<A, DeviceComparisonError>;

const json = (response: ServerResponse, payload: unknown, status = 200) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
};

const rpcError = (response: ServerResponse, id: unknown, message: string) =>
  json(response, {
    jsonrpc: "2.0",
    id,
    result: { ok: false, error: { code: "COMMAND_FAILED", message } },
  });

const readRpc = async (request: IncomingMessage): Promise<unknown> => {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_RPC_BYTES) throw new Error("Device request too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

interface ManagedRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly payload?: ReturnType<typeof managedAgentDeviceRpc>;
}

async function managedRequest(
  request: IncomingMessage,
  grant: AgentDeviceGrant,
): Promise<ManagedRequest | undefined> {
  const path = request.url ?? "";
  if (request.method === "POST" && path === "/rpc") {
    const payload = await readRpc(request);
    const command = managedAgentDeviceRpc(payload, grant);
    if (!command)
      throw new Error("Use the exact device_open flags and a supported device command.");
    return { method: "POST", path, payload: command };
  }
  // Declining the 0.21.12 direct-upload preflight makes the stock CLI use its
  // standard streaming upload. The upstream never sends auth or upload URLs to the CLI.
  if (!grant.resumedApp && !grant.approvedApp && request.method === "POST" && path === "/upload")
    return { method: "POST", path };
  const artifact = /^\/artifacts\/([a-zA-Z0-9_-]+)$/.exec(path)?.[1];
  if (request.method === "GET" && artifact && grant.artifacts.has(artifact)) {
    return { method: "GET", path };
  }
}

const upstream = (
  endpoint: AgentDeviceEndpoint,
  request: IncomingMessage,
  response: ServerResponse,
  route: ManagedRequest,
  grant: AgentDeviceGrant,
  canDispatch: () => boolean,
  timeoutMs: (verb: string) => number = agentDeviceTimeoutMs,
) =>
  Effect.tryPromise({
    try: async () => {
      // Abort the upstream call when the client goes away so a hung daemon cannot hold control.
      const clientGone = new AbortController();
      response.once("close", () => {
        if (!response.writableEnded) clientGone.abort();
      });
      const headers = new Headers({ authorization: `Bearer ${endpoint.token}` });
      const origin = endpoint.baseUrl.replace(/\/$/, "");
      const check = () => {
        if (!canDispatch())
          throw new DeviceComparisonError({
            reason: "Device control ended before the command started.",
          });
      };
      if (route.payload) headers.set("content-type", "application/json");
      if (route.path === "/upload") {
        for (const name of [
          "content-type",
          "x-artifact-type",
          "x-artifact-filename",
          "x-artifact-hash",
          "x-artifact-hash-algorithm",
        ]) {
          const value = request.headers[name];
          if (typeof value === "string") headers.set(name, value);
        }
      }
      if (route.payload) {
        const rpc = async (
          payload: { id: unknown },
          mayMutate = false,
          timeoutVerb = "snapshot",
        ): Promise<unknown> => {
          check();
          try {
            const reply_ = await fetch(`${origin}/rpc`, {
              method: "POST",
              headers,
              redirect: "error",
              signal: AbortSignal.any([
                AbortSignal.timeout(timeoutMs(timeoutVerb)),
                clientGone.signal,
              ]),
              body: JSON.stringify(payload),
            });
            const reply: unknown = await reply_.json();
            if (!reply_.ok || agentDeviceObject(reply).id !== payload.id) throw unavailable();
            return reply;
          } catch (cause) {
            if (mayMutate) grant.uncertain = true;
            throw cause;
          }
        };
        let command = route.payload;
        const verb = command.params.command;
        assertNoCoordinates(command, grant);
        if (needsDeviceSnapshot(command)) {
          const privacy = await rpc(privacySnapshotCommand(grant));
          const snapshot = safeDeviceSnapshot(
            deviceRpcData(privacy),
            verb === "screenshot",
            (grant.resumedApp ?? grant.approvedApp)?.appId,
          );
          command = refreshDeviceReference(command, grant.lastSnapshot, snapshot, {
            stale: grant.snapshotStale === true,
            ...(grant.snapshotScreenKey ? { screenKey: grant.snapshotScreenKey } : {}),
          });
        }
        if (
          ["open", "close", "home", "app-switcher", "settings", "install", "reinstall"].includes(
            verb,
          )
        )
          delete grant.lastSnapshot;
        if (verb === "open" && grant.approvedApp) {
          check();
          if (grant.appOpenDispatched)
            throw new DeviceComparisonError({
              reason: "The approved launch was already dispatched. Take a fresh snapshot.",
            });
          grant.appOpenDispatched = true;
        }
        // Whatever this verb does, refs from the previous snapshot are no longer trustworthy.
        if (mutatingDeviceVerbs.has(verb)) grant.snapshotStale = true;
        const reply = await rpc(command, verb !== "snapshot" && verb !== "screenshot", verb);
        const result = safeDeviceResult(command, reply, grant);
        if (result.result.ok && verb === "screenshot") {
          safeDeviceSnapshot(
            deviceRpcData(await rpc(privacySnapshotCommand(grant))),
            true,
            (grant.resumedApp ?? grant.approvedApp)?.appId,
          );
          check();
          for (const artifact of Array.isArray(result.result.data?.artifacts)
            ? result.result.data.artifacts
            : []) {
            const { artifactId } = agentDeviceObject(artifact);
            if (typeof artifactId === "string") grant.artifacts.add(artifactId);
          }
        }
        if (result.result.ok && Object.keys(result.result.data).length > 0) check();
        json(response, result);
        return;
      }
      check();
      const result = await fetch(`${origin}${route.path}`, {
        method: route.method,
        headers,
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs("install")), clientGone.signal]),
        ...(route.path === "/upload"
          ? { body: Readable.toWeb(request), duplex: "half" as const }
          : {}),
      });
      // Only forward the artifact from this command. Inventory is daemon-wide.
      if (route.method === "GET" && result.ok && result.body) {
        const headers: Record<string, string> = {};
        for (const name of ["content-type", "content-length", "content-disposition"]) {
          const value = result.headers.get(name);
          if (value !== null) headers[name] = value;
        }
        response.writeHead(result.status, headers);
        await pipeline(Readable.fromWeb(result.body), response);
        return;
      }
      if (!result.ok) {
        await result.body?.cancel();
        throw new Error("Device host rejected the request.");
      }
      const payload: unknown = await result.json();
      const decoded = agentDeviceObject(payload);
      if (route.path === "/upload" && decoded.ok === true && typeof decoded.uploadId === "string") {
        grant.uploads.add(decoded.uploadId);
      }
      json(response, { ok: decoded.ok === true, uploadId: decoded.uploadId });
    },
    catch: (error) => (error instanceof DeviceComparisonError ? error : unavailable()),
  });

export const startAgentDeviceProxy = (options: {
  readonly lookup: (token: string) => AgentDeviceGrant | undefined;
  readonly dispatch: Dispatch;
  readonly timeoutMs?: (verb: string) => number;
}) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const server = createServer((request, response) => {
          void (async () => {
            // The pinned CLI probes health before sending an authenticated command.
            if (request.method === "GET" && request.url === "/health") {
              json(response, {
                ok: true,
                service: "agent-device-daemon",
                version: AGENT_DEVICE_VERSION,
                rpcProtocolVersion: 2,
              });
              return;
            }
            const authorization = request.headers.authorization;
            const grant = authorization?.startsWith("Bearer ")
              ? options.lookup(authorization.slice(7))
              : undefined;
            if (!grant) {
              if (request.method === "POST" && request.url === "/rpc") {
                const { id } = agentDeviceObject(await readRpc(request));
                rpcError(
                  response,
                  id,
                  "Device control ended. Call device_open to request it again.",
                );
              } else json(response, { ok: false }, 403);
              return;
            }
            let route: ManagedRequest | undefined;
            try {
              route = await managedRequest(request, grant);
            } catch (cause) {
              rpcError(
                response,
                null,
                cause instanceof Error ? cause.message : "Invalid device request.",
              );
              return;
            }
            if (!route) {
              json(response, { ok: false }, 404);
              return;
            }
            await Effect.runPromise(
              options
                .dispatch(
                  grant,
                  (endpoint, canDispatch) =>
                    upstream(
                      endpoint,
                      request,
                      response,
                      route,
                      grant,
                      canDispatch,
                      options.timeoutMs,
                    ),
                  route.payload !== undefined,
                )
                .pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      if (response.headersSent) response.destroy();
                      else if (route.payload) rpcError(response, route.payload.id, error.reason);
                      else json(response, { ok: false, error: error.reason }, 409);
                    }),
                  ),
                ),
            );
          })().catch(() => {
            if (response.headersSent) response.destroy();
            else json(response, { ok: false, error: "Invalid device request." }, 400);
          });
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No loopback port.");
        return { server, origin: `http://127.0.0.1:${address.port}` };
      },
      catch: () => new DeviceComparisonError({ reason: "Could not start device control." }),
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
  );

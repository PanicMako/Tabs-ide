import * as Context from "effect/Context";
/**
 * Server - HTTP/WebSocket server service interface.
 *
 * Owns startup and shutdown lifecycle of the HTTP server, static asset serving,
 * and WebSocket request routing.
 *
 * @module Server
 */
import http from "node:http";
import * as NodeCrypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import type { Duplex } from "node:stream";
import { readExtensionWorkspaceFile } from "./extensionWorkspaceRead.ts";

import Mime from "@effect/platform-node/Mime";
import {
  CommandId,
  AuthStandardClientScopes,
  AuthSessionId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProjectId,
  ProviderInstanceId,
  RpcClientId,
  ThreadId,
  type TestingCaseCreateInput,
  type TestingCaseDeleteInput,
  type TestingCaseGroupUpdateInput,
  type TestingCaseGroupCreateInput,
  type TestingCaseGroupDeleteInput,
  type TestingCaseReviewInput,
  type TestingCaseIdPolicyInput,
  type TestingBugDraftInput,
  type TestingDiscoveryExperienceInput,
  type TestingExplorationInput,
  type TestingExecutionInput,
  type TestingExecutionRunInput,
  type TestingArtifactReadInput,
  type TestingGenerationInput,
  type TestingGenerationJobInput,
  type TestingHealingDecisionInput,
  type TestingLocatorDiscoveryInput,
  type TestingLocatorDiscoveryNavigateInput,
  type TestingLocatorDiscoverySessionInput,
  type TestingLocatorEntryReviewInput,
  type TestingLocatorPageDeleteInput,
  type TestingLocatorPageSelectionInput,
  type TestingLocatorPageUpdateInput,
  type TestingPageObjectCodeUpdateInput,
  type TestingLocatorRepositoryApplyInput,
  type TestingLocatorRepositoryPreviewInput,
  type TestingLocatorSyncDecisionInput,
  type TestingLocatorFolderInput,
  type TestingLocatorVerificationInput,
  type TestingProjectInput,
  type TestingReportInput,
  type TestingScheduleInput,
  type TestingTargetInput,
  type TestingStoryImportInput,
  type TestingTraceabilityInput,
  type TestingTriageInput,
  type TestingWorkbookImportInput,
  type UsageSummaryInput,
  type ServerListProviderUsageInput,
  type ServerProcessResourceHistoryInput,
  type ServerSignalProcessInput,
  type ProviderConsumeResetCreditInput,
  type AgentSessionImportInput,
  WS_CHANNELS,
  WS_METHODS,
  WebSocketRequest,
  type WsResponse as WsResponseMessage,
  WsResponse,
  type WsPushEnvelopeBase,
} from "@tabs/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  Cause,
  Crypto,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  Stream,
  Struct,
} from "effect";
import { WebSocketServer, type WebSocket } from "ws";

import { createLogger } from "./logger";
import { GitManager } from "./git/Services/GitManager.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { Keybindings } from "./keybindings";
import { ServerSettingsService } from "./serverSettings";
import { searchWorkspaceContents, searchWorkspaceEntries } from "./workspaceEntries";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import { ProviderService } from "./provider/Services/ProviderService";
import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ProviderMaintenanceRunner } from "./provider/providerMaintenanceRunner";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { clamp } from "effect/Number";
import { Open, resolveAvailableEditors } from "./open";
import { ServerConfig } from "./config";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics";
import { GitCore } from "./git/Services/GitCore.ts";
import { GitEnvironment } from "./git/Services/GitEnvironment.ts";
import { tryHandleProjectFaviconRequest } from "./projectFaviconRoute";
import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { expandHomePath } from "./os-jank.ts";
import { makeServerPushBus } from "./wsServer/pushBus.ts";
import { makeServerReadiness } from "./wsServer/readiness.ts";
import { decodeJsonResult, formatSchemaError } from "@tabs/shared/schemaJson";
import { discoverSourceControl } from "./sourceControl/discovery";
import { runProcess } from "./processRunner";
import { TestingService } from "./testing/TestingService";
import { TextGeneration } from "./textGeneration/TextGeneration";
import { UsageService } from "./usage/UsageService.ts";
import { listProviderUsageSnapshotsEffect } from "./providerUsage/index.ts";
import { PreviewManager } from "./preview/Manager.ts";
import { PortDiscovery } from "./preview/PortScanner.ts";
import { AgentSessionScanner } from "./project/AgentSessionScanner.ts";
import { importRecentAgentThreads } from "./project/AgentSessionImporter.ts";
import { ProjectSetupScriptRunner } from "./project/ProjectSetupScriptRunner.ts";
import { ProjectFileLoader } from "./project/ProjectFileLoader.ts";
import { ServerEnvironment } from "./environment/ServerEnvironment.ts";
import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import { PreviewAutomationBroker } from "./mcp/PreviewAutomationBroker.ts";
import { handleMcpHttpRequest } from "./mcp/McpHttpServer.ts";
import { ExtensionAiBrokerClient } from "./mcp/ExtensionAiBrokerClient.ts";
import { resolveMcpProjectId } from "./mcp/McpProjectScope.ts";
import { resolveActiveMcpCredential } from "./mcp/McpSessionRegistry.ts";
import { SessionStore } from "./auth/SessionStore.ts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import { verifyDpopRequestFields } from "./auth/dpop.ts";
import { ServerSecretStore } from "./auth/ServerSecretStore.ts";
import { BackgroundPolicy } from "./background/BackgroundPolicy.ts";
import { EnvironmentThemeService } from "./environmentTheme.ts";
import { withUsageLimitsCommands } from "@tabs/shared/usageLimits";
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import {
  readProcessDiagnostics,
  readProcessResourceHistory,
  signalProcess,
} from "./diagnostics/ProcessDiagnostics.ts";
import {
  readResourceTelemetrySnapshot,
  readResourceTelemetryHistory,
  retryResourceTelemetry,
} from "./diagnostics/ResourceTelemetryService.ts";
import { recordResourceAttribution } from "./diagnostics/ResourceAttribution.ts";
import { createSupportBundle } from "./diagnostics/SupportBundle.ts";
import type { ResourceTelemetryHistoryInput } from "@tabs/contracts";

/**
 * ServerShape - Service API for server lifecycle control.
 */
export interface ServerShape {
  /**
   * Start HTTP and WebSocket listeners.
   */
  readonly start: Effect.Effect<
    http.Server,
    ServerLifecycleError,
    Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >;

  /**
   * Wait for process shutdown signals.
   */
  readonly stopSignal: Effect.Effect<void, never>;
}

/**
 * Server - Service tag for HTTP/WebSocket lifecycle management.
 */
export class Server extends Context.Service<Server, ServerShape>()("tabs/wsServer/Server") {}

const isServerNotRunningError = (error: Error): boolean => {
  const maybeCode = (error as NodeJS.ErrnoException).code;
  return (
    maybeCode === "ERR_SERVER_NOT_RUNNING" || error.message.toLowerCase().includes("not running")
  );
};

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Bad Request"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message,
  );
}

function websocketRawToString(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }
  if (Array.isArray(raw)) {
    const chunks: string[] = [];
    for (const chunk of raw) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        continue;
      }
      if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk).toString("utf8"));
        continue;
      }
      if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(new Uint8Array(chunk)).toString("utf8"));
        continue;
      }
      return null;
    }
    return chunks.join("");
  }
  return null;
}

function readHttpRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > 64 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function resolveWorkspaceWritePath(params: {
  workspaceRoot: string;
  relativePath: string;
  path: Path.Path;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  const normalizedInputPath = params.relativePath.trim();
  if (params.path.isAbsolute(normalizedInputPath)) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must be relative to the project root.",
      }),
    );
  }

  const absolutePath = params.path.resolve(params.workspaceRoot, normalizedInputPath);
  const relativeToRoot = toPosixRelativePath(
    params.path.relative(params.workspaceRoot, absolutePath),
  );
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === "." ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot === ".." ||
    params.path.isAbsolute(relativeToRoot)
  ) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must stay within the project root.",
      }),
    );
  }

  return Effect.succeed({
    absolutePath,
    relativePath: relativeToRoot,
  });
}

function resolveWorkspaceReadPath(params: {
  workspaceRoot: string;
  relativePath: string;
  path: Path.Path;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  return resolveWorkspaceWritePath(params);
}

function stripRequestTag<T extends { _tag: string }>(body: T) {
  return Struct.omit(body, ["_tag"]);
}

const encodeWsResponse = Schema.encodeEffect(Schema.fromJsonString(WsResponse));
const decodeWebSocketRequest = decodeJsonResult(WebSocketRequest);

export type ServerCoreRuntimeServices =
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | CheckpointDiffQuery
  | OrchestrationReactor
  | ProviderService
  | ProviderSessionDirectory
  | ProviderRegistry
  | ProviderMaintenanceRunner;

export type ServerRuntimeServices =
  | ServerCoreRuntimeServices
  | GitManager
  | GitCore
  | GitEnvironment
  | TerminalManager
  | Keybindings
  | ServerSettingsService
  | TextGeneration
  | UsageService
  | Open
  | AnalyticsService
  | PreviewManager
  | PortDiscovery
  | ServerEnvironment
  | EnvironmentAuth
  | PreviewAutomationBroker
  | SessionStore
  | ServerSecretStore
  | Crypto.Crypto
  | BackgroundPolicy
  | EnvironmentThemeService
  | TraceDiagnostics.TraceDiagnostics
  | UsageLimitSources.UsageLimitSources
  | AgentSessionScanner
  | ProjectSetupScriptRunner
  | ProjectFileLoader
  | ProviderInstanceRegistry;

export class ServerLifecycleError extends Schema.TaggedErrorClass<ServerLifecycleError>()(
  "ServerLifecycleError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class RouteRequestError extends Schema.TaggedErrorClass<RouteRequestError>()("RouteRequestError", {
  message: Schema.String,
}) {}

export const createServer = Effect.fn(function* (): Effect.fn.Return<
  http.Server,
  ServerLifecycleError,
  Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
> {
  const serverConfig = yield* ServerConfig;
  const {
    port,
    cwd,
    keybindingsConfigPath,
    staticDir,
    devUrl,
    authToken,
    host,
    logWebSocketEvents,
    autoBootstrapProjectFromCwd,
  } = serverConfig;
  const availableEditors = resolveAvailableEditors();

  const gitManager = yield* GitManager;
  const terminalManager = yield* TerminalManager;
  const keybindingsManager = yield* Keybindings;
  const serverSettingsManager = yield* ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry;
  const providerMaintenanceRunner = yield* ProviderMaintenanceRunner;
  const git = yield* GitCore;
  const gitEnvironment = yield* GitEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const textGeneration = yield* TextGeneration;
  const usageService = yield* UsageService;
  const previewManager = yield* PreviewManager;
  const portDiscovery = yield* PortDiscovery;
  const serverEnvironment = yield* ServerEnvironment;
  const environmentAuth = yield* EnvironmentAuth;
  const previewAutomationBroker = yield* PreviewAutomationBroker;
  const sessionStore = yield* SessionStore;
  const serverSecretStore = yield* ServerSecretStore;
  const effectCrypto = yield* Crypto.Crypto;
  const backgroundPolicy = yield* BackgroundPolicy;
  const environmentTheme = yield* EnvironmentThemeService;
  const usageLimitSources = yield* UsageLimitSources.UsageLimitSources;
  const providerInstances = yield* ProviderInstanceRegistry;
  const testingService = new TestingService(serverConfig.stateDir, textGeneration);
  yield* Effect.addFinalizer(() => Effect.sync(() => testingService.close()));

  yield* keybindingsManager.syncDefaultKeybindingsOnStartup.pipe(
    Effect.catch((error) =>
      Effect.logWarning("failed to sync keybindings defaults on startup", {
        path: error.configPath,
        detail: error.detail,
        cause: error.cause,
      }),
    ),
  );

  const providersRef = yield* Ref.make(yield* providerRegistry.getProviders);

  const getEffectiveProviders = (rawProviders: ReadonlyArray<any>) =>
    Effect.gen(function* () {
      const sources = yield* usageLimitSources.current;
      return withUsageLimitsCommands(rawProviders as any, sources);
    });

  const clients = yield* Ref.make(new Set<WebSocket>());
  const previewAutomationFibers = new Map<WebSocket, Set<Fiber.Fiber<void, unknown>>>();
  const websocketSessions = new WeakMap<WebSocket, AuthSessionId>();
  const websocketClientIds = new WeakMap<WebSocket, RpcClientId>();
  let nextRpcClientId = 1;
  const logger = createLogger("ws");
  const readiness = yield* makeServerReadiness;

  function logOutgoingPush(push: WsPushEnvelopeBase, recipients: number) {
    if (!logWebSocketEvents) return;
    const payload = push.data;
    const payloadShape = Array.isArray(payload)
      ? { kind: "array", itemCount: payload.length }
      : payload !== null && typeof payload === "object"
        ? { kind: "object", keys: Object.keys(payload).slice(0, 20) }
        : { kind: typeof payload };
    logger.event("outgoing push", {
      channel: push.channel,
      sequence: push.sequence,
      recipients,
      // Push bodies can contain complete provider/model/skill catalogs and
      // user content. Logging their shape is enough to trace fan-out without
      // serializing hundreds of kilobytes or leaking sensitive text.
      payloadShape,
    });
  }

  const pushBus = yield* makeServerPushBus({
    clients,
    logOutgoingPush,
  });
  yield* readiness.markPushBusReady;
  yield* keybindingsManager.start.pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "keybindingsRuntimeStart", cause }),
    ),
  );
  yield* readiness.markKeybindingsReady;
  yield* serverSettingsManager.start.pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "serverSettingsRuntimeStart", cause }),
    ),
  );

  const normalizeDispatchCommand = Effect.fnUntraced(function* (input: {
    readonly command: ClientOrchestrationCommand;
  }) {
    const normalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (workspaceRoot: string) {
      const normalizedWorkspaceRoot = path.resolve(yield* expandHomePath(workspaceRoot.trim()));
      const workspaceStat = yield* fileSystem
        .stat(normalizedWorkspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!workspaceStat) {
        return yield* new RouteRequestError({
          message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
        });
      }
      if (workspaceStat.type !== "Directory") {
        return yield* new RouteRequestError({
          message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
        });
      }
      return normalizedWorkspaceRoot;
    });

    if (input.command.type === "project.create") {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type !== "thread.turn.start") {
      return input.command as OrchestrationCommand;
    }
    const turnStartCommand = input.command;

    const normalizedAttachments = yield* Effect.forEach(
      turnStartCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed) {
            return yield* new RouteRequestError({
              message: `Invalid attachment payload for '${attachment.name}'.`,
            });
          }

          const parsedMimeType = parsed.mimeType.toLowerCase();
          const declaredMimeType = attachment.mimeType.toLowerCase();
          if (parsedMimeType !== declaredMimeType) {
            return yield* new RouteRequestError({
              message: `Attachment MIME type mismatch for '${attachment.name}'.`,
            });
          }
          if (attachment.type === "image" && !parsedMimeType.startsWith("image/")) {
            return yield* new RouteRequestError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }
          if (attachment.type === "file" && parsedMimeType.startsWith("image/")) {
            return yield* new RouteRequestError({
              message: `Image payload '${attachment.name}' must use the image attachment type.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          const maxBytes =
            attachment.type === "image"
              ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
              : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
          if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
            return yield* new RouteRequestError({
              message: `Attachment '${attachment.name}' is empty or too large.`,
            });
          }
          if (bytes.byteLength !== attachment.sizeBytes) {
            return yield* new RouteRequestError({
              message: `Attachment size mismatch for '${attachment.name}'.`,
            });
          }

          const attachmentId = createAttachmentId(turnStartCommand.threadId);
          if (!attachmentId) {
            return yield* new RouteRequestError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: attachment.type,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsedMimeType,
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new RouteRequestError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...turnStartCommand,
      message: {
        ...turnStartCommand.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

  const runtimeServices = yield* Effect.context<
    ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >();
  const runPromise = Effect.runPromiseWith(runtimeServices);
  const extensionAiBroker = (() => {
    if (!serverConfig.desktopExtensionBroker) return undefined;
    try {
      return new ExtensionAiBrokerClient(serverConfig.desktopExtensionBroker);
    } catch {
      return undefined;
    }
  })();

  // HTTP server — serves static files or redirects to Vite dev server
  const httpServer = http.createServer((req, res) => {
    const respond = (
      statusCode: number,
      headers: Record<string, string>,
      body?: string | Uint8Array,
    ) => {
      res.writeHead(statusCode, headers);
      res.end(body);
    };

    void runPromise(
      Effect.gen(function* () {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const respondJson = (statusCode: number, value: unknown) =>
          respond(
            statusCode,
            {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
            JSON.stringify(value),
          );
        const requestUrl = new URL(
          req.url ?? "/",
          `${"encrypted" in req.socket && req.socket.encrypted ? "https" : "http"}://${req.headers.host ?? `localhost:${port}`}`,
        ).href;
        const authenticateAccessToken = (authorization: string | undefined) =>
          Effect.gen(function* () {
            const isDpop = authorization?.startsWith("DPoP ") === true;
            const isBearer = authorization?.startsWith("Bearer ") === true;
            if (!isDpop && !isBearer) return null;
            const token = authorization!.slice(isDpop ? 5 : 7).trim();
            if (token.length === 0) return null;
            const session = yield* sessionStore.verify(token);
            if (session.proofKeyThumbprint) {
              if (!isDpop) return yield* Effect.fail(new Error("DPoP authorization required."));
              yield* verifyDpopRequestFields({
                proof: typeof req.headers.dpop === "string" ? req.headers.dpop : undefined,
                method: req.method ?? "GET",
                url: requestUrl,
                expectedThumbprint: session.proofKeyThumbprint,
                expectedAccessToken: token,
              }).pipe(
                Effect.provideService(ServerSecretStore, serverSecretStore),
                Effect.provideService(Crypto.Crypto, effectCrypto),
              );
            } else if (isDpop) {
              return yield* Effect.fail(new Error("DPoP token is not proof-bound."));
            }
            return session;
          });

        if (req.method === "POST" && url.pathname === "/internal/extensions/read-project-file") {
          const remote = req.socket.remoteAddress;
          if (
            !authToken ||
            (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1")
          ) {
            respondJson(404, { error: "Not found." });
            return;
          }
          const supplied = req.headers["x-tabs-backend-token"];
          const expected = Buffer.from(authToken);
          const actual = Buffer.from(typeof supplied === "string" ? supplied : "");
          if (actual.length !== expected.length || !NodeCrypto.timingSafeEqual(actual, expected)) {
            respondJson(401, { error: "Unauthorized." });
            return;
          }
          const parsed = yield* Effect.tryPromise(
            async () => JSON.parse(await readHttpRequestBody(req)) as unknown,
          ).pipe(Effect.exit);
          if (Exit.isFailure(parsed) || !parsed.value || typeof parsed.value !== "object") {
            respondJson(400, { error: "Invalid request." });
            return;
          }
          const input = parsed.value as Record<string, unknown>;
          if (typeof input.projectId !== "string" || typeof input.relativePath !== "string") {
            respondJson(400, { error: "Invalid request." });
            return;
          }
          const snapshot = yield* projectionReadModelQuery.getSnapshot();
          const project = snapshot.projects.find(
            (candidate) => candidate.id === input.projectId && candidate.deletedAt === null,
          );
          if (!project) {
            respondJson(404, { error: "Project not found." });
            return;
          }
          const read = yield* Effect.tryPromise(() =>
            readExtensionWorkspaceFile(project.workspaceRoot, input.relativePath as string),
          ).pipe(Effect.exit);
          if (Exit.isFailure(read)) {
            respondJson(400, { error: "Workspace file is unavailable." });
            return;
          }
          respondJson(200, { contents: read.value });
          return;
        }

        if (req.method === "GET" && url.pathname === "/.well-known/t3/environment") {
          respondJson(200, yield* serverEnvironment.getDescriptor);
          return;
        }

        if (url.pathname === "/mcp") {
          const authorization = req.headers.authorization;
          const token = authorization?.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length).trim()
            : "";
          const scope = token.length > 0 ? yield* resolveActiveMcpCredential(token) : undefined;
          if (!scope) {
            respond(
              401,
              {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "WWW-Authenticate": "Bearer",
              },
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32001, message: "Invalid or expired MCP credential." },
                id: null,
              }),
            );
            return;
          }
          const snapshot = yield* projectionReadModelQuery.getSnapshot();
          if (!resolveMcpProjectId(scope, snapshot)) {
            respondJson(403, { error: "MCP thread or project is no longer available." });
            return;
          }
          yield* Effect.tryPromise(() =>
            handleMcpHttpRequest({
              request: req,
              response: res,
              scope,
              broker: previewAutomationBroker,
              ...(extensionAiBroker ? { extensionAiBroker } : {}),
              resolveProjectId: async () =>
                resolveMcpProjectId(
                  scope,
                  await runPromise(projectionReadModelQuery.getSnapshot()),
                ),
              runPromise,
            }),
          );
          return;
        }

        if (req.method === "POST" && url.pathname === "/oauth/token") {
          const rawBody = yield* Effect.tryPromise(() => readHttpRequestBody(req));
          const payload = new URLSearchParams(rawBody);
          const credential = payload.get("subject_token")?.trim() ?? "";
          const requestedScope = payload.get("scope");
          const requestedScopes = requestedScope
            ? requestedScope.split(" ").filter((scope) => scope.length > 0)
            : undefined;
          if (
            credential.length === 0 ||
            (requestedScopes !== undefined &&
              !requestedScopes.every((scope) => AuthStandardClientScopes.includes(scope as never)))
          ) {
            respondJson(400, { code: "invalid_request", reason: "invalid_scope", traceId: "http" });
            return;
          }
          const proofVerification =
            typeof req.headers.dpop === "string"
              ? yield* verifyDpopRequestFields({
                  proof: req.headers.dpop,
                  method: req.method,
                  url: requestUrl,
                }).pipe(
                  Effect.provideService(ServerSecretStore, serverSecretStore),
                  Effect.provideService(Crypto.Crypto, effectCrypto),
                  Effect.exit,
                )
              : Exit.succeed(undefined);
          if (Exit.isFailure(proofVerification)) {
            res.setHeader("WWW-Authenticate", "DPoP");
            respondJson(401, {
              code: "auth_invalid",
              reason: "invalid_credential",
              traceId: "http",
            });
            return;
          }
          const proofKeyThumbprint = proofVerification.value;
          const issued = yield* environmentAuth
            .exchangeBootstrapCredentialForAccessToken(
              credential,
              requestedScopes as typeof AuthStandardClientScopes | undefined,
              {
                deviceType:
                  (payload.get("client_device_type") as
                    | "desktop"
                    | "mobile"
                    | "tablet"
                    | "bot"
                    | "unknown"
                    | null) ?? "unknown",
                ...(payload.get("client_label") ? { label: payload.get("client_label")! } : {}),
                ...(payload.get("client_os") ? { os: payload.get("client_os")! } : {}),
                ...(req.headers["user-agent"] ? { userAgent: req.headers["user-agent"] } : {}),
                ...(req.socket.remoteAddress ? { ipAddress: req.socket.remoteAddress } : {}),
              },
              proofKeyThumbprint ? { proofKeyThumbprint } : undefined,
            )
            .pipe(Effect.exit);
          if (Exit.isFailure(issued)) {
            respondJson(401, {
              code: "auth_invalid",
              reason: "invalid_credential",
              traceId: "http",
            });
            return;
          }
          respondJson(200, issued.value);
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/auth/websocket-ticket") {
          const authorization = req.headers.authorization;
          if (!authorization) {
            respondJson(401, {
              code: "auth_invalid",
              reason: "missing_credential",
              traceId: "http",
            });
            return;
          }
          const verified = yield* authenticateAccessToken(authorization).pipe(Effect.exit);
          if (Exit.isFailure(verified)) {
            if (authorization.startsWith("DPoP ")) res.setHeader("WWW-Authenticate", "DPoP");
            respondJson(401, {
              code: "auth_invalid",
              reason: "invalid_credential",
              traceId: "http",
            });
            return;
          }
          if (verified.value === null) {
            respondJson(401, {
              code: "auth_invalid",
              reason: "missing_credential",
              traceId: "http",
            });
            return;
          }
          const ticket = yield* sessionStore.issueWebSocketToken(verified.value.sessionId);
          respondJson(200, {
            ticket: ticket.token,
            expiresAt: DateTime.formatIso(ticket.expiresAt),
          });
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/auth/session") {
          const authorization = req.headers.authorization;
          const auth = yield* environmentAuth.getDescriptor();
          if (!authorization) {
            respondJson(200, { authenticated: false, auth });
            return;
          }
          const verified = yield* authenticateAccessToken(authorization).pipe(Effect.exit);
          if (Exit.isFailure(verified)) {
            if (authorization.startsWith("DPoP ")) res.setHeader("WWW-Authenticate", "DPoP");
            respondJson(401, {
              code: "auth_invalid",
              reason: "invalid_credential",
              traceId: "http",
            });
            return;
          }
          if (verified.value === null) {
            respondJson(401, {
              code: "auth_invalid",
              reason: "missing_credential",
              traceId: "http",
            });
            return;
          }
          respondJson(200, {
            authenticated: true,
            auth,
            scopes: verified.value.scopes,
            sessionMethod: verified.value.method,
            ...(verified.value.expiresAt
              ? { expiresAt: DateTime.formatIso(verified.value.expiresAt) }
              : {}),
          });
          return;
        }
        if (!authToken && tryHandleProjectFaviconRequest(url, res)) {
          return;
        }

        if (url.pathname.startsWith(ATTACHMENTS_ROUTE_PREFIX)) {
          const rawRelativePath = url.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
          const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
          if (!normalizedRelativePath) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid attachment path");
            return;
          }

          const isIdLookup =
            !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
          const filePath = isIdLookup
            ? resolveAttachmentPathById({
                attachmentsDir: serverConfig.attachmentsDir,
                attachmentId: normalizedRelativePath,
              })
            : resolveAttachmentRelativePath({
                attachmentsDir: serverConfig.attachmentsDir,
                relativePath: normalizedRelativePath,
              });
          if (!filePath) {
            respond(
              isIdLookup ? 404 : 400,
              { "Content-Type": "text/plain" },
              isIdLookup ? "Not Found" : "Invalid attachment path",
            );
            return;
          }

          const fileInfo = yield* fileSystem
            .stat(filePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!fileInfo || fileInfo.type !== "File") {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const contentType = Mime.getType(filePath) ?? "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          const streamExit = yield* Stream.runForEach(fileSystem.stream(filePath), (chunk) =>
            Effect.sync(() => {
              if (!res.destroyed) {
                res.write(chunk);
              }
            }),
          ).pipe(Effect.exit);
          if (Exit.isFailure(streamExit)) {
            if (!res.destroyed) {
              res.destroy();
            }
            return;
          }
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        // In dev mode, redirect to Vite dev server
        if (devUrl) {
          respond(302, { Location: devUrl.href });
          return;
        }

        // Serve static files from the web app build
        if (!staticDir) {
          respond(
            503,
            { "Content-Type": "text/plain" },
            "No static directory configured and no dev URL set.",
          );
          return;
        }

        const staticRoot = path.resolve(staticDir);
        const staticRequestPath = url.pathname === "/" ? "/index.html" : url.pathname;
        const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
        const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
        const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
        const hasPathTraversalSegment = staticRelativePath.startsWith("..");
        if (
          staticRelativePath.length === 0 ||
          hasRawLeadingParentSegment ||
          hasPathTraversalSegment ||
          staticRelativePath.includes("\0")
        ) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const isWithinStaticRoot = (candidate: string) =>
          candidate === staticRoot ||
          candidate.startsWith(
            staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`,
          );

        let filePath = path.resolve(staticRoot, staticRelativePath);
        if (!isWithinStaticRoot(filePath)) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const ext = path.extname(filePath);
        if (!ext) {
          filePath = path.resolve(filePath, "index.html");
          if (!isWithinStaticRoot(filePath)) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
            return;
          }
        }

        const fileInfo = yield* fileSystem
          .stat(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          const indexPath = path.resolve(staticRoot, "index.html");
          const indexData = yield* fileSystem
            .readFile(indexPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!indexData) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }
          respond(200, { "Content-Type": "text/html; charset=utf-8" }, indexData);
          return;
        }

        const contentType = Mime.getType(filePath) ?? "application/octet-stream";
        const data = yield* fileSystem
          .readFile(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!data) {
          respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
          return;
        }
        respond(200, { "Content-Type": contentType }, data);
      }),
    ).catch(() => {
      if (!res.headersSent) {
        respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
      }
    });
  });

  // WebSocket server — upgrades from the HTTP server
  const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

  const closeWebSocketServer = Effect.callback<void, ServerLifecycleError>((resume) => {
    wss.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        resume(
          Effect.fail(
            new ServerLifecycleError({ operation: "closeWebSocketServer", cause: error }),
          ),
        );
      } else {
        resume(Effect.void);
      }
    });
  });

  const closeAllClients = Ref.get(clients).pipe(
    Effect.flatMap(Effect.forEach((client) => Effect.sync(() => client.close()))),
    Effect.flatMap(() => Ref.set(clients, new Set())),
  );

  const listenOptions = host ? { host, port } : { port };

  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const orchestrationReactor = yield* OrchestrationReactor;
  const { openInEditor } = yield* Open;
  const agentSessionScanner = yield* AgentSessionScanner;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
  const projectFileLoader = yield* ProjectFileLoader;

  const subscriptionsScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(subscriptionsScope, Exit.void));

  yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
    pushBus.publishAll(ORCHESTRATION_WS_CHANNELS.domainEvent, event),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(keybindingsManager.streamChanges, (event) =>
    Effect.gen(function* () {
      const providers = yield* getEffectiveProviders(yield* Ref.get(providersRef));
      yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
        issues: event.issues,
        providers,
      });
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(serverSettingsManager.streamChanges, (settings) =>
    Effect.gen(function* () {
      const providers = yield* getEffectiveProviders(yield* Ref.get(providersRef));
      yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
        issues: [],
        providers,
        settings,
      });
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(environmentTheme.streamChanges, (environmentThemes) =>
    Effect.gen(function* () {
      const providers = yield* getEffectiveProviders(yield* Ref.get(providersRef));
      yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
        issues: [],
        providers,
        environmentThemes,
      });
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(usageLimitSources.streamChanges, (sources) =>
    Effect.gen(function* () {
      const rawProviders = yield* Ref.get(providersRef);
      const providers = withUsageLimitsCommands(rawProviders as any, sources);
      yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
        issues: [],
        providers,
        usageLimitSources: sources,
      });
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* providerRegistry.streamChanges.pipe(
    // A startup refresh can produce one complete snapshot per provider in a
    // short burst. Only the latest complete array matters to clients, so
    // coalesce that burst instead of repeatedly serializing and broadcasting
    // the entire provider/model catalog.
    Stream.debounce(Duration.millis(100)),
    Stream.runForEach((providers) =>
      Effect.gen(function* () {
        yield* Ref.set(providersRef, providers);
        const effectiveProviders = yield* getEffectiveProviders(providers);
        yield* pushBus.publishAll(WS_CHANNELS.serverProvidersUpdated, {
          providers: effectiveProviders,
        });
      }),
    ),
    Effect.forkIn(subscriptionsScope),
  );

  yield* Stream.runForEach(previewManager.events, (event) =>
    pushBus.publishAll(WS_CHANNELS.previewEvent, event),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(backgroundPolicy.streamChanges, (snapshot) =>
    pushBus.publishAll(WS_CHANNELS.backgroundPolicyUpdated, snapshot),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Effect.forever(
    Effect.gen(function* () {
      const settings = yield* serverSettingsManager.getSettings;
      yield* Effect.sleep(settings.providerHealthRefreshInterval);
      if (!(yield* backgroundPolicy.shouldRunScopeWork({ type: "provider-status" }))) return;
      // refresh() publishes changed snapshots through streamChanges. That
      // single path updates providersRef and notifies clients; broadcasting
      // here as well duplicated the full catalog on every periodic refresh.
      yield* providerRegistry.refresh();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("background provider refresh failed", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.andThen(Effect.sleep(Duration.seconds(30)))),
      ),
    ),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Scope.provide(subscriptionsScope)(orchestrationReactor.start);
  yield* readiness.markOrchestrationSubscriptionsReady;

  let welcomeBootstrapProjectId: ProjectId | undefined;
  let welcomeBootstrapThreadId: ThreadId | undefined;

  if (autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const snapshot = yield* projectionReadModelQuery.getSnapshot();
      const existingProject = snapshot.projects.find(
        (project: any) => project.workspaceRoot === cwd && project.deletedAt === null,
      );
      let bootstrapProjectId: ProjectId;
      let bootstrapProjectDefaultModelSelection;

      if (!existingProject) {
        const createdAt = new Date().toISOString();
        bootstrapProjectId = crypto.randomUUID() as ProjectId;
        const bootstrapProjectTitle = path.basename(cwd) || "project";
        bootstrapProjectDefaultModelSelection = {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5-codex",
        };
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: crypto.randomUUID() as CommandId,
          projectId: bootstrapProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: cwd,
          defaultModelSelection: bootstrapProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        bootstrapProjectId = existingProject.id;
        bootstrapProjectDefaultModelSelection = existingProject.defaultModelSelection ?? {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5-codex",
        };
      }

      const existingThread = snapshot.threads.find(
        (thread: any) => thread.projectId === bootstrapProjectId && thread.deletedAt === null,
      );
      if (!existingThread) {
        const createdAt = new Date().toISOString();
        const threadId = crypto.randomUUID() as ThreadId;
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: crypto.randomUUID() as CommandId,
          threadId,
          projectId: bootstrapProjectId,
          title: "New thread",
          modelSelection: bootstrapProjectDefaultModelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = threadId;
      } else {
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = existingThread.id;
      }
    }).pipe(
      Effect.mapError(
        (cause) => new ServerLifecycleError({ operation: "autoBootstrapProject", cause }),
      ),
    );
  }

  const unsubscribeTerminalEvents = yield* terminalManager.subscribe(
    (event: any) => void runPromise(pushBus.publishAll(WS_CHANNELS.terminalEvent, event)),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribeTerminalEvents()));
  yield* readiness.markTerminalSubscriptionsReady;

  yield* NodeHttpServer.make(() => httpServer, listenOptions).pipe(
    Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerListen", cause })),
  );
  yield* readiness.markHttpListening;

  yield* Effect.addFinalizer(() =>
    Effect.all([closeAllClients, closeWebSocketServer.pipe(Effect.ignoreCause({ log: true }))]),
  );

  const routeRequest = Effect.fnUntraced(function* (ws: WebSocket, request: WebSocketRequest) {
    switch (request.body._tag) {
      case WS_METHODS.testingGetStatus: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.getStatus(body);
      }

      case WS_METHODS.testingGetLocatorLibrary: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.getLocatorLibrary(body);
      }

      case WS_METHODS.testingSetDiscoveryExperience: {
        const body = stripRequestTag(request.body) as TestingDiscoveryExperienceInput;
        return testingService.setDiscoveryExperience(body);
      }

      case WS_METHODS.testingGetCaseIdPolicy: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.getCaseIdPolicy(body);
      }

      case WS_METHODS.testingSetCaseIdPolicy: {
        const body = stripRequestTag(request.body) as TestingCaseIdPolicyInput;
        return testingService.setCaseIdPolicy(body);
      }

      case WS_METHODS.testingGetTestInventory: {
        const body = stripRequestTag(request.body) as TestingProjectInput & {
          readonly projectPath: string;
        };
        return testingService.getTestInventory(body);
      }

      case WS_METHODS.testingStartLocatorDiscovery: {
        const body = stripRequestTag(request.body) as TestingLocatorDiscoveryInput;
        return yield* Effect.tryPromise({
          try: () => testingService.startLocatorDiscovery(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingNavigateLocatorDiscovery: {
        const body = stripRequestTag(request.body) as TestingLocatorDiscoveryNavigateInput;
        return yield* Effect.tryPromise({
          try: () => testingService.navigateLocatorDiscovery(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingCaptureLocatorPage: {
        const body = stripRequestTag(request.body) as TestingLocatorDiscoverySessionInput;
        return yield* Effect.tryPromise({
          try: () => testingService.captureLocatorPage(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingFinishLocatorDiscovery: {
        const body = stripRequestTag(request.body) as TestingLocatorDiscoverySessionInput;
        return yield* Effect.tryPromise({
          try: () => testingService.finishLocatorDiscovery(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingCancelLocatorDiscovery: {
        const body = stripRequestTag(request.body) as TestingLocatorDiscoverySessionInput;
        return yield* Effect.tryPromise({
          try: () => testingService.cancelLocatorDiscovery(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingReviewLocatorEntry: {
        const body = stripRequestTag(request.body) as TestingLocatorEntryReviewInput;
        return testingService.reviewLocatorEntry(body);
      }

      case WS_METHODS.testingUpdateLocatorPage: {
        const body = stripRequestTag(request.body) as TestingLocatorPageUpdateInput;
        return testingService.updateLocatorPage(body);
      }

      case WS_METHODS.testingSetLocatorPageSelection: {
        const body = stripRequestTag(request.body) as TestingLocatorPageSelectionInput;
        return testingService.setLocatorPageSelection(body);
      }

      case WS_METHODS.testingDeleteLocatorPage: {
        const body = stripRequestTag(request.body) as TestingLocatorPageDeleteInput;
        return testingService.deleteLocatorPage(body);
      }

      case WS_METHODS.testingUpdatePageObjectCode: {
        const body = stripRequestTag(request.body) as TestingPageObjectCodeUpdateInput;
        return testingService.updatePageObjectCode(body);
      }

      case WS_METHODS.testingPreviewLocatorRepositoryWrite: {
        const body = stripRequestTag(request.body) as TestingLocatorRepositoryPreviewInput;
        return yield* Effect.tryPromise({
          try: () => testingService.previewLocatorRepositoryWrite(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingApplyLocatorRepositoryWrite: {
        const body = stripRequestTag(request.body) as TestingLocatorRepositoryApplyInput;
        return yield* Effect.tryPromise({
          try: () => testingService.applyLocatorRepositoryWrite(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingPreviewLocatorSync: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.previewLocatorSync(body);
      }

      case WS_METHODS.testingResolveLocatorSync: {
        const body = stripRequestTag(request.body) as TestingLocatorSyncDecisionInput;
        return testingService.resolveLocatorSync(body);
      }

      case WS_METHODS.testingDisconnectLocatorFolder: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.disconnectLocatorFolder(body);
      }

      case WS_METHODS.testingIndexLocatorFolder: {
        const body = stripRequestTag(request.body) as TestingLocatorFolderInput;
        return yield* Effect.tryPromise({
          try: () => testingService.indexLocatorFolder(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingVerifyLocators: {
        const body = stripRequestTag(request.body) as TestingLocatorVerificationInput;
        return yield* Effect.tryPromise({
          try: () => testingService.verifyLocators(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingImportUserStory: {
        const body = stripRequestTag(request.body) as TestingStoryImportInput;
        return yield* Effect.tryPromise({
          try: () => testingService.importUserStory(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingStartAuthCapture: {
        const body = stripRequestTag(request.body) as TestingTargetInput;
        return yield* Effect.tryPromise({
          try: () => testingService.startAuthCapture(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingFinishAuthCapture: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return yield* Effect.tryPromise({
          try: () => testingService.finishAuthCapture(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingStartExploration: {
        const body = stripRequestTag(request.body) as TestingExplorationInput;
        return yield* Effect.tryPromise({
          try: () => testingService.startExploration(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingImportWorkbook: {
        const body = stripRequestTag(request.body) as TestingWorkbookImportInput;
        return yield* Effect.tryPromise({
          try: () => testingService.importWorkbook(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingListCases: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.listCases(body);
      }

      case WS_METHODS.testingCreateCase: {
        const body = stripRequestTag(request.body) as TestingCaseCreateInput;
        return testingService.createCase(body);
      }

      case WS_METHODS.testingReviewCase: {
        const body = stripRequestTag(request.body) as TestingCaseReviewInput;
        return testingService.reviewCase(body);
      }

      case WS_METHODS.testingDeleteCase: {
        const body = stripRequestTag(request.body) as TestingCaseDeleteInput;
        return testingService.deleteCase(body);
      }

      case WS_METHODS.testingUpdateCaseGroup: {
        const body = stripRequestTag(request.body) as TestingCaseGroupUpdateInput;
        return testingService.updateCaseGroup(body);
      }

      case WS_METHODS.testingCreateCaseGroup: {
        const body = stripRequestTag(request.body) as TestingCaseGroupCreateInput;
        return testingService.createCaseGroup(body);
      }

      case WS_METHODS.testingDeleteCaseGroup: {
        const body = stripRequestTag(request.body) as TestingCaseGroupDeleteInput;
        return testingService.deleteCaseGroup(body);
      }

      case WS_METHODS.testingGenerateScenarios: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.generateScenarios(body);
      }

      case WS_METHODS.testingClearGraph: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.clearGraph(body);
      }

      case WS_METHODS.testingGenerateTests: {
        const body = stripRequestTag(request.body) as TestingGenerationInput;
        return yield* Effect.tryPromise({
          try: () => testingService.generateTests(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingListGenerationJobs: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.listGenerationJobs(body);
      }

      case WS_METHODS.testingCancelGenerationJob: {
        const body = stripRequestTag(request.body) as TestingGenerationJobInput;
        return testingService.cancelGenerationJob(body);
      }

      case WS_METHODS.testingReadArtifact: {
        const body = stripRequestTag(request.body) as TestingArtifactReadInput;
        return yield* Effect.tryPromise({
          try: () => testingService.readArtifact(body),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      case WS_METHODS.testingRunTests: {
        const body = stripRequestTag(request.body) as TestingExecutionInput;
        return yield* Effect.tryPromise({
          try: () => testingService.runTests(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingCancelExecutionRun: {
        const body = stripRequestTag(request.body) as TestingExecutionRunInput;
        return testingService.cancelExecutionRun(body);
      }

      case WS_METHODS.testingListExecutionRuns: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.listExecutionRuns(body);
      }

      case WS_METHODS.testingDecideHealingProposal: {
        const body = stripRequestTag(request.body) as TestingHealingDecisionInput;
        return testingService.decideHealingProposal(body);
      }

      case WS_METHODS.testingCreateSchedule: {
        const body = stripRequestTag(request.body) as TestingScheduleInput;
        return testingService.createSchedule(body);
      }

      case WS_METHODS.testingListSchedules: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.listSchedules(body);
      }

      case WS_METHODS.testingGenerateReport: {
        const body = stripRequestTag(request.body) as TestingReportInput;
        return yield* Effect.tryPromise({
          try: () => testingService.generateReport(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case WS_METHODS.testingGetTraceability: {
        const body = stripRequestTag(request.body) as TestingTraceabilityInput;
        return testingService.getTraceability(body);
      }

      case WS_METHODS.testingDraftBug: {
        const body = stripRequestTag(request.body) as TestingBugDraftInput;
        return testingService.draftBug(body);
      }

      case WS_METHODS.testingGetGraphExplorer: {
        const body = stripRequestTag(request.body) as TestingProjectInput;
        return testingService.getGraphExplorer(body);
      }

      case WS_METHODS.testingTriageFailure: {
        const body = stripRequestTag(request.body) as TestingTriageInput;
        return yield* Effect.tryPromise({
          try: () => testingService.triageFailure(body),
          catch: (cause) => new RouteRequestError({ message: String(cause) }),
        });
      }

      case ORCHESTRATION_WS_METHODS.getSnapshot:
        return yield* projectionReadModelQuery.getSnapshot();

      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        const { command } = request.body;
        const normalizedCommand = yield* normalizeDispatchCommand({ command });

        if (
          normalizedCommand.type === "thread.turn.start" &&
          normalizedCommand.bootstrap?.runSetupScript
        ) {
          const bootstrap = normalizedCommand.bootstrap;
          const snapshot = yield* projectionReadModelQuery.getSnapshot();
          const thread = snapshot.threads.find((t) => t.id === normalizedCommand.threadId);
          const project = thread
            ? snapshot.projects.find((p) => p.id === thread.projectId)
            : undefined;
          const targetWorktreePath =
            bootstrap.prepareWorktree?.projectCwd ??
            thread?.worktreePath ??
            project?.workspaceRoot ??
            null;

          if (targetWorktreePath) {
            const requestedAt = new Date().toISOString();
            yield* projectSetupScriptRunner
              .runForThread({
                threadId: normalizedCommand.threadId,
                ...(thread?.projectId ? { projectId: thread.projectId } : {}),
                worktreePath: targetWorktreePath,
              })
              .pipe(
                Effect.matchEffect({
                  onFailure: (error) => {
                    const detail =
                      error._tag === "ProjectSetupScriptOperationError"
                        ? error.cause instanceof Error
                          ? error.cause.message
                          : String(error.cause)
                        : error._tag === "ProjectSetupScriptProjectNotFoundError"
                          ? "Project was not found for setup script execution."
                          : "Setup script execution failed.";

                    return orchestrationEngine
                      .dispatch({
                        type: "thread.activity.append",
                        commandId: crypto.randomUUID() as CommandId,
                        threadId: normalizedCommand.threadId,
                        activity: {
                          id: crypto.randomUUID() as any,
                          tone: "error",
                          kind: "setup-script.failed",
                          summary: "Setup script failed to start",
                          payload: {
                            detail,
                            worktreePath: targetWorktreePath,
                          },
                          turnId: null,
                          createdAt: requestedAt,
                        },
                        createdAt: requestedAt,
                      })
                      .pipe(
                        Effect.ignoreCause({ log: false }),
                        Effect.flatMap(() =>
                          Effect.logWarning("bootstrap turn start failed to launch setup script", {
                            threadId: normalizedCommand.threadId,
                            worktreePath: targetWorktreePath,
                            detail,
                          }),
                        ),
                      );
                  },
                  onSuccess: (setupResult) => {
                    if (setupResult.status !== "started") {
                      return Effect.void;
                    }
                    const startedAt = new Date().toISOString();
                    const payload = {
                      scriptId: setupResult.scriptId,
                      scriptName: setupResult.scriptName,
                      terminalId: setupResult.terminalId,
                      worktreePath: targetWorktreePath,
                    };
                    return Effect.all([
                      orchestrationEngine.dispatch({
                        type: "thread.activity.append",
                        commandId: crypto.randomUUID() as CommandId,
                        threadId: normalizedCommand.threadId,
                        activity: {
                          id: crypto.randomUUID() as any,
                          tone: "info",
                          kind: "setup-script.requested",
                          summary: "Starting setup script",
                          payload,
                          turnId: null,
                          createdAt: requestedAt,
                        },
                        createdAt: requestedAt,
                      }),
                      orchestrationEngine.dispatch({
                        type: "thread.activity.append",
                        commandId: crypto.randomUUID() as CommandId,
                        threadId: normalizedCommand.threadId,
                        activity: {
                          id: crypto.randomUUID() as any,
                          tone: "info",
                          kind: "setup-script.started",
                          summary: "Setup script started",
                          payload,
                          turnId: null,
                          createdAt: startedAt,
                        },
                        createdAt: startedAt,
                      }),
                    ]).pipe(
                      Effect.asVoid,
                      Effect.catch((error: any) =>
                        Effect.logWarning(
                          "bootstrap turn start launched setup script but failed to record setup activity",
                          {
                            threadId: normalizedCommand.threadId,
                            worktreePath: targetWorktreePath,
                            scriptId: setupResult.scriptId,
                            terminalId: setupResult.terminalId,
                            detail: error?.message ?? String(error),
                          },
                        ),
                      ),
                    );
                  },
                }),
              );
          }
        }

        return yield* orchestrationEngine.dispatch(normalizedCommand);
      }

      case ORCHESTRATION_WS_METHODS.getTurnDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getTurnDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.getFullThreadDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getFullThreadDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.replayEvents: {
        const { fromSequenceExclusive } = request.body;
        return yield* Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(Effect.map((events) => Array.from(events)));
      }

      case WS_METHODS.agentSessionsScan: {
        return yield* agentSessionScanner.scan;
      }

      case WS_METHODS.agentSessionsImport: {
        const body = stripRequestTag(request.body) as AgentSessionImportInput;
        return yield* importRecentAgentThreads(body);
      }

      case WS_METHODS.projectsSearchContents: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: () => searchWorkspaceContents(body),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace contents: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsSearchEntries: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: () => searchWorkspaceEntries(body),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace entries: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.filesystemBrowse: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: async () => {
            const expandHomePath = (input: string): string => {
              if (input === "~") {
                return os.homedir();
              }
              if (input.startsWith("~/") || input.startsWith("~\\")) {
                return path.join(os.homedir(), input.slice(2));
              }
              return input;
            };

            let resolvedInputPath = "";
            const isAbsolute =
              path.isAbsolute(body.partialPath) ||
              body.partialPath.startsWith("~/") ||
              body.partialPath === "~";
            if (isAbsolute) {
              resolvedInputPath = path.resolve(expandHomePath(body.partialPath));
            } else {
              if (!body.cwd) {
                throw new Error("cwd is required for relative path browsing");
              }
              resolvedInputPath = path.resolve(expandHomePath(body.cwd), body.partialPath);
            }

            const endsWithSeparator = /[\\/]$/.test(body.partialPath) || body.partialPath === "~";
            const parentPath = endsWithSeparator
              ? resolvedInputPath
              : path.dirname(resolvedInputPath);

            const dirents = await fs.promises.readdir(parentPath, { withFileTypes: true });
            const entries = dirents
              .filter((dirent) => dirent.isDirectory())
              .map((dirent) => ({
                name: dirent.name,
                fullPath: path.join(parentPath, dirent.name),
              }));

            return {
              parentPath,
              entries,
            };
          },
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to browse path '${body.partialPath}': ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsWriteFile: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveWorkspaceWritePath({
          workspaceRoot: body.cwd,
          relativePath: body.relativePath,
          path,
        });
        yield* fileSystem
          .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to prepare workspace path: ${String(cause)}`,
                }),
            ),
          );
        yield* fileSystem.writeFileString(target.absolutePath, body.contents).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to write workspace file: ${String(cause)}`,
              }),
          ),
        );
        return { relativePath: target.relativePath };
      }

      case WS_METHODS.projectsReadFile: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveWorkspaceReadPath({
          workspaceRoot: body.cwd,
          relativePath: body.relativePath,
          path,
        });
        const contents = yield* fileSystem.readFileString(target.absolutePath).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to read workspace file: ${String(cause)}`,
              }),
          ),
        );
        return {
          relativePath: target.relativePath,
          contents,
        };
      }

      case WS_METHODS.shellOpenInEditor: {
        const body = stripRequestTag(request.body);
        return yield* openInEditor(body);
      }

      case WS_METHODS.gitStatus: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.status(body);
      }

      case WS_METHODS.gitPull: {
        const body = stripRequestTag(request.body);
        return yield* git.pullCurrentBranch(body.cwd);
      }

      case WS_METHODS.gitFetch: {
        const body = stripRequestTag(request.body);
        return yield* git.fetchLatest(body);
      }

      case WS_METHODS.gitRunStackedAction: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.runStackedAction(body, {
          actionId: body.actionId,
          progressReporter: {
            publish: (event) =>
              pushBus.publishClient(ws, WS_CHANNELS.gitActionProgress, event).pipe(Effect.asVoid),
          },
        });
      }

      case WS_METHODS.gitResolvePullRequest: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.resolvePullRequest(body);
      }

      case WS_METHODS.gitGenerateDiffSummary: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.generateDiffSummary(body);
      }

      case WS_METHODS.gitGenerateReview: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.generateReview(body, {
          onCostPreview: (event) =>
            pushBus.publishClient(ws, WS_CHANNELS.reviewCostPreview, event).pipe(Effect.asVoid),
          onProgress: (event) =>
            pushBus.publishClient(ws, WS_CHANNELS.reviewProgress, event).pipe(Effect.asVoid),
        });
      }

      case WS_METHODS.gitSubmitFindingFeedback: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.submitFindingFeedback(body);
      }

      case WS_METHODS.gitGetReviewHistory: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.getReviewHistory(body);
      }

      case WS_METHODS.gitListPullRequests: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.listPullRequests(body);
      }

      case WS_METHODS.gitMutatePullRequest: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.mutatePullRequest(body);
      }

      case WS_METHODS.gitCreatePullRequest: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.createPullRequest(body);
      }

      case WS_METHODS.gitPreparePullRequestThread: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.preparePullRequestThread(body);
      }

      case WS_METHODS.gitListBranches: {
        const body = stripRequestTag(request.body);
        return yield* git.listBranches(body);
      }

      case WS_METHODS.gitListWorkflowRuns: {
        const body = stripRequestTag(request.body);
        return yield* git.listWorkflowRuns(body);
      }

      case WS_METHODS.gitCreateWorktree: {
        const body = stripRequestTag(request.body);
        return yield* git.createWorktree(body);
      }

      case WS_METHODS.gitRemoveWorktree: {
        const body = stripRequestTag(request.body);
        return yield* git.removeWorktree(body);
      }

      case WS_METHODS.gitCreateBranch: {
        const body = stripRequestTag(request.body);
        return yield* git.createBranch(body);
      }

      case WS_METHODS.gitCreateFork: {
        const body = stripRequestTag(request.body);
        return yield* git.createFork(body);
      }

      case WS_METHODS.gitCheckout: {
        const body = stripRequestTag(request.body);
        return yield* Effect.scoped(git.checkoutBranch(body));
      }

      case WS_METHODS.gitRenameBranch: {
        const body = stripRequestTag(request.body);
        return yield* git.renameBranch(body);
      }

      case WS_METHODS.gitDeleteBranch: {
        const body = stripRequestTag(request.body);
        return yield* git.deleteBranch({
          cwd: body.cwd,
          branch: body.branch,
          ...(body.force !== undefined ? { force: body.force } : {}),
        });
      }

      case WS_METHODS.gitSetBranchUpstream: {
        const body = stripRequestTag(request.body);
        return yield* git.setBranchUpstream(body);
      }

      case WS_METHODS.gitInit: {
        const body = stripRequestTag(request.body);
        return yield* git.initRepo(body);
      }

      case WS_METHODS.gitHistory: {
        const body = stripRequestTag(request.body);
        return yield* git.history(body);
      }

      case WS_METHODS.gitDiff: {
        const body = stripRequestTag(request.body);
        return yield* git.diff(body);
      }

      case WS_METHODS.gitStageFiles: {
        const body = stripRequestTag(request.body);
        return yield* git.stageFiles(body);
      }

      case WS_METHODS.gitUnstageFiles: {
        const body = stripRequestTag(request.body);
        return yield* git.unstageFiles(body);
      }

      case WS_METHODS.gitDiscardChanges: {
        const body = stripRequestTag(request.body);
        return yield* git.discardChanges(body);
      }

      case WS_METHODS.gitSaveStash: {
        const body = stripRequestTag(request.body);
        return yield* git.saveStash(body);
      }

      case WS_METHODS.gitListStashes: {
        const body = stripRequestTag(request.body);
        return yield* git.listStashes(body);
      }

      case WS_METHODS.gitApplyStash: {
        const body = stripRequestTag(request.body);
        return yield* git.applyStash(body);
      }

      case WS_METHODS.gitDropStash: {
        const body = stripRequestTag(request.body);
        return yield* git.dropStash(body);
      }

      case WS_METHODS.gitResolveConflict: {
        const body = stripRequestTag(request.body);
        return yield* git.resolveConflict(body);
      }

      case WS_METHODS.gitConflictSnapshot: {
        const body = stripRequestTag(request.body);
        return yield* git.readConflictSnapshot(body);
      }

      case WS_METHODS.gitApplyHunk: {
        const body = stripRequestTag(request.body);
        return yield* git.applyHunk(body);
      }

      case WS_METHODS.gitMerge: {
        const body = stripRequestTag(request.body);
        return yield* git.mergeBranch(body);
      }

      case WS_METHODS.gitRebase: {
        const body = stripRequestTag(request.body);
        return yield* git.rebaseBranch(body);
      }

      case WS_METHODS.gitContinueOperation: {
        const body = stripRequestTag(request.body);
        return yield* git.continueOperation(body);
      }

      case WS_METHODS.gitAbortOperation: {
        const body = stripRequestTag(request.body);
        return yield* git.abortOperation(body);
      }

      case WS_METHODS.gitSkipRebase: {
        const body = stripRequestTag(request.body);
        return yield* git.skipRebase(body);
      }

      case WS_METHODS.gitPush: {
        const body = stripRequestTag(request.body);
        return yield* git.pushCurrentBranch(body.cwd, null);
      }

      case WS_METHODS.gitPerformRepositoryAction: {
        const body = stripRequestTag(request.body);
        const operation = body.operation;
        const args = (() => {
          switch (operation.action) {
            case "push_ref":
              return [
                "push",
                ...(operation.forceWithLease ? ["--force-with-lease"] : []),
                operation.remote,
                operation.ref,
              ];
            case "pull_ref":
              return ["pull", operation.remote, operation.ref];
            case "push_tag":
              return ["push", operation.remote, operation.tag];
            case "add_remote":
              return ["remote", "add", operation.name, operation.url];
            case "remove_remote":
              return ["remote", "remove", operation.name];
            case "reset":
              return ["reset", `--${operation.mode}`, operation.sha];
          }
        })();
        yield* git.execute({ operation: `GitCore.${operation.action}`, cwd: body.cwd, args });
        return undefined;
      }

      case WS_METHODS.gitPublishRelease: {
        const body = stripRequestTag(request.body);
        return yield* gitEnvironment.publishRelease(body);
      }

      case WS_METHODS.gitTriggerReleaseWorkflow: {
        const body = stripRequestTag(request.body);
        return yield* gitEnvironment.triggerReleaseWorkflow(body);
      }

      case WS_METHODS.gitEnvironment: {
        const body = stripRequestTag(request.body);
        return yield* gitEnvironment.detect(body);
      }

      case WS_METHODS.gitHubSwitchAccount: {
        const body = stripRequestTag(request.body);
        return yield* gitEnvironment.switchAccount(body);
      }

      case WS_METHODS.gitHubLogout: {
        const body = stripRequestTag(request.body);
        return yield* gitEnvironment.logout(body);
      }

      case WS_METHODS.gitAmendCommit: {
        const body = stripRequestTag(request.body);
        return yield* git.amendCommit(body);
      }

      case WS_METHODS.gitUndoLastCommit: {
        const body = stripRequestTag(request.body);
        return yield* git.undoLastCommit(body);
      }

      case WS_METHODS.gitRevertCommit: {
        const body = stripRequestTag(request.body);
        return yield* git.revertCommit(body);
      }

      case WS_METHODS.gitCherryPick: {
        const body = stripRequestTag(request.body);
        return yield* git.cherryPick(body);
      }

      case WS_METHODS.gitCreateTag: {
        const body = stripRequestTag(request.body);
        return yield* git.createTag(body);
      }

      case WS_METHODS.gitListTags: {
        const body = stripRequestTag(request.body);
        return yield* git.listTags(body);
      }

      case WS_METHODS.gitWatchedBranchStatuses: {
        const body = stripRequestTag(request.body);
        return yield* git.watchedBranchStatuses(body);
      }

      case WS_METHODS.terminalOpen: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.open(body);
      }

      case WS_METHODS.terminalList: {
        return yield* terminalManager.list();
      }

      case WS_METHODS.terminalWrite: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.write(body);
      }

      case WS_METHODS.terminalResize: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.resize(body);
      }

      case WS_METHODS.terminalClear: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.clear(body);
      }

      case WS_METHODS.terminalRestart: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.restart(body);
      }

      case WS_METHODS.terminalClose: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.close(body);
      }

      case WS_METHODS.previewOpen:
        return yield* previewManager.open(stripRequestTag(request.body));
      case WS_METHODS.previewNavigate:
        return yield* previewManager.navigate(stripRequestTag(request.body));
      case WS_METHODS.previewReportStatus:
        return yield* previewManager.reportStatus(stripRequestTag(request.body));
      case WS_METHODS.previewResize:
        return yield* previewManager.resize(stripRequestTag(request.body));
      case WS_METHODS.previewRefresh:
        return yield* previewManager.refresh(stripRequestTag(request.body));
      case WS_METHODS.previewClose:
        return yield* previewManager.close(stripRequestTag(request.body));
      case WS_METHODS.previewList:
        return yield* previewManager.list(stripRequestTag(request.body));
      case WS_METHODS.previewAutomationConnect: {
        const stream = yield* previewAutomationBroker.connect(stripRequestTag(request.body));
        const fiber = yield* Stream.runForEach(stream, (event) =>
          pushBus.publishClient(ws, WS_CHANNELS.previewAutomationEvent, event).pipe(Effect.asVoid),
        ).pipe(Effect.forkIn(subscriptionsScope));
        const fibers = previewAutomationFibers.get(ws) ?? new Set();
        fibers.add(fiber);
        previewAutomationFibers.set(ws, fibers);
        return { connected: true };
      }
      case WS_METHODS.previewAutomationFocusHost:
        return yield* previewAutomationBroker.focusHost(stripRequestTag(request.body));
      case WS_METHODS.previewAutomationRespond:
        return yield* previewAutomationBroker.respond(stripRequestTag(request.body));

      case WS_METHODS.subscribeDiscoveredLocalServers: {
        const body = stripRequestTag(request.body) as { configuredUrls?: ReadonlyArray<string> };
        const configuredUrls = body?.configuredUrls ?? [];
        yield* Scope.provide(subscriptionsScope)(portDiscovery.retain);
        const initial = yield* portDiscovery.scan(configuredUrls);
        const initialScannedAt = DateTime.formatIso(yield* DateTime.now);
        yield* pushBus.publishClient(ws, WS_CHANNELS.discoveredLocalServers, {
          servers: initial,
          scannedAt: initialScannedAt,
          configuredUrlProbing: true,
        });
        const unsubscribeFiber = yield* Scope.provide(subscriptionsScope)(
          portDiscovery.subscribe({ configuredUrls, initialSnapshot: initial }, (servers) =>
            Effect.gen(function* () {
              const scannedAt = DateTime.formatIso(yield* DateTime.now);
              yield* pushBus.publishClient(ws, WS_CHANNELS.discoveredLocalServers, {
                servers,
                scannedAt,
                configuredUrlProbing: true,
              });
            }),
          ),
        ).pipe(Effect.forkIn(subscriptionsScope));
        const fibers = previewAutomationFibers.get(ws) ?? new Set();
        fibers.add(unsubscribeFiber);
        previewAutomationFibers.set(ws, fibers);
        return {
          servers: initial,
          scannedAt: initialScannedAt,
          configuredUrlProbing: true,
        };
      }

      case WS_METHODS.serverGetConfig: {
        const keybindingsConfig = yield* keybindingsManager.loadConfigState;
        const settings = yield* serverSettingsManager.getSettings;
        const rawProviders = yield* Ref.get(providersRef);
        const usageLimitSourcesSnapshot = yield* usageLimitSources.current;
        const providers = withUsageLimitsCommands(rawProviders as any, usageLimitSourcesSnapshot);
        return {
          environment: yield* serverEnvironment.getDescriptor,
          auth: yield* environmentAuth.getDescriptor(),
          cwd,
          keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors,
          observability: {
            logsDirectoryPath: serverConfig.logsDir,
            localTracingEnabled: true,
            otlpTracesEnabled: false,
            otlpMetricsEnabled: false,
          },
          settings,
          environmentThemes: yield* environmentTheme.current,
          usageLimitSources: usageLimitSourcesSnapshot,
        };
      }

      case WS_METHODS.serverGetProcessDiagnostics:
        return yield* Effect.tryPromise({
          try: () => readProcessDiagnostics(),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

      case WS_METHODS.serverGetProcessResourceHistory:
        return yield* Effect.tryPromise({
          try: () =>
            readProcessResourceHistory(
              stripRequestTag(request.body) as ServerProcessResourceHistoryInput,
            ),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

      case WS_METHODS.serverGetResourceTelemetry: {
        const policy = yield* backgroundPolicy.snapshot;
        return yield* Effect.tryPromise({
          try: () => readResourceTelemetrySnapshot(policy.hostPower),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      case WS_METHODS.serverGetResourceTelemetryHistory: {
        const policy = yield* backgroundPolicy.snapshot;
        return yield* Effect.tryPromise({
          try: () =>
            readResourceTelemetryHistory(
              stripRequestTag(request.body) as ResourceTelemetryHistoryInput,
              policy.hostPower,
            ),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      case WS_METHODS.serverRetryResourceTelemetry: {
        const policy = yield* backgroundPolicy.snapshot;
        return yield* Effect.tryPromise({
          try: () => retryResourceTelemetry(policy.hostPower),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      case WS_METHODS.subscribeResourceTelemetry: {
        const policy = yield* backgroundPolicy.snapshot;
        const initial = yield* Effect.tryPromise({
          try: () => readResourceTelemetrySnapshot(policy.hostPower),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        yield* pushBus.publishClient(ws, WS_CHANNELS.resourceTelemetryUpdated, initial);
        yield* Scope.provide(subscriptionsScope)(
          Effect.forkScoped(
            Effect.gen(function* () {
              while (true) {
                yield* Effect.sleep("5 seconds");
                const currentPolicy = yield* backgroundPolicy.snapshot;
                const snapshot = yield* Effect.tryPromise({
                  try: () => readResourceTelemetrySnapshot(currentPolicy.hostPower),
                  catch: () => null,
                });
                if (snapshot) {
                  yield* pushBus.publishClient(ws, WS_CHANNELS.resourceTelemetryUpdated, snapshot);
                }
              }
            }),
          ),
        );
        return { subscribed: true };
      }

      case WS_METHODS.serverSignalProcess:
        return yield* Effect.tryPromise({
          try: () => signalProcess(stripRequestTag(request.body) as ServerSignalProcessInput),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

      case WS_METHODS.serverGetTraceDiagnostics: {
        recordResourceAttribution({
          component: "server-trace",
          operation: "read",
          logicalReadBytes: 8192,
          count: 1,
          durationMs: 5,
        });
        return yield* TraceDiagnostics.readTraceDiagnostics({
          traceFilePath: serverConfig.serverTracePath,
          maxFiles: 5,
        });
      }

      case WS_METHODS.serverCreateSupportBundle: {
        recordResourceAttribution({
          component: "support-bundle",
          operation: "export",
          logicalReadBytes: 4096,
          logicalWriteBytes: 16384,
          count: 1,
          durationMs: 20,
        });
        const descriptor = yield* serverEnvironment.getDescriptor;
        const traces = yield* TraceDiagnostics.readTraceDiagnostics({
          traceFilePath: serverConfig.serverTracePath,
          maxFiles: 5,
        });
        return yield* Effect.tryPromise({
          try: () =>
            createSupportBundle({
              environmentId: descriptor.environmentId,
              appVersion: descriptor.serverVersion,
              traces,
            }),
          catch: (cause) =>
            new RouteRequestError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      case WS_METHODS.serverReportClientActivity: {
        const sessionId = websocketSessions.get(ws) ?? AuthSessionId.make("local-desktop");
        const rpcClientId = websocketClientIds.get(ws) ?? RpcClientId.make(0);
        yield* backgroundPolicy.reportClientActivity(
          sessionId,
          rpcClientId,
          stripRequestTag(request.body),
        );
        return undefined;
      }

      case WS_METHODS.serverReportHostPowerState:
        yield* backgroundPolicy.reportHostPowerState(stripRequestTag(request.body));
        return undefined;

      case WS_METHODS.serverGetBackgroundPolicy:
        return yield* backgroundPolicy.snapshot;

      case WS_METHODS.serverRefreshProviders: {
        const body = request.body ? (stripRequestTag(request.body) as any) : undefined;
        if (body?.instanceId === undefined) {
          yield* usageLimitSources.refresh;
        }
        const providers = yield* body?.cwd !== undefined && body?.instanceId !== undefined
          ? providerRegistry.refreshWorkspaceSnapshot({
              instanceId: body.instanceId,
              cwd: body.cwd,
            })
          : body?.instanceId !== undefined
            ? providerRegistry.refreshInstance(body.instanceId)
            : providerRegistry.refresh();
        yield* Ref.set(providersRef, providers);
        const effectiveProviders = yield* getEffectiveProviders(providers);
        return { providers: effectiveProviders };
      }

      case WS_METHODS.serverRunProviderMaintenance: {
        const body = stripRequestTag(request.body);
        const providers = yield* providerRegistry.getProviders;
        const target = providers.find((candidate) => candidate.instanceId === body.instanceId);
        if (!target) {
          return yield* new RouteRequestError({
            message: `Unknown provider instance: ${body.instanceId}`,
          });
        }
        const result = yield* (
          body.action === "install"
            ? providerMaintenanceRunner.installProvider({
                provider: target.driver,
                instanceId: body.instanceId,
              })
            : providerMaintenanceRunner.updateProvider({
                provider: target.driver,
                instanceId: body.instanceId,
              })
        ).pipe(Effect.mapError((error: any) => new RouteRequestError({ message: error.reason })));
        yield* Ref.set(providersRef, result.providers);
        const effectiveProviders = yield* getEffectiveProviders(result.providers);
        return { ...result, providers: effectiveProviders };
      }

      case WS_METHODS.providerConsumeResetCredit: {
        const input = stripRequestTag(request.body) as ProviderConsumeResetCreditInput;
        if ("sourceId" in input) {
          const outcome = yield* usageLimitSources.consumeResetCredit(input).pipe(
            Effect.mapError(
              (error: any) =>
                new RouteRequestError({
                  message:
                    error?.detail ?? (error instanceof Error ? error.message : String(error)),
                }),
            ),
          );
          return outcome;
        }
        const instance = yield* providerInstances.getInstance(input.instanceId);
        if (instance === undefined || !instance.enabled) {
          return yield* new RouteRequestError({
            message: instance ? "This provider is disabled." : "Provider instance not found.",
          });
        }
        if (instance.consumeResetCredit === undefined) {
          return yield* new RouteRequestError({
            message: "This provider does not bank reset credits.",
          });
        }
        const outcome = yield* instance.consumeResetCredit().pipe(
          Effect.mapError(
            (error) =>
              new RouteRequestError({
                message: error.detail,
              }),
          ),
        );
        return { outcome };
      }

      case WS_METHODS.serverUpsertKeybinding: {
        const body = stripRequestTag(request.body);
        const keybindingsConfig = yield* keybindingsManager.upsertKeybindingRule(body);
        return { keybindings: keybindingsConfig, issues: [] };
      }

      case WS_METHODS.serverBatchUpsertKeybindings: {
        const body = stripRequestTag(request.body);
        const result = yield* keybindingsManager.batchUpsertKeybindingRules(body.rules);
        return {
          keybindings: result.keybindings,
          issues: [],
          importedCount: result.importedCount,
        };
      }

      case WS_METHODS.serverRemoveKeybinding: {
        const body = stripRequestTag(request.body);
        const keybindingsConfig = yield* keybindingsManager.removeKeybindingRule(body);
        return { keybindings: keybindingsConfig, issues: [] };
      }

      case WS_METHODS.serverGetSettings: {
        return yield* serverSettingsManager.getSettings;
      }

      case WS_METHODS.serverUpdateSettings: {
        const body = stripRequestTag(request.body);
        return yield* serverSettingsManager.updateSettings(body.patch);
      }

      case WS_METHODS.serverDiscoverSourceControl: {
        return yield* Effect.promise(() => discoverSourceControl());
      }

      case WS_METHODS.serverCloneRepository: {
        const body = stripRequestTag(request.body);
        console.log("[DIAG-SERVER] serverCloneRepository received request body:", body);
        let remoteUrl = body.remoteUrl ?? "";
        if (!remoteUrl && body.repository) {
          const repo = body.repository;
          if (
            repo.startsWith("http://") ||
            repo.startsWith("https://") ||
            repo.startsWith("git@") ||
            repo.startsWith("ssh://")
          ) {
            remoteUrl = repo;
          } else if (body.provider) {
            switch (body.provider) {
              case "github": {
                const result = yield* Effect.promise(() =>
                  runProcess("gh", ["repo", "view", repo, "--json", "url,sshUrl"], {
                    timeoutMs: 15000,
                    allowNonZeroExit: true,
                  }),
                );
                if (result.code === 0) {
                  const parsed = tryParseJson(result.stdout);
                  remoteUrl = parsed?.sshUrl || parsed?.url || `https://github.com/${repo}.git`;
                } else {
                  remoteUrl = `https://github.com/${repo}.git`;
                }
                break;
              }
              case "gitlab": {
                const result = yield* Effect.promise(() =>
                  runProcess("glab", ["api", `projects/${encodeURIComponent(repo)}`], {
                    timeoutMs: 15000,
                    allowNonZeroExit: true,
                  }),
                );
                if (result.code === 0) {
                  const parsed = tryParseJson(result.stdout);
                  remoteUrl =
                    parsed?.ssh_url_to_repo ||
                    parsed?.http_url_to_repo ||
                    `https://gitlab.com/${repo}.git`;
                } else {
                  remoteUrl = `https://gitlab.com/${repo}.git`;
                }
                break;
              }
              case "azure-devops": {
                const result = yield* Effect.promise(() =>
                  runProcess("az", ["repos", "show", "--detect", "true", "--repository", repo], {
                    timeoutMs: 15000,
                    allowNonZeroExit: true,
                  }),
                );
                if (result.code === 0) {
                  const parsed = tryParseJson(result.stdout);
                  remoteUrl =
                    parsed?.sshUrl || parsed?.remoteUrl || `https://dev.azure.com/${repo}`;
                } else {
                  remoteUrl = repo.startsWith("http") ? repo : `https://dev.azure.com/${repo}`;
                }
                break;
              }
              case "bitbucket": {
                const email = process.env.T3CODE_BITBUCKET_EMAIL;
                const apiToken = process.env.T3CODE_BITBUCKET_API_TOKEN;
                const accessToken = process.env.T3CODE_BITBUCKET_ACCESS_TOKEN;
                if (accessToken) {
                  remoteUrl = `https://x-token-auth:${encodeURIComponent(accessToken)}@bitbucket.org/${repo}.git`;
                } else if (email && apiToken) {
                  remoteUrl = `https://${encodeURIComponent(email)}:${encodeURIComponent(apiToken)}@bitbucket.org/${repo}.git`;
                } else {
                  remoteUrl = `https://bitbucket.org/${repo}.git`;
                }
                break;
              }
              default:
                remoteUrl = repo;
            }
          } else {
            remoteUrl = repo;
          }
        }
        console.log("[DIAG-SERVER] serverCloneRepository resolved remoteUrl:", remoteUrl);
        if (!remoteUrl) {
          console.log("[DIAG-SERVER] serverCloneRepository error: remoteUrl is empty");
          return yield* new RouteRequestError({
            message: "No remote URL or repository specified.",
          });
        }
        let dest = body.destinationPath;
        if (dest.startsWith("~/")) {
          const home = process.env.HOME || process.env.USERPROFILE || "";
          dest = dest.replace(/^~\//, home + "/");
        }
        console.log("[DIAG-SERVER] serverCloneRepository resolved dest path:", dest);
        const git = yield* GitCore;
        console.log("[DIAG-SERVER] serverCloneRepository running git clone command...");
        const cloneResult = yield* git.execute({
          operation: "clone",
          cwd: process.cwd(),
          args: ["clone", remoteUrl, dest],
        });
        console.log(
          "[DIAG-SERVER] serverCloneRepository clone succeeded, cloneResult:",
          cloneResult,
        );
        return {
          cwd: dest,
          remoteUrl,
          repository: body.repository
            ? {
                provider: body.provider ?? "unknown",
                nameWithOwner: body.repository,
                url: remoteUrl,
                sshUrl: remoteUrl,
              }
            : null,
        };
      }

      case WS_METHODS.serverLookupRepository: {
        const body = stripRequestTag(request.body);
        const { provider, repository } = body;
        switch (provider) {
          case "github": {
            const result = yield* Effect.promise(() =>
              runProcess("gh", ["repo", "view", repository, "--json", "nameWithOwner,url,sshUrl"], {
                timeoutMs: 15000,
                allowNonZeroExit: true,
              }),
            );
            if (result.code === 0) {
              const parsed = tryParseJson(result.stdout);
              if (parsed && parsed.url && parsed.sshUrl) {
                return {
                  provider: "github" as const,
                  nameWithOwner: parsed.nameWithOwner,
                  url: parsed.url,
                  sshUrl: parsed.sshUrl,
                };
              }
            }
            return yield* new RouteRequestError({
              message: `Failed to find GitHub repository "${repository}". Make sure it exists and you are authenticated in the GitHub CLI.`,
            });
          }
          case "gitlab": {
            const result = yield* Effect.promise(() =>
              runProcess("glab", ["api", `projects/${encodeURIComponent(repository)}`], {
                timeoutMs: 15000,
                allowNonZeroExit: true,
              }),
            );
            if (result.code === 0) {
              const parsed = tryParseJson(result.stdout);
              if (parsed && (parsed.web_url || parsed.ssh_url_to_repo)) {
                return {
                  provider: "gitlab" as const,
                  nameWithOwner: parsed.path_with_namespace || repository,
                  url: parsed.web_url || `https://gitlab.com/${repository}`,
                  sshUrl: parsed.ssh_url_to_repo || `git@gitlab.com:${repository}.git`,
                };
              }
            }
            return yield* new RouteRequestError({
              message: `Failed to find GitLab repository "${repository}". Make sure it exists and you are authenticated in the GitLab CLI.`,
            });
          }
          case "azure-devops": {
            const result = yield* Effect.promise(() =>
              runProcess("az", ["repos", "show", "--detect", "true", "--repository", repository], {
                timeoutMs: 15000,
                allowNonZeroExit: true,
              }),
            );
            if (result.code === 0) {
              const parsed = tryParseJson(result.stdout);
              if (parsed && (parsed.remoteUrl || parsed.sshUrl)) {
                return {
                  provider: "azure-devops" as const,
                  nameWithOwner: parsed.name,
                  url: parsed.remoteUrl,
                  sshUrl: parsed.sshUrl,
                };
              }
            }
            return yield* new RouteRequestError({
              message: `Failed to find Azure DevOps repository "${repository}". Make sure it exists and you are authenticated in the Azure CLI.`,
            });
          }
          case "bitbucket": {
            return {
              provider: "bitbucket" as const,
              nameWithOwner: repository,
              url: `https://bitbucket.org/${repository}.git`,
              sshUrl: `git@bitbucket.org:${repository}.git`,
            };
          }
          case "unknown": {
            return yield* new RouteRequestError({
              message: "Cannot lookup repository with unknown provider.",
            });
          }
          default: {
            const _exhaustiveCheck: never = provider;
            return yield* new RouteRequestError({
              message: `Unsupported provider: ${String(_exhaustiveCheck)}`,
            });
          }
        }
      }

      case WS_METHODS.usageReadSummary: {
        const body = stripRequestTag(request.body) as UsageSummaryInput;
        return yield* usageService.readSummary(body).pipe(
          Effect.catchCause(
            (cause) =>
              new RouteRequestError({
                message: `Usage summary read failed: ${Cause.squash(cause)}`,
              }),
          ),
        );
      }

      case WS_METHODS.usageListSnapshots: {
        const body = stripRequestTag(request.body) as ServerListProviderUsageInput;
        return yield* listProviderUsageSnapshotsEffect(body);
      }

      case WS_METHODS.usageRefreshAll: {
        return yield* listProviderUsageSnapshotsEffect({ forceRefresh: true });
      }

      default: {
        const _exhaustiveCheck: never = request.body;
        return yield* new RouteRequestError({
          message: `Unknown method: ${String(_exhaustiveCheck)}`,
        });
      }
    }
  });

  const handleMessage = Effect.fnUntraced(function* (ws: WebSocket, raw: unknown) {
    const sendWsResponse = (response: WsResponseMessage) =>
      encodeWsResponse(response).pipe(
        Effect.tap((encodedResponse) => Effect.sync(() => ws.send(encodedResponse))),
        Effect.asVoid,
      );

    const messageText = websocketRawToString(raw);
    if (messageText === null) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: "Invalid request format: Failed to read message" },
      });
    }

    const request = decodeWebSocketRequest(messageText);
    if (Result.isFailure(request)) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: `Invalid request format: ${formatSchemaError(request.failure)}` },
      });
    }

    const startedAt = yield* Clock.currentTimeNanos;
    const result = yield* Effect.exit(routeRequest(ws, request.success));
    const endedAt = yield* Clock.currentTimeNanos;
    const elapsedNanos = endedAt > startedAt ? endedAt - startedAt : 0n;
    const durationMs = Number(elapsedNanos / 1_000_000n);
    const methodTag = (request.success.body as { _tag?: string })?._tag ?? "unknown";
    recordResourceAttribution({
      component: "rpc",
      operation: methodTag,
      count: 1,
      durationMs,
    });

    if (durationMs > 5_000) {
      yield* Effect.logWarning(
        `Slow RPC handler: ${methodTag} took ${durationMs}ms (id: ${request.success.id})`,
      );
    }
    if (Exit.isFailure(result)) {
      const failure = Cause.findErrorOption(result.cause);
      const errVal: any =
        Option.isSome(failure) && typeof failure.value === "object" && failure.value !== null
          ? failure.value
          : null;
      const userMessage =
        errVal && "message" in errVal ? String(errVal.message) : "Internal server error";
      const phase = errVal && "phase" in errVal && errVal.phase ? String(errVal.phase) : undefined;
      const createdCommitSha =
        errVal && "createdCommitSha" in errVal && errVal.createdCommitSha
          ? String(errVal.createdCommitSha)
          : undefined;
      return yield* sendWsResponse({
        id: request.success.id,
        error: {
          message: userMessage,
          ...(phase ? { phase } : {}),
          ...(createdCommitSha ? { createdCommitSha } : {}),
        },
      });
    }

    return yield* sendWsResponse({
      id: request.success.id,
      result: result.value,
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {}); // Prevent unhandled `EPIPE`/`ECONNRESET` from crashing the process if the client disconnects mid-handshake

    let upgradeUrl: URL;
    try {
      upgradeUrl = new URL(request.url ?? "/", `http://localhost:${port}`);
    } catch {
      rejectUpgrade(socket, 400, "Invalid WebSocket URL");
      return;
    }

    const completeUpgrade = (sessionId = AuthSessionId.make("local-desktop")) =>
      wss.handleUpgrade(request, socket, head, (ws) => {
        websocketSessions.set(ws, sessionId);
        websocketClientIds.set(ws, RpcClientId.make(nextRpcClientId++));
        wss.emit("connection", ws, request);
      });

    const providedToken = upgradeUrl.searchParams.get("token");
    if (!authToken || providedToken === authToken) {
      completeUpgrade();
      return;
    }

    const ticket = upgradeUrl.searchParams.get("wsTicket");
    if (!ticket) {
      rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
      return;
    }
    void runPromise(sessionStore.verifyWebSocketToken(ticket).pipe(Effect.exit)).then(
      (verified) => {
        if (Exit.isFailure(verified)) {
          rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
          return;
        }
        completeUpgrade(verified.value.sessionId);
      },
    );
  });

  wss.on("connection", (ws) => {
    const segments = cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";

    const welcomeData = {
      cwd,
      projectName,
      ...(welcomeBootstrapProjectId ? { bootstrapProjectId: welcomeBootstrapProjectId } : {}),
      ...(welcomeBootstrapThreadId ? { bootstrapThreadId: welcomeBootstrapThreadId } : {}),
    };
    // Send welcome before adding to broadcast set so publishAll calls
    // cannot reach this client before the welcome arrives.
    void runPromise(
      readiness.awaitServerReady.pipe(
        Effect.flatMap(() => pushBus.publishClient(ws, WS_CHANNELS.serverWelcome, welcomeData)),
        Effect.flatMap((delivered) =>
          delivered ? Ref.update(clients, (clients) => clients.add(ws)) : Effect.void,
        ),
      ),
    );

    ws.on("message", (raw) => {
      void runPromise(handleMessage(ws, raw).pipe(Effect.ignoreCause({ log: true })));
    });

    ws.on("close", () => {
      const sessionId = websocketSessions.get(ws);
      const rpcClientId = websocketClientIds.get(ws);
      void runPromise(
        Effect.all(
          [
            Ref.update(clients, (clients) => {
              clients.delete(ws);
              return clients;
            }),
            Effect.forEach(previewAutomationFibers.get(ws) ?? [], Fiber.interrupt, {
              discard: true,
            }),
            sessionId && rpcClientId
              ? backgroundPolicy.removeRpcClient(sessionId, rpcClientId)
              : Effect.void,
          ],
          { discard: true },
        ).pipe(Effect.ensuring(Effect.sync(() => previewAutomationFibers.delete(ws)))),
      );
    });

    ws.on("error", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });
  });

  return httpServer;
});

export const ServerLive = Layer.effect(
  Server,
  Effect.gen(function* () {
    const stopSignalDeferred = yield* Deferred.make<void>();
    const runtimeServices = yield* Effect.context();
    const runFork = Effect.runForkWith(runtimeServices);

    const handler = () => {
      runFork(Deferred.succeed(stopSignalDeferred, undefined).pipe(Effect.orDie));
    };

    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        process.off("SIGTERM", handler);
        process.off("SIGINT", handler);
      }),
    );

    return {
      start: createServer(),
      stopSignal: Deferred.await(stopSignalDeferred).pipe(Effect.orDie),
    } satisfies ServerShape;
  }),
);

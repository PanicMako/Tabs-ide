import * as McpProtocol from "effect/unstable/ai/McpProtocol";
import { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient.ts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { AiError, McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OrchestratorMcpFailure,
  PreviewAutomationError,
  type PreviewAutomationOperation,
  type PreviewTabId,
} from "@tabs/contracts";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import * as ExtensionGateway from "./ExtensionMcpGateway.ts";
import * as ExtensionThreads from "../orchestration-v2/ThreadManagementService.ts";
import * as ExtensionProjects from "../orchestration-v2/ProjectStore.ts";
import * as DeviceService from "../device/DeviceService.ts";
import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import * as PreviewBrowser from "../htmlRender/PreviewBrowser.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import { PreviewControlsToolkit } from "./toolkits/previewControls/tools.ts";
import * as PreviewControlsHandlers from "./toolkits/previewControls/handlers.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import * as EnvironmentHandlers from "./toolkits/environment/handlers.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import * as ProjectHandlers from "./toolkits/project/handlers.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import * as AttachmentHandlers from "./toolkits/attachment/handlers.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import * as ThreadHandlers from "./toolkits/thread/handlers.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as OrchestratorHandlers from "./toolkits/orchestrator/handlers.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import * as PreviewHandlers from "./toolkits/preview/handlers.ts";
import {
  PreviewSnapshotTool,
  PreviewSnapshotToolkit,
  PreviewStandardToolkit,
} from "./toolkits/preview/tools.ts";
import * as WorktreeHandlers from "./toolkits/worktree/handlers.ts";
import { WorktreeToolkit } from "./toolkits/worktree/tools.ts";
import * as WorktreeMcpService from "./WorktreeMcpService.ts";
import * as PullRequestsHandlers from "./toolkits/pullRequests/handlers.ts";
import { PullRequestsToolkit } from "./toolkits/pullRequests/tools.ts";
import * as DeviceHandlers from "./toolkits/device/handlers.ts";
import {
  DeviceScreenshotTool,
  DeviceScreenshotToolkit,
  DeviceStandardToolkit,
} from "./toolkits/device/tools.ts";
import * as HtmlHandlers from "./toolkits/html/handlers.ts";
import { HtmlPreviewTool, HtmlPreviewToolkit, HtmlRenderToolkit } from "./toolkits/html/tools.ts";

const unauthorized = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mcp_credential",
    message: "A valid provider-scoped MCP bearer credential is required.",
  },
  {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": "Bearer",
    },
  },
);

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

export const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

export const makeMcpAuthMiddleware = Effect.gen(function* () {
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const services = yield* Effect.context<never>();
  return Effect.fn("McpHttpServer.authenticateRequest")(function* (
    httpEffect: AuthenticatedHttpEffect,
  ) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authorization = request.headers.authorization;
    const token =
      authorization?.startsWith("Bearer ") === true ? authorization.slice(7).trim() : "";
    const invocation = yield* registry.resolve(token);
    if (!invocation) return unauthorized;
    const config = Context.getOrUndefined(services, ServerConfig.ServerConfig);
    const threads = Context.getOrUndefined(services, ExtensionThreads.ThreadManagementService);
    const projects = Context.getOrUndefined(services, ExtensionProjects.ProjectStoreV2);
    const configuration = config?.desktopExtensionBroker;
    const gateway =
      configuration && threads && projects && invocation.thread
        ? {
            broker: new ExtensionAiBrokerClient(configuration),
            resolveProjectId: () =>
              Effect.runPromise(
                Effect.gen(function* () {
                  const shell = yield* threads.getThreadShell(invocation.thread!.threadId);
                  if (!shell || shell.deletedAt !== null) return undefined;
                  const project = yield* projects.get(shell.projectId);
                  return Option.isSome(project) ? project.value.projectId : undefined;
                }),
              ),
          }
        : undefined;
    const payload =
      gateway && request.method === "POST"
        ? yield* request.json.pipe(Effect.orElseSucceed(() => undefined))
        : undefined;
    const rpc = payload as
      | { id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } }
      | undefined;
    if (gateway && rpc?.method === "tools/call" && rpc.params?.name?.startsWith("tabs_ext_")) {
      const result = yield* Effect.tryPromise(() =>
        ExtensionGateway.invokeExtensionMcpTool(gateway, rpc.params!.name!, rpc.params?.arguments),
      ).pipe(
        Effect.catch((error) =>
          Effect.succeed({ isError: true, content: [{ type: "text", text: String(error.cause) }] }),
        ),
      );
      return HttpServerResponse.jsonUnsafe(
        { jsonrpc: "2.0", id: rpc.id, result },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const response = yield* httpEffect.pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.map(normalizeMcpHttpResponse),
    );
    if (!gateway || rpc?.method !== "tools/list" || response.status !== 200) return response;
    const tools = yield* Effect.tryPromise(() => ExtensionGateway.extensionMcpTools(gateway)).pipe(
      Effect.orElseSucceed(() => []),
    );
    if (tools.length === 0) return response;
    const body = yield* Effect.tryPromise(() =>
      HttpServerResponse.toWeb(response, { context: services }).text(),
    ).pipe(Effect.orDie);
    const updated = ExtensionGateway.appendExtensionTools(
      body,
      response.headers["content-type"] ?? "",
      tools,
    );
    return HttpServerResponse.text(updated, {
      status: response.status,
      headers: {
        ...response.headers,
        "content-length": String(new TextEncoder().encode(updated).byteLength),
        "content-type": response.headers["content-type"] ?? "application/json",
        "cache-control": "no-store",
      },
    });
  }) satisfies McpAuthMiddleware;
});

const layerMcpAuthMiddleware = HttpRouter.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(makeMcpAuthMiddleware).layer;

/**
 * Claude Code moves an MCP result above its output limit to a file and hands
 * the agent a notice instead, so a snapshot that carries the full
 * accessibility tree and page text loses its locators too. Claude Code also
 * shows the model `structuredContent` in place of the text blocks when a
 * result has both, so both carry the same bounded snapshot. Keep it near
 * 20 KB and tell the agent what was cut. The short `omitted` notes may go a
 * little over; the provider limit is far above this.
 */
export const MAX_SNAPSHOT_TEXT_BYTES = 20_000;
const MAX_SNAPSHOT_VISIBLE_TEXT_CHARS = 8_000;
const MAX_SNAPSHOT_ELEMENT_NAME_CHARS = 200;
const MAX_SNAPSHOT_LOG_ENTRIES = 40;
const MAX_SNAPSHOT_LOG_TEXT_CHARS = 500;
const MAX_SNAPSHOT_IDENTIFIER_CHARS = 2_048;

const encodeJsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const utf8Length = (text: string) => Buffer.byteLength(text, "utf8");
const cutText = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Shortens every string field of a log entry; other fields pass through. */
const cutEntryStrings = <A>(entry: A): A =>
  typeof entry === "object" && entry !== null
    ? (Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [
          key,
          typeof value === "string" ? cutText(value, MAX_SNAPSHOT_LOG_TEXT_CHARS) : value,
        ]),
      ) as A)
    : entry;

const hasLongString = (entry: unknown, max: number) =>
  typeof entry === "object" &&
  entry !== null &&
  Object.values(entry).some((value) => typeof value === "string" && value.length > max);

type SnapshotMetadata = {
  readonly url: string;
  readonly title: string;
  readonly visibleText: string;
  readonly interactiveElements: ReadonlyArray<{
    readonly name: string;
    readonly [key: string]: unknown;
  }>;
  readonly consoleEntries: ReadonlyArray<unknown>;
  readonly networkEntries: ReadonlyArray<unknown>;
  readonly actionTimeline: ReadonlyArray<unknown>;
  readonly [key: string]: unknown;
};

/**
 * Drops the accessibility tree, shortens page text, element names, identifiers,
 * and log strings, keeps only the newest log entries, and finally sheds
 * interactive elements until the JSON fits. Returns the bounded value, its
 * text, and notes on what is missing so the agent can reach for
 * preview_evaluate.
 */
const boundSnapshotMetadata = (metadata: SnapshotMetadata) => {
  const omitted: Array<string> = [];
  const { accessibilityTree, ...withoutTree } = metadata;
  if (accessibilityTree !== undefined) {
    omitted.push("accessibilityTree (use interactiveElements locators or preview_evaluate)");
  }
  const tail = <A>(entries: ReadonlyArray<A>, label: string) => {
    if (entries.length > MAX_SNAPSHOT_LOG_ENTRIES) {
      omitted.push(`${entries.length - MAX_SNAPSHOT_LOG_ENTRIES} older ${label}`);
    }
    const kept = entries.slice(-MAX_SNAPSHOT_LOG_ENTRIES);
    if (kept.some((entry) => hasLongString(entry, MAX_SNAPSHOT_LOG_TEXT_CHARS))) {
      omitted.push(`${label} text after ${MAX_SNAPSHOT_LOG_TEXT_CHARS} characters`);
    }
    return kept.map(cutEntryStrings);
  };
  if (
    metadata.url.length > MAX_SNAPSHOT_IDENTIFIER_CHARS ||
    metadata.title.length > MAX_SNAPSHOT_IDENTIFIER_CHARS
  ) {
    omitted.push(`url or title after ${MAX_SNAPSHOT_IDENTIFIER_CHARS} characters`);
  }
  if (
    metadata.interactiveElements.some(
      (element) => element.name.length > MAX_SNAPSHOT_ELEMENT_NAME_CHARS,
    )
  ) {
    omitted.push(`element names longer than ${MAX_SNAPSHOT_ELEMENT_NAME_CHARS} characters`);
  }
  const bounded = {
    ...withoutTree,
    url: cutText(metadata.url, MAX_SNAPSHOT_IDENTIFIER_CHARS),
    title: cutText(metadata.title, MAX_SNAPSHOT_IDENTIFIER_CHARS),
    interactiveElements: metadata.interactiveElements.map((element) => ({
      ...element,
      name: cutText(element.name, MAX_SNAPSHOT_ELEMENT_NAME_CHARS),
    })),
    consoleEntries: tail(metadata.consoleEntries, "console entries"),
    networkEntries: tail(metadata.networkEntries, "network entries"),
    actionTimeline: tail(metadata.actionTimeline, "action timeline entries"),
  };

  // Per-field caps do not sum below the ceiling: three log arrays of 40 capped
  // entries alone can pass 60 KB, and the caps count characters, not bytes.
  // Halve one thing per round until the JSON fits: logs first, then page
  // text, then the locators. The identifier caps bound the rest, so this
  // terminates.
  const shedOrder = [
    "actionTimeline",
    "networkEntries",
    "consoleEntries",
    "interactiveElements",
  ] as const;
  const lists: Record<(typeof shedOrder)[number], ReadonlyArray<unknown>> = {
    interactiveElements: bounded.interactiveElements,
    consoleEntries: bounded.consoleEntries,
    networkEntries: bounded.networkEntries,
    actionTimeline: bounded.actionTimeline,
  };
  const dropped: Record<(typeof shedOrder)[number], number> = {
    interactiveElements: 0,
    consoleEntries: 0,
    networkEntries: 0,
    actionTimeline: 0,
  };
  let visibleTextChars = Math.min(metadata.visibleText.length, MAX_SNAPSHOT_VISIBLE_TEXT_CHARS);
  const value = () => ({
    ...bounded,
    visibleText: cutText(metadata.visibleText, visibleTextChars),
    ...lists,
  });
  let text = encodeJsonText(value());
  while (utf8Length(text) > MAX_SNAPSHOT_TEXT_BYTES) {
    // Elements carry the locators, so they go last; logs shed newest-last.
    const key =
      shedOrder.find(
        (candidate) => candidate !== "interactiveElements" && lists[candidate].length > 0,
      ) ??
      (visibleTextChars > 0
        ? "visibleText"
        : lists.interactiveElements.length > 0
          ? "interactiveElements"
          : undefined);
    if (key === undefined) break;
    if (key === "visibleText") {
      visibleTextChars = Math.floor(visibleTextChars / 2);
    } else {
      const keep = Math.floor(lists[key].length / 2);
      dropped[key] += lists[key].length - keep;
      // slice(-0) keeps everything, so spell out the empty case.
      lists[key] =
        keep === 0
          ? []
          : key === "interactiveElements"
            ? lists[key].slice(0, keep)
            : lists[key].slice(-keep);
    }
    text = encodeJsonText(value());
  }
  if (visibleTextChars < metadata.visibleText.length) {
    omitted.push(
      `visibleText after ${visibleTextChars} characters (use preview_evaluate for more)`,
    );
  }
  for (const key of shedOrder) {
    if (dropped[key] > 0) {
      omitted.push(`${dropped[key]} of ${bounded[key].length} ${key}`);
    }
  }
  return { value: value(), text, omitted };
};

export class PreviewScreenshotSaveError extends Schema.TaggedError<PreviewScreenshotSaveError>()(
  "PreviewScreenshotSaveError",
  { screenshotPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not save preview screenshot to ${this.screenshotPath}.`;
  }
}

const MAX_SCREENSHOT_SITE_SLUG_LENGTH = 40;

/** Hostname reduced to a filename-safe slug, matching the desktop's own screenshot names. */
const screenshotSiteSlug = (rawUrl: string): string => {
  try {
    const slug = new URL(rawUrl).hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SCREENSHOT_SITE_SLUG_LENGTH)
      .replace(/-+$/g, "");
    return slug || "site";
  } catch {
    return "site";
  }
};

/** Writes the snapshot PNG under the browser artifacts directory and returns its path. */
const saveScreenshot = Effect.fn("McpHttpServer.saveScreenshot")(function* (
  pageUrl: string,
  data: Uint8Array,
) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const millis = yield* Clock.currentTimeMillis;
  const crypto = yield* Crypto.Crypto;
  // Two saves in the same millisecond must not overwrite each other.
  const unique = (yield* crypto.randomUUIDv4.pipe(Effect.orDie)).slice(0, 8);
  const fileName = `browser-screenshot-${screenshotSiteSlug(pageUrl)}-${millis.toString(36)}-${unique}.png`;
  const screenshotPath = path.join(config.browserArtifactsDir, fileName);
  yield* fileSystem.makeDirectory(config.browserArtifactsDir, { recursive: true }).pipe(
    Effect.andThen(fileSystem.writeFile(screenshotPath, data)),
    Effect.mapError((cause) => new PreviewScreenshotSaveError({ screenshotPath, cause })),
  );
  return screenshotPath;
});

const isPreviewAutomationError = Schema.is(PreviewAutomationError);

const previewSnapshotFailure = <E>(cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
    return Effect.failCause(cause).pipe(Effect.orDie);
  }
  const failures = cause.reasons.filter(Cause.isFailReason);
  const firstFailure = failures[0]?.error;
  const errorTag =
    typeof firstFailure === "object" &&
    firstFailure !== null &&
    "_tag" in firstFailure &&
    typeof firstFailure._tag === "string"
      ? firstFailure._tag
      : "PreviewSnapshotError";
  // Preview errors build their message on the server, never from page output,
  // and it tells the agent what to do next, such as falling back to a shell browser.
  const message = isPreviewAutomationError(firstFailure) ? firstFailure.message : undefined;
  const result = new McpSchema.CallToolResult({
    isError: true,
    structuredContent: {
      error: {
        _tag: errorTag,
        operation: "snapshot",
        failureCount: failures.length,
        ...(message === undefined ? {} : { message }),
      },
    },
    // Some clients show only the text content and others only structuredContent, so both carry it.
    content: [{ type: "text", text: `Preview snapshot failed: ${message ?? `${errorTag}.`}` }],
  });
  return Effect.logWarning("preview snapshot failed", {
    operation: "snapshot",
    errorTag,
    failureCount: failures.length,
  }).pipe(Effect.as(result));
};

const registerPreviewSnapshot = Effect.fn("McpHttpServer.registerPreviewSnapshot")(function* () {
  const server = yield* McpServer.McpServer;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  // The MCP tool runner only supplies the client, so hand the save path its services here.
  const saveServices = yield* Effect.context<
    ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path | Crypto.Crypto
  >();
  const built = yield* PreviewSnapshotToolkit;
  const tool = PreviewSnapshotTool;
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        ...Context.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined,
        ),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return built.handle("preview_snapshot", payload).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.flatMap(({ encodedResult }) =>
            Effect.gen(function* () {
              const snapshot = encodedResult as SnapshotMetadata & {
                readonly url: string;
                readonly screenshot: {
                  readonly mimeType: "image/png";
                  readonly data: string;
                  readonly width: number;
                  readonly height: number;
                };
              };
              const { screenshot, ...page } = snapshot;
              const png = new Uint8Array(Buffer.from(screenshot.data, "base64"));
              const screenshotPath =
                payload?.save === true ? yield* saveScreenshot(snapshot.url, png) : undefined;
              if (screenshotPath !== undefined && payload?.includeImage === false) {
                // The agent only wants a file to show the user. The url keeps the site icon on the tool row.
                const saved = {
                  url: cutText(snapshot.url, MAX_SNAPSHOT_IDENTIFIER_CHARS),
                  screenshotPath,
                };
                return new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: saved,
                  content: [{ type: "text", text: encodeJsonText(saved) }],
                });
              }
              const metadata = {
                ...page,
                screenshot: {
                  mimeType: screenshot.mimeType,
                  width: screenshot.width,
                  height: screenshot.height,
                },
                ...(screenshotPath === undefined ? {} : { screenshotPath }),
              };
              const bounded = boundSnapshotMetadata(metadata);
              return new McpSchema.CallToolResult({
                isError: false,
                structuredContent:
                  bounded.omitted.length === 0
                    ? bounded.value
                    : { ...bounded.value, omitted: bounded.omitted },
                content: [
                  // Keep the page identity readable even if a provider truncates the snapshot.
                  {
                    type: "text",
                    text: encodeJsonText({
                      url: cutText(snapshot.url, MAX_SNAPSHOT_IDENTIFIER_CHARS),
                    }),
                  },
                  { type: "text", text: bounded.text },
                  ...(bounded.omitted.length === 0
                    ? []
                    : [
                        {
                          type: "text" as const,
                          text: `Snapshot text was bounded. Omitted: ${bounded.omitted.join("; ")}.`,
                        },
                      ]),
                  ...(payload?.includeImage === false
                    ? []
                    : [{ type: "image" as const, data: png, mimeType: screenshot.mimeType }]),
                ],
              });
            }),
          ),
          Effect.provide(saveServices),
          Effect.matchCauseEffect({
            onFailure: previewSnapshotFailure,
            onSuccess: Effect.succeed,
          }),
        );
      }),
  });
});

interface ImageToolResult {
  readonly screenshot: {
    readonly mimeType: "image/png";
    readonly data: string;
    readonly width: number;
    readonly height: number;
  };
  readonly [key: string]: unknown;
}

/**
 * Failures surface only their tag unless the tool describes them: the remote
 * message may carry renderer or device output the agent should not see, and
 * the tag is what it can act on. A describer returns a server-built message.
 */
const imageToolFailure =
  <E>(toolName: string, operation: string, failureText: string | ((error: E) => string)) =>
  (cause: Cause.Cause<E>) => {
    if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
      return Effect.failCause(cause).pipe(Effect.orDie);
    }
    const failures = cause.reasons.filter(Cause.isFailReason);
    const firstFailure = failures[0]?.error;
    const errorTag =
      typeof firstFailure === "object" &&
      firstFailure !== null &&
      "_tag" in firstFailure &&
      typeof firstFailure._tag === "string"
        ? firstFailure._tag
        : `${toolName}Error`;
    const message =
      typeof failureText === "string" || failures[0] === undefined
        ? undefined
        : failureText(failures[0].error);
    const result = new McpSchema.CallToolResult({
      isError: true,
      structuredContent: {
        error: {
          _tag: errorTag,
          operation,
          failureCount: failures.length,
          ...(message === undefined ? {} : { message }),
        },
      },
      // Some clients show only the text content and others only structuredContent, so both carry it.
      content: [
        {
          type: "text",
          text: typeof failureText === "string" ? failureText : (message ?? `${toolName} failed.`),
        },
      ],
    });
    return Effect.logWarning(`${toolName} failed`, {
      operation,
      errorTag,
      failureCount: failures.length,
    }).pipe(Effect.as(result));
  };

/**
 * `McpServer.toolkit` serializes every result as JSON text, which is the
 * wrong shape for a screenshot: the model needs image content. Tools whose
 * result carries a `screenshot` field are registered by hand so the PNG goes
 * out as an image block and the rest of the payload as JSON metadata.
 */
const registerImageTool = <T extends Tool.Any, E, R>(
  tool: T,
  handle: (payload: Tool.Parameters<T>) => Effect.Effect<{ readonly encodedResult: unknown }, E, R>,
  provide: (
    effect: Effect.Effect<{ readonly encodedResult: unknown }, E, R>,
  ) => Effect.Effect<
    { readonly encodedResult: unknown },
    E,
    McpInvocationContext.McpInvocationContext
  >,
  operation: string,
  failureText: string | ((error: E) => string),
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    yield* server.addTool({
      tool: new McpSchema.Tool({
        name: tool.name,
        description: Tool.getDescription(tool),
        inputSchema: Tool.getJsonSchema(tool),
        annotations: {
          ...Context.getOption(tool.annotations, Tool.Title).pipe(
            Option.map((title) => ({ title })),
            Option.getOrUndefined,
          ),
          readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
          destructiveHint: Context.get(tool.annotations, Tool.Destructive),
          idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
          openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
        },
      }),
      annotations: tool.annotations,
      handle: (payload) =>
        Effect.withFiber((fiber) => {
          const invocation = Context.getUnsafe(
            fiber.context,
            McpInvocationContext.McpInvocationContext,
          );
          return provide(handle(payload as Tool.Parameters<T>)).pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.matchCauseEffect({
              onFailure: imageToolFailure(tool.name, operation, failureText),
              onSuccess: ({ encodedResult }) => {
                const { screenshot, ...rest } = encodedResult as ImageToolResult;
                const includeImage =
                  (payload as { readonly includeImage?: boolean } | undefined)?.includeImage !==
                  false;
                const metadata = {
                  ...rest,
                  screenshot: {
                    mimeType: screenshot.mimeType,
                    width: screenshot.width,
                    height: screenshot.height,
                  },
                };
                return Effect.succeed(
                  new McpSchema.CallToolResult({
                    isError: false,
                    structuredContent: metadata,
                    content: [
                      { type: "text", text: JSON.stringify(metadata) },
                      ...(includeImage
                        ? [
                            {
                              type: "image" as const,
                              data: new Uint8Array(Buffer.from(screenshot.data, "base64")),
                              mimeType: screenshot.mimeType,
                            },
                          ]
                        : []),
                    ],
                  }),
                );
              },
            }),
          );
        }),
    });
  });

const registerDeviceScreenshot = Effect.fn("McpHttpServer.registerDeviceScreenshot")(function* () {
  const devices = yield* DeviceService.DeviceService;
  const built = yield* DeviceScreenshotToolkit;
  yield* registerImageTool(
    DeviceScreenshotTool,
    (payload) =>
      built
        .handle("device_screenshot", payload)
        .pipe(Stream.unwrap, Stream.run(Sink.last()), Effect.flatMap(Effect.fromOption)),
    (effect) => effect.pipe(Effect.provideService(DeviceService.DeviceService, devices)),
    "screenshot",
    "Device screenshot failed.",
  );
});

const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);

const registerHtmlPreview = Effect.fn("McpHttpServer.registerHtmlPreview")(function* () {
  const htmlRender = yield* HtmlRender.HtmlRender;
  const built = yield* HtmlPreviewToolkit;
  yield* registerImageTool(
    HtmlPreviewTool,
    (payload) =>
      built
        .handle("html_preview", payload)
        .pipe(Stream.unwrap, Stream.run(Sink.last()), Effect.flatMap(Effect.fromOption)),
    (effect) => effect.pipe(Effect.provideService(HtmlRender.HtmlRender, htmlRender)),
    "preview",
    // Parameter errors and HTML render errors are both written by the server for the agent.
    (error) =>
      isOrchestratorMcpFailure(error) || AiError.isAiError(error)
        ? error.message
        : "HTML preview failed.",
  );
});

const registerToolkit = /*#__PURE__*/ Effect.fnUntraced(function* (toolkit: any) {
  const registry = yield* McpServer.McpServer;
  const built = yield* toolkit as any;
  const services = yield* Effect.context();
  for (const tool of Object.values((built as any).tools as Record<string, any>)) {
    const annotations = tool.annotations;
    const toolMeta = Context.getOrUndefined(annotations, Tool.Meta);
    const mcpTool = new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        ...Context.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined,
        ),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
      _meta: toolMeta,
    });
    const outputJsonSchema = tool.successSchema
      ? Tool.getJsonSchemaFromSchema(tool.successSchema)
      : undefined;
    // MCP only permits object output schemas. Union and scalar results remain
    // available as content without advertising an invalid tool descriptor.
    const outputSchema =
      outputJsonSchema?.type === "object"
        ? { ...outputJsonSchema, additionalProperties: true }
        : undefined;
    if (outputSchema) {
      (mcpTool as any).outputSchema = outputSchema;
    }
    yield* registry.addTool({
      tool: mcpTool,
      annotations,
      handle(payload: any) {
        return Effect.withFiber((fiber) =>
          (built as any).handle(tool.name, payload).pipe(
            Stream.unwrap,
            Stream.run(Sink.last()),
            Effect.flatMap((opt) => Effect.fromOption(opt as Option.Option<any>)),
            Effect.provideContext(Context.merge(services, fiber.context)),
            Effect.matchCauseEffect({
              onFailure: (cause: Cause.Cause<any>) => {
                const error = Cause.squash(cause);
                const text =
                  typeof error === "object" &&
                  error !== null &&
                  "message" in error &&
                  typeof (error as any).message === "string"
                    ? (error as any).message
                    : Cause.pretty(cause);
                if (
                  text.includes("Invalid parameters for tool") ||
                  (error as any)?._tag === "InvalidParams"
                ) {
                  return Effect.fail(new McpSchema.InvalidParams({ message: text }));
                }
                return Effect.succeed(
                  new McpSchema.CallToolResult({
                    isError: true,
                    content: [{ type: "text", text }],
                  }),
                );
              },
              onSuccess: (result: any) =>
                Effect.succeed(
                  new McpSchema.CallToolResult({
                    isError: result.isFailure === true,
                    structuredContent:
                      result.isFailure === true
                        ? undefined
                        : typeof result.encodedResult === "object"
                          ? result.encodedResult
                          : undefined,
                    content: [{ type: "text", text: JSON.stringify(result.encodedResult) }],
                  }),
                ),
            }),
            Effect.tapCause(Effect.log),
          ),
        );
      },
    });
  }
});

const toolkit = (t: any) =>
  Layer.effectDiscard(
    registerToolkit(t).pipe(
      Effect.tapCause((cause) =>
        Effect.logError("MCP toolkit registration failed", { cause: Cause.pretty(cause) }),
      ),
    ),
  ).pipe(Layer.provide(McpServer.McpServer.layer));

export const layerHtmlToolkit = Layer.mergeAll(
  toolkit(HtmlRenderToolkit).pipe(Layer.provide(HtmlHandlers.layerRender)),
  Layer.effectDiscard(registerHtmlPreview()).pipe(Layer.provide(HtmlHandlers.layerPreview)),
).pipe(Layer.provide(HtmlRender.layer), Layer.provide(PreviewBrowser.layer));

const layerPreviewStandardToolkitRegistration = toolkit(PreviewStandardToolkit).pipe(
  Layer.provide(PreviewHandlers.layerStandard),
);

const layerPreviewSnapshotRegistration = Layer.effectDiscard(registerPreviewSnapshot()).pipe(
  Layer.provide(PreviewHandlers.layerSnapshot),
);

export const layerPreviewToolkit = Layer.mergeAll(
  layerPreviewStandardToolkitRegistration,
  layerPreviewSnapshotRegistration,
);

export const layerOrchestratorToolkit = toolkit(OrchestratorToolkit).pipe(
  Layer.provide(OrchestratorHandlers.layer),
  Layer.provide(OrchestratorMcpService.layer),
  Layer.provide(ThreadMetadataMcpService.layer),
);

export const layerThreadToolkit = toolkit(ThreadToolkit).pipe(Layer.provide(ThreadHandlers.layer));

const layerWorktreeToolkitRegistration = toolkit(WorktreeToolkit).pipe(
  Layer.provide(WorktreeHandlers.layer),
  Layer.provide(WorktreeMcpService.layer),
);

const layerPreviewControlsRegistration = toolkit(PreviewControlsToolkit).pipe(
  Layer.provide(PreviewControlsHandlers.layer),
);

const layerEnvironmentRegistration = toolkit(EnvironmentToolkit).pipe(
  Layer.provide(EnvironmentHandlers.layer),
);

const layerProjectRegistration = toolkit(ProjectToolkit).pipe(Layer.provide(ProjectHandlers.layer));

const layerAttachmentRegistration = toolkit(AttachmentToolkit).pipe(
  Layer.provide(AttachmentHandlers.layer),
);

export const layerPullRequestsToolkit = toolkit(PullRequestsToolkit).pipe(
  Layer.provide(PullRequestsHandlers.layer),
);

const layerDeviceStandardToolkitRegistration = toolkit(DeviceStandardToolkit).pipe(
  Layer.provide(DeviceHandlers.layerStandard),
);

const layerDeviceScreenshotRegistration = Layer.effectDiscard(registerDeviceScreenshot()).pipe(
  Layer.provide(DeviceHandlers.layerScreenshot),
);

export const layerDeviceToolkit = Layer.mergeAll(
  layerDeviceStandardToolkitRegistration,
  layerDeviceScreenshotRegistration,
);

const layerMcpTransport = McpServer.layerHttp({
  protocols: [McpProtocol.v2025_06_18],
  name: "Tabs",
  version: packageJson.version,
  path: "/mcp",
}).pipe(Layer.provide(layerMcpAuthMiddleware));

export const layer = Layer.mergeAll(
  layerPreviewToolkit,
  layerOrchestratorToolkit,
  layerThreadToolkit,
  layerAttachmentRegistration,
  layerProjectRegistration,
  layerEnvironmentRegistration,
  layerPreviewControlsRegistration,
  layerWorktreeToolkitRegistration,
  layerPullRequestsToolkit,
  layerDeviceToolkit,
  layerHtmlToolkit,
).pipe(
  Layer.provideMerge(layerMcpTransport),
  Layer.tapCause((cause) =>
    Effect.logError("MCP route assembly failed", { cause: Cause.pretty(cause) }),
  ),
);

type LegacyBroker = {
  readonly invoke: <A = unknown>(request: {
    readonly scope: McpInvocationContext.McpThreadInvocationScope;
    readonly operation: PreviewAutomationOperation;
    readonly input: unknown;
    readonly tabId?: PreviewTabId;
    readonly timeoutMs?: number;
  }) => Effect.Effect<A, unknown>;
};

const commonLegacyProperties = {
  tabId: { type: "string", description: "Collaborative browser tab to target." },
  timeoutMs: { type: "integer", minimum: 1, maximum: 60_000 },
};

const legacyToolDefinitions: ReadonlyArray<{
  readonly name: string;
  readonly operation: PreviewAutomationOperation;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}> = [
  {
    name: "preview_status",
    operation: "status",
    description: "Read collaborative browser status.",
    inputSchema: {},
  },
  {
    name: "preview_open",
    operation: "open",
    description: "Open the collaborative browser.",
    inputSchema: {
      url: { type: "string" },
      show: { type: "boolean" },
      reuseExistingTab: { type: "boolean" },
    },
  },
  {
    name: "preview_navigate",
    operation: "navigate",
    description: "Navigate the collaborative browser and wait for readiness.",
    inputSchema: {
      url: { type: "string" },
      target: { type: "object" },
      readiness: { enum: ["load", "domContentLoaded", "none"] },
    },
  },
  {
    name: "preview_snapshot",
    operation: "snapshot",
    description:
      "Capture visible text, accessibility data, elements, diagnostics, and a screenshot.",
    inputSchema: {},
  },
  {
    name: "preview_click",
    operation: "click",
    description: "Click an element by locator, CSS selector, or coordinates.",
    inputSchema: {
      locator: { type: "string" },
      selector: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
    },
  },
  {
    name: "preview_type",
    operation: "type",
    description: "Type text into an element or the focused control.",
    inputSchema: {
      text: { type: "string" },
      locator: { type: "string" },
      selector: { type: "string" },
      clear: { type: "boolean" },
    },
  },
  {
    name: "preview_press",
    operation: "press",
    description: "Press a keyboard key in the active browser tab.",
    inputSchema: {
      key: { type: "string" },
      modifiers: { type: "array", items: { enum: ["Alt", "Control", "Meta", "Shift"] } },
    },
  },
  {
    name: "preview_scroll",
    operation: "scroll",
    description: "Scroll the page or a selected container.",
    inputSchema: {
      deltaX: { type: "number" },
      deltaY: { type: "number" },
      locator: { type: "string" },
      selector: { type: "string" },
    },
  },
  {
    name: "preview_evaluate",
    operation: "evaluate",
    description: "Evaluate JavaScript in the page main frame.",
    inputSchema: {
      expression: { type: "string" },
      awaitPromise: { type: "boolean" },
      returnByValue: { type: "boolean" },
    },
  },
  {
    name: "preview_wait_for",
    operation: "waitFor",
    description: "Wait for page text, URL, or an element.",
    inputSchema: {
      locator: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
      urlIncludes: { type: "string" },
    },
  },
];

const toLegacyToolResult = (result: unknown) => {
  const screenshot =
    result && typeof result === "object" && "screenshot" in result
      ? (result as { screenshot?: { data?: unknown; mimeType?: unknown } }).screenshot
      : undefined;
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }];
  if (typeof screenshot?.data === "string" && typeof screenshot.mimeType === "string") {
    content.push({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
  }
  return {
    content,
    structuredContent:
      result && typeof result === "object" ? (result as Record<string, unknown>) : { result },
  };
};

export async function handleMcpHttpRequest(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly broker: LegacyBroker;
  readonly extensionAiBroker?: ExtensionAiBrokerClient;
  readonly resolveProjectId?: () => Promise<string | undefined>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}): Promise<void> {
  // Agent transports are optional until the first MCP request. In particular,
  // the SDK's protocol schemas should not be constructed on every app launch.
  const [{ Server: LegacyMcpServer }, { StreamableHTTPServerTransport }, schemas] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);
  if (options.response.destroyed) return;
  const { CallToolRequestSchema, ListToolsRequestSchema } = schemas;
  const server = new LegacyMcpServer(
    { name: "Tabs", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let aiTools: Awaited<ReturnType<ExtensionAiBrokerClient["list"]>> = [];
    if (options.extensionAiBroker && options.resolveProjectId) {
      try {
        const projectId = await options.resolveProjectId();
        if (projectId) aiTools = await options.extensionAiBroker.list(projectId);
      } catch {
        // The desktop broker is optional; do not break existing preview tools.
      }
    }
    return {
      tools: [
        ...legacyToolDefinitions.map((definition) => ({
          name: definition.name,
          description: definition.description,
          inputSchema: {
            type: "object" as const,
            properties: { ...commonLegacyProperties, ...definition.inputSchema },
            additionalProperties: false,
          },
        })),
        ...aiTools.map((tool) => ({
          name: tool.name,
          description: `${tool.description} (isolated, JSON-only Tabs extension command)`,
          inputSchema: {
            type: "object" as const,
            properties: { input: { type: "object" as const, additionalProperties: true } },
            required: ["input"],
            additionalProperties: false,
          },
        })),
      ],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = legacyToolDefinitions.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (!definition) {
      try {
        if (!options.extensionAiBroker || !options.resolveProjectId) {
          throw new Error("Extension AI tool is unavailable.");
        }
        const projectId = await options.resolveProjectId();
        if (!projectId) throw new Error("MCP project is no longer available.");
        const authorized = await options.extensionAiBroker.list(projectId);
        if (!authorized.some((tool) => tool.name === request.params.name)) {
          throw new Error("Extension AI tool is unavailable for this project.");
        }
        const input = request.params.arguments?.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error("Extension AI tool input must be a JSON object.");
        }
        const result = await options.extensionAiBroker.invoke(
          projectId,
          request.params.name,
          input,
        );
        if ((await options.resolveProjectId()) !== projectId) {
          throw new Error("MCP project changed during extension command.");
        }
        return toLegacyToolResult(result);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Extension AI tool failed.",
            },
          ],
        };
      }
    }
    const { tabId, timeoutMs, ...input } = request.params.arguments ?? {};
    if (!options.scope.thread) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Preview automation requires an active thread scope.",
          },
        ],
      };
    }
    try {
      const result = await options.runPromise(
        options.broker.invoke({
          scope: options.scope as McpInvocationContext.McpThreadInvocationScope,
          operation: definition.operation,
          input,
          ...(typeof tabId === "string" ? { tabId: tabId as PreviewTabId } : {}),
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        }),
      );
      return toLegacyToolResult(result);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : "Preview automation failed.",
          },
        ],
      };
    }
  });
  const transport = new StreamableHTTPServerTransport({});
  options.response.once("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport as Parameters<typeof server.connect>[0]);
  await transport.handleRequest(options.request, options.response);
}

import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type AntigravityAuthMethod,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderSendTurnInput,
  type RuntimeMode,
} from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { HostProcessPlatform } from "@tabs/shared/hostProcess";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import {
  makeAntigravityStderrHandler,
  makeAntigravityStdoutTransform,
} from "../antigravityAuthSupport.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { normalizeAntigravitySessionUpdate } from "./AntigravityProtocol.ts";

export interface AntigravityAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  | "authMethodId"
  | "authenticateEagerly"
  | "cancelBehavior"
  | "clientCapabilities"
  | "onStderr"
  | "resumeMethod"
  | "transformSessionUpdate"
  | "transformStdout"
  | "spawn"
> {
  readonly spawn?: AcpSessionRuntime.AcpSpawnInput;
  readonly antigravitySettings?: {
    readonly binaryPath?: string;
    readonly args?: readonly string[];
  };
  readonly environment?: NodeJS.ProcessEnv;
  readonly profileDirectory?: string;
  /** Device CLI environment supplied for this provider session. */
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly onAuthorizationUrl?: (url: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
  /**
   * Advertise `fs.readTextFile` and `fs.writeTextFile`. The agent then routes
   * workspace reads and writes through T3, which turns each edit into a
   * `session/request_permission` with the file content, instead of writing
   * through its own tools. Chat sessions turn this on. Setup, probe, and text
   * generation helpers leave it off so they never touch a workspace.
   */
  readonly clientFileSystem?: boolean;
  /** ACP `authenticate` method id. Defaults to the personal Google account flow. */
  readonly authMethod?: AntigravityAuthMethod;
  /**
   * Version of the standalone `agy` CLI serving this runtime (`null` when unknown).
   * Leave undefined for the legacy ACP server, which keeps the caller's `clientInfo`.
   */
  readonly cliVersion?: string | null;
}

function parseAntigravityVersion(version: string | null | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version?.trim() ?? "");
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: ReadonlyArray<number>, right: ReadonlyArray<number>) {
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// `agy acp` 1.5.1 offers every model to every ACP client; older runtimes allowlist editors.
const OPEN_MODEL_ACCESS_RELEASE = [1, 5, 1] as const;

/** Older CLI releases offer non-Gemini models only to allowlisted clients such as Zed. */
export function antigravityClientInfo(version: string | null | undefined) {
  const parsed = parseAntigravityVersion(version);
  return parsed !== undefined && compareVersions(parsed, OPEN_MODEL_ACCESS_RELEASE) >= 0
    ? { name: "tabs", version: "0.0.0" }
    : { name: "zed", version: "0.0.0" };
}

/**
 * The agy CLI rejects the managed runtime's `yolo` and `auto_edit`. It stays in `default`, where
 * it asks before acting and Tabs answers from the live runtime policy.
 */
export function antigravityCliSessionMode(modeId: string): string {
  return modeId === "yolo" || modeId === "auto_edit" ? "default" : modeId;
}

/** The CLI reports thinking as its own `thought_level` option, separate from the model ID. */
export function antigravityThinkingConfig(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
) {
  const option = configOptions?.find((candidate) => candidate.category === "thought_level");
  return option?.type === "select" ? option : undefined;
}

/** Normal launches reject browser login; only the auth flow supplies `onAuthorizationUrl`. */
export const makeAntigravityAcpRuntime = Effect.fn("makeAntigravityAcpRuntime")(function* (
  input: AntigravityAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Scope.Scope
> {
  const spawn: AcpSessionRuntime.AcpSpawnInput = input.spawn ?? {
    command: input.antigravitySettings?.binaryPath || "antigravity",
    args: input.antigravitySettings?.args ?? [],
    ...(input.environment ? { env: input.environment } : {}),
  };
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      ...(input.cliVersion === undefined
        ? {}
        : { clientInfo: antigravityClientInfo(input.cliVersion) }),
      spawn,
      authMethodId: input.authMethod ?? "oauth-personal",
      authenticateEagerly: true,
      resumeMethod: "resume",
      cancelBehavior: "wait-for-prompt",
      clientCapabilities: {
        fs: {
          readTextFile: input.clientFileSystem === true,
          writeTextFile: input.clientFileSystem === true,
        },
        terminal: false,
      },
      transformStdout: makeAntigravityStdoutTransform(
        input.onAuthorizationUrl ? { onAuthorizationUrl: input.onAuthorizationUrl } : {},
      ),
      onStderr: makeAntigravityStderrHandler(
        input.onAuthorizationUrl ? { onAuthorizationUrl: input.onAuthorizationUrl } : {},
      ),
      transformSessionUpdate: normalizeAntigravitySessionUpdate,
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

export function antigravityPermissionMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "full-access":
      return "yolo";
    case "auto-accept-edits":
      return "auto_edit";
    case "auto":
    case "approval-required":
      return "default";
  }
}

export function resolveAntigravityAcpBaseModelId(
  model: string | null | undefined,
): string | undefined {
  const trimmed = model?.trim();
  return trimmed && trimmed !== ANTIGRAVITY_DEFAULT_MODEL ? trimmed : undefined;
}

export function currentAntigravityModelIdFromSessionSetup(
  result:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  const config = result.configOptions?.find((option) => option.id === "model");
  return config?.type === "select" ? config.currentValue : result.models?.currentModelId?.trim();
}

export function discoverAntigravityAcpModels(
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "getConfigOptions">,
) {
  return Effect.map(runtime.getConfigOptions, (configOptions) => ({
    models: antigravityModelOptions(configOptions).map((model) => ({
      slug: model.value,
      name: model.name,
    })),
    source: "antigravity-acp",
    cached: false,
  }));
}

export function antigravityModelOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
) {
  const model = configOptions.find((option) => option.id === "model");
  if (model?.type !== "select") return [];
  return model.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
}

const LEGACY_THINKING_LEVELS = ["low", "medium", "high"] as const;

/**
 * Runtime 1.3 encoded the thinking level in the model ID (`gemini-3.8-flash-high`). Runtime 1.4+
 * lists the family (`gemini-3.8-flash`) and reports the level as its own `thought_level` option.
 * Saved selections and the manifest default still carry the old IDs, so split one into the
 * family the account offers plus the level.
 */
export function splitLegacyAntigravityModel(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  model: string,
): { readonly family: string; readonly level: string } | undefined {
  const offered = antigravityModelOptions(configOptions).map((option) => option.value);
  if (offered.includes(model)) return undefined;
  const level = LEGACY_THINKING_LEVELS.find((candidate) => model.endsWith(`-${candidate}`));
  if (level === undefined) return undefined;
  const family = model.slice(0, -(level.length + 1));
  return offered.includes(family) ? { family, level } : undefined;
}

/**
 * Resolves the model a turn should run on. A saved selection is reapplied
 * as-is. The provider default alias resolves to `defaultModel` when the
 * account offers it (or offers its family, for a legacy per-level ID), so T3
 * can pick a newer model than the one Google marks current. Otherwise the
 * agent's current selection stands.
 */
function resolveAntigravityModel(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly model: string | null | undefined;
  readonly defaultModel?: string | undefined;
}): string | undefined {
  const modelConfig = input.configOptions.find((option) => option.id === "model");
  const current = modelConfig?.type === "select" ? modelConfig.currentValue : undefined;
  if (input.model && input.model !== ANTIGRAVITY_DEFAULT_MODEL) return input.model;
  const options = antigravityModelOptions(input.configOptions);
  if (input.defaultModel && options.some((option) => option.value === input.defaultModel)) {
    return input.defaultModel;
  }
  // The alias keeps the agent's own thinking level, so only the family is taken from a legacy ID.
  return (
    (input.defaultModel
      ? splitLegacyAntigravityModel(input.configOptions, input.defaultModel)?.family
      : undefined) ?? current
  );
}

/** Never replace a saved selection with the default returned by a cold resume. */
export const applyAntigravityAcpModelSelection = Effect.fn("applyAntigravityAcpModelSelection")(
  function* <E>(input: {
    readonly runtime: Pick<
      AcpSessionRuntime.AcpSessionRuntime["Service"],
      "getConfigOptions" | "setModel"
    > &
      Partial<Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setConfigOption">>;
    readonly model: string | null | undefined;
    /** Model to select for the provider default alias. See `resolveAntigravityModel`. */
    readonly defaultModel?: string | undefined;
    readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
  }): Effect.fn.Return<string | undefined, E> {
    const configOptions = yield* input.runtime.getConfigOptions;
    const modelConfig = configOptions.find((option) => option.id === "model");
    const current = modelConfig?.type === "select" ? modelConfig.currentValue : undefined;
    const resolved = resolveAntigravityModel({
      configOptions,
      model: input.model,
      defaultModel: input.defaultModel,
    });
    // The default alias never sends an internal ID. It selects the manifest
    // default when that differs from the agent's current model, and otherwise
    // leaves the agent's choice alone.
    const explicit = Boolean(input.model) && input.model !== ANTIGRAVITY_DEFAULT_MODEL;
    if (resolved === undefined || (!explicit && resolved === current)) return current;
    const options = antigravityModelOptions(configOptions);
    if (!options.some((option) => option.value === resolved)) {
      const legacy = splitLegacyAntigravityModel(configOptions, resolved);
      if (legacy !== undefined) {
        yield* input.runtime.setModel(legacy.family).pipe(Effect.mapError(input.mapError));
        yield* applyLegacyThinkingLevel({
          runtime: input.runtime,
          legacyModel: resolved,
          level: legacy.level,
          mapError: input.mapError,
        });
        return legacy.family;
      }
      return yield* Effect.fail(
        input.mapError(
          EffectAcpErrors.AcpRequestError.invalidParams(
            `Antigravity model '${resolved}' is unavailable for this Google account. Select an available model.`,
          ),
        ),
      );
    }
    yield* input.runtime.setModel(resolved).pipe(Effect.mapError(input.mapError));
    return resolved;
  },
);

/**
 * Applies the level of a legacy per-level model ID through the family's `thought_level` option,
 * read after the model switch because the choices belong to the new model. A family without that
 * option still gets the old ID, which the agent accepts as-is.
 */
const applyLegacyThinkingLevel = Effect.fn("applyAntigravityLegacyThinkingLevel")(function* <
  E,
>(input: {
  readonly runtime: Partial<
    Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setConfigOption">
  > &
    Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "getConfigOptions">;
  readonly legacyModel: string;
  readonly level: string;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.fn.Return<void, E> {
  const { setConfigOption } = input.runtime;
  if (setConfigOption === undefined) return;
  const thinking = antigravityThinkingConfig(yield* input.runtime.getConfigOptions);
  const offersLevel =
    thinking?.options
      .flatMap((entry) => ("value" in entry ? [entry] : entry.options))
      .some((choice) => choice.value === input.level) === true;
  if (thinking !== undefined && offersLevel) {
    yield* setConfigOption(thinking.id, input.level).pipe(Effect.mapError(input.mapError));
    return;
  }
  if (thinking === undefined) {
    yield* setConfigOption("model", input.legacyModel, { allowUnlistedValue: true }).pipe(
      Effect.mapError(input.mapError),
    );
  }
});

const IMAGE_MIME_TYPES = new Set(["image/bmp", "image/jpeg", "image/png", "image/webp"]);
// Formats the bundled SDK's Audio type accepts. Anything else is rejected up front.
const AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);
const ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Linked-video and native range-read decisions key on this release. */
/**
 * Releases Tabs qualified for native range reads and linked video. On 1.4.5 the client-read path
 * sends a whole file to serve one line, and the native reader keeps diff edits.
 */
export function isQualifiedAntigravityRelease(version: string | null | undefined): boolean {
  return version?.trim() === "1.4.5";
}

// The agent inlines linked video bytes into one model request, so keep it under the inline limit.
const ANTIGRAVITY_MAX_VIDEO_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Only Gemini takes video. The evidence is the session's resolved model, so an account default
 * counts once the agent reports it; opaque ids such as `agy-model` need a Gemini display name.
 */
function antigravityModelAcceptsVideo(
  model: { readonly id: string; readonly name: string | undefined } | undefined,
): boolean {
  return model !== undefined && (/^gemini-/i.test(model.id) || /^gemini\b/i.test(model.name ?? ""));
}
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/x-sh",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".graphql",
  ".svelte",
  ".vue",
  ".log",
  ".diff",
  ".patch",
  ".ini",
  ".conf",
]);
const ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = PROVIDER_SEND_TURN_MAX_FILE_BYTES;

/**
 * Sends supported uploads as native ACP content. Other files, and native
 * candidates over their limits, reach the agent through the saved path
 * ProviderService puts in the text block.
 */
export const buildAntigravityPrompt = Effect.fn("buildAntigravityPrompt")(function* (input: {
  readonly input: ProviderSendTurnInput["input"];
  readonly attachments: ProviderSendTurnInput["attachments"];
  readonly attachmentsDir: string;
}): Effect.fn.Return<
  ReadonlyArray<EffectAcpSchema.ContentBlock>,
  EffectAcpErrors.AcpError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const blocks: Array<EffectAcpSchema.ContentBlock> = [];
  const text = input.input?.trim();
  if (text) blocks.push({ type: "text", text });
  let totalBytes = 0;

  for (const attachment of input.attachments ?? []) {
    const isPastedText =
      attachment.type === "file" &&
      "source" in attachment &&
      attachment.source?._tag === "pasted-text";
    // ProviderService has already put the file path in the text block. Keep a
    // folded clipboard paste lazy so the agent can search or sample it rather
    // than paying to embed the entire resource in context immediately.
    const mimeType = attachment.mimeType.toLowerCase().split(";", 1)[0] ?? "";
    const image = attachment.type === "image" && IMAGE_MIME_TYPES.has(mimeType);
    const audio = attachment.type === "file" && AUDIO_MIME_TYPES.has(mimeType);
    const pdf = attachment.type === "file" && mimeType === "application/pdf";
    const textFile =
      attachment.type === "file" &&
      (mimeType.startsWith("text/") ||
        TEXT_MIME_TYPES.has(mimeType) ||
        TEXT_FILE_EXTENSIONS.has(path.extname(attachment.name).toLowerCase()));
    const isPathOnly =
      attachment.type === "file" && (isPastedText || (!audio && !pdf && !textFile));
    if (attachment.type === "image" && !image) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Antigravity does not support '${attachment.name}' (${attachment.mimeType}). Attach a BMP, JPEG, PNG, WebP, PDF, audio, or text file.`,
      );
    }
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Invalid attachment '${attachment.name}'.`,
      );
    }
    const info = yield* fileSystem
      .stat(attachmentPath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.invalidParams(
            `Could not read attachment '${attachment.name}'.`,
          ),
        ),
      );
    if (info.type !== "File") {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Could not read attachment '${attachment.name}'.`,
      );
    }
    if (isPathOnly) continue;
    const size = Number(info.size);
    const limit = image
      ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
      : audio
        ? ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES
        : pdf
          ? MAX_TOTAL_ATTACHMENT_BYTES
          : ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES;
    if (
      attachment.type === "file" &&
      (size > limit || totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES)
    ) {
      continue;
    }
    totalBytes += size;
    if (size > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Image '${attachment.name}' is too large. Antigravity accepts images up to 10 MiB and 50 MiB of native attachments per message.`,
      );
    }
    const uri = yield* path.toFileUrl(attachmentPath).pipe(
      Effect.map((url) => url.href),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.invalidParams(`Invalid attachment '${attachment.name}'.`),
      ),
    );
    if (pdf) {
      blocks.push({ type: "resource_link", uri, name: attachment.name, mimeType });
      continue;
    }
    const bytes = yield* fileSystem.stream(attachmentPath, { bytesToRead: limit + 1 }).pipe(
      Stream.runCollect,
      Effect.map((chunks) => Buffer.concat(chunks)),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.invalidParams(
          `Could not read attachment '${attachment.name}'.`,
        ),
      ),
    );
    totalBytes += bytes.length - size;
    if (bytes.length > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Attachment '${attachment.name}' changed while being read and is too large.`,
      );
    }
    if (image) {
      blocks.push({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType });
    } else if (audio) {
      blocks.push({ type: "audio", data: Buffer.from(bytes).toString("base64"), mimeType });
    } else {
      const decoded = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        catch: () =>
          EffectAcpErrors.AcpRequestError.invalidParams(
            `Attachment '${attachment.name}' is not a UTF-8 text file.`,
          ),
      });
      if (decoded.includes("\0")) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Attachment '${attachment.name}' contains binary data.`,
        );
      }
      blocks.push({ type: "resource", resource: { uri, mimeType, text: decoded } });
    }
  }
  if (blocks.length === 0) {
    return yield* EffectAcpErrors.AcpRequestError.invalidParams(
      "A turn requires text or supported attachments.",
    );
  }
  return blocks;
});

/**
 * Capability-aware variant: sends a native block only when the agent advertised support for it,
 * and links video for qualified releases and Gemini models.
 */
export const buildAntigravityCapabilityPrompt = Effect.fn("buildAntigravityCapabilityPrompt")(
  function* (input: {
    readonly input: ProviderSendTurnInput["input"];
    readonly attachments: ProviderSendTurnInput["attachments"];
    readonly resolveAttachmentPath: (
      attachment: NonNullable<ProviderSendTurnInput["attachments"]>[number],
    ) => string | null;
    readonly promptCapabilities: EffectAcpSchema.AgentCapabilities["promptCapabilities"];
    /** Linked video needs a runtime whose `resource_link` handling is qualified and a Gemini model. */
    readonly agentVersion?: string | undefined;
    readonly currentModel?: { readonly id: string; readonly name: string | undefined } | undefined;
  }): Effect.fn.Return<
    ReadonlyArray<EffectAcpSchema.ContentBlock>,
    EffectAcpErrors.AcpError,
    FileSystem.FileSystem | Path.Path
  > {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The agent runs on this host.
    const platform = yield* HostProcessPlatform;
    const blocks: Array<EffectAcpSchema.ContentBlock> = [];
    const text = input.input?.trim();
    if (text) blocks.push({ type: "text", text });
    let totalBytes = 0;

    for (const attachment of input.attachments ?? []) {
      const isPastedText =
        attachment.type === "file" &&
        "source" in attachment &&
        attachment.source?._tag === "pasted-text";
      // The text already carries the path; keep folded pastes lazy so agents can search without embedding the whole file.
      const mimeType = attachment.mimeType.toLowerCase().split(";", 1)[0] ?? "";
      const image = attachment.type === "image" && IMAGE_MIME_TYPES.has(mimeType);
      const audio = attachment.type === "file" && AUDIO_MIME_TYPES.has(mimeType);
      const pdf = attachment.type === "file" && mimeType === "application/pdf";
      const video =
        attachment.type === "file" &&
        mimeType === "video/mp4" &&
        isQualifiedAntigravityRelease(input.agentVersion) &&
        // The agent turns a file URI into a path with unquote(urlparse(uri).path), which drops
        // Windows drives and UNC hosts. Keep the saved path there until Google fixes it.
        platform !== "win32" &&
        antigravityModelAcceptsVideo(input.currentModel);
      const textFile =
        attachment.type === "file" &&
        (mimeType.startsWith("text/") ||
          TEXT_MIME_TYPES.has(mimeType) ||
          TEXT_FILE_EXTENSIONS.has(path.extname(attachment.name).toLowerCase()));
      const isPathOnly =
        (attachment.type === "image" && (!image || input.promptCapabilities?.image !== true)) ||
        (attachment.type === "file" &&
          (isPastedText ||
            (audio
              ? input.promptCapabilities?.audio !== true
              : pdf || textFile
                ? input.promptCapabilities?.embeddedContext !== true
                : !video)));
      const attachmentPath = input.resolveAttachmentPath(attachment);
      if (!attachmentPath) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Invalid attachment '${attachment.name}'.`,
        );
      }
      const info = yield* fileSystem
        .stat(attachmentPath)
        .pipe(
          Effect.mapError(() =>
            EffectAcpErrors.AcpRequestError.invalidParams(
              `Could not read attachment '${attachment.name}'.`,
            ),
          ),
        );
      if (info.type !== "File") {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Could not read attachment '${attachment.name}'.`,
        );
      }
      if (isPathOnly) continue;
      const size = Number(info.size);
      const limit = image
        ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
        : audio
          ? ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES
          : pdf
            ? MAX_TOTAL_ATTACHMENT_BYTES
            : video
              ? ANTIGRAVITY_MAX_VIDEO_ATTACHMENT_BYTES
              : ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES;
      if (
        attachment.type === "file" &&
        (size > limit || totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES)
      ) {
        continue;
      }
      totalBytes += size;
      if (size > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Image '${attachment.name}' is too large. Antigravity accepts images up to 10 MiB and 50 MiB of native attachments per message.`,
        );
      }
      const uri = yield* path.toFileUrl(attachmentPath).pipe(
        Effect.map((url) => url.href),
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.invalidParams(`Invalid attachment '${attachment.name}'.`),
        ),
      );
      if (pdf || video) {
        blocks.push({ type: "resource_link", uri, name: attachment.name, mimeType, size });
        continue;
      }
      const bytes = yield* fileSystem.stream(attachmentPath, { bytesToRead: limit + 1 }).pipe(
        Stream.runCollect,
        Effect.map((chunks) => Buffer.concat(chunks)),
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.invalidParams(
            `Could not read attachment '${attachment.name}'.`,
          ),
        ),
      );
      totalBytes += bytes.length - size;
      if (bytes.length > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Attachment '${attachment.name}' changed while being read and is too large.`,
        );
      }
      if (image) {
        blocks.push({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType });
      } else if (audio) {
        blocks.push({ type: "audio", data: Buffer.from(bytes).toString("base64"), mimeType });
      } else {
        const decoded = yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          catch: () =>
            EffectAcpErrors.AcpRequestError.invalidParams(
              `Attachment '${attachment.name}' is not a UTF-8 text file.`,
            ),
        });
        if (decoded.includes("\0")) {
          return yield* EffectAcpErrors.AcpRequestError.invalidParams(
            `Attachment '${attachment.name}' contains binary data.`,
          );
        }
        blocks.push({ type: "resource", resource: { uri, mimeType, text: decoded } });
      }
    }
    if (blocks.length === 0) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        "A turn requires text or supported attachments.",
      );
    }
    return blocks;
  },
);

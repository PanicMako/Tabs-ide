import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type AntigravityAuthMethod,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderSendTurnInput,
  type RuntimeMode,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore";
import {
  buildAntigravityAcpSpawnInput,
  makeAntigravityStderrHandler,
  makeAntigravityStdoutTransform,
  prepareAntigravityProfile,
} from "../antigravityAuthSupport";
import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
} from "./AcpSessionRuntime";
import { normalizeAntigravitySessionUpdate } from "./AntigravityProtocol";
import { getProviderSecret } from "../ProviderSecretStore";

export type AntigravityAcpRuntimeSettings = Partial<
  Pick<
    import("@tabs/contracts").AntigravitySettings,
    "binaryPath" | "authMethod" | "gcpProject" | "gcpLocation"
  >
>;

export interface AntigravityAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "onStderr" | "spawn" | "transformStdout"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly antigravitySettings?: AntigravityAcpRuntimeSettings;
  readonly environment?: NodeJS.ProcessEnv;
  readonly profileDirectory?: string;
  readonly onAuthorizationUrl?: (url: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly clientFileSystem?: boolean;
  readonly authMethod?: AntigravityAuthMethod;
}

/**
 * Creates a native, resumable ACP runtime around Google's Antigravity agent.
 * Normal chat launches reject interactive browser login; the settings login flow
 * opts in by providing `onAuthorizationUrl`.
 */
export const makeAntigravityAcpRuntime = Effect.fn("makeAntigravityAcpRuntime")(function* (
  input: AntigravityAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntimeShape,
  EffectAcpErrors.AcpError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const path = yield* Path.Path;
  const executablePath = input.antigravitySettings?.binaryPath?.trim() || "agy_acp_server.par";
  const apiKey = yield* Effect.tryPromise(() => getProviderSecret("antigravity.api-key")).pipe(
    Effect.mapError(
      (cause) =>
        new EffectAcpErrors.AcpTransportError({
          detail: "Failed to read the Antigravity API key from secure storage.",
          cause,
        }),
    ),
  );
  const auth = {
    authMethod: input.authMethod ?? input.antigravitySettings?.authMethod ?? "oauth-personal",
    apiKey: apiKey?.trim() ?? "",
    gcpProject: input.antigravitySettings?.gcpProject?.trim() ?? "",
    gcpLocation: input.antigravitySettings?.gcpLocation?.trim() ?? "",
  };
  const profile = yield* prepareAntigravityProfile({
    profileDirectory:
      input.profileDirectory ?? path.join(input.cwd, ".tabs", "antigravity-profile"),
    ...(input.environment ? { baseEnv: input.environment } : {}),
    auth,
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
  );
  const spawn = buildAntigravityAcpSpawnInput({
    installation: {
      executablePath,
      harnessPath: path.join(
        path.dirname(executablePath),
        process.platform === "win32" ? "localharness_external.exe" : "localharness_external",
      ),
    },
    profile,
    cwd: input.cwd,
    ...(input.environment ? { baseEnv: input.environment } : {}),
    auth,
  });
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      spawn,
      authMethodId: auth.authMethod,
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
  return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(context));
});

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
  runtime: Pick<AcpSessionRuntimeShape, "getConfigOptions">,
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

export function antigravityPermissionMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "full-access":
      return "yolo";
    case "auto-accept-edits":
      return "auto_edit";
    case "approval-required":
      return "default";
  }
}

export function antigravityModelOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
) {
  const model = configOptions.find((option) => option.id === "model");
  if (model?.type !== "select") return [];
  return model.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
}

export function resolveAntigravityModel(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly model: string | null | undefined;
  readonly defaultModel?: string;
}): string | undefined {
  const modelConfig = input.configOptions.find((option) => option.id === "model");
  const current = modelConfig?.type === "select" ? modelConfig.currentValue : undefined;
  if (input.model && input.model !== ANTIGRAVITY_DEFAULT_MODEL) return input.model;
  const options = antigravityModelOptions(input.configOptions);
  return input.defaultModel && options.some((option) => option.value === input.defaultModel)
    ? input.defaultModel
    : current;
}

/** Reapplies an explicit selection after resume without overwriting it with a cold default. */
export const applyAntigravityAcpModelSelection = Effect.fn("applyAntigravityAcpModelSelection")(
  function* <E>(input: {
    readonly runtime: Pick<AcpSessionRuntimeShape, "getConfigOptions" | "setModel">;
    readonly model: string | null | undefined;
    readonly defaultModel?: string;
    readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
  }): Effect.fn.Return<string | undefined, E> {
    const configOptions = yield* input.runtime.getConfigOptions;
    const modelConfig = configOptions.find((option) => option.id === "model");
    const current = modelConfig?.type === "select" ? modelConfig.currentValue : undefined;
    const resolved = resolveAntigravityModel({
      configOptions,
      model: input.model,
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
    });
    const explicit = Boolean(input.model) && input.model !== ANTIGRAVITY_DEFAULT_MODEL;
    if (resolved === undefined || (!explicit && resolved === current)) return current;
    const options = antigravityModelOptions(configOptions);
    if (!options.some((option) => option.value === resolved)) {
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

const IMAGE_MIME_TYPES = new Set(["image/bmp", "image/jpeg", "image/png", "image/webp"]);
export const ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES = 20 * 1024 * 1024;
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
export const ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = PROVIDER_SEND_TURN_MAX_FILE_BYTES;

// AG-007: Sends uploads as native ACP content with bounded buffers and MIME checks.
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
      (attachment as Record<string, unknown>).source !== null &&
      typeof (attachment as Record<string, unknown>).source === "object" &&
      ((attachment as Record<string, unknown>).source as { _tag?: string })?._tag === "pasted-text";

    const mimeType = attachment.mimeType.toLowerCase().split(";", 1)[0] ?? "";
    const image = attachment.type === "image" && IMAGE_MIME_TYPES.has(mimeType);
    const audio = attachment.type === "file" && AUDIO_MIME_TYPES.has(mimeType);
    const pdf = attachment.type === "file" && mimeType === "application/pdf";
    const textFile =
      attachment.type === "file" &&
      (mimeType.startsWith("text/") ||
        TEXT_MIME_TYPES.has(mimeType) ||
        TEXT_FILE_EXTENSIONS.has(path.extname(attachment.name).toLowerCase()));
    if (!image && !audio && !pdf && !textFile) {
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
    if (isPastedText) {
      if (info.type !== "File") {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Could not read attachment '${attachment.name}'.`,
        );
      }
      continue;
    }
    const size = Number(info.size);
    const limit = image
      ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
      : audio
        ? ANTIGRAVITY_MAX_AUDIO_ATTACHMENT_BYTES
        : pdf
          ? PROVIDER_SEND_TURN_MAX_FILE_BYTES
          : ANTIGRAVITY_MAX_TEXT_ATTACHMENT_BYTES;
    totalBytes += size;
    if (info.type !== "File" || size > limit || totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Attachment '${attachment.name}' is too large. Antigravity accepts text files up to 1 MiB, images up to 10 MiB, audio up to 20 MiB, and 50 MiB total attachments.`,
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

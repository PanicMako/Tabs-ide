import type { FxSettings, ServerProviderAuth, ServerProviderModel } from "@tabs/contracts";
import { createModelCapabilities } from "@tabs/shared/model";
import { resolveSpawnCommand } from "@tabs/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";

import {
  FX_DEFAULT_MODEL_SLUG,
  FX_DRIVER_KIND,
  FX_EFFORT_OPTION_DESCRIPTOR,
  FX_SUPPORTED_RUNTIME_MODES,
} from "./acp/FxAcpSupport.ts";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  type ProviderProbeResult,
  providerModelsFromSettings,
  type ServerProviderDraft,
  spawnAndCollect,
} from "./providerSnapshot.ts";

const nonEmptyTrimmed = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const FX_PRESENTATION = {
  displayName: "fx",
  showInteractionModeToggle: false,
  supportedRuntimeModes: FX_SUPPORTED_RUNTIME_MODES,
} as const;
const FX_MODEL_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [FX_EFFORT_OPTION_DESCRIPTOR],
});

/**
 * "Default" keeps the model `fx status` reports as its alias, which the
 * adapter selects for it. `fx models` lists the rest.
 */
const fxModels = (
  settings: FxSettings,
  defaultModel?: string,
  listed: ReadonlyArray<string> = [],
): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings(
    [
      {
        slug: FX_DEFAULT_MODEL_SLUG,
        name: defaultModel === undefined ? "Default" : `Default (${defaultModel})`,
        ...(defaultModel === undefined ? {} : { aliases: [defaultModel] }),
        isCustom: false,
        isDefault: true,
        capabilities: FX_MODEL_CAPABILITIES,
      },
      ...listed
        .filter((id, index) => id !== FX_DEFAULT_MODEL_SLUG && listed.indexOf(id) === index)
        .map((id) => ({
          slug: id,
          name: id,
          isCustom: false,
          capabilities: FX_MODEL_CAPABILITIES,
        })),
    ],
    settings.customModels,
    FX_MODEL_CAPABILITIES,
  );

const snapshot = (
  settings: FxSettings,
  checkedAt: string,
  probe: ProviderProbeResult,
  defaultModel?: string,
  listed?: ReadonlyArray<string>,
): ServerProviderDraft => ({
  ...buildServerProvider({
    // Gives the snapshot its version advisory; fx runs no enrichment pass.
    driver: FX_DRIVER_KIND,
    presentation: FX_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: fxModels(settings, defaultModel, listed),
    probe,
  }),
  // Every `fx acp` session is saved under `~/.fx` and ACP has no session
  // delete, so a throwaway text-generation session would stay on disk.
  supportsTextGeneration: false,
});

export const buildInitialFxProviderSnapshot = (
  settings: FxSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.map(DateTime.now, (now) =>
    snapshot(settings, DateTime.formatIso(now), {
      installed: settings.enabled,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: settings.enabled
        ? "Checking fx CLI availability..."
        : "fx is disabled in Tabs settings.",
    }),
  );

const runFxCli = Effect.fn("runFxCli")(function* (
  settings: FxSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const command = settings.binaryPath || "fx";
  const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  );
});

/** `fx status --json` on fx 0.0.13: `auth` names the login method, `missing` when signed out. */
const FxStatus = Schema.fromJsonString(
  Schema.Struct({
    auth: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
  }),
);
const decodeFxStatus = Schema.decodeUnknownOption(FxStatus);
const FxModels = Schema.fromJsonString(
  Schema.Struct({ ids: Schema.optional(Schema.Array(Schema.String)) }),
);
const decodeFxModels = Schema.decodeUnknownOption(FxModels);

const VERSION_PROBE_TIMEOUT_MS = 10_000;

function fxAuth(auth: string | undefined): ServerProviderAuth {
  const method = nonEmptyTrimmed(auth);
  if (method === undefined) return { status: "unknown" };
  return method === "missing"
    ? { status: "unauthenticated" }
    : { status: "authenticated", label: method };
}

/**
 * Reads `fx --version`, `fx status --json` (login and default model) and
 * `fx models --json`. None of them opens an ACP session, which fx would save.
 */
export const checkFxProviderStatus = Effect.fn("checkFxProviderStatus")(function* (
  settings: FxSettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return snapshot(settings, checkedAt, {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "fx is disabled in Tabs settings.",
    });
  }

  const probeEnvironment = environment;
  const versionResult = yield* runFxCli(settings, ["--version"], probeEnvironment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult) || Option.isNone(versionResult.success)) {
    const missing = Result.isFailure(versionResult) && isCommandMissingCause(versionResult.failure);
    return snapshot(settings, checkedAt, {
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing ? "fx is not installed or not on PATH." : "Failed to run `fx --version`.",
    });
  }
  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: "fx is installed but failed to run.",
    });
  }

  const read = (args: ReadonlyArray<string>) =>
    runFxCli(settings, args, probeEnvironment).pipe(
      Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS),
      Effect.map(Option.filter((output) => output.code === 0)),
      Effect.map(Option.map((output) => output.stdout)),
      Effect.orElseSucceed(() => Option.none<string>()),
    );
  const status = Option.flatMap(yield* read(["status", "--json"]), decodeFxStatus);
  const listed = Option.flatMap(yield* read(["models", "--json"]), decodeFxModels).pipe(
    Option.map((models) => models.ids?.flatMap((id) => nonEmptyTrimmed(id) ?? []) ?? []),
  );
  const auth = fxAuth(Option.getOrUndefined(status)?.auth);
  const defaultModel = nonEmptyTrimmed(Option.getOrUndefined(status)?.model);
  const probe =
    auth.status === "unauthenticated"
      ? { status: "error" as const, message: "Run `fx login` to sign in." }
      : auth.status === "unknown"
        ? {
            status: "warning" as const,
            message: "fx is installed but login state could not be determined.",
          }
        : Option.isNone(listed)
          ? {
              status: "warning" as const,
              message: "fx is installed but model listing failed. Model options may be incomplete.",
            }
          : { status: "ready" as const };
  return snapshot(
    settings,
    checkedAt,
    { installed: true, version, auth, ...probe },
    defaultModel,
    Option.getOrUndefined(listed),
  );
});

/** fx's id for "Default": the alias the snapshot gave it, if `fx status` reported one. */
export const fxDefaultModelId = (models: ReadonlyArray<ServerProviderModel>) =>
  models.find((model) => model.slug === FX_DEFAULT_MODEL_SLUG)?.aliases?.[0];

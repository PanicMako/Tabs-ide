import { type CopilotSettings, ProviderDriverKind } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime";
import { getCopilotToken } from "../CopilotCredentialStore";

export const COPILOT_DEFAULT_AUTH_METHOD_ID = "copilot-login";
export const COPILOT_DRIVER_KIND = "copilot" as ProviderDriverKind;

export type CopilotAcpRuntimeCopilotSettings = Partial<
  Pick<CopilotSettings, "binaryPath" | "gheHost" | "byokProvider" | "byokApiKey">
>;

export interface CopilotAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly copilotSettings: CopilotAcpRuntimeCopilotSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildCopilotEnvironment(
  copilotSettings: CopilotAcpRuntimeCopilotSettings | null | undefined,
  baseEnv?: NodeJS.ProcessEnv,
  secureToken?: string | null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(baseEnv ?? process.env) };

  // BYOK must be an explicit provider setting. Remove inherited Copilot BYOK
  // variables first so a shell-level key cannot silently bypass seat billing.
  delete env.COPILOT_PROVIDER_API_KEY;
  for (const key of Object.keys(env)) {
    if (/^COPILOT_PROVIDER_.*_API_KEY$/u.test(key)) delete env[key];
  }
  delete env.COPILOT_GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  // Explicit token injection from the OS credential store (no settings-file or parent leakage).
  const configuredToken = secureToken?.trim();
  if (configuredToken) {
    env.COPILOT_GITHUB_TOKEN = configuredToken;
    env.GH_TOKEN = configuredToken;
    env.GITHUB_TOKEN = configuredToken;
  }

  // GitHub Enterprise host
  const gheHost = copilotSettings?.gheHost?.trim();
  if (gheHost) {
    env.GITHUB_ENTERPRISE_URL = gheHost;
    env.GH_HOST = gheHost;
  }

  // BYOK (Bring Your Own Key) environment variables
  const byokProvider = copilotSettings?.byokProvider?.trim();
  const byokApiKey = copilotSettings?.byokApiKey?.trim();
  if (byokProvider && byokApiKey) {
    const providerVar = `COPILOT_PROVIDER_${byokProvider.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_API_KEY`;
    env[providerVar] = byokApiKey;
    env.COPILOT_PROVIDER_API_KEY = byokApiKey;
  }

  return env;
}

export function buildCopilotAcpSpawnInput(
  copilotSettings: CopilotAcpRuntimeCopilotSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  secureToken?: string | null,
): AcpSpawnInput {
  return {
    command: copilotSettings?.binaryPath || "copilot",
    args: ["--acp", "--stdio"],
    cwd,
    env: buildCopilotEnvironment(copilotSettings, environment, secureToken),
  };
}

export interface CopilotTerminalAuthMetadata {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly label?: string;
}

export function resolveCopilotTerminalAuthCommand(
  advertisedMeta: unknown,
  gheHost?: string | null | undefined,
): CopilotTerminalAuthMetadata {
  const meta = advertisedMeta as
    | { "terminal-auth"?: { command?: string; args?: string[]; label?: string } }
    | undefined;
  const terminalAuth = meta?.["terminal-auth"];
  const baseCommand = terminalAuth?.command || "copilot";
  const baseArgs =
    Array.isArray(terminalAuth?.args) && terminalAuth.args.length > 0
      ? [...terminalAuth.args]
      : ["login"];
  const label = terminalAuth?.label || "Copilot Login";

  // If a GitHub Enterprise host is specified, append --host to the login command
  const host = gheHost?.trim();
  if (host && !baseArgs.includes("--host")) {
    baseArgs.push("--host", host);
  }

  return {
    command: baseCommand,
    args: baseArgs,
    label,
  };
}

export function resolveCopilotAuthMethodId(
  initializeResult: EffectAcpSchema.InitializeResponse | undefined,
  copilotSettings?: CopilotAcpRuntimeCopilotSettings | null | undefined,
): string {
  // If BYOK is configured, GitHub OAuth is bypassed
  if (copilotSettings?.byokApiKey?.trim()) {
    return "byok";
  }

  const methods = initializeResult?.authMethods;
  if (Array.isArray(methods) && methods.length > 0) {
    const firstMethod = methods[0];
    if (firstMethod && typeof firstMethod.id === "string" && firstMethod.id.trim().length > 0) {
      return firstMethod.id.trim();
    }
  }

  return COPILOT_DEFAULT_AUTH_METHOD_ID;
}

export const makeCopilotAcpRuntime = (
  input: CopilotAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const secureToken = yield* Effect.tryPromise(() => getCopilotToken()).pipe(
      Effect.mapError(
        (cause) =>
          new EffectAcpErrors.AcpTransportError({
            detail: "Failed to read the GitHub Copilot token from secure storage.",
            cause,
          }),
      ),
    );
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildCopilotAcpSpawnInput(
          input.copilotSettings,
          input.cwd,
          input.environment,
          secureToken,
        ),
        authMethodId: resolveCopilotAuthMethodId(undefined, input.copilotSettings),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });

export function resolveCopilotAcpBaseModelId(model: string | null | undefined): string | undefined {
  const trimmed = model?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function currentCopilotModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyCopilotAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntimeShape, "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}

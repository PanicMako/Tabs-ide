import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ServerProviderUpdateError,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUpdatedPayload,
  type ServerProviderUpdateState,
} from "@tabs/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProviderRegistry } from "./Services/ProviderRegistry";
import { makeProviderMaintenanceCommandCoordinator } from "./providerMaintenanceCommandCoordinator";
import { enrichProviderSnapshotWithVersionAdvisory } from "./providerMaintenance";
import type { ProviderMaintenanceCapabilities } from "./providerMaintenance";
import { collectUint8StreamText } from "../stream/collectUint8StreamText";
import { AntigravityInstallation } from "./AntigravityInstallation";
const isServerProviderUpdateError = Schema.is(ServerProviderUpdateError);

const UPDATE_TIMEOUT_MS = 5 * 60_000;
const UPDATE_OUTPUT_MAX_BYTES = 10_000;

interface ProviderInstallCommand {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly lockKey: string;
}

/**
 * Server-owned install commands keyed by driver kind slug. The web never
 * supplies a shell string (RCE guard) — install is resolved here so the only
 * thing a client names is the configured instance + the action.
 */
const PROVIDER_INSTALL_COMMANDS: Readonly<Record<string, ProviderInstallCommand>> = {
  codex: { executable: "npm", args: ["install", "-g", "@openai/codex"], lockKey: "npm-global" },
  claudeAgent: {
    executable: "npm",
    args: ["install", "-g", "@anthropic-ai/claude-code"],
    lockKey: "npm-global",
  },
  cursor: {
    executable: "sh",
    args: ["-c", "curl https://cursor.com/install -fsS | bash"],
    lockKey: "cursor-install",
  },
  grok: {
    executable: "npm",
    args: ["install", "-g", "@vibe-kit/grok-cli"],
    lockKey: "npm-global",
  },
  opencode: { executable: "npm", args: ["install", "-g", "opencode-ai"], lockKey: "npm-global" },
  kilo: { executable: "npm", args: ["install", "-g", "@kilocode/cli"], lockKey: "npm-global" },
  droid: { executable: "npm", args: ["install", "-g", "droid"], lockKey: "npm-global" },
  copilot: { executable: "npm", args: ["install", "-g", "@github/copilot"], lockKey: "npm-global" },
};

function resolveInstallCommand(provider: ProviderDriverKind): ProviderInstallCommand | null {
  return PROVIDER_INSTALL_COMMANDS[provider as unknown as string] ?? null;
}

export interface ProviderMaintenanceCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export type ProviderMaintenanceTarget =
  | ProviderDriverKind
  | {
      readonly provider: ProviderDriverKind;
      readonly instanceId?: ProviderInstanceId | undefined;
    };

export interface ProviderMaintenanceRunnerShape {
  readonly updateProvider: (
    target: ProviderMaintenanceTarget,
  ) => Effect.Effect<ServerProviderUpdatedPayload, ServerProviderUpdateError>;
  /**
   * Install a provider's CLI using the server-owned install command for its
   * driver kind. Progress is projected onto the same volatile `updateState`
   * channel the UI already renders, then the instance is refreshed so a
   * successful install flips the provider to `installed`.
   */
  readonly installProvider: (
    target: ProviderMaintenanceTarget,
  ) => Effect.Effect<ServerProviderUpdatedPayload, ServerProviderUpdateError>;
}

export class ProviderMaintenanceRunner extends Context.Service<
  ProviderMaintenanceRunner,
  ProviderMaintenanceRunnerShape
>()("tabs/provider/providerMaintenanceRunner") {}

class ProviderMaintenanceCommandError extends Data.TaggedError("ProviderMaintenanceCommandError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface VerifiedProviderRefresh {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly verifiedProviders: ReadonlyArray<ServerProvider>;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const runProviderMaintenanceCommandWithSpawner = Effect.fn("ProviderMaintenanceRunner.runCommand")(
  function* (input: {
    readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
    readonly command: string;
    readonly args: ReadonlyArray<string>;
  }) {
    const collectCommandResult = Effect.fn("ProviderMaintenanceRunner.collectCommandResult")(
      function* () {
        const child = yield* input.spawner
          .spawn(ChildProcess.make(input.command, [...input.args]))
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderMaintenanceCommandError({
                  message: `Failed to run update command ${input.command}: ${cause.message}`,
                  cause,
                }),
            ),
          );
        yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectUint8StreamText({
              stream: child.stdout,
              maxBytes: UPDATE_OUTPUT_MAX_BYTES,
            }),
            collectUint8StreamText({
              stream: child.stderr,
              maxBytes: UPDATE_OUTPUT_MAX_BYTES,
            }),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderMaintenanceCommandError({
                message: cause instanceof Error ? cause.message : "Update command failed to run.",
                cause,
              }),
          ),
        );

        return {
          stdout: stdout.text,
          stderr: stderr.text,
          exitCode: Number(exitCode),
          timedOut: false,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        } satisfies ProviderMaintenanceCommandResult;
      },
    );

    return yield* collectCommandResult().pipe(
      Effect.scoped,
      Effect.timeoutOption(Duration.millis(UPDATE_TIMEOUT_MS)),
      Effect.map((result) =>
        Option.match(result, {
          onSome: (value) => value,
          onNone: () =>
            ({
              stdout: "",
              stderr: "",
              exitCode: null,
              timedOut: true,
              stdoutTruncated: false,
              stderrTruncated: false,
            }) satisfies ProviderMaintenanceCommandResult,
        }),
      ),
    );
  },
);

function trimNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function commandOutput(result: ProviderMaintenanceCommandResult): string | null {
  const output = trimNullable([result.stderr, result.stdout].filter(Boolean).join("\n\n"));
  if (!output) {
    return null;
  }
  return truncateText(output, UPDATE_OUTPUT_MAX_BYTES);
}

function failureMessage(result: ProviderMaintenanceCommandResult): string {
  if (result.timedOut) {
    return "Update timed out.";
  }
  if (result.exitCode !== null && result.exitCode !== 0) {
    return `Update command exited with code ${result.exitCode}.`;
  }
  return "Update command failed.";
}

function isOutdatedProvider(provider: ServerProvider | undefined): boolean {
  return provider?.versionAdvisory?.status === "behind_latest";
}

function isStillInstalled(provider: ServerProvider): boolean {
  return provider.installed;
}

function makeUpdateState(input: {
  readonly status: ServerProviderUpdateState["status"];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly message: string | null;
  readonly output?: string | null;
}): ServerProviderUpdateState {
  return {
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    message: input.message,
    output: input.output ?? null,
  };
}

export const make = Effect.fn("ProviderMaintenanceRunner.make")(function* () {
  const providerRegistry = yield* ProviderRegistry;
  const antigravityInstallation = yield* Effect.serviceOption(AntigravityInstallation);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const httpClient = yield* HttpClient.HttpClient;
  const runMaintenanceCommand = (command: string, args: ReadonlyArray<string>) =>
    runProviderMaintenanceCommandWithSpawner({
      spawner,
      command,
      args,
    });
  const commandCoordinator = yield* makeProviderMaintenanceCommandCoordinator({
    makeAlreadyRunningError: () =>
      new ServerProviderUpdateError({
        provider: "unknown" as ProviderDriverKind,
        reason: "An update is already running for this provider.",
      }),
  });

  const verifyRefreshedProvider = (
    provider: ProviderDriverKind,
    maintenanceCapabilities: ProviderMaintenanceCapabilities,
    instanceId: ProviderInstanceId,
  ): Effect.Effect<VerifiedProviderRefresh> =>
    providerRegistry.getProviders.pipe(
      Effect.map((providers) => {
        const instanceIds: Array<ProviderInstanceId> = [];
        for (const candidate of providers) {
          if (candidate.driver === provider && candidate.instanceId === instanceId) {
            instanceIds.push(candidate.instanceId);
          }
        }
        return instanceIds;
      }),
      Effect.flatMap((instanceIds) =>
        instanceIds.length === 0
          ? providerRegistry.refreshInstance(instanceId)
          : Effect.forEach(
              instanceIds,
              (instanceId) => providerRegistry.refreshInstance(instanceId),
              {
                concurrency: "unbounded",
                discard: true,
              },
            ).pipe(Effect.andThen(providerRegistry.getProviders)),
      ),
      Effect.flatMap((providers) => {
        const refreshedProviders = providers.filter(
          (candidate) => candidate.driver === provider && candidate.instanceId === instanceId,
        );
        if (refreshedProviders.length === 0) {
          return Effect.succeed<VerifiedProviderRefresh>({
            providers,
            verifiedProviders: [],
          });
        }
        return Effect.forEach(
          refreshedProviders,
          (refreshedProvider) =>
            enrichProviderSnapshotWithVersionAdvisory(
              refreshedProvider,
              maintenanceCapabilities,
            ).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
          {
            concurrency: "unbounded",
          },
        ).pipe(
          Effect.map(
            (verifiedProviders): VerifiedProviderRefresh => ({
              providers,
              verifiedProviders,
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Provider post-update version verification failed", {
              provider,
              cause: Cause.pretty(cause),
            }).pipe(
              Effect.as<VerifiedProviderRefresh>({
                providers,
                verifiedProviders: refreshedProviders,
              }),
            ),
          ),
        );
      }),
    );

  const updateProvider: ProviderMaintenanceRunnerShape["updateProvider"] = Effect.fn(
    "ProviderMaintenanceRunner.updateProvider",
  )(function* (target) {
    const provider = typeof target === "string" ? target : target.provider;
    const instanceId =
      typeof target === "string"
        ? defaultInstanceIdForDriver(provider)
        : (target.instanceId ?? defaultInstanceIdForDriver(provider));
    const targetKey = `instance:${instanceId}`;
    const capabilities = yield* providerRegistry.getProviderMaintenanceCapabilitiesForInstance(
      instanceId,
      provider,
    );
    const update = capabilities.update;
    if (!update) {
      return yield* new ServerProviderUpdateError({
        provider,
        reason: "This provider does not support one-click updates.",
      });
    }

    const setUpdateState = (state: ServerProviderUpdateState | null) =>
      providerRegistry.setProviderMaintenanceActionState({
        instanceId,
        action: "update",
        state,
      });
    const setQueuedState = setUpdateState(
      makeUpdateState({
        status: "queued",
        startedAt: null,
        finishedAt: null,
        message: "Waiting for another provider update to finish.",
      }),
    ).pipe(Effect.asVoid);

    const runProviderUpdate = Effect.fn("ProviderMaintenanceRunner.runProviderUpdate")(
      function* () {
        const finish = (state: ServerProviderUpdateState) =>
          setUpdateState(state).pipe(Effect.map((providers) => ({ providers })));
        const startedAtRef = yield* Ref.make<string | null>(null);

        const runCommandAndVerify = Effect.fn("ProviderMaintenanceRunner.runCommandAndVerify")(
          function* () {
            const startedAt = yield* nowIso;
            yield* Ref.set(startedAtRef, startedAt);
            yield* setUpdateState(
              makeUpdateState({
                status: "running",
                startedAt,
                finishedAt: null,
                message: "Updating provider.",
              }),
            );

            const result = yield* runMaintenanceCommand(update.executable, update.args);
            const finishedAt = yield* nowIso;
            if (result.timedOut || result.exitCode !== 0) {
              return yield* finish(
                makeUpdateState({
                  status: "failed",
                  startedAt,
                  finishedAt,
                  message: failureMessage(result),
                  output: commandOutput(result),
                }),
              );
            }

            const { verifiedProviders } = yield* verifyRefreshedProvider(
              provider,
              capabilities,
              instanceId,
            );
            const couldNotVerify =
              verifiedProviders.length === 0 ||
              verifiedProviders.some((verifiedProvider) => !isStillInstalled(verifiedProvider));
            const stillOutdated = verifiedProviders.some((verifiedProvider) =>
              isOutdatedProvider(verifiedProvider),
            );
            return yield* finish(
              makeUpdateState({
                status: couldNotVerify || stillOutdated ? "unchanged" : "succeeded",
                startedAt,
                finishedAt,
                message: couldNotVerify
                  ? "Update command completed, but Tabs could not verify the provider."
                  : stillOutdated
                    ? "Update command completed, but Tabs still detects an outdated provider version."
                    : "Provider updated.",
                output: commandOutput(result),
              }),
            );
          },
        );

        const recordFailedUpdate = Effect.fn("ProviderMaintenanceRunner.recordFailedUpdate")(
          function* (cause: Cause.Cause<unknown>) {
            const failure = Cause.squash(cause);
            const startedAt = yield* Ref.get(startedAtRef);
            return yield* finish(
              makeUpdateState({
                status: "failed",
                startedAt,
                finishedAt: yield* nowIso,
                message: failure instanceof Error ? failure.message : "Update command failed.",
                output: null,
              }),
            );
          },
        );

        return yield* runCommandAndVerify().pipe(Effect.catchCause(recordFailedUpdate));
      },
    );

    return yield* commandCoordinator
      .withCommandLock({
        targetKey,
        lockKey: update.lockKey,
        onQueued: setQueuedState,
        run: runProviderUpdate(),
      })
      .pipe(
        Effect.mapError((error) =>
          isServerProviderUpdateError(error)
            ? new ServerProviderUpdateError({
                provider,
                reason: error.reason,
              })
            : error,
        ),
      );
  });

  const installProvider: ProviderMaintenanceRunnerShape["installProvider"] = Effect.fn(
    "ProviderMaintenanceRunner.installProvider",
  )(function* (target) {
    const provider = typeof target === "string" ? target : target.provider;
    const instanceId =
      typeof target === "string"
        ? defaultInstanceIdForDriver(provider)
        : (target.instanceId ?? defaultInstanceIdForDriver(provider));
    const managedAntigravity = (provider as unknown as string) === "antigravity";
    const command = resolveInstallCommand(provider);
    if (!managedAntigravity && !command) {
      return yield* new ServerProviderUpdateError({
        provider,
        reason: "This provider does not support one-click install.",
      });
    }

    const targetKey = `instance:${instanceId}`;
    const setUpdateState = (state: ServerProviderUpdateState | null) =>
      providerRegistry.setProviderMaintenanceActionState({
        instanceId,
        action: "update",
        state,
      });
    const setQueuedState = setUpdateState(
      makeUpdateState({
        status: "queued",
        startedAt: null,
        finishedAt: null,
        message: "Waiting for another provider task to finish.",
      }),
    ).pipe(Effect.asVoid);

    const runProviderInstall = Effect.fn("ProviderMaintenanceRunner.runProviderInstall")(
      function* () {
        const finish = (state: ServerProviderUpdateState) =>
          setUpdateState(state).pipe(Effect.map((providers) => ({ providers })));
        const startedAtRef = yield* Ref.make<string | null>(null);

        const runCommandAndRefresh = Effect.fn("ProviderMaintenanceRunner.runInstallCommand")(
          function* () {
            const startedAt = yield* nowIso;
            yield* Ref.set(startedAtRef, startedAt);
            yield* setUpdateState(
              makeUpdateState({
                status: "running",
                startedAt,
                finishedAt: null,
                message: "Installing provider.",
              }),
            );

            if (managedAntigravity) {
              if (antigravityInstallation._tag === "None") {
                return yield* new ServerProviderUpdateError({
                  provider,
                  reason: "The managed Antigravity installer is unavailable in this environment.",
                });
              }
              const installedState = yield* antigravityInstallation.value.start;
              const providers = yield* providerRegistry.refreshInstance(instanceId);
              const installed =
                installedState.phase === "succeeded" &&
                providers.some(
                  (candidate) =>
                    candidate.driver === provider &&
                    candidate.instanceId === instanceId &&
                    candidate.installed,
                );
              return yield* finish(
                makeUpdateState({
                  status: installed ? "succeeded" : "unchanged",
                  startedAt,
                  finishedAt: yield* nowIso,
                  message: installed
                    ? `Antigravity ACP ${installedState.installedVersion ?? "runtime"} installed and verified.`
                    : "The managed runtime was installed, but Tabs could not activate it for this provider instance.",
                }),
              );
            }

            const result = yield* runMaintenanceCommand(command!.executable, command!.args);
            const finishedAt = yield* nowIso;
            if (result.timedOut || result.exitCode !== 0) {
              return yield* finish(
                makeUpdateState({
                  status: "failed",
                  startedAt,
                  finishedAt,
                  message: result.timedOut
                    ? "Install timed out."
                    : `Install command exited with code ${result.exitCode}.`,
                  output: commandOutput(result),
                }),
              );
            }

            const providers = yield* providerRegistry.refreshInstance(instanceId);
            const installed = providers.some(
              (candidate) =>
                candidate.driver === provider &&
                candidate.instanceId === instanceId &&
                candidate.installed,
            );
            return yield* finish(
              makeUpdateState({
                status: installed ? "succeeded" : "unchanged",
                startedAt,
                finishedAt,
                message: installed
                  ? "Provider installed."
                  : "Install command completed, but Tabs could not detect the provider. You may need to restart.",
                output: commandOutput(result),
              }),
            );
          },
        );

        const recordFailedInstall = Effect.fn("ProviderMaintenanceRunner.recordFailedInstall")(
          function* (cause: Cause.Cause<unknown>) {
            const failure = Cause.squash(cause);
            const startedAt = yield* Ref.get(startedAtRef);
            return yield* finish(
              makeUpdateState({
                status: "failed",
                startedAt,
                finishedAt: yield* nowIso,
                message: failure instanceof Error ? failure.message : "Install command failed.",
                output: null,
              }),
            );
          },
        );

        return yield* runCommandAndRefresh().pipe(Effect.catchCause(recordFailedInstall));
      },
    );

    return yield* commandCoordinator
      .withCommandLock({
        targetKey,
        lockKey: managedAntigravity ? "antigravity-managed-runtime" : command!.lockKey,
        onQueued: setQueuedState,
        run: runProviderInstall(),
      })
      .pipe(
        Effect.mapError((error) =>
          isServerProviderUpdateError(error)
            ? new ServerProviderUpdateError({
                provider,
                reason: error.reason,
              })
            : error,
        ),
      );
  });

  return ProviderMaintenanceRunner.of({
    updateProvider,
    installProvider,
  });
});

export const layer = Layer.effect(ProviderMaintenanceRunner, make());

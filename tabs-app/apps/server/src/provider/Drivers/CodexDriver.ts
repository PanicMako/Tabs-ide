import { CodexDriver as ModernCodexDriver } from "./CodexDriver.modern.ts";
import { ProviderRuntimeGeneration } from "../ProviderRuntimeGeneration.ts";
/**
 * CodexDriver — first concrete `ProviderDriver` in the new per-instance model.
 *
 * A driver is a plain value (not a ServiceMap.Service) whose `create()` returns
 * one `ProviderInstance` bundling:
 *   - `snapshot`   — the live `ServerProviderShape` for this instance;
 *   - `adapter`    — the Codex session/turn/approval runtime;
 *   - `textGeneration` — commit/PR/branch/title generation via `codex exec`.
 *
 * Each call to `create()` captures the `codexConfig` argument in closures
 * owned by the returned instance. Two instances created with different
 * `homePath`s (e.g. `codex_personal` + `codex_work`) therefore run with
 * fully independent Codex app-server processes and `CODEX_HOME`
 * environments — no shared mutable state.
 *
 * Resource lifecycle: `create()` runs in a scope handed in by the registry.
 * Closing that scope releases the adapter's child processes, the managed
 * snapshot's refresh fibre, and the text-generation binaries' transient
 * scratch files. The registry uses this to tear down an instance when its
 * `providerInstances` entry disappears or its config changes.
 *
 * @module provider/Drivers/CodexDriver
 */
import {
  CodexSettings,
  ProviderDriverKind,
  type ProviderConsumeResetCreditOutcome,
  type ServerProvider,
} from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCodexAdapter } from "../Layers/CodexAdapter.ts";
import {
  CODEX_RESET_CREDIT_TIMEOUT,
  CodexResetCreditCoordinator,
} from "../Layers/codexResetCredit.ts";
import {
  checkCodexProviderStatus,
  makePendingCodexProvider,
  probeCodexSkillsForCwd,
  withCodexAppServerClient,
} from "../Layers/CodexProvider.ts";
import { resolveCodexLaunchArgs } from "../Layers/codexLaunchArgs.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  makeExternalCliLifecycle,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import { makeManagedCodexProvider } from "./CodexManagedProvider.ts";
import {
  codexContinuationIdentity,
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
} from "./CodexHomeLayout.ts";
const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const DRIVER_KIND = "codex" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const makeUpdateResolver = (sharedHomePath: string) =>
  makePackageManagedProviderMaintenanceResolver({
    provider: DRIVER_KIND,
    npmPackageName: "@openai/codex",
    homebrewFormula: "codex",
    nativeUpdate: {
      executable: "codex",
      args: ["update"],
      lockKey: "codex-native",
      env: { CODEX_HOME: sharedHomePath },
      isCommandPath: (commandPath) =>
        commandPath.replaceAll("\\", "/").includes("/packages/standalone/"),
    },
  });

/**
 * Services the driver needs to materialize an instance. Surfaced as the
 * driver's `R` so the registry layer aggregates these across every
 * registered driver and the runtime satisfies them once.
 */
export type CodexDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | CodexResetCreditCoordinator
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

/**
 * Stamp instance identity onto a `ServerProvider` snapshot produced by the
 * driver-kind-only codex helpers. Once `buildServerProvider` in
 * `providerSnapshot.ts` is widened to accept `instanceId`/`driver`, this
 * wrapper disappears.
 */
const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

const LegacyCodexDriver: ProviderDriver<CodexSettings, any> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Codex",
    supportsMultipleInstances: true,
  },
  configSchema: CodexSettings,
  defaultConfig: (): CodexSettings => decodeCodexSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      if (config.setupMode === "managed") {
        return yield* makeManagedCodexProvider({
          instanceId,
          displayName,
          accentColor,
          environment,
          enabled,
          config,
        });
      }
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const resetCreditCoordinator = yield* CodexResetCreditCoordinator;
      const httpClient = yield* HttpClient.HttpClient;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const homeLayout = yield* resolveCodexHomeLayout(config);
      const continuationIdentity = codexContinuationIdentity(homeLayout);
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      yield* materializeCodexShadowHome(homeLayout).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: cause.message,
              cause,
            }),
        ),
      );
      const effectiveConfig = {
        ...config,
        enabled,
        binaryPath: expandHomePath(config.binaryPath.trim()),
        homePath: homeLayout.effectiveHomePath ?? "",
      } satisfies CodexSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(
        makeUpdateResolver(homeLayout.sharedHomePath),
        {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        },
      );

      // `makeCodexAdapter` and `makeCodexTextGeneration` have `never` error
      // channels at construction time — their failure modes are all on the
      // per-operation closures they return. No `mapError` wrapper is needed
      // here; the registry only has to worry about snapshot-build and
      // spawner-availability failures surfaced from `checkCodexProviderStatus`
      // below.
      const adapter = yield* makeCodexAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeCodexTextGeneration(effectiveConfig, processEnv);

      // Build a managed snapshot whose settings never change — mutations come
      // in as instance rebuilds from the registry rather than in-place
      // updates. Pre-provide `ChildProcessSpawner` so the check fits
      // `makeManagedServerProvider.checkProvider`'s `R = never`.
      const checkProvider = checkCodexProviderStatus(effectiveConfig, undefined, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const snapshot = yield* makeManagedServerProvider<CodexSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingCodexProvider(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        enrichSnapshot: ({ snapshot, publishSnapshot }) =>
          enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
          ),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Codex snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const snapshotForCwd = (cwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              probeCodexSkillsForCwd({
                binaryPath: effectiveConfig.binaryPath,
                homePath: effectiveConfig.homePath,
                launchArgs: resolveCodexLaunchArgs(undefined, processEnv),
                cwd,
                environment: processEnv,
              }).pipe(
                Effect.scoped,
                Effect.timeout("20 seconds"),
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
              ),
            ]).pipe(
              Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills })),
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER_KIND,
                    instanceId,
                    detail: `Failed to probe Codex skills for '${cwd}'`,
                    cause,
                  }),
              ),
            );

      const accountKey = homeLayout.effectiveHomePath ?? homeLayout.sharedHomePath;
      const consumeResetCredit: NonNullable<ProviderInstance["consumeResetCredit"]> = () =>
        resetCreditCoordinator
          .redeem(accountKey, (idempotencyKey) =>
            Effect.gen(function* () {
              const { client } = yield* withCodexAppServerClient({
                binaryPath: effectiveConfig.binaryPath,
                homePath: effectiveConfig.homePath,
                launchArgs: resolveCodexLaunchArgs(undefined, processEnv),
                // Account-level request; any directory serves, same as the status probe.
                cwd: process.cwd(),
                environment: processEnv,
              });
              const response = yield* (client as any).request(
                "account/rateLimitResetCredit/consume",
                {
                  idempotencyKey,
                },
              ) as Effect.Effect<{ outcome: ProviderConsumeResetCreditOutcome }, any, never>;
              return response.outcome;
            }).pipe(Effect.scoped, Effect.timeout(CODEX_RESET_CREDIT_TIMEOUT)),
          )
          .pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.mapError(
              (cause) =>
                new ProviderDriverError({
                  driver: DRIVER_KIND,
                  instanceId,
                  detail: "Codex could not redeem the reset credit.",
                  cause,
                }),
            ),
            Effect.tap(() =>
              Effect.gen(function* () {
                const before = (yield* snapshot.getSnapshot).usageLimits?.checkedAt;
                const refreshed = yield* snapshot.refresh;
                const after = refreshed.usageLimits?.checkedAt;
                if (
                  after === undefined ||
                  after === before ||
                  refreshed.usageLimits?.unavailable?.reason === "probeFailed"
                ) {
                  return yield* new ProviderDriverError({
                    driver: DRIVER_KIND,
                    instanceId,
                    detail:
                      "The reset was applied, but Codex could not confirm the new limits. Refresh to check.",
                  });
                }
              }),
            ),
          );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        capabilities: makeProviderInstanceCapabilities({
          modelDiscovery: "runtime",
          agentSessions: "supported",
          textGeneration: "supported",
          structuredGeneration: "supported",
          testingMcpTools: "supported",
          login: "external",
          logout: "external",
          accountSwitch: "external",
          installation: "external",
        }),
        lifecycle: makeExternalCliLifecycle([
          { kind: "login", command: "codex login" },
          { kind: "logout", command: "codex logout" },
          { kind: "switch-account", command: "codex logout && codex login" },
        ]),
        snapshot,
        snapshotForCwd,
        consumeResetCredit,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};

// Both server generations share the provider catalog during the transition.
// Legacy registry assembly explicitly retains its existing adapters until
// the browser migration is accepted.
export const CodexDriver: typeof LegacyCodexDriver = {
  ...LegacyCodexDriver,
  create: (input) =>
    Effect.gen(function* () {
      const generation = yield* ProviderRuntimeGeneration;
      return yield* generation === "v2"
        ? ModernCodexDriver.create(input)
        : LegacyCodexDriver.create(input);
    }),
};

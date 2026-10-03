import { type DroidSettings, type ServerProvider } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  parseGenericCliVersion,
  spawnAndCollect,
} from "../providerSnapshot";

export const checkDroidProviderStatus = Effect.fn("checkDroidProviderStatus")(function* (
  settings: DroidSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: { displayName: "Factory Droid" },
      enabled: false,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Factory Droid is disabled in Tabs settings.",
      },
    });
  }
  const binary = settings.binaryPath?.trim() || "droid";
  const command = ChildProcess.make(binary, ["--version"], {
    env: environment,
  });
  const probe = yield* spawnAndCollect(binary, command).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(probe) || Option.isNone(probe.success)) {
    return buildServerProvider({
      presentation: { displayName: "Factory Droid" },
      enabled: settings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Factory Droid CLI (`droid`) is not installed or failed to run.",
      },
    });
  }
  const result = probe.success.value;
  return buildServerProvider({
    presentation: { displayName: "Factory Droid" },
    enabled: settings.enabled,
    checkedAt,
    models: [],
    probe: {
      installed: result.code === 0,
      version: parseGenericCliVersion(`${result.stdout}\n${result.stderr}`),
      status: result.code === 0 ? "warning" : "error",
      auth: { status: "unknown" },
      message:
        result.code === 0
          ? "Checking Factory Droid authentication through ACP..."
          : "Factory Droid CLI is installed but failed its version check.",
    },
  });
});

export const makePendingDroidProvider = (
  settings: DroidSettings,
): Effect.Effect<ServerProvider, never, ChildProcessSpawner.ChildProcessSpawner> =>
  checkDroidProviderStatus(settings) as any;

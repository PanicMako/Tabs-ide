import { MuseSettings, PiSettings } from "@tabs/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  PI_ARGUMENTS_WITH_VALUES,
  resolvePiLaunchArgs,
} from "../orchestration-v2/Adapters/piT3McpInjection.ts";
import { createMuseSdkHostEffect, makeMuseEnvironment } from "../provider/muse/sdk.ts";

/** Expands a leading `~` against `home`, which is the instance's home rather than the host's. */
function expandHomePath(value: string, home: string): string {
  if (value === "~") return home;
  return value.startsWith("~/") || value.startsWith("~\\") ? home + value.slice(1) : value;
}

const decodePiSettings = Schema.decodeOption(PiSettings);
const decodeMuseSettings = Schema.decodeOption(MuseSettings);

/** The home Pi resolves `~` against: the instance's HOME (USERPROFILE on Windows), else the host's. */
export function piHome(
  environment: NodeJS.ProcessEnv,
  hostHome: string,
  platform: NodeJS.Platform,
): string {
  return (platform === "win32" ? environment.USERPROFILE : environment.HOME) || hostHome;
}

/** Where Pi stores session JSONL files for a provider environment, matching Pi's own lookup. */
export function resolvePiSessionsDir(
  environment: NodeJS.ProcessEnv,
  home: string,
  path: Path.Path,
): string {
  const sessionDir = environment.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDir) return path.resolve(expandHomePath(sessionDir, home));
  const agentDir = environment.PI_CODING_AGENT_DIR?.trim();
  return path.resolve(
    agentDir ? expandHomePath(agentDir, home) : path.join(home, ".pi", "agent"),
    "sessions",
  );
}

function piLaunchSessionDir(launchArgs: string): string | undefined {
  const resolved = resolvePiLaunchArgs(launchArgs);
  if (!resolved.ok) return undefined;
  let sessionDir: string | undefined;
  for (let index = 0; index < resolved.args.length; index += 1) {
    const arg = resolved.args[index];
    if (arg === undefined || !PI_ARGUMENTS_WITH_VALUES.has(arg)) continue;
    index += 1;
    if (arg === "--session-dir") sessionDir = resolved.args[index] || undefined;
  }
  return sessionDir;
}

export function piSessionDirectories(input: {
  readonly config: unknown;
  readonly environment: NodeJS.ProcessEnv;
  readonly hostHome: string;
  readonly platform: NodeJS.Platform;
  readonly path: Path.Path;
}): ReadonlyArray<string> {
  const decoded = decodePiSettings(input.config ?? {});
  const launchHome = piHome(input.environment, input.hostHome, input.platform);
  const sessionDirArg = Option.isSome(decoded)
    ? piLaunchSessionDir(decoded.value.launchArgs)
    : undefined;
  const launchDir =
    sessionDirArg === undefined ? undefined : expandHomePath(sessionDirArg, launchHome);
  // --session-dir moves only Tabs-launched sessions; terminal sessions stay in Pi's own directory.
  return [
    ...(launchDir !== undefined && input.path.isAbsolute(launchDir)
      ? [input.path.resolve(launchDir)]
      : []),
    resolvePiSessionsDir(input.environment, launchHome, input.path),
  ];
}

interface MuseHomeKey {
  readonly binaryPath: string;
  readonly environment: Readonly<Record<string, string>>;
}

// Muse reports its home only when started, so each binary and environment is asked once and the
// answer is kept; an unavailable install is retried after a short wait.
const museHomes = Effect.runSync(
  Cache.makeWith(
    (key: MuseHomeKey) =>
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* Effect.acquireRelease(
            createMuseSdkHostEffect({
              binaryPath: key.binaryPath,
              environment: makeMuseEnvironment({ ...key.environment }),
              readOnly: true,
              startupTimeoutMs: 5_000,
            }),
            (host) => Effect.promise(() => host.close()).pipe(Effect.ignore),
            { interruptible: true },
          );
          return host.initializeResult.museHome;
        }),
      ).pipe(Effect.orElseSucceed((): string | undefined => undefined)),
    {
      capacity: 32,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value ? Duration.infinity : Duration.seconds(30),
    },
  ),
);

export const museSessionDirectories = Effect.fn("usage.museSessionDirectories")(function* (input: {
  readonly config: unknown;
  readonly environment: NodeJS.ProcessEnv;
  readonly hostHome: string;
  readonly path: Path.Path;
}) {
  const decoded = decodeMuseSettings(input.config ?? {});
  const binaryPath = expandHomePath(
    Option.isSome(decoded) ? decoded.value.binaryPath || "muse" : "muse",
    input.hostHome,
  );
  const environment = Object.fromEntries(
    Object.entries(input.environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const home = yield* Cache.get(museHomes, { binaryPath, environment });
  return home ? [{ directory: input.path.join(home, "sessions"), fileName: "session.jsonl" }] : [];
});

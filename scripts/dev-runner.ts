#!/usr/bin/env node

import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService, layer as netServiceLayer } from "@tabs/shared/Net";
import { Config, Data, Effect, Hash, Layer, Logger, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

const BASE_SERVER_PORT = 3773;
const BASE_WEB_PORT = 5733;
const MAX_HASH_OFFSET = 3000;
const MAX_PORT = 65535;

export const DEFAULT_TABS_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(homedir(), ".tabs"),
);

const MODE_ARGS = {
  dev: [
    "run",
    "dev",
    "--ui=tui",
    "--filter=@tabs/contracts",
    "--filter=@tabs/web",
    "--filter=tabs",
  ],
  "dev:server": ["run", "dev", "--filter=tabs"],
  "dev:web": ["run", "dev", "--filter=@tabs/web"],
  // The desktop package watches its own authenticated backend bundle via
  // `dev:backend-bundle`; do not run the standalone server here because it
  // competes for state and is not the process Electron connects to.
  // Both desktop and web resolve workspace packages from source while their
  // watchers are active. `--only` skips the root dev task's contracts build,
  // which otherwise blocks first paint on ~15s of declaration generation.
  "dev:desktop": ["run", "dev", "--only", "--filter=@tabs/desktop", "--filter=@tabs/web"],
} as const satisfies Record<string, ReadonlyArray<string>>;

type DevMode = keyof typeof MODE_ARGS;
type PortAvailabilityCheck<R = never> = (port: number) => Effect.Effect<boolean, never, R>;

const DEV_RUNNER_MODES = Object.keys(MODE_ARGS) as Array<DevMode>;

class DevRunnerError extends Data.TaggedError("DevRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalBooleanConfig = (name: string): Config.Config<boolean | undefined> =>
  Config.boolean(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalPortConfig = (name: string): Config.Config<number | undefined> =>
  Config.port(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalIntegerConfig = (name: string): Config.Config<number | undefined> =>
  Config.int(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalUrlConfig = (name: string): Config.Config<URL | undefined> =>
  Config.url(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

const OffsetConfig = Config.all({
  portOffset: optionalIntegerConfig("TABS_PORT_OFFSET"),
  devInstance: optionalStringConfig("TABS_DEV_INSTANCE"),
});

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
}): { readonly offset: number; readonly source: string } {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      throw new Error(`Invalid TABS_PORT_OFFSET: ${config.portOffset}`);
    }
    return {
      offset: config.portOffset,
      source: `TABS_PORT_OFFSET=${config.portOffset}`,
    };
  }

  const seed = config.devInstance?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return { offset: Number(seed), source: `numeric TABS_DEV_INSTANCE=${seed}` };
  }

  const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
  return { offset, source: `hashed TABS_DEV_INSTANCE=${seed}` };
}

function resolveBaseDir(baseDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = baseDir?.trim();

    if (configured) {
      return path.resolve(configured);
    }

    return yield* DEFAULT_TABS_HOME;
  });
}

interface CreateDevRunnerEnvInput {
  readonly mode: DevMode;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly serverOffset: number;
  readonly webOffset: number;
  readonly tabsHome: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
}

export function createDevRunnerEnv({
  mode,
  baseEnv,
  serverOffset,
  webOffset,
  tabsHome,
  authToken,
  noBrowser,
  autoBootstrapProjectFromCwd,
  logWebSocketEvents,
  host,
  port,
  devUrl,
}: CreateDevRunnerEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const serverPort = port ?? BASE_SERVER_PORT + serverOffset;
    const webPort = BASE_WEB_PORT + webOffset;
    const resolvedBaseDir = yield* resolveBaseDir(tabsHome);
    const isDesktopMode = mode === "dev:desktop";

    const output: NodeJS.ProcessEnv = {
      ...baseEnv,
      PORT: String(webPort),
      ELECTRON_RENDERER_PORT: String(webPort),
      VITE_DEV_SERVER_URL: devUrl?.toString() ?? `http://localhost:${webPort}`,
      TABS_HOME: resolvedBaseDir,
    };

    if (!isDesktopMode) {
      output.TABS_PORT = String(serverPort);
      output.VITE_WS_URL = `ws://localhost:${serverPort}`;
    } else {
      delete output.TABS_PORT;
      delete output.VITE_WS_URL;
      delete output.TABS_AUTH_TOKEN;
      delete output.TABS_MODE;
      delete output.TABS_NO_BROWSER;
      delete output.TABS_HOST;
    }

    if (!isDesktopMode && host !== undefined) {
      output.TABS_HOST = host;
    }

    if (!isDesktopMode && authToken !== undefined) {
      output.TABS_AUTH_TOKEN = authToken;
    } else if (!isDesktopMode) {
      delete output.TABS_AUTH_TOKEN;
    }

    if (!isDesktopMode && noBrowser !== undefined) {
      output.TABS_NO_BROWSER = noBrowser ? "1" : "0";
    } else if (!isDesktopMode) {
      delete output.TABS_NO_BROWSER;
    }

    if (autoBootstrapProjectFromCwd !== undefined) {
      output.TABS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = autoBootstrapProjectFromCwd ? "1" : "0";
    } else {
      delete output.TABS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
    }

    if (logWebSocketEvents !== undefined) {
      output.TABS_LOG_WS_EVENTS = logWebSocketEvents ? "1" : "0";
    } else {
      delete output.TABS_LOG_WS_EVENTS;
    }

    if (mode === "dev") {
      output.TABS_MODE = "web";
      delete output.TABS_DESKTOP_WS_URL;
    }

    if (mode === "dev:server" || mode === "dev:web") {
      output.TABS_MODE = "web";
      delete output.TABS_DESKTOP_WS_URL;
    }

    if (isDesktopMode) {
      delete output.TABS_DESKTOP_WS_URL;
    }

    return output;
  });
}

function portPairForOffset(offset: number): {
  readonly serverPort: number;
  readonly webPort: number;
} {
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + offset,
  };
}

const defaultCheckPortAvailability: PortAvailabilityCheck<NetService> = (port) =>
  Effect.gen(function* () {
    const net = yield* NetService;
    return yield* net.isPortAvailableOnLoopback(port);
  });

interface FindFirstAvailableOffsetInput<R = NetService> {
  readonly startOffset: number;
  readonly requireServerPort: boolean;
  readonly requireWebPort: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function findFirstAvailableOffset<R = NetService>({
  startOffset,
  requireServerPort,
  requireWebPort,
  checkPortAvailability,
}: FindFirstAvailableOffsetInput<R>): Effect.Effect<number, DevRunnerError, R> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    for (let candidate = startOffset; ; candidate += 1) {
      const { serverPort, webPort } = portPairForOffset(candidate);
      const serverPortOutOfRange = serverPort > MAX_PORT;
      const webPortOutOfRange = webPort > MAX_PORT;

      if (
        (requireServerPort && serverPortOutOfRange) ||
        (requireWebPort && webPortOutOfRange) ||
        (!requireServerPort && !requireWebPort && (serverPortOutOfRange || webPortOutOfRange))
      ) {
        break;
      }

      const checks: Array<Effect.Effect<boolean, never, R>> = [];
      if (requireServerPort) {
        checks.push(checkPort(serverPort));
      }
      if (requireWebPort) {
        checks.push(checkPort(webPort));
      }

      if (checks.length === 0) {
        return candidate;
      }

      const availability = yield* Effect.all(checks);
      if (availability.every(Boolean)) {
        return candidate;
      }
    }

    return yield* new DevRunnerError({
      message: `No available dev ports found from offset ${startOffset}. Tried server=${BASE_SERVER_PORT}+n web=${BASE_WEB_PORT}+n up to port ${MAX_PORT}.`,
    });
  });
}

interface ResolveModePortOffsetsInput<R = NetService> {
  readonly mode: DevMode;
  readonly startOffset: number;
  readonly hasExplicitServerPort: boolean;
  readonly hasExplicitDevUrl: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function resolveModePortOffsets<R = NetService>({
  mode,
  startOffset,
  hasExplicitServerPort,
  hasExplicitDevUrl,
  checkPortAvailability,
}: ResolveModePortOffsetsInput<R>): Effect.Effect<
  { readonly serverOffset: number; readonly webOffset: number },
  DevRunnerError,
  R
> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    if (mode === "dev:web") {
      if (hasExplicitDevUrl) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const webOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: false,
        requireWebPort: true,
        checkPortAvailability: checkPort,
      });
      return { serverOffset: startOffset, webOffset };
    }

    if (mode === "dev:server") {
      if (hasExplicitServerPort) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const serverOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: true,
        requireWebPort: false,
        checkPortAvailability: checkPort,
      });
      return { serverOffset, webOffset: serverOffset };
    }

    const sharedOffset = yield* findFirstAvailableOffset({
      startOffset,
      requireServerPort: !hasExplicitServerPort,
      requireWebPort: !hasExplicitDevUrl,
      checkPortAvailability: checkPort,
    });

    return { serverOffset: sharedOffset, webOffset: sharedOffset };
  });
}

interface DevRunnerCliInput {
  readonly mode: DevMode;
  readonly tabsHome: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly dryRun: boolean;
  readonly turboArgs: ReadonlyArray<string>;
}

const readOptionalBooleanEnv = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return undefined;
};

const resolveOptionalBooleanOverride = (
  explicitValue: boolean | undefined,
  envValue: boolean | undefined,
): boolean | undefined => {
  if (explicitValue === true) {
    return true;
  }

  if (explicitValue === false) {
    return envValue;
  }

  return envValue;
};

export function matchesLocalProviderServerCommand(command: string): boolean {
  return (
    /(?:^|\s)(?:\S*\/)?opencode serve --hostname 127\.0\.0\.1 --port \d+(?:\s|$)/u.test(command) ||
    /(?:^|\s)(?:\S*\/)?\.?kilo serve --hostname 127\.0\.0\.1 --port \d+(?:\s|$)/u.test(command)
  );
}

function terminateExistingDevInstances(options?: {
  readonly protectCurrentDescendants?: boolean;
  readonly restrictToCurrentWorkingTree?: boolean;
}): number {
  try {
    // 1. Get the current process ancestors to protect them from being terminated.
    const ancestors = new Set<number>([process.pid]);
    const ppidMap = new Map<number, number>();

    // Get process groups as well: Kilo's native worker survives if only its
    // Node launcher is killed.
    const psOutput = execSync("ps -ax -o pid,ppid,pgid,command").toString();
    const lines = psOutput.split("\n");

    const processesToInspect: Array<{ pid: number; ppid: number; pgid: number; command: string }> =
      [];

    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i];
      if (rawLine === undefined) {
        continue;
      }
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      // Match pid, ppid, and the command string
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (
        match &&
        match[1] !== undefined &&
        match[2] !== undefined &&
        match[3] !== undefined &&
        match[4] !== undefined
      ) {
        const pid = parseInt(match[1], 10);
        const ppid = parseInt(match[2], 10);
        const pgid = parseInt(match[3], 10);
        const command = match[4];
        ppidMap.set(pid, ppid);
        processesToInspect.push({ pid, ppid, pgid, command });
      }
    }

    // Resolve full ancestor chain for the current process up to PID 1 or until a cycle/self-parent is detected
    let currentPid = process.pid;
    while (currentPid > 0) {
      const parent = ppidMap.get(currentPid);
      if (parent === undefined || parent === currentPid || ancestors.has(parent)) {
        break;
      }
      ancestors.add(parent);
      currentPid = parent;
    }

    // Resolve all descendants of the current process PID (not of its ancestors, to avoid protecting sibling shells in integrated terminals)
    const descendants = new Set<number>([process.pid]);
    let addedNewDescendant = true;
    while (addedNewDescendant) {
      addedNewDescendant = false;
      for (const [pid, ppid] of ppidMap.entries()) {
        if (descendants.has(ppid) && !descendants.has(pid)) {
          descendants.add(pid);
          addedNewDescendant = true;
        }
      }
    }

    // Combine ancestors and current process descendants into a single protected PIDs set
    const protectedPids = new Set<number>([
      ...ancestors,
      ...(options?.protectCurrentDescendants === false ? [process.pid] : descendants),
    ]);
    const protectedGroups = new Set(
      processesToInspect.filter(({ pid }) => protectedPids.has(pid)).map(({ pgid }) => pgid),
    );

    // Designate the process pattern matching targets
    const TARGET_PATTERNS = [
      "dev-electron.mjs",
      "Tabs (Dev)",
      "dist-electron/main.js",
      "apps/server/dist/index.mjs",
      "@tabs/desktop",
      "node.*/apps/web/node_modules/.bin/vite",
      "tsdown",
      "dev:bundle dev:backend-bundle",
    ];

    const matchesDevProcess = (command: string) =>
      TARGET_PATTERNS.some((pattern) =>
        pattern.includes(".*") ? new RegExp(pattern).test(command) : command.includes(pattern),
      );
    const staleDevPids = new Set(
      processesToInspect
        .filter(({ pid, command }) => !protectedPids.has(pid) && matchesDevProcess(command))
        .map(({ pid }) => pid),
    );
    const descendsFromStaleDevProcess = (pid: number): boolean => {
      const visited = new Set<number>();
      let current = ppidMap.get(pid);
      while (current !== undefined && current > 1 && !visited.has(current)) {
        if (staleDevPids.has(current)) return true;
        visited.add(current);
        current = ppidMap.get(current);
      }
      return false;
    };
    const isOwnedProviderServer = (input: {
      readonly pid: number;
      readonly ppid: number;
      readonly command: string;
    }): boolean =>
      matchesLocalProviderServerCommand(input.command) &&
      (input.ppid === 1 || descendsFromStaleDevProcess(input.pid));
    const knownServerDirectories = new Set(
      execSync("git worktree list --porcelain", { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => join(line.slice("worktree ".length), "tabs-app", "apps", "server")),
    );
    const belongsToCurrentWorkingTree = (pid: number): boolean => {
      if (options?.restrictToCurrentWorkingTree !== true) return true;
      try {
        const output = execSync(`lsof -a -p ${pid} -d cwd -Fn`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const cwd = output
          .split("\n")
          .find((line) => line.startsWith("n"))
          ?.slice(1);
        const root = process.cwd();
        return cwd === root || cwd?.startsWith(`${root}/`) === true;
      } catch {
        return false;
      }
    };
    const belongsToKnownServerWorktree = (pid: number): boolean => {
      try {
        const output = execSync(`lsof -a -p ${pid} -d cwd -Fn`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const cwd = output
          .split("\n")
          .find((line) => line.startsWith("n"))
          ?.slice(1);
        return cwd !== undefined && knownServerDirectories.has(cwd);
      } catch {
        return false;
      }
    };

    // Identify processes to kill
    const pidsToKill: number[] = [];
    const providerGroupsToKill = new Set<number>();
    for (const processInfo of processesToInspect) {
      const { pid, pgid, command } = processInfo;
      // Never kill protected processes (ourselves, ancestors, or our own spawned descendants)
      if (protectedPids.has(pid)) {
        continue;
      }

      const ownedProvider = isOwnedProviderServer(processInfo);
      const matchesPattern = matchesDevProcess(command) || ownedProvider;

      if (
        ownedProvider &&
        !protectedGroups.has(pgid) &&
        (belongsToCurrentWorkingTree(pid) ||
          (processInfo.ppid === 1 && belongsToKnownServerWorktree(pid)))
      ) {
        providerGroupsToKill.add(pgid);
      } else if (matchesPattern && belongsToCurrentWorkingTree(pid)) {
        pidsToKill.push(pid);
      }
    }

    // Kill the target processes
    let terminated = 0;
    for (const pgid of providerGroupsToKill) {
      try {
        process.kill(-pgid, "SIGKILL");
        terminated += 1;
      } catch {
        // ignore if the group already exited
      }
    }
    for (const pid of pidsToKill) {
      try {
        process.kill(pid, "SIGKILL");
        terminated += 1;
      } catch {
        // ignore if process already exited
      }
    }
    return terminated;
  } catch (e) {
    // ignore errors to avoid breaking the startup flow if ps or execution fails
    return 0;
  }
}

export function runDevRunnerWithInput(input: DevRunnerCliInput) {
  return Effect.gen(function* () {
    const { portOffset, devInstance } = yield* OffsetConfig.pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerError({
            message: "Failed to read TABS_PORT_OFFSET/TABS_DEV_INSTANCE configuration.",
            cause,
          }),
      ),
    );

    const { offset, source } = yield* Effect.try({
      try: () => resolveOffset({ portOffset, devInstance }),
      catch: (cause) =>
        new DevRunnerError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const envOverrides = {
      noBrowser: readOptionalBooleanEnv("TABS_NO_BROWSER"),
      autoBootstrapProjectFromCwd: readOptionalBooleanEnv("TABS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD"),
      logWebSocketEvents: readOptionalBooleanEnv("TABS_LOG_WS_EVENTS"),
    };

    const { serverOffset, webOffset } = yield* resolveModePortOffsets({
      mode: input.mode,
      startOffset: offset,
      hasExplicitServerPort: input.port !== undefined,
      hasExplicitDevUrl: input.devUrl !== undefined,
    });

    const env = yield* createDevRunnerEnv({
      mode: input.mode,
      baseEnv: process.env,
      serverOffset,
      webOffset,
      tabsHome: input.tabsHome,
      authToken: input.authToken,
      noBrowser: resolveOptionalBooleanOverride(input.noBrowser, envOverrides.noBrowser),
      autoBootstrapProjectFromCwd: resolveOptionalBooleanOverride(
        input.autoBootstrapProjectFromCwd,
        envOverrides.autoBootstrapProjectFromCwd,
      ),
      logWebSocketEvents: resolveOptionalBooleanOverride(
        input.logWebSocketEvents,
        envOverrides.logWebSocketEvents,
      ),
      host: input.host,
      port: input.port,
      devUrl: input.devUrl,
    });

    const selectionSuffix =
      serverOffset !== offset || webOffset !== offset
        ? ` selectedOffset(server=${serverOffset},web=${webOffset})`
        : "";

    yield* Effect.logInfo(
      `[dev-runner] mode=${input.mode} source=${source}${selectionSuffix} serverPort=${String(env.TABS_PORT)} webPort=${String(env.PORT)} baseDir=${String(env.TABS_HOME)}`,
    );

    if (input.dryRun) {
      return;
    }

    if (process.platform !== "win32") {
      yield* Effect.logInfo(
        "[dev-runner] Terminating any existing dev instances to prevent conflicts...",
      );
      const terminated = terminateExistingDevInstances({
        restrictToCurrentWorkingTree: true,
      });

      // Give macOS a brief opportunity to reclaim resources only when stale
      // processes were actually removed. A clean launch should not pay this
      // delay on every invocation.
      if (terminated > 0) {
        yield* Effect.sleep("1500 millis");
      }
    }

    const child = yield* ChildProcess.make(
      "turbo",
      [...MODE_ARGS[input.mode], ...input.turboArgs],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
        extendEnv: false,
        // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
        shell: process.platform === "win32",
        // Keep turbo in the same process group so terminal signals (Ctrl+C)
        // reach it directly.
        detached: false,
        forceKillAfter: "1500 millis",
      },
    );

    const exitCode = yield* child.exitCode.pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerError({
            message:
              cause instanceof Error
                ? `turbo was interrupted before it could report an exit code: ${cause.message}`
                : "turbo was interrupted before it could report an exit code",
            cause,
          }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (input.mode === "dev:desktop" && process.platform !== "win32") {
            terminateExistingDevInstances({
              protectCurrentDescendants: false,
              restrictToCurrentWorkingTree: true,
            });
          }
        }),
      ),
    );
    if (exitCode !== 0) {
      return yield* new DevRunnerError({
        message: `turbo exited with code ${exitCode}`,
      });
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DevRunnerError
        ? cause
        : new DevRunnerError({
            message: cause instanceof Error ? cause.message : "dev-runner failed",
            cause,
          }),
    ),
  );
}

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.choice("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  tabsHome: Flag.string("home-dir").pipe(
    Flag.withDescription("Base directory for all Tabs data (equivalent to TABS_HOME)."),
    Flag.withFallbackConfig(optionalStringConfig("TABS_HOME")),
  ),
  authToken: Flag.string("auth-token").pipe(
    Flag.withDescription("Auth token (forwards to TABS_AUTH_TOKEN)."),
    Flag.withAlias("token"),
    Flag.withFallbackConfig(optionalStringConfig("TABS_AUTH_TOKEN")),
  ),
  noBrowser: Flag.boolean("no-browser").pipe(
    Flag.withDescription("Browser auto-open toggle (equivalent to TABS_NO_BROWSER)."),
    Flag.withFallbackConfig(optionalBooleanConfig("TABS_NO_BROWSER")),
  ),
  autoBootstrapProjectFromCwd: Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
    Flag.withDescription(
      "Auto-bootstrap toggle (equivalent to TABS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD).",
    ),
    Flag.withFallbackConfig(optionalBooleanConfig("TABS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD")),
  ),
  logWebSocketEvents: Flag.boolean("log-websocket-events").pipe(
    Flag.withDescription("WebSocket event logging toggle (equivalent to TABS_LOG_WS_EVENTS)."),
    Flag.withAlias("log-ws-events"),
    Flag.withFallbackConfig(optionalBooleanConfig("TABS_LOG_WS_EVENTS")),
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription("Server host/interface override (forwards to TABS_HOST)."),
    Flag.withFallbackConfig(optionalStringConfig("TABS_HOST")),
  ),
  port: Flag.integer("port").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    Flag.withDescription("Server port override (forwards to TABS_PORT)."),
    Flag.withFallbackConfig(optionalPortConfig("TABS_PORT")),
  ),
  devUrl: Flag.string("dev-url").pipe(
    Flag.withSchema(Schema.URLFromString),
    Flag.withDescription("Web dev URL override (forwards to VITE_DEV_SERVER_URL)."),
    Flag.withFallbackConfig(optionalUrlConfig("VITE_DEV_SERVER_URL")),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve mode/ports/env and print, but do not spawn turbo."),
    Flag.withDefault(false),
  ),
  turboArgs: Argument.string("turbo-arg").pipe(
    Argument.withDescription("Additional turbo args (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo development modes with deterministic port/env wiring."),
  Command.withHandler((input) => runDevRunnerWithInput(input)),
);

const cliRuntimeLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  NodeServices.layer,
  netServiceLayer,
);

const runtimeProgram = Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
);

if (import.meta.main) {
  NodeRuntime.runMain(runtimeProgram);
}

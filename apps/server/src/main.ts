import * as Context from "effect/Context";
/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import { Config, Data, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@tabs/shared/Net";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  resolveStaticDir,
  ServerConfig,
  type RuntimeMode,
  type ServerConfigShape,
} from "./config";
import { fixPath, resolveBaseDir } from "./os-jank";
import { Open } from "./open";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import {
  makeProviderInstanceRegistryLayer,
  makeRemoteAccessServicesLayer,
  makeServerProviderLayer,
  makeServerRuntimeServicesLayer,
} from "./serverLayers";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { Server } from "./wsServer";
import { ObservabilityLive } from "./observability/Observability";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";
import { readBootstrapEnvelope } from "./bootstrap";
import * as McpSessionRegistry from "./mcp/McpSessionRegistry";
import { ServerSettingsLive } from "./serverSettings";
import * as BackgroundPolicy from "./background/BackgroundPolicy";
import {
  checkServiceStatus,
  formatHeadlessInfo,
  removePidFile,
  stopDaemon,
  uninstallService,
  writePidFile,
} from "./background/BackgroundService.ts";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const BootstrapEnvelopeSchema = Schema.Struct({
  mode: Schema.optional(Schema.String),
  port: Schema.optional(PortSchema),
  host: Schema.optional(Schema.String),
  tabsHome: Schema.optional(Schema.String),
  devUrl: Schema.optional(Schema.URLFromString),
  noBrowser: Schema.optional(Schema.Boolean),
  authToken: Schema.optional(Schema.String),
  autoBootstrapProjectFromCwd: Schema.optional(Schema.Boolean),
  logWebSocketEvents: Schema.optional(Schema.Boolean),
});

interface CliInput {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly tabsHome: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly authToken: Option.Option<string>;
  readonly bootstrapFd: Option.Option<number>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

/**
 * CliConfigShape - Startup helpers required while building server layers.
 */
export interface CliConfigShape {
  /**
   * Current process working directory.
   */
  readonly cwd: string;

  /**
   * Apply OS-specific PATH normalization.
   */
  readonly fixPath: Effect.Effect<void>;

  /**
   * Resolve static web asset directory for server mode.
   */
  readonly resolveStaticDir: Effect.Effect<string | undefined>;
}

/**
 * CliConfig - Service tag for startup CLI/runtime helpers.
 */
export class CliConfig extends Context.Service<CliConfig, CliConfigShape>()("tabs/main/CliConfig") {
  static readonly layer = Layer.effect(
    CliConfig,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return {
        cwd: process.cwd(),
        fixPath: Effect.sync(fixPath),
        resolveStaticDir: resolveStaticDir().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      } satisfies CliConfigShape;
    }),
  );
}

const CliEnvConfig = Config.all({
  mode: Config.string("TABS_MODE").pipe(
    Config.option,
    Config.map(Option.map((value) => (value === "desktop" ? "desktop" : "web"))),
    Config.map(Option.getOrUndefined),
  ),
  port: Config.port("TABS_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("TABS_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  tabsHome: Config.string("TABS_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean("TABS_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  authToken: Config.string("TABS_AUTH_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  bootstrapFd: Config.int("TABS_BOOTSTRAP_FD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("TABS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("TABS_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values);

const isValidPort = (value: number): boolean => value >= 1 && value <= 65_535;
const isRuntimeMode = (value: string): value is RuntimeMode =>
  value === "web" || value === "desktop";

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = yield* CliEnvConfig.pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({ message: "Failed to read environment configuration", cause }),
        ),
      );

      const bootstrapFd = Option.getOrUndefined(input.bootstrapFd) ?? env.bootstrapFd;
      const bootstrapEnvelope =
        bootstrapFd !== undefined
          ? yield* readBootstrapEnvelope(BootstrapEnvelopeSchema, bootstrapFd)
          : Option.none();

      const mode: RuntimeMode = Option.getOrElse(
        resolveOptionPrecedence(
          input.mode,
          Option.fromUndefinedOr(env.mode),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.filter(Option.fromUndefinedOr(bootstrap.mode), isRuntimeMode),
          ),
        ),
        () => "web",
      );
      const port = yield* Option.match(
        resolveOptionPrecedence(
          input.port,
          Option.fromUndefinedOr(env.port),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.filter(Option.fromUndefinedOr(bootstrap.port), isValidPort),
          ),
        ),
        {
          onSome: (value) => Effect.succeed(value),
          onNone: () => {
            if (mode === "desktop") {
              return Effect.succeed(DEFAULT_PORT);
            }
            return findAvailablePort(DEFAULT_PORT);
          },
        },
      );

      const devUrl = Option.getOrElse(
        resolveOptionPrecedence(
          input.devUrl,
          Option.fromUndefinedOr(env.devUrl),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.devUrl),
          ),
        ),
        () => undefined,
      );
      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(
          resolveOptionPrecedence(
            input.tabsHome,
            Option.fromUndefinedOr(env.tabsHome),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.tabsHome),
            ),
          ),
        ),
      );
      const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
      const noBrowser = resolveBooleanFlag(
        input.noBrowser,
        Option.getOrElse(
          resolveOptionPrecedence(
            Option.fromUndefinedOr(env.noBrowser),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.noBrowser),
            ),
          ),
          () => mode === "desktop",
        ),
      );
      const authToken = resolveOptionPrecedence(
        input.authToken,
        Option.fromUndefinedOr(env.authToken),
        Option.flatMap(bootstrapEnvelope, (bootstrap) =>
          Option.fromUndefinedOr(bootstrap.authToken),
        ),
      );
      const autoBootstrapProjectFromCwd = resolveBooleanFlag(
        input.autoBootstrapProjectFromCwd,
        Option.getOrElse(
          resolveOptionPrecedence(
            Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.autoBootstrapProjectFromCwd),
            ),
          ),
          () => mode === "web",
        ),
      );
      const logWebSocketEvents = resolveBooleanFlag(
        input.logWebSocketEvents,
        Option.getOrElse(
          resolveOptionPrecedence(
            Option.fromUndefinedOr(env.logWebSocketEvents),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.logWebSocketEvents),
            ),
          ),
          () => Boolean(devUrl),
        ),
      );
      const staticDir = devUrl ? undefined : yield* cliConfig.resolveStaticDir;
      const host = Option.getOrElse(
        resolveOptionPrecedence(
          input.host,
          Option.fromUndefinedOr(env.host),
          Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.host)),
        ),
        () => (mode === "desktop" ? "127.0.0.1" : undefined),
      );

      const config: ServerConfigShape = {
        mode,
        port,
        cwd: cliConfig.cwd,
        host,
        baseDir,
        ...derivedPaths,
        staticDir,
        devUrl,
        noBrowser,
        authToken: Option.getOrUndefined(authToken),
        autoBootstrapProjectFromCwd,
        logWebSocketEvents,
      } satisfies ServerConfigShape;

      return config;
    }),
  );

// Composition order is consumer → provider (each `provideMerge` provides the
// argument to everything accumulated above it). The provider instance registry
// must sit below the provider service/snapshot/text-gen consumers, and
// `NodeServices` (FileSystem/Path/ChildProcessSpawner) is innermost so the
// per-driver spawners — created inside the instance registry — can resolve it.
const LayerLive = (input: CliInput) =>
  Layer.empty.pipe(
    Layer.provideMerge(makeServerRuntimeServicesLayer()),
    Layer.provideMerge(
      makeServerProviderLayer().pipe(Layer.provideMerge(McpSessionRegistry.layer)),
    ),
    Layer.provideMerge(makeProviderInstanceRegistryLayer()),
    Layer.provideMerge(makeRemoteAccessServicesLayer()),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ObservabilityLive),
    Layer.provideMerge(AnalyticsServiceLayerLive),
    Layer.provideMerge(BackgroundPolicy.layer.pipe(Layer.provideMerge(ServerSettingsLive))),
    Layer.provideMerge(ServerConfigLive(input)),
    Layer.provideMerge(NodeServices.layer),
  );

const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getSnapshot().pipe(
    Effect.map((snapshot) => ({
      threadCount: snapshot.threads.length,
      projectCount: snapshot.projects.length,
    })),
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup snapshot for telemetry", { cause }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

const makeServerRuntimeProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const { start, stopSignal } = yield* Server;
    const openDeps = yield* Open;

    const config = yield* ServerConfig;

    if (!config.devUrl && !config.staticDir) {
      yield* Effect.logWarning(
        "web bundle missing and no VITE_DEV_SERVER_URL; web UI unavailable",
        {
          hint: "Run `bun run --cwd apps/web build` or set VITE_DEV_SERVER_URL for dev mode.",
        },
      );
    }

    yield* start;
    yield* Effect.forkChild(recordStartupHeartbeat);

    const localUrl = `http://localhost:${config.port}`;
    const bindUrl =
      config.host && !isWildcardHost(config.host)
        ? `http://${formatHostForUrl(config.host)}:${config.port}`
        : localUrl;
    const { authToken, devUrl, ...safeConfig } = config;
    yield* Effect.logInfo("Tabs running", {
      ...safeConfig,
      devUrl: devUrl?.toString(),
      authEnabled: Boolean(authToken),
    });

    if (!config.noBrowser) {
      const target = config.devUrl?.toString() ?? bindUrl;
      yield* openDeps.openBrowser(target).pipe(
        Effect.catch(() =>
          Effect.logInfo("browser auto-open unavailable", {
            hint: `Open ${target} in your browser.`,
          }),
        ),
      );
    } else {
      yield* Effect.promise(() => writePidFile(config.baseDir));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          void removePidFile(config.baseDir).catch(() => {});
        }),
      );
      yield* Effect.logInfo(
        formatHeadlessInfo({
          port: config.port,
          host: config.host,
          authToken: config.authToken,
          baseDir: config.baseDir,
        }),
      );
    }

    return yield* stopSignal;
  }).pipe(Effect.provide(LayerLive(input)));

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    yield* cliConfig.fixPath;
    return yield* makeServerRuntimeProgram(input);
  });

/**
 * These flags mirrors the environment variables and the config shape.
 */

const modeFlag = Flag.choice("mode", ["web", "desktop"]).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const tabsHomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for all Tabs data (equivalent to TABS_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const bootstrapFdFlag = Flag.integer("bootstrap-fd").pipe(
  Flag.withSchema(Schema.Int),
  Flag.withDescription("Read one-time bootstrap secrets from the given file descriptor."),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to TABS_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

const sharedServerFlags = {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  tabsHome: tabsHomeFlag,
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  authToken: authTokenFlag,
  bootstrapFd: bootstrapFdFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
};

const serveCommand = Command.make("serve", sharedServerFlags).pipe(
  Command.withDescription("Run the Tabs server in headless background mode."),
  Command.withHandler((input) =>
    Effect.scoped(
      makeServerProgram({
        ...input,
        noBrowser: Option.some(true),
      }),
    ),
  ),
);

const statusCommand = Command.make("status", { tabsHome: tabsHomeFlag }).pipe(
  Command.withDescription("Check status of running Tabs daemon and background service."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(flags.tabsHome));
      const status = yield* Effect.tryPromise({
        try: () => checkServiceStatus(baseDir),
        catch: (e) => new StartupError({ message: String(e) }),
      });
      console.log(`Tabs Daemon Status:`);
      console.log(`  Base directory: ${baseDir}`);
      console.log(`  Running:        ${status.running ? `Yes (PID ${status.pid})` : "No"}`);
      console.log(`  Service:        ${status.installed ? "Installed" : "Not installed"}`);
      if (status.unitPath) {
        console.log(`  Unit path:      ${status.unitPath}`);
      }
      console.log(`  Log path:       ${status.logPath}`);
    }),
  ),
);

const stopCommand = Command.make("stop", { tabsHome: tabsHomeFlag }).pipe(
  Command.withDescription("Stop a running Tabs background server."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(flags.tabsHome));
      const result = yield* Effect.tryPromise({
        try: () => stopDaemon(baseDir),
        catch: (e) => new StartupError({ message: String(e) }),
      });
      console.log(result.message);
    }),
  ),
);

const serviceStatusCommand = Command.make("status", { tabsHome: tabsHomeFlag }).pipe(
  Command.withDescription("Show background service status."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(flags.tabsHome));
      const status = yield* Effect.tryPromise({
        try: () => checkServiceStatus(baseDir),
        catch: (e) => new StartupError({ message: String(e) }),
      });
      console.log(`Background Service:`);
      console.log(`  Platform:  ${status.platform}`);
      console.log(`  Supported: ${status.supported ? "Yes" : "No"}`);
      console.log(`  Installed: ${status.installed ? "Yes" : "No"}`);
      if (status.unitPath) console.log(`  Unit:      ${status.unitPath}`);
      console.log(`  Logs:      ${status.logPath}`);
    }),
  ),
);

const serviceUninstallCommand = Command.make("uninstall").pipe(
  Command.withDescription("Uninstall and remove background service."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => uninstallService(),
        catch: (e) => new StartupError({ message: String(e) }),
      });
      console.log(result.removed ? "Background service removed." : "Service was not installed.");
    }),
  ),
);

const serviceCommand = Command.make("service").pipe(
  Command.withDescription("Manage background OS service."),
  Command.withSubcommands([serviceStatusCommand, serviceUninstallCommand]),
);

export const tabsCli = Command.make("tabs", sharedServerFlags).pipe(
  Command.withDescription("Run the Tabs server."),
  Command.withHandler((input) => Effect.scoped(makeServerProgram(input))),
  Command.withSubcommands([serveCommand, statusCommand, stopCommand, serviceCommand]),
);

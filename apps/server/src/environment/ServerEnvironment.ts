import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@tabs/contracts";
import { HostProcessArchitecture, HostProcessPlatform } from "@tabs/shared/hostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import { resolveServerEnvironmentLabel } from "./ServerEnvironmentLabel.ts";

export class ServerEnvironmentIdPersistenceError extends Schema.TaggedErrorClass<ServerEnvironmentIdPersistenceError>()(
  "ServerEnvironmentIdPersistenceError",
  {
    operation: Schema.Literals(["check", "read", "write"]),
    environmentIdPath: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class ServerEnvironment extends Context.Service<
  ServerEnvironment,
  {
    readonly getEnvironmentId: Effect.Effect<EnvironmentId>;
    readonly getDescriptor: Effect.Effect<ExecutionEnvironmentDescriptor>;
  }
>()("tabs/environment/ServerEnvironment") {}

function platformOs(platform: NodeJS.Platform): ExecutionEnvironmentDescriptor["platform"]["os"] {
  if (platform === "darwin" || platform === "linux") return platform;
  return platform === "win32" ? "windows" : "unknown";
}

function platformArch(
  architecture: NodeJS.Architecture,
): ExecutionEnvironmentDescriptor["platform"]["arch"] {
  return architecture === "arm64" || architecture === "x64" ? architecture : "other";
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const hostPlatform = yield* HostProcessPlatform;
  const hostArchitecture = yield* HostProcessArchitecture;

  const existing = yield* fileSystem.exists(config.environmentIdPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerEnvironmentIdPersistenceError({
          operation: "check",
          environmentIdPath: config.environmentIdPath,
          cause,
        }),
    ),
    Effect.flatMap((exists) =>
      exists
        ? fileSystem.readFileString(config.environmentIdPath).pipe(
            Effect.map((value) => value.trim() || null),
            Effect.mapError(
              (cause) =>
                new ServerEnvironmentIdPersistenceError({
                  operation: "read",
                  environmentIdPath: config.environmentIdPath,
                  cause,
                }),
            ),
          )
        : Effect.succeed(null),
    ),
  );
  const rawId = existing ?? (yield* crypto.randomUUIDv4);
  if (existing === null) {
    yield* fileSystem
      .makeDirectory(path.dirname(config.environmentIdPath), { recursive: true })
      .pipe(
        Effect.andThen(fileSystem.writeFileString(config.environmentIdPath, `${rawId}\n`)),
        Effect.mapError(
          (cause) =>
            new ServerEnvironmentIdPersistenceError({
              operation: "write",
              environmentIdPath: config.environmentIdPath,
              cause,
            }),
        ),
      );
  }

  const environmentId = EnvironmentId.make(rawId);
  const label = yield* resolveServerEnvironmentLabel({ cwdBaseName: path.basename(config.cwd) });
  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    label,
    platform: { os: platformOs(hostPlatform), arch: platformArch(hostArchitecture) },
    serverVersion: packageJson.version,
    capabilities: {
      repositoryIdentity: true,
      connectionProbe: true,
      attachmentUploads: true,
      usageLimitSources: true,
      usagePriceOverrides: true,
    },
  };

  return ServerEnvironment.of({
    getEnvironmentId: Effect.succeed(environmentId),
    getDescriptor: Effect.succeed(descriptor),
  });
});

export const layer = Layer.effect(ServerEnvironment, make);

import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { AgentDeviceEndpoint } from "./DeviceHost.ts";

const encodeEndpoint = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ daemonBaseUrl: Schema.String, daemonAuthToken: Schema.String }),
  ),
);

const key = (value: string) =>
  NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

export const agentDeviceGrantDirectory = (stateDir: string, path: Path.Path) =>
  path.join(stateDir, "device", "control");

// Remove configs from versions that passed the daemon's own credential to the CLI.
export const legacyAgentDeviceConfigPath = (stateDir: string, hostId: string, path: Path.Path) =>
  path.join(stateDir, "device", "hosts", `${key(hostId)}.json`);

export const agentDeviceSession = (
  threadId: string,
  hostId: string,
  deviceId: string,
  generation?: string,
) => `t3-${key(JSON.stringify([threadId, hostId, deviceId, ...(generation ? [generation] : [])]))}`;

export const writeAgentDeviceConfig = Effect.fn("AgentDeviceTarget.writeConfig")(function* (
  file: string,
  endpoint: Pick<AgentDeviceEndpoint, "baseUrl" | "token">,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  const content = yield* encodeEndpoint({
    daemonBaseUrl: endpoint.baseUrl,
    daemonAuthToken: endpoint.token,
  });
  if ((yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))) === content) return;
  const temporary = yield* fs.makeTempFile({ directory: path.dirname(file), prefix: ".endpoint-" });
  yield* Effect.gen(function* () {
    yield* fs.chmod(temporary, 0o600);
    yield* fs.writeFileString(temporary, content);
    yield* fs.rename(temporary, file);
  }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
});

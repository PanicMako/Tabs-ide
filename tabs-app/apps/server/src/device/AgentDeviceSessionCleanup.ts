import { randomUUID } from "node:crypto";
import type { DevicePlatform } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import type { AgentDeviceEndpoint } from "./DeviceHost.ts";

/** On the pinned daemon, a positional-free native close disposes the session and
 * releases its device claim while leaving the app running. */
export const closeAgentDeviceSession = (
  endpoint: AgentDeviceEndpoint,
  session: string,
  platform: DevicePlatform,
  deviceId: string,
  fetchRpc: (url: string, init: RequestInit) => Promise<Response> = fetch,
) =>
  Effect.tryPromise(async (signal) => {
    const id = randomUUID();
    const response = await fetchRpc(`${endpoint.baseUrl.replace(/\/$/, "")}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "agent_device.command",
        params: {
          session,
          command: "close",
          positionals: [],
          flags: { platform, [platform === "ios" ? "udid" : "serial"]: deviceId, noRecord: true },
          meta: { sessionExplicit: true, requestId: id },
        },
      }),
    });
    await response.arrayBuffer();
  }).pipe(Effect.ignore);

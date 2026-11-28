// @effect-diagnostics nodeBuiltinImport:off - test daemon bound to an ephemeral loopback port.
import { createServer } from "node:http";
import {
  DeviceComparisonError,
  ProviderInstanceId,
  ThreadId,
  type DeviceServiceState,
  type DeviceSession,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { managedAgentDeviceRpc } from "./AgentDeviceCommand.ts";
import {
  AGENT_DEVICE_IDLE_TIMEOUT_MS,
  isLiveDeviceAttachment,
  makeAgentDeviceControl,
  type AgentDeviceGrant,
} from "./AgentDeviceControl.ts";
import {
  assertNoCoordinates,
  deviceScreenKey,
  refreshDeviceReference,
  type ManagedDeviceRpc,
} from "./AgentDevicePrivacy.ts";
import { agentDeviceTimeoutMs, startAgentDeviceProxy } from "./AgentDeviceProxy.ts";
import { rememberDeviceIdentity } from "./DeviceIdentity.ts";
import type { SemanticSnapshot } from "./DeviceSemanticDriver.ts";

const caller = {
  threadId: ThreadId.make("thread"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: "provider",
};
const session = (): DeviceSession => ({
  threadId: caller.threadId,
  hostId: "local",
  deviceId: "emulator-5554",
  platform: "android",
  openedAt: "now",
});
const grantFor = (attachment: DeviceSession, extra: Partial<AgentDeviceGrant> = {}) =>
  ({
    id: "grant",
    token: "token",
    caller,
    attachment,
    daemonSession: "daemon-session",
    uploads: new Set<string>(),
    artifacts: new Set<string>(),
    createdAt: 0,
    ...extra,
  }) as AgentDeviceGrant;

describe("agent device proxy timeouts", () => {
  it("settles and marks the grant uncertain when the daemon never answers", async () => {
    const daemon = createServer(() => {
      // Never respond: a hung agent-device daemon.
    });
    await new Promise<void>((resolve) => daemon.listen(0, "127.0.0.1", resolve));
    const address = daemon.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const grant = grantFor(session());
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { origin } = yield* startAgentDeviceProxy({
              lookup: (token) => (token === grant.token ? grant : undefined),
              dispatch: (_grant, operation) =>
                operation(
                  { baseUrl: `http://127.0.0.1:${address.port}`, token: "up" } as never,
                  () => true,
                ),
              timeoutMs: () => 150,
            });
            const started = Date.now();
            const reply = yield* Effect.promise(() =>
              fetch(`${origin}/rpc`, {
                method: "POST",
                headers: { authorization: `Bearer ${grant.token}` },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: "1",
                  method: "agent_device.command",
                  params: {
                    session: grant.daemonSession,
                    command: "open",
                    positionals: ["com.example.app"],
                    flags: { platform: "android", serial: grant.attachment.deviceId },
                    meta: {},
                  },
                }),
              }).then((response) => response.json() as Promise<any>),
            );
            expect(reply.result.ok).toBe(false);
            expect(Date.now() - started).toBeLessThan(5_000);
            expect(grant.uncertain).toBe(true);
          }),
        ),
      );
    } finally {
      daemon.close();
      daemon.closeAllConnections();
    }
  });

  it("uses the short cap for input verbs and the long cap for launches", () => {
    expect(agentDeviceTimeoutMs("click")).toBe(45_000);
    expect(agentDeviceTimeoutMs("swipe")).toBe(45_000);
    expect(agentDeviceTimeoutMs("open")).toBe(240_000);
    expect(agentDeviceTimeoutMs("snapshot")).toBe(240_000);
  });
});

const snapshot = (label = "Continue", generation = 3): SemanticSnapshot => ({
  appBundleId: "com.example.app",
  refsGeneration: generation,
  nodes: [{ index: 1, ref: "@e5", role: "button", label }],
});
const command = (verb: string, positionals: string[]) =>
  ({ id: "1", params: { command: verb, positionals } }) as unknown as ManagedDeviceRpc;

describe("device reference guards", () => {
  it("re-resolves a ref only against a fresh snapshot of the same screen", () => {
    const before = snapshot();
    const now = snapshot("Continue", 4);
    const key = deviceScreenKey(before);
    const refreshed = refreshDeviceReference(command("click", ["@e5~s3"]), before, now, {
      stale: false,
      ...(key ? { screenKey: key } : {}),
    });
    expect(refreshed.params.positionals).toEqual(["@e5~s4"]);
    expect(() =>
      refreshDeviceReference(command("click", ["@e5"]), before, now, { stale: true }),
    ).toThrow("Run snapshot again");
    expect(() =>
      refreshDeviceReference(command("press", ["@e5~s2"]), before, now, { stale: false }),
    ).toThrow("could not be verified");
    expect(() =>
      refreshDeviceReference(command("click", ["@e5"]), before, snapshot("Other"), {
        stale: false,
        ...(key ? { screenKey: key } : {}),
      }),
    ).toThrow(DeviceComparisonError);
  });

  it("refuses coordinates and gestures for approved-app grants only", () => {
    const approved = grantFor(session(), {
      approvedApp: { id: "a", appId: "com.example.app", endpoint: {} as never },
    });
    expect(() => assertNoCoordinates(command("press", ["10", "20"]), approved)).toThrow(
      "target a control by its ref",
    );
    expect(() => assertNoCoordinates(command("swipe", ["1", "2", "3", "4"]), approved)).toThrow();
    expect(() => assertNoCoordinates(command("gesture", []), approved)).toThrow();
    expect(() => assertNoCoordinates(command("press", ["@e5~s3"]), approved)).not.toThrow();
    expect(() =>
      assertNoCoordinates(command("press", ["10", "20"]), grantFor(session())),
    ).not.toThrow();
  });

  it("rejects coordinate commands built through the managed command parser", () => {
    const grant = grantFor(session());
    expect(
      managedAgentDeviceRpc(
        {
          jsonrpc: "2.0",
          id: "1",
          method: "agent_device.command",
          params: {
            session: grant.daemonSession,
            command: "press",
            positionals: ["@e5"],
            flags: { platform: "android", serial: grant.attachment.deviceId },
          },
        },
        grant,
      ),
    ).toBeDefined();
  });
});

const stateFor = (attachment: DeviceSession, name: string): DeviceServiceState =>
  ({
    agentAccessEnabled: true,
    hostStatus: "ready",
    sessions: [attachment],
    devices: [
      {
        hostId: attachment.hostId,
        id: attachment.deviceId,
        platform: attachment.platform,
        name,
        version: "36",
        booted: true,
        physical: false,
      },
    ],
  }) as unknown as DeviceServiceState;

describe("device identity and idle expiry", () => {
  it("treats a reused Android serial that now belongs to another emulator as not live", () => {
    const attachment = rememberDeviceIdentity(session(), {
      name: "Pixel_8",
      version: "36",
      physical: false,
    });
    expect(isLiveDeviceAttachment(stateFor(attachment, "Pixel_8"), attachment)).toBe(true);
    expect(isLiveDeviceAttachment(stateFor(attachment, "Pixel_Tablet"), attachment)).toBe(false);
  });

  it("revokes the grant when the device behind the serial changes", () => {
    const attachment = rememberDeviceIdentity(session(), {
      name: "Pixel_8",
      version: "36",
      physical: false,
    });
    const control = makeAgentDeviceControl(() => true);
    const grant = control.claim(attachment, caller)!;
    expect(control.lookup(grant.token)).toBe(grant);
    control.reconcile(stateFor(attachment, "Pixel_Tablet"));
    expect(control.lookup(grant.token)).toBeUndefined();
  });

  it("expires a grant that issued no command for the idle timeout", () => {
    let now = 1_000;
    const attachment = session();
    const control = makeAgentDeviceControl(() => true, { now: () => now });
    const grant = control.claim(attachment, caller)!;
    now += AGENT_DEVICE_IDLE_TIMEOUT_MS - 1;
    expect(control.lookup(grant.token)).toBe(grant);
    // A command resets the idle clock.
    void Effect.runPromise(control.dispatch(grant, Effect.void));
    now += AGENT_DEVICE_IDLE_TIMEOUT_MS - 1;
    expect(control.lookup(grant.token)).toBe(grant);
    now += 2;
    expect(control.lookup(grant.token)).toBeUndefined();
    expect(control.currentGrant(attachment, caller)).toBeUndefined();
  });
});

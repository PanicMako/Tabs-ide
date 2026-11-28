import type { McpThreadCaller } from "../mcp/McpInvocationContext.ts";
import type { DeviceComparisonTarget, DeviceSession, DeviceSummary } from "@tabs/contracts";

/** Stable key for one device on one host. Shared by comparison and agent control. */
export const deviceKey = ({ hostId, deviceId }: DeviceComparisonTarget) =>
  JSON.stringify([hostId, deviceId]);

/**
 * Android serials such as `emulator-5554` are reused by whichever emulator starts next, so a
 * session also remembers the hub-reported identity (AVD name, OS version, kind) of the device
 * it attached to. iOS UDIDs are stable and are covered by the same check.
 */
export const deviceIdentity = ({
  name,
  version,
  physical,
}: Pick<DeviceSummary, "name" | "version" | "physical">) =>
  JSON.stringify([name, version, physical]);

const identities = new WeakMap<DeviceSession, string>();

export const rememberDeviceIdentity = <S extends DeviceSession>(
  session: S,
  device: Pick<DeviceSummary, "name" | "version" | "physical">,
): S => {
  identities.set(session, deviceIdentity(device));
  return session;
};

/** Sessions without a recorded identity (restored or synthetic) are not rejected. */
export const sameDeviceIdentity = (
  session: DeviceSession,
  device: Pick<DeviceSummary, "name" | "version" | "physical">,
) => {
  const expected = identities.get(session);
  return expected === undefined || expected === deviceIdentity(device);
};

/** Two MCP callers are the same only when thread, provider session and instance all match. */
export const sameCaller = (a: McpThreadCaller, b: McpThreadCaller) =>
  a.threadId === b.threadId &&
  a.providerSessionId === b.providerSessionId &&
  a.providerInstanceId === b.providerInstanceId;

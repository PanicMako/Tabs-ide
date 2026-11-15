import { PrimaryConnectionTarget, type PreparedConnection } from "@tabs/client-runtime/connection";
import { EnvironmentId } from "@tabs/contracts";

import { getServerHttpOrigin } from "../components/ProjectFavicon";
import {
  getPrimaryEnvironmentId,
  initializePrimaryEnvironmentApi,
} from "../connection/environmentApiRegistry";
import { desktopHttpAccessToken } from "../desktopWebSocketAuth";

let pending: Promise<PreparedConnection> | null = null;

/**
 * Dictation records on this device and transcribes on the environment this window runs against,
 * so audio never leaves the machine on desktop. The connection is resolved once per window.
 */
export function primaryVoiceConnection(): Promise<PreparedConnection> {
  if (pending) return pending;
  pending = (async () => {
    const environmentId = EnvironmentId.make(
      getPrimaryEnvironmentId() ?? (await initializePrimaryEnvironmentApi()),
    );
    const httpBaseUrl = getServerHttpOrigin();
    const socketUrl = window.desktopBridge?.getWsUrl() ?? "";
    const token = socketUrl ? await desktopHttpAccessToken(socketUrl) : null;
    const label = "This device";
    return {
      environmentId,
      label,
      httpBaseUrl,
      socketUrl,
      httpAuthorization: token ? { _tag: "Bearer", token } : null,
      target: new PrimaryConnectionTarget({
        environmentId,
        label,
        httpBaseUrl,
        wsBaseUrl: socketUrl,
      }),
    } satisfies PreparedConnection;
  })();
  // A failed resolution is retried by the next recording.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

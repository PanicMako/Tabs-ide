import type { WebFrameMain } from "electron";

export const DEVICE_SCREENSHOT_AUTHORIZATION_CHANNEL =
  "desktop:browser-host:device-screenshot-authorization";
export const DEVICE_SCREENSHOT_AUTHORIZATION_REPLY_CHANNEL =
  "desktop:browser-host:device-screenshot-authorization-reply";

type AuthorizationFrame = Pick<WebFrameMain, "detached" | "send">;

export function createDeviceScreenshotAuthorizationRequests() {
  const pending = new Map<
    string,
    { frame: AuthorizationFrame; finish: (approved: boolean) => void }
  >();

  return {
    request(frame: AuthorizationFrame, id: string): Promise<boolean> {
      if (frame.detached || pending.has(id)) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timeoutMs = 10_000;
        const expiresAt = performance.now() + timeoutMs;
        const finish = (approved: boolean) => {
          clearTimeout(timeout);
          pending.delete(id);
          resolve(approved && !frame.detached && performance.now() <= expiresAt);
        };
        const timeout = setTimeout(() => finish(false), timeoutMs);
        pending.set(id, { frame, finish });
        try {
          frame.send(DEVICE_SCREENSHOT_AUTHORIZATION_CHANNEL, id);
        } catch {
          finish(false);
        }
      });
    },
    reply(frame: AuthorizationFrame | null, id: unknown, result: unknown): void {
      const entry = typeof id === "string" ? pending.get(id) : undefined;
      if (entry && entry.frame === frame) entry.finish(result === true);
    },
  };
}

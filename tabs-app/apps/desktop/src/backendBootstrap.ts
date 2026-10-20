import type { Writable } from "node:stream";
import type { DesktopBackendBootstrap } from "@tabs/contracts";

/** Let Node load the backend while the shell resolves, then release startup. */
export async function writeBackendBootstrap(
  stream: Writable,
  ready: Promise<unknown>,
  payload: () => DesktopBackendBootstrap,
  onError: (error: unknown) => void,
): Promise<void> {
  // The child may exit (or be stopped) before environment resolution finishes.
  stream.once("error", onError);
  try {
    await ready;
    if (stream.destroyed || stream.writableEnded) return;
    stream.end(`${JSON.stringify(payload())}\n`);
  } catch (error) {
    onError(error);
  }
}

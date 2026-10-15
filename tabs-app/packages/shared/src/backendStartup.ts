export const BACKEND_STARTUP_ERROR_PREFIX = "TABS_BACKEND_STARTUP_ERROR:";

/** Incremental decoder: stderr writes can split a diagnostic across chunks. */
export function createBackendStartupErrorDecoder(onError: (message: string) => void) {
  let pending = "";
  return (chunk: string) => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line.startsWith(BACKEND_STARTUP_ERROR_PREFIX)) continue;
      try {
        const message: unknown = JSON.parse(line.slice(BACKEND_STARTUP_ERROR_PREFIX.length));
        if (typeof message === "string" && message.length > 0) onError(message);
      } catch {
        // Ordinary stderr and malformed diagnostics must not break logging.
      }
    }
    // Bound buffering for subprocess output with no line breaks.
    if (pending.length > 64 * 1024) pending = "";
  };
}

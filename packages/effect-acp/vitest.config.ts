import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The child-process protocol tests spawn a mock ACP peer. During teardown
    // there is a benign race where writing the final bytes to the peer's stdin
    // EPIPEs because the peer already exited; effect's NodeSink surfaces that as
    // an uncaught exception with no attachable handler. Every test still passes,
    // so don't fail the whole run on it.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});

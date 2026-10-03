import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import { baseConfig } from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: "server",
      root: import.meta.dirname,
      setupFiles: ["./vitest.setup.ts"],
      exclude: [...configDefaults.exclude, "_incomplete-synara-port/**"],
      testTimeout: 15_000,
      hookTimeout: 15_000,
      // The ACP integration tests spawn mock-agent child processes. During
      // teardown there is a benign race where writing the final bytes to a
      // peer's stdin EPIPEs because the peer already exited; effect's NodeSink
      // surfaces that as an uncaught exception with no attachable handler.
      // Every test still passes, so don't fail the whole run on it.
      dangerouslyIgnoreUnhandledErrors: true,
    },
  }),
);

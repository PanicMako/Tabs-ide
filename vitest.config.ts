import { createRequire } from "node:module";
import * as path from "node:path";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const vitestDir = path.dirname(require.resolve("vitest"));
const runnerEntry = require.resolve("@vitest/runner", { paths: [vitestDir] });

export const baseConfig = defineConfig({
  resolve: {
    alias: [
      {
        // Workspace packages can import either API, but both must use the
        // runner selected here rather than a second Vite+ installation.
        find: /^vite-plus\/test$/,
        replacement: "vitest",
      },
      {
        find: /^@vitest\/runner$/,
        replacement: runnerEntry,
      },
      {
        find: /^@tabs\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
      {
        find: /^~\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, "./apps/web/src/$1"),
      },
    ],
  },
  test: {
    // Playwright owns the demo specs; the incomplete port is already excluded
    // by the server package's test configuration.
    exclude: [
      ...configDefaults.exclude,
      "testing-demo/**",
      "apps/server/_incomplete-synara-port/**",
    ],
    // Server tests spawn processes and databases. Bound the aggregate runner
    // so unrelated suites cannot exhaust their startup deadlines.
    maxWorkers: 4,
    server: {
      deps: {
        inline: ["@effect/vitest"],
      },
    },
  },
});

export default defineConfig(() => {
  // Packages without a local config discover this file from their own cwd.
  // Keep those runs scoped to that package; only the root run owns projects.
  if (path.resolve(process.cwd()) !== import.meta.dirname) return baseConfig;

  return mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        projects: [
          {
            extends: true,
            test: {
              name: "workspace",
              exclude: [...baseConfig.test!.exclude!, "apps/server/**"],
            },
          },
          "apps/server/vitest.config.ts",
        ],
      },
    }),
  );
});

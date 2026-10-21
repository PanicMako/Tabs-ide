import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(async (env) => {
  const resolvedViteConfig = await viteConfig(env);

  return mergeConfig(
    resolvedViteConfig,
    defineConfig({
      resolve: {
        alias: {
          "~": srcPath,
        },
      },
      test: {
        include: ["src/components/**/*.browser.tsx"],
        maxWorkers: 4,
        // Browser iframes share origin storage and the MSW service worker.
        // Theme, persistence and full-app fixtures must not reset each other.
        fileParallelism: false,
        browser: {
          enabled: true,
          provider: playwright(),
          instances: [{ browser: "chromium" }],
          headless: true,
        },
        testTimeout: 30_000,
        hookTimeout: 30_000,
      },
    }),
  );
});

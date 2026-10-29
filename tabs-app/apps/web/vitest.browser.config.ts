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
          commands: {
            async scrollFontReel({ page, frame }, deltas: number[]) {
              const reel = (await frame()).locator(".font-reel");
              await reel.scrollIntoViewIfNeeded();
              const box = await reel.boundingBox();
              if (!box) throw new Error("Font reel is not visible");
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              for (const delta of deltas) {
                await page.mouse.wheel(0, delta);
                await page.waitForTimeout(16);
              }
            },
          },
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

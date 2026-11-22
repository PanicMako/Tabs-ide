import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Vitest's browser API defaults to a fixed port, so two concurrent runs (agents, a watcher plus CI
 * script) collide. `TABS_VITEST_BROWSER_PORT` pins it; otherwise ask the OS for a free one.
 */
async function resolveBrowserApiPort(): Promise<number> {
  const pinned = Number(process.env.TABS_VITEST_BROWSER_PORT);
  if (Number.isInteger(pinned) && pinned > 0) return pinned;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 63315;
      server.close(() => resolve(port));
    });
  });
}

export default defineConfig(async (env) => {
  const browserApiPort = await resolveBrowserApiPort();
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
          api: { port: browserApiPort, host: "127.0.0.1" },
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
        // expect.poll / expect.element default to 1 s, which a cold full-suite run (dependency
        // optimisation, lazy chunks, a diff worker) can exceed. A generous ceiling costs nothing
        // when the condition is already true.
        expect: { poll: { timeout: 10_000, interval: 50 } },
        testTimeout: 30_000,
        hookTimeout: 30_000,
      },
    }),
  );
});

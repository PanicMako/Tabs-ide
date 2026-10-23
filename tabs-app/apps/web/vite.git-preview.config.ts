import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";
export default defineConfig(async (env) =>
  mergeConfig(await base(env), {
    cacheDir: "node_modules/.vite-git-preview",
    server: { port: 5735, strictPort: true },
  }),
);

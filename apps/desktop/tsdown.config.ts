import { defineConfig } from "tsdown";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: true,
  outExtensions: () => ({ js: ".js" }),
  dts: false,
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
    noExternal: (id) => id.startsWith("@tabs/"),
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
    // Sandboxed Electron preloads cannot require arbitrary packages at runtime.
    // Keep Clerk's small preload bridge inside our generated preload bundle so
    // a navigation or Vite full reload cannot lose every contextBridge API.
    noExternal: (id) => id.startsWith("@clerk/electron"),
  },
  {
    ...shared,
    entry: ["src/notificationPreload.ts"],
  },
]);

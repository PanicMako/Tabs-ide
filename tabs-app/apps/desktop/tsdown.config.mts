import { defineConfig } from "tsdown";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: true,
  // Strip whitespace/comments without rewriting functions or their names.
  minify: { compress: false, mangle: false, codegen: { removeWhitespace: true } },
  outExtensions: () => ({ js: ".js" }),
  dts: false,
  // Electron's main process is CommonJS. Effect reads `import.meta?.env`
  // optionally, so rolldown's empty-object substitution is the intended result.
  checks: { emptyImportMeta: false },
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
    // One compiled runtime avoids loading Effect's dependency graph file by file.
    deps: {
      onlyBundle: false,
      alwaysBundle: (id: string) =>
        id.startsWith("@tabs/") ||
        id === "effect" ||
        id.startsWith("effect/") ||
        id.startsWith("@effect/"),
    },
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
    // Sandboxed Electron preloads cannot require arbitrary packages at runtime.
    // Keep Clerk's small preload bridge inside our generated preload bundle so
    // a navigation or Vite full reload cannot lose every contextBridge API.
    deps: {
      onlyBundle: false,
      alwaysBundle: (id: string) => id.startsWith("@clerk/electron"),
    },
  },
  {
    ...shared,
    entry: ["src/notificationPreload.ts"],
  },
  {
    ...shared,
    entry: ["src/extensionPreload.ts"],
  },
  {
    ...shared,
    entry: ["src/extensionLogicWorker.js"],
  },
]);

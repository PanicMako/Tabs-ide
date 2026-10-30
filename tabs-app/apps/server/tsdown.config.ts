import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/claudeHistoryWorker.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: true,
  // Strip whitespace/comments without rewriting functions or their names.
  minify: { compress: false, mangle: false, codegen: { removeWhitespace: true } },
  clean: true,
  // Bundle internal workspace packages into the server output so the packaged
  // desktop app doesn't need to resolve `workspace:*` deps at runtime. This
  // covers the `@tabs/*` packages plus the (unscoped) `effect-acp` and
  // `effect-codex-app-server` workspace packages.
  deps: {
    // The Locator Library uses the compiler API to parse company page objects
    // without executing them. Keep TypeScript as a runtime dependency instead
    // of embedding its CommonJS-oriented Node host in our ESM server bundle.
    neverBundle: ["typescript"],
    alwaysBundle: (id) =>
      // Avoid resolving/compiling hundreds of small Effect modules per launch.
      // Keep its platform and OpenCode schema consumers in the same runtime.
      id === "effect" ||
      id.startsWith("effect/") ||
      id.startsWith("@effect/") ||
      id.startsWith("@opencode/") ||
      id.startsWith("@opencode-ai/") ||
      // Only the patch parser is used on the server. Its package exposes no
      // require condition, so keep the parser in both ESM and CommonJS builds.
      id === "@pierre/diffs" ||
      id.startsWith("@pierre/diffs/") ||
      id.startsWith("@tabs/") ||
      id === "effect-acp" ||
      id.startsWith("effect-acp/") ||
      id === "effect-codex-app-server" ||
      id.startsWith("effect-codex-app-server/"),
  },
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});

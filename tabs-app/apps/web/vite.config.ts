import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const port = Number(process.env.PORT ?? 5733);
const sourcemapEnv = process.env.TABS_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

// The React Compiler (run via @rolldown/plugin-babel below) is ~90% of build
// time. This knob controls it:
//   "infer"      – default; auto-memoize all components/hooks (best runtime perf)
//   "annotation" – only compile functions tagged "use memo" (near-zero build cost,
//                  but also near-zero memoization — opt-in only)
//   "off"        – skip the compiler entirely (fastest build, no memoization)
// Per CLAUDE.md "performance first", the default keeps full memoization.
const compilerMode = (process.env.TABS_WEB_COMPILER?.trim().toLowerCase() ?? "infer") as
  | "infer"
  | "annotation"
  | "off";

export default defineConfig(({ command }) => ({
  plugins: [
    // autoCodeSplitting: split each route's component/loader into its own chunk
    // so the initial bundle no longer eagerly pulls the heaviest screens
    // (settings ~2.2k LOC, the chat thread view → ChatView + react-markdown +
    // @pierre/diffs). Routes load on navigation; see defaultPreload in router.ts.
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    // Gate the compiler to production builds only: dev relies on react()'s fast
    // refresh, so skipping the babel pass keeps dev-server startup and HMR snappy.
    command === "build" && compilerMode !== "off"
      ? babel({
          // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
          // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
          // whereas the previous version of the plugin parsed all files with a .ts extension.
          // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
          parserOpts: { plugins: ["typescript", "jsx"] },
          // Skip the compiler's source-map generation when build sourcemaps are
          // disabled (TABS_WEB_SOURCEMAP=0); the plugin docs note this "will
          // improve performance".
          sourceMap: buildSourcemap !== false,
          // Cast: the preset's option type is the fully-resolved PluginOptions
          // (all fields required), but it accepts a partial at runtime and fills
          // defaults via zod, so a single-field object is safe here.
          presets: [
            reactCompilerPreset({ compilationMode: compilerMode } as Parameters<
              typeof reactCompilerPreset
            >[0]),
          ],
        })
      : null,
    tailwindcss(),
  ],
  optimizeDeps: {
    // Pre-bundle the heavy deps up front. Without this, the FIRST time a screen
    // that uses one of these is opened, Vite discovers the dep, re-optimizes, and
    // forces a full page reload — the "first click takes a few seconds" stall.
    include: [
      "@pierre/diffs",
      "@pierre/diffs/react",
      "@pierre/diffs/worker/worker.js",
      "react-markdown",
      "@xterm/xterm",
      "@xterm/addon-fit",
    ],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port,
    strictPort: true,
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      protocol: "ws",
      host: "localhost",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
  },
}));

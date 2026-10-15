import * as FS from "node:fs";
import * as Module from "node:module";
import * as Path from "node:path";
import * as NodeURL from "node:url";

/** Use the application's TypeScript transform for standalone Node GC fixtures. */
export function registerTypeScriptFixtureLoader(root) {
  const require = Module.createRequire(Path.join(root, "apps/server/package.json"));
  const typescript = require("typescript");
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (
          (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "ERR_UNSUPPORTED_DIR_IMPORT") ||
          !specifier.startsWith(".") ||
          !context.parentURL?.startsWith("file:")
        )
          throw error;
        const base = NodeURL.fileURLToPath(new URL(specifier, context.parentURL));
        for (const candidate of [base + ".ts", Path.join(base, "index.ts")]) {
          if (FS.existsSync(candidate) && FS.statSync(candidate).isFile())
            return nextResolve(NodeURL.pathToFileURL(candidate).href, context);
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (url.endsWith(".ts") && !url.endsWith(".d.ts")) {
        return {
          format: "module",
          source: typescript.transpileModule(FS.readFileSync(NodeURL.fileURLToPath(url), "utf8"), {
            compilerOptions: {
              module: typescript.ModuleKind.ESNext,
              target: typescript.ScriptTarget.ES2022,
            },
          }).outputText,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
}

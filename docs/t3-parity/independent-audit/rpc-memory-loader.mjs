import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
      const candidate = new URL(specifier + ".ts", context.parentURL);
      if (!existsSync(fileURLToPath(candidate))) throw error;
      return next(candidate.href, context);
    }
  },
});

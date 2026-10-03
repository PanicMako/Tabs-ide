import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { sanitizeMacAppSymlinks } = require("./mac-symlink-sanitizer.cjs") as {
  sanitizeMacAppSymlinks: (appPath: string) => void;
};

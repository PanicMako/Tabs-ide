import { createRequire } from "node:module";

const requireTypeScript = createRequire(import.meta.url);
let compiler: typeof import("typescript") | undefined;

// Parsing repository tests and page objects is optional work. Keep the compiler
// off the server startup path, while preserving these synchronous parser APIs.
export function loadTypeScript(): typeof import("typescript") {
  return (compiler ??= requireTypeScript("typescript") as typeof import("typescript"));
}

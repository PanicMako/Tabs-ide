import { readFileSync, globSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// The production minifier drops an unprefixed backdrop-filter that comes before
// its -webkit- twin, and Chromium ignores the prefixed one, so glass silently
// loses its blur only in shipped builds.
const root = resolve(import.meta.dirname, "../..");
const files = globSync("**/*.css", { cwd: root });

it("finds the stylesheets", () => {
  expect(files.length).toBeGreaterThan(10);
});
it.each(files)("%s declares -webkit-backdrop-filter first", (file) => {
  const css = readFileSync(resolve(root, file), "utf8");
  expect(css).not.toMatch(/(?<!-webkit-)backdrop-filter:[^;]+;\s*-webkit-backdrop-filter:/);
});

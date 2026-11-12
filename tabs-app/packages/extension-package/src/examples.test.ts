import * as FS from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";
import { validateTabsextDirectory } from "./index.ts";

const EXAMPLES = Path.resolve(__dirname, "../../../examples");
const DESKTOP_VERSION = JSON.parse(
  FS.readFileSync(Path.resolve(__dirname, "../../../apps/desktop/package.json"), "utf8"),
).version as string;

const examples = FS.readdirSync(EXAMPLES, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && FS.existsSync(Path.join(EXAMPLES, entry.name, "tabs-extension.json")),
  )
  .map((entry) => entry.name)
  .toSorted();

describe("bundled example extensions", () => {
  it("covers the samples authors copy from", () => {
    expect(examples).toContain("workbench-extras-extension");
    expect(examples.length).toBeGreaterThanOrEqual(5);
  });

  // Every sample must stay installable on the Tabs that ships alongside it,
  // so an API or validator change can never silently break the docs' examples.
  it.each(examples)("%s validates against this Tabs release", (name) => {
    expect(() =>
      validateTabsextDirectory(Path.join(EXAMPLES, name), DESKTOP_VERSION),
    ).not.toThrow();
  });
});

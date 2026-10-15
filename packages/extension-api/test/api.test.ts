import { describe, expect, it } from "vitest";
import { TABS_EXTENSION_API_VERSION, type TabsExtensionManifest } from "../src/index.js";

const example = {
  manifestVersion: 1,
  publisher: "tabs-example",
  name: "hello",
  version: "0.1.0",
  displayName: "Hello Tabs",
  description: "An example full-workspace tool",
  engines: { tabs: ">=1.3.0 <2.0.0", api: "^1.0.0" },
  contributes: { tools: [{ id: "hello", label: "Hello", entry: "dist/index.html" }] },
} satisfies TabsExtensionManifest;

describe("public extension API", () => {
  it("exports the version required by the example manifest", () => {
    expect(TABS_EXTENSION_API_VERSION).toBe("1.7.0");
    expect(example.engines.api).toBe("^1.0.0");
  });
});

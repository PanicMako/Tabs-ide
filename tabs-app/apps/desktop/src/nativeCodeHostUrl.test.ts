import { describe, expect, it } from "vitest";

import { findNativeCodeHostURLs, isNativeCodeHostURL } from "./nativeCodeHostUrl";

describe("native Code host URLs", () => {
  it("accepts extension callbacks but leaves the Tabs renderer URL to Clerk", () => {
    expect(isNativeCodeHostURL("tabs://vscode.github-authentication/did-authenticate?code=1")).toBe(
      true,
    );
    expect(isNativeCodeHostURL("tabs://app/index.html#/oauth-callback")).toBe(false);
  });

  it("extracts callbacks from a second-instance command line", () => {
    expect(
      findNativeCodeHostURLs([
        "/Applications/Tabs.app/Contents/MacOS/Tabs",
        "--open-url",
        "tabs://github.copilot/auth?windowId=42",
        "/tmp/project",
      ]),
    ).toEqual(["tabs://github.copilot/auth?windowId=42"]);
  });
});

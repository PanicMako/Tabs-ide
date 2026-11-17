import { describe, expect, it } from "vitest";
import { rememberWorkspaceLocation, settingsReturnHref } from "./settingsReturn";

describe("Settings' Back", () => {
  it("returns to the exact place the user left, never to Settings itself", () => {
    expect(settingsReturnHref()).toBe("/");
    rememberWorkspaceLocation("/env-1/thread-9?panel=diff", "/env-1/thread-9");
    rememberWorkspaceLocation("/settings?section=general", "/settings");
    expect(settingsReturnHref()).toBe("/env-1/thread-9?panel=diff");
  });
});

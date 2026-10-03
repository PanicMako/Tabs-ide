import { describe, expect, it } from "vitest";

import {
  getCodeHostUnavailableMessage,
  getDefaultCodeHostUnavailableMessage,
} from "./codeHost.logic";

describe("code host availability messaging", () => {
  it("falls back to the local tabs-code-oss build instructions", () => {
    expect(getDefaultCodeHostUnavailableMessage()).toContain("tabs-code-oss");
    expect(getDefaultCodeHostUnavailableMessage()).toContain("npm run compile");
    expect(getDefaultCodeHostUnavailableMessage()).not.toContain("npm run compile-web");
    expect(getCodeHostUnavailableMessage(null)).toBe(getDefaultCodeHostUnavailableMessage());
  });

  it("preserves actionable desktop resolver errors", () => {
    expect(getCodeHostUnavailableMessage("Configured Code-OSS entry does not exist")).toBe(
      "Configured Code-OSS entry does not exist",
    );
  });
});

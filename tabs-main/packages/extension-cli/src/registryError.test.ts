import { describe, expect, it } from "vitest";
import { registryError } from "./registryError.ts";
describe("safe registry recovery", () => {
  it("explains known stable errors", () => {
    expect(registryError(403, { code: "TERMS_ACCEPTANCE_REQUIRED" }).message).toContain("/account");
    expect(registryError(409, { code: "VERSION_ALREADY_SUBMITTED" }).message).toContain(
      "increment",
    );
  });
  it("never echoes untrusted diagnostics or credentials", () => {
    expect(
      registryError(500, { error: "tex_secret", recovery: "secret", code: "EVIL" }).message,
    ).not.toContain("secret");
    expect(registryError(500, null).message).toContain("No automatic retry");
  });
});

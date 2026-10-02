import { describe, expect, it } from "vitest";
import { accountNavigation } from "../frontend/src/lib/accountNavigation";

describe("role-specific account navigation", () => {
  it("preserves anonymous browsing intent through the sign-in link", () => {
    const navigation = accountNavigation(null, "/extensions/acme/tool?version=1.0.0#overview");
    expect(new URL(navigation.href, "https://exchange.example").searchParams.get("returnTo")).toBe(
      "/extensions/acme/tool?version=1.0.0#overview",
    );
    expect(navigation.reviewer).toBe(false);
  });
  it("shows reviewer navigation only for an explicit boolean reviewer role", () => {
    expect(accountNavigation({ login: "reviewer", admin: true }, "/admin")).toEqual({
      label: "reviewer · Account",
      href: "/account",
      reviewer: true,
    });
    for (const admin of [false, undefined, "true", 1])
      expect(accountNavigation({ login: "publisher", admin }, "/publish").reviewer).toBe(false);
    expect(
      accountNavigation({ login: "<script>text</script>", admin: false }, "/account").label,
    ).toContain("<script>text</script>");
  });
  it("rejects malformed identity rather than guessing reviewer access", () => {
    for (const actor of [
      undefined,
      [],
      {},
      { admin: true },
      { login: " " },
      { login: "x".repeat(101), admin: true },
    ])
      expect(() => accountNavigation(actor, "/account")).toThrow("identity");
  });
});

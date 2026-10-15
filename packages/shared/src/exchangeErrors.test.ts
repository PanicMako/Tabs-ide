import { expect, it } from "vitest";
import { exchangeErrorCode, exchangeErrorGuidance } from "./exchangeErrors";
it("provides stable recovery without echoing arbitrary server diagnostics", () => {
  expect(exchangeErrorCode(401)).toBe("AUTHENTICATION_REQUIRED");
  expect(exchangeErrorCode(409)).toBe("STATE_CONFLICT");
  expect(
    exchangeErrorGuidance(401, { error: "token-secret", recovery: "token-secret" }).message,
  ).toContain("Sign in again");
  expect(
    exchangeErrorGuidance(500, { code: "UNKNOWN", error: "token-secret" }).message,
  ).not.toContain("token-secret");
  expect(exchangeErrorGuidance(403, { code: "TERMS_ACCEPTANCE_REQUIRED" }).message).toContain(
    "Account page",
  );
});

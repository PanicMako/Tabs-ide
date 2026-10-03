import { describe, expect, it } from "vitest";
import { isCompletionReturn } from "./authWindow";

describe("authWindow", () => {
  describe("isCompletionReturn", () => {
    it("detects when navigation returns to the initiating application origin", () => {
      expect(isCompletionReturn("https://my-app.com/dashboard", "https://my-app.com/login")).toBe(
        true,
      );

      expect(isCompletionReturn("https://my-app.com/app/home", "https://my-app.com/signin")).toBe(
        true,
      );
    });

    it("does not consider OAuth authorization paths as completion", () => {
      expect(
        isCompletionReturn(
          "https://my-app.com/oauth/authorize?client_id=123",
          "https://my-app.com/",
        ),
      ).toBe(false);

      expect(isCompletionReturn("https://my-app.com/login", "https://my-app.com/")).toBe(false);
    });

    it("does not match different origins", () => {
      expect(
        isCompletionReturn("https://github.com/login/oauth/authorize", "https://my-app.com/"),
      ).toBe(false);

      expect(
        isCompletionReturn("https://accounts.google.com/o/oauth2/v2/auth", "https://my-app.com/"),
      ).toBe(false);
    });

    it("handles missing completion origin cleanly", () => {
      expect(isCompletionReturn("https://my-app.com/dashboard", undefined)).toBe(false);
    });
  });
});

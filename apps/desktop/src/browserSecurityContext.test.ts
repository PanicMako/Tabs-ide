import { describe, expect, it } from "vitest";
import {
  buildSecurityContext,
  deriveRegistrableDomain,
  deriveSecurityState,
  hasPunycodeOrHomoglyphWarning,
} from "./browserSecurityContext";

describe("browserSecurityContext", () => {
  describe("deriveRegistrableDomain", () => {
    it("extracts second-level domain for standard domains", () => {
      expect(deriveRegistrableDomain("github.com")).toBe("github.com");
      expect(deriveRegistrableDomain("api.github.com")).toBe("github.com");
      expect(deriveRegistrableDomain("sub.deep.example.com")).toBe("example.com");
    });

    it("handles two-level ccTLDs accurately", () => {
      expect(deriveRegistrableDomain("bbc.co.uk")).toBe("bbc.co.uk");
      expect(deriveRegistrableDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
      expect(deriveRegistrableDomain("service.gov.uk")).toBe("service.gov.uk");
      expect(deriveRegistrableDomain("tokyo.ac.jp")).toBe("tokyo.ac.jp");
      expect(deriveRegistrableDomain("accounts.example.co.in")).toBe("example.co.in");
      expect(deriveRegistrableDomain("tenant.github.io")).toBe("tenant.github.io");
    });

    it("preserves localhost and IP addresses", () => {
      expect(deriveRegistrableDomain("localhost")).toBe("localhost");
      expect(deriveRegistrableDomain("127.0.0.1")).toBe("127.0.0.1");
      expect(deriveRegistrableDomain("[::1]")).toBe("::1");
    });
  });

  describe("hasPunycodeOrHomoglyphWarning", () => {
    it("flags punycode internationalized domains", () => {
      expect(hasPunycodeOrHomoglyphWarning("xn--gogle-qoa.com")).toBe(true);
      expect(hasPunycodeOrHomoglyphWarning("sub.xn--apple-43a.com")).toBe(true);
    });

    it("does not flag standard ASCII domains", () => {
      expect(hasPunycodeOrHomoglyphWarning("google.com")).toBe(false);
      expect(hasPunycodeOrHomoglyphWarning("accounts.google.com")).toBe(false);
      expect(hasPunycodeOrHomoglyphWarning("localhost")).toBe(false);
    });
  });

  describe("deriveSecurityState", () => {
    it("marks valid HTTPS as secure", () => {
      expect(deriveSecurityState({ url: "https://accounts.google.com" })).toBe("secure");
      expect(deriveSecurityState({ url: "https://github.com/login" })).toBe("secure");
    });

    it("marks localhost HTTP as secure per W3C specification", () => {
      expect(deriveSecurityState({ url: "http://localhost:3000" })).toBe("secure");
      expect(deriveSecurityState({ url: "http://127.0.0.1:8080" })).toBe("secure");
    });

    it("marks non-localhost HTTP as insecure", () => {
      expect(deriveSecurityState({ url: "http://example.com" })).toBe("insecure");
      expect(deriveSecurityState({ url: "http://insecure-login.org/auth" })).toBe("insecure");
    });

    it("downgrades to broken on certificate errors", () => {
      expect(
        deriveSecurityState({
          url: "https://expired.badssl.com",
          certificateError: "net::ERR_CERT_DATE_INVALID",
        }),
      ).toBe("broken");
    });

    it("returns unknown for about:blank or missing URLs", () => {
      expect(deriveSecurityState({ url: "about:blank" })).toBe("unknown");
      expect(deriveSecurityState({ url: null })).toBe("unknown");
    });
  });

  describe("buildSecurityContext", () => {
    it("constructs complete security context for secure profile session", () => {
      const context = buildSecurityContext({
        url: "https://accounts.google.com/signin/v2/identifier",
        partition: "persist:tabs-browser:profile:work",
      });

      expect(context.securityState).toBe("secure");
      expect(context.registrableDomain).toBe("google.com");
      expect(context.origin).toBe("https://accounts.google.com");
      expect(context.profileId).toBe("work");
      expect(context.isTabsOwned).toBe(true);
      expect(context.hasPunycodeWarning).toBe(false);
      expect(context.certificateError).toBeNull();
    });

    it("flags broken state and certificate error accurately", () => {
      const context = buildSecurityContext({
        url: "https://self-signed.badssl.com",
        partition: "persist:tabs-browser:profile:dev",
        certificateError: "net::ERR_CERT_AUTHORITY_INVALID",
      });

      expect(context.securityState).toBe("broken");
      expect(context.certificateError).toBe("net::ERR_CERT_AUTHORITY_INVALID");
    });

    it("flags punycode warning on homoglyph domain", () => {
      const context = buildSecurityContext({
        url: "https://xn--e1afmkfd.xn--p1ai",
        partition: "persist:tabs-browser:default",
      });

      expect(context.hasPunycodeWarning).toBe(true);
    });
  });
});

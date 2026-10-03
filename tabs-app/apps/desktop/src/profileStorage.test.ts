import { describe, expect, it } from "vitest";
import {
  deriveBrowserPartition,
  encodeScopeForDigest,
  extractProfileIdFromPartition,
  isPersistentPartition,
  isProfilePartition,
  normalizeProfileIdentifier,
} from "./profileStorage";

describe("profileStorage", () => {
  describe("normalizeProfileIdentifier", () => {
    it("preserves valid alphanumeric and hyphenated profile ids", () => {
      expect(normalizeProfileIdentifier("personal")).toBe("personal");
      expect(normalizeProfileIdentifier("work-profile_1")).toBe("work-profile_1");
    });

    it("rejects path traversal attempts", () => {
      expect(() => normalizeProfileIdentifier("../etc/passwd")).toThrow("path traversal");
      expect(() => normalizeProfileIdentifier("..\\profile")).toThrow("path traversal");
      expect(() => normalizeProfileIdentifier("profile/sub")).toThrow("path traversal");
    });

    it("rejects empty identifier", () => {
      expect(() => normalizeProfileIdentifier("")).toThrow("Invalid browser profile identifier");
      expect(() => normalizeProfileIdentifier("   ")).toThrow("Invalid browser profile identifier");
    });

    it("deterministically handles Unicode characters", () => {
      const u1 = normalizeProfileIdentifier("프로필1");
      const u2 = normalizeProfileIdentifier("프로필2");
      expect(u1).not.toBe(u2);
      expect(u1).toMatch(/^p-.*[a-f0-9]{16}$/);
      expect(u2).toMatch(/^p-.*[a-f0-9]{16}$/);
    });
  });

  describe("encodeScopeForDigest", () => {
    it("preserves regular strings", () => {
      expect(encodeScopeForDigest("standard-scope")).toBe("standard-scope");
    });

    it("escapes lone surrogates so they cannot alias U+FFFD", () => {
      const loneSurrogate = "p\ud800";
      const escaped = encodeScopeForDigest(loneSurrogate);
      expect(escaped).toBe("p\\ud800");

      const literalReplacement = "p\ufffd";
      expect(encodeScopeForDigest(literalReplacement)).not.toBe(escaped);
    });
  });

  describe("deriveBrowserPartition", () => {
    it("creates persistent partitions with persist: prefix", () => {
      const p = deriveBrowserPartition({ profileId: "work" });
      expect(p).toBe("persist:tabs-browser:profile:work");
      expect(isPersistentPartition(p)).toBe(true);
      expect(isProfilePartition(p)).toBe(true);
    });

    it("creates ephemeral partitions without persist: prefix", () => {
      const p = deriveBrowserPartition({ profileId: "incognito", ephemeral: true });
      expect(p).toBe("tabs-browser-ephemeral:profile:incognito");
      expect(isPersistentPartition(p)).toBe(false);
      expect(isProfilePartition(p)).toBe(true);
    });

    it("distinguishes project and profile namespaces", () => {
      const profilePartition = deriveBrowserPartition({ profileId: "main" });
      const projectPartition = deriveBrowserPartition({ projectId: "main" });
      expect(profilePartition).not.toBe(projectPartition);
      expect(profilePartition).toBe("persist:tabs-browser:profile:main");
      expect(projectPartition).toBe("persist:tabs-browser:project:main");
    });
  });

  describe("extractProfileIdFromPartition", () => {
    it("extracts profile ID from modern and legacy partitions", () => {
      expect(extractProfileIdFromPartition("persist:tabs-browser:profile:work")).toBe("work");

      expect(extractProfileIdFromPartition("tabs-browser-ephemeral:profile:test")).toBe("test");

      expect(extractProfileIdFromPartition("persist:tabs-browser:project:proj1")).toBe(null);
    });
  });
});

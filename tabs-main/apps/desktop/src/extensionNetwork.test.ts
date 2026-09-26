import { describe, expect, it, vi } from "vitest";
import {
  extensionNetworkStatusAllowed,
  resolveExtensionNetworkAddress,
  validateExtensionNetworkUrl,
} from "./extensionNetwork";

describe("extension network broker", () => {
  it("never follows or accepts redirects", () => {
    expect(extensionNetworkStatusAllowed(200)).toBe(true);
    expect(extensionNetworkStatusAllowed(302)).toBe(false);
    expect(extensionNetworkStatusAllowed(307)).toBe(false);
    expect(extensionNetworkStatusAllowed(401)).toBe(false);
  });
  it("accepts only declared HTTPS hosts without alternate authorities", () => {
    const hosts = ["api.example.com"];
    expect(validateExtensionNetworkUrl("https://api.example.com/data", hosts).hostname).toBe(
      "api.example.com",
    );
    for (const url of [
      "http://api.example.com/data",
      "https://api.example.com:444/data",
      "https://user:secret@api.example.com/data",
      "https://api.example.com.evil.test/data",
      "https://127.0.0.1/data",
      "https://api.example.com/data#fragment",
    ])
      expect(() => validateExtensionNetworkUrl(url, hosts)).toThrow();
  });

  it("rejects any private answer, including mixed and mapped IPv6 answers", async () => {
    const fake = (addresses: { address: string; family: 4 | 6 }[]) =>
      vi.fn().mockResolvedValue(addresses) as never;
    await expect(
      resolveExtensionNetworkAddress(
        "api.example.com",
        fake([
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
      ),
    ).rejects.toThrow("restricted");
    await expect(
      resolveExtensionNetworkAddress(
        "api.example.com",
        fake([{ address: "::ffff:127.0.0.1", family: 6 }]),
      ),
    ).rejects.toThrow("restricted");
    await expect(
      resolveExtensionNetworkAddress("api.example.com", fake([{ address: "8.8.8.8", family: 4 }])),
    ).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });
});

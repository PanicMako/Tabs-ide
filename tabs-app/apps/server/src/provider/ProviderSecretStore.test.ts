import { describe, expect, it, vi } from "vitest";

const keytarMock = vi.hoisted(() => ({
  deletePassword: vi.fn(async () => true),
  getPassword: vi.fn(async (_service?: string, _account?: string): Promise<string | null> => null),
  setPassword: vi.fn(async () => undefined),
}));

vi.mock("keytar", () => ({ default: keytarMock }));

import { deleteProviderSecret, getProviderSecret, setProviderSecret } from "./ProviderSecretStore";

describe("ProviderSecretStore", () => {
  it("retrieves a stored secret from the keychain", async () => {
    keytarMock.getPassword.mockResolvedValueOnce("super-secret-token");
    const secret = await getProviderSecret("antigravity.api-key");
    expect(secret).toBe("super-secret-token");
    expect(keytarMock.getPassword).toHaveBeenCalledWith(
      "Tabs Provider Credentials",
      "antigravity.api-key",
    );
  });

  it("returns null when a secret is not present in the keychain", async () => {
    keytarMock.getPassword.mockResolvedValueOnce(null);
    const secret = await getProviderSecret("antigravity.api-key");
    expect(secret).toBeNull();
  });

  it("safely returns null when keychain access throws in headless or restricted environments", async () => {
    keytarMock.getPassword.mockRejectedValueOnce(
      new Error("Cannot autolaunch D-Bus without X11 $DISPLAY"),
    );
    const secret = await getProviderSecret("antigravity.api-key");
    expect(secret).toBeNull();
  });

  it("stores and normalizes secrets", async () => {
    keytarMock.setPassword.mockClear();
    await setProviderSecret("gemini.api-key", "  my-key  ");
    expect(keytarMock.setPassword).toHaveBeenCalledWith(
      "Tabs Provider Credentials",
      "gemini.api-key",
      "my-key",
    );
  });

  it("deletes secrets when given an empty value", async () => {
    keytarMock.deletePassword.mockClear();
    await setProviderSecret("gemini.api-key", "   ");
    expect(keytarMock.deletePassword).toHaveBeenCalledWith(
      "Tabs Provider Credentials",
      "gemini.api-key",
    );
  });

  it("reports delete failures rather than claiming credentials were removed", async () => {
    keytarMock.deletePassword.mockRejectedValueOnce(
      new Error("No such interface 'org.freedesktop.Secret.Collection'"),
    );
    await expect(deleteProviderSecret("gemini.api-key")).rejects.toThrow("No such interface");
  });
});

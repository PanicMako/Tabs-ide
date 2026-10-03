import type { ServerProvider } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { getProviderStatusBannerKey, shouldShowProviderStatusBanner } from "./ProviderStatusBanner";

const warningProvider = {
  instanceId: "codex",
  driver: "codex",
  installed: true,
  status: "warning",
  message: "Sign in required",
  auth: { status: "unauthenticated" },
} as ServerProvider;

describe("ProviderStatusBanner", () => {
  it("stays dismissed until the provider condition changes", () => {
    const key = getProviderStatusBannerKey(warningProvider);
    expect(key).not.toBeNull();
    expect(shouldShowProviderStatusBanner(warningProvider, null)).toBe(true);
    expect(shouldShowProviderStatusBanner(warningProvider, key)).toBe(false);
    expect(
      shouldShowProviderStatusBanner({ ...warningProvider, message: "A different warning" }, key),
    ).toBe(true);
  });

  it("does not warn for ready providers or Antigravity's expected unknown auth probe", () => {
    expect(getProviderStatusBannerKey({ ...warningProvider, status: "ready" })).toBeNull();
    expect(
      getProviderStatusBannerKey({
        ...warningProvider,
        driver: "antigravity",
        auth: { status: "unknown" },
      } as ServerProvider),
    ).toBeNull();
  });
});

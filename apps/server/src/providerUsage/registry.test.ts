import { describe, expect, it } from "vitest";
import { SUPPORTED_USAGE_PROVIDERS } from "./index";
import { PROVIDER_USAGE_FETCHERS } from "./registry";

describe("provider usage registry", () => {
  it("registers a fetcher for every usage-capable provider", () => {
    expect(
      SUPPORTED_USAGE_PROVIDERS.every((provider: string) => PROVIDER_USAGE_FETCHERS[provider]),
    ).toBe(true);
  });
});

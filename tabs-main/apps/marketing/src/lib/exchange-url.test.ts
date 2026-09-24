import { describe, expect, it } from "vitest";
import { configuredExchangeOrigin } from "./exchange-url";

describe("Exchange marketing URL", () => {
  it("accepts a configured HTTPS origin or local development origin", () => {
    expect(configuredExchangeOrigin("https://exchange.tabs.example")).toBe(
      "https://exchange.tabs.example",
    );
    expect(configuredExchangeOrigin("http://localhost:8787")).toBe("http://localhost:8787");
  });

  it("rejects non-HTTPS remote and path-bearing URLs", () => {
    expect(configuredExchangeOrigin("javascript:alert(1)")).toBeNull();
    expect(configuredExchangeOrigin("http://exchange.tabs.example")).toBeNull();
    expect(configuredExchangeOrigin("https://exchange.tabs.example/path")).toBeNull();
  });
});

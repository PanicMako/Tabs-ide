import { describe, expect, it } from "vitest";
import { fixtureEndpoint, fixtureFormPolicy, requireBrowserFixture } from "./browserFixture.ts";
describe("isolated browser acceptance fixture", () => {
  it("allows the exact local callback origin without wildcard form destinations", () => {
    expect(fixtureFormPolicy("http://127.0.0.1:49939")).toBe(
      "default-src 'none'; form-action 'self' http://127.0.0.1:49939; base-uri 'none'; frame-ancestors 'none'",
    );
    for (const origin of [
      "https://remote.example",
      "http://127.0.0.1:49939/path",
      "http://test@127.0.0.1:49939",
      "http://127.0.0.1:49939?next=remote",
    ])
      expect(() => fixtureFormPolicy(origin)).toThrow();
  });
  it("requires both explicit fixture consent and test mode", () => {
    expect(() =>
      requireBrowserFixture({ NODE_ENV: "test", TABS_EXCHANGE_BROWSER_FIXTURE: "1" }),
    ).not.toThrow();
    for (const environment of [
      {},
      { NODE_ENV: "test" },
      { NODE_ENV: "production", TABS_EXCHANGE_BROWSER_FIXTURE: "1" },
    ])
      expect(() => requireBrowserFixture(environment)).toThrow("not production OAuth");
  });
  it("refuses remote, credential-host confusion and wrong protocol endpoints", () => {
    expect(
      fixtureEndpoint("postgres://test:test@127.0.0.1:5433/test", ["postgres:"]).hostname,
    ).toBe("127.0.0.1");
    for (const value of [
      "postgres://remote.example/test",
      "postgres://127.0.0.1@remote.example/test",
      "https://127.0.0.1/test",
      "postgres://127.0.0.1/test#fragment",
    ])
      expect(() => fixtureEndpoint(value, ["postgres:"])).toThrow("loopback");
  });
});

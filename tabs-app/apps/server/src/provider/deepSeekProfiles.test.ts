import { expect, it } from "vitest";
import { deepSeekHarnessHome } from "./deepSeekProfiles";
it("gives the plugin manager exactly the same stable, account-scoped harness home", () => {
  expect(deepSeekHarnessHome("/state", "account/a")).toBe(
    deepSeekHarnessHome("/state", "account/a"),
  );
  expect(deepSeekHarnessHome("/state", "account/a")).not.toBe(
    deepSeekHarnessHome("/state", "account/b"),
  );
  expect(deepSeekHarnessHome("/state", "../../outside")).toMatch(
    /^\/state\/harnesses\/deepseek\/[a-f0-9]{16}$/,
  );
});

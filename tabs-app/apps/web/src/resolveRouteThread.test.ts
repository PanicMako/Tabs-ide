import { describe, expect, it } from "vitest";
import { resolveRouteThread } from "./resolveRouteThread";

describe("route thread resolution", () => {
  const local = { id: "thread", environmentId: "local" };
  const remote = { id: "thread", environmentId: "remote" };
  it("opens a unique legacy link before its redirect component can mount", () => {
    expect(resolveRouteThread([local], "thread", null)).toBe(local);
  });
  it("keeps scoped links isolated from another environment", () => {
    expect(resolveRouteThread([local, remote], "thread", "remote")).toBe(remote);
    expect(resolveRouteThread([local], "thread", "remote")).toBeNull();
  });
  it("does not choose an environment for an ambiguous legacy link", () => {
    expect(resolveRouteThread([local, remote], "thread", null)).toBeNull();
  });
  it("ignores absent threads and non-thread routes", () => {
    expect(resolveRouteThread([local], "missing", null)).toBeNull();
    expect(resolveRouteThread([local], null, null)).toBeNull();
  });
});

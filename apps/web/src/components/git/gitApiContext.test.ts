import { describe, expect, it } from "vitest";

import { gitWorkspaceScopeKey } from "./gitApiContext";

describe("gitWorkspaceScopeKey", () => {
  it("keeps identical repository paths isolated by environment", () => {
    const local = gitWorkspaceScopeKey(undefined, "/workspace/app");
    const remote = gitWorkspaceScopeKey("remote-a", "/workspace/app");

    expect(local).not.toBe(remote);
    expect(gitWorkspaceScopeKey("remote-a", "/workspace/app")).toBe(remote);
  });

  it("does not create ambiguous keys from delimiters in either component", () => {
    expect(gitWorkspaceScopeKey("a:b", "/workspace/app")).not.toBe(
      gitWorkspaceScopeKey("a", "b:/workspace/app"),
    );
  });
});

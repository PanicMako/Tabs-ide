import { describe, expect, it } from "vitest";

import { isHostPullRequestProvider } from "./HostPullRequestsPanel";

describe("HostPullRequestsPanel", () => {
  it("claims only the hosts the git layer cannot read", () => {
    for (const provider of ["forgejo", "gitcafe", "cursor-origin"])
      expect(isHostPullRequestProvider(provider)).toBe(true);
    for (const provider of ["github", "gitlab", "bitbucket", "azure-devops", "unknown", null])
      expect(isHostPullRequestProvider(provider)).toBe(false);
  });
});

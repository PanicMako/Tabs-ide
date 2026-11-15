import { describe, expect, it } from "vitest";

import { pullRequestLinkTarget } from "./pullRequestLinkTarget";

const page = { projectId: "p1", repository: "PanicMako/Tabs-ide", host: "github.com" };

describe("pullRequestLinkTarget", () => {
  it("names a pull request of the page's own repository", () => {
    expect(
      pullRequestLinkTarget("https://github.com/panicmako/tabs-ide/pull/44", page),
    ).toEqual({
      projectId: "p1",
      repository: "PanicMako/Tabs-ide",
      number: 44,
      host: "github.com",
    });
  });

  it("gives no card for another repository, an issue, or no project", () => {
    expect(pullRequestLinkTarget("https://github.com/other/repo/pull/1", page)).toBeNull();
    expect(pullRequestLinkTarget("https://github.com/panicmako/tabs-ide/issues/9", page)).toBeNull();
    expect(
      pullRequestLinkTarget("https://github.com/panicmako/tabs-ide/pull/44", {
        ...page,
        projectId: null,
      }),
    ).toBeNull();
  });
});

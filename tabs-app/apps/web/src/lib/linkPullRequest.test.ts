import { describe, expect, it } from "vitest";
import { linkPullRequestFromText } from "./linkPullRequest";

describe("linkPullRequestFromText", () => {
  it("reads a GitHub pull request link", () => {
    expect(linkPullRequestFromText("  https://github.com/Owner/Repo/pull/42  ")).toEqual({
      ok: true,
      host: "github.com",
      repository: "owner/repo",
      number: 42,
      url: "https://github.com/Owner/Repo/pull/42",
    });
  });

  it("reads a GitLab merge request link", () => {
    const result = linkPullRequestFromText("https://gitlab.com/group/sub/app/-/merge_requests/7");
    expect(result).toMatchObject({ ok: true, repository: "group/sub/app", number: 7 });
  });

  it("asks for a link when the box is empty", () => {
    expect(linkPullRequestFromText("   ")).toEqual({
      ok: false,
      message: "Paste the link to a pull request.",
    });
  });

  it("explains links that are not pull requests", () => {
    for (const text of [
      "https://github.com/owner/repo",
      "https://github.com/owner/repo/issues/3",
      "not a url",
      "javascript:alert(1)",
    ]) {
      expect(linkPullRequestFromText(text)).toMatchObject({ ok: false });
    }
  });
});

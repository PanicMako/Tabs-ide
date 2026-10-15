import { expect, it } from "vitest";
import {
  changeRequestUrlFor,
  parseChangeRequestUrl,
  matchesLinkedPullRequestUrl,
  changeRequestRepositoryUrl,
  siblingPullRequestUrl,
} from "./changeRequestUrl.ts";
it("preserves Forgejo authority, isolates ports, and derives repository/sibling URLs", () => {
  const url = "http://git.example.test:3000/team/repo/pulls/42/files?diff=1#x";
  expect(parseChangeRequestUrl(url)).toEqual({
    host: "git.example.test",
    repository: "team/repo",
    number: 42,
    authority: "git.example.test:3000",
  });
  expect(
    changeRequestUrlFor(
      "forgejo",
      "git.example.test",
      "team/repo",
      42,
      "http://git.example.test:3000/team/repo.git",
    ),
  ).toBe("http://git.example.test:3000/team/repo/pulls/42");
  expect(changeRequestRepositoryUrl(url)).toBe("http://git.example.test:3000/team/repo");
  expect(siblingPullRequestUrl(url, 43)).toBe("http://git.example.test:3000/team/repo/pulls/43");
  expect(matchesLinkedPullRequestUrl({ url } as never, url.replace(":3000", ":4000"))).toBe(false);
  expect(matchesLinkedPullRequestUrl({ url } as never, url)).toBe(true);
});

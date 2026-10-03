import { describe, expect, it } from "vitest";

import {
  decodeGitLabMergeRequestChanges,
  decodeGitLabMergeRequests,
  decodeGitLabReviewThreads,
} from "./GitLabCli.ts";

describe("decodeGitLabReviewThreads", () => {
  it("keeps positioned discussion replies and resolution state", () => {
    expect(
      decodeGitLabReviewThreads(
        [
          {
            id: "discussion-1",
            resolved: true,
            notes: [
              {
                id: 20,
                body: "Can this be simplified?",
                created_at: "2026-09-01T10:00:00Z",
                author: { username: "reviewer" },
                position: { new_path: "src/app.ts", new_line: 12 },
                award_emoji: [
                  { name: "rocket", user: { username: "rushil" } },
                  { name: "rocket", user: { username: "reviewer" } },
                ],
              },
              {
                id: 21,
                body: "Done.",
                created_at: "2026-09-01T11:00:00Z",
                author: { username: "author" },
              },
            ],
          },
        ],
        "rushil",
      ),
    ).toMatchObject([
      {
        id: "discussion-1",
        path: "src/app.ts",
        line: 12,
        side: "right",
        resolved: true,
        comments: [
          {
            id: "20",
            reactions: [{ content: "ROCKET", count: 2, viewerHasReacted: true }],
          },
          { id: "21" },
        ],
      },
    ]);
  });
});

describe("decodeGitLabMergeRequests", () => {
  it("normalizes real GitLab fields without inventing unavailable data", () => {
    const [mergeRequest] = decodeGitLabMergeRequests(
      JSON.stringify([
        {
          iid: 17,
          title: "Ship provider routing",
          web_url: "https://gitlab.com/tabs/app/-/merge_requests/17",
          source_branch: "feature/providers",
          target_branch: "main",
          state: "opened",
          draft: true,
          description: "Provider-backed details.",
          author: { username: "rushil", avatar_url: "https://gitlab.com/avatar.png" },
          reviewers: [{ username: "reviewer" }],
          labels: ["backend", { name: "git", color: "1f75cb" }],
          has_conflicts: false,
          merge_status: "can_be_merged",
          changes_count: "4",
          head_pipeline: { status: "success" },
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-02T10:00:00Z",
        },
      ]),
    );

    expect(mergeRequest).toEqual({
      provider: "gitlab",
      number: 17,
      title: "Ship provider routing",
      url: "https://gitlab.com/tabs/app/-/merge_requests/17",
      headBranch: "feature/providers",
      baseBranch: "main",
      state: "open",
      isDraft: true,
      author: { login: "rushil", avatarUrl: "https://gitlab.com/avatar.png" },
      labels: [{ name: "backend" }, { name: "git", color: "1f75cb" }],
      reviewers: [{ login: "reviewer" }],
      mergeability: "mergeable",
      checksState: "passing",
      createdAt: "2026-09-01T10:00:00Z",
      updatedAt: "2026-09-02T10:00:00Z",
      body: "Provider-backed details.",
      changedFiles: 4,
    });
  });

  it("drops malformed list rows instead of fabricating required fields", () => {
    expect(
      decodeGitLabMergeRequests(
        JSON.stringify([
          { iid: 2, title: "Missing URL" },
          {
            iid: 3,
            title: "Valid",
            web_url: "https://gitlab.com/tabs/app/-/merge_requests/3",
            source_branch: "feature/valid",
            target_branch: "main",
          },
        ]),
      ),
    ).toHaveLength(1);
  });
});

describe("decodeGitLabMergeRequestChanges", () => {
  it("normalizes renamed and binary merge-request files", () => {
    expect(
      decodeGitLabMergeRequestChanges({
        changes: [
          {
            old_path: "src/old.ts",
            new_path: "src/new.ts",
            renamed_file: true,
            new_file: false,
            deleted_file: false,
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
          {
            old_path: "logo.png",
            new_path: "logo.png",
            new_file: false,
            deleted_file: false,
            renamed_file: false,
          },
        ],
      }),
    ).toEqual([
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
        patchTruncated: false,
      },
      {
        path: "logo.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: null,
        patchTruncated: false,
      },
    ]);
  });
});

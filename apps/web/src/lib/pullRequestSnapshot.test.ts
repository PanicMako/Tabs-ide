import { describe, expect, it } from "vitest";
import type { GitResolvePullRequestResult } from "@tabs/contracts";

import {
  prunePullRequestSnapshots,
  pullRequestSnapshotKey,
  readPullRequestSnapshot,
  resolveDisplayedPullRequestResult,
  writePullRequestSnapshot,
} from "./pullRequestSnapshot";

const makeMockStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
};

const sampleResult = (
  overrides?: Partial<GitResolvePullRequestResult["pullRequest"]>,
): GitResolvePullRequestResult => ({
  pullRequest: {
    number: 42,
    title: "Support persistent PR cache",
    url: "https://github.com/acme/tabs/pull/42",
    headBranch: "feature/pr-cache",
    baseBranch: "main",
    state: "open",
    isDraft: false,
    author: { login: "octocat" },
    comments: [],
    files: [],
    reviewThreads: [],
    ...overrides,
  },
  capabilities: {
    provider: "github",
    diff: true,
    create: true,
    search: true,
    actions: ["merge", "close"],
    mergeMethods: ["merge", "squash"],
  },
});

describe("pullRequestSnapshot", () => {
  it("hydrates title and details across restarts so reopen does not ghost the tab", () => {
    const storage = makeMockStorage();
    const ref = { environmentId: "env-1", cwd: "/repos/tabs", reference: "42" };

    writePullRequestSnapshot(ref, sampleResult(), storage);

    const snapshot = readPullRequestSnapshot(ref, storage);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.pullRequest.title).toBe("Support persistent PR cache");
    expect(snapshot?.pullRequest.author?.login).toBe("octocat");
  });

  it("prioritizes live results while keeping cached painted until live resolves", () => {
    const ref = { environmentId: "env-1", cwd: "/repos/tabs", reference: "42" };
    const cached = sampleResult({ title: "Cached Title" });
    const live = sampleResult({ title: "Updated Live Title" });

    // While live is null (loading), cached is displayed
    expect(resolveDisplayedPullRequestResult({ live: null, cached, ref })?.pullRequest.title).toBe(
      "Cached Title",
    );

    // Once live arrives, live wins
    expect(resolveDisplayedPullRequestResult({ live, cached, ref })?.pullRequest.title).toBe(
      "Updated Live Title",
    );
  });

  it("does not paint another PR's snapshot", () => {
    const ref = { environmentId: "env-1", cwd: "/repos/tabs", reference: "42" };
    const otherPr = sampleResult({ number: 99, headBranch: "different-branch" });

    expect(resolveDisplayedPullRequestResult({ live: null, cached: otherPr, ref })).toBeNull();
  });

  it("isolates snapshots between environments and repositories", () => {
    const storage = makeMockStorage();
    const env1Ref = { environmentId: "env-1", cwd: "/repos/tabs", reference: "42" };
    const env2Ref = { environmentId: "env-2", cwd: "/repos/tabs", reference: "42" };
    const otherRepoRef = { environmentId: "env-1", cwd: "/repos/other", reference: "42" };

    writePullRequestSnapshot(env1Ref, sampleResult({ title: "Env 1 PR" }), storage);

    expect(readPullRequestSnapshot(env2Ref, storage)).toBeNull();
    expect(readPullRequestSnapshot(otherRepoRef, storage)).toBeNull();
    expect(readPullRequestSnapshot(env1Ref, storage)?.pullRequest.title).toBe("Env 1 PR");
  });

  it("shrugs off corrupted storage data", () => {
    const storage = makeMockStorage();
    const ref = { environmentId: "env-1", cwd: "/repos/tabs", reference: "42" };
    storage.setItem(pullRequestSnapshotKey(ref), "{not valid json");

    expect(readPullRequestSnapshot(ref, storage)).toBeNull();
  });

  it("prunes snapshots when capacity is exceeded", () => {
    const storage = makeMockStorage();
    for (let i = 1; i <= 60; i++) {
      const ref = { environmentId: "env-1", cwd: "/repos/tabs", reference: String(i) };
      writePullRequestSnapshot(ref, sampleResult({ number: i }), storage);
    }

    // Default max capacity is 50
    expect(storage.length).toBeLessThanOrEqual(50);
  });
});

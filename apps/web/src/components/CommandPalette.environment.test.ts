import { describe, expect, it, vi } from "vitest";

import type { Project, Thread } from "../types";
import {
  buildCommandPaletteProjectMetadata,
  buildProjectActionItems,
  buildThreadActionItems,
  resolveCommandPaletteWorkspaceContext,
  resolveEnvironmentLabel,
} from "./CommandPalette.logic";

describe("resolveCommandPaletteWorkspaceContext", () => {
  it("does not select a same-id thread or project from another environment", () => {
    const localProject = { id: "project-1", environmentId: "local", cwd: "/local" } as Project;
    const remoteProject = { id: "project-1", environmentId: "remote", cwd: "/remote" } as Project;
    const localThread = {
      id: "thread-1",
      projectId: "project-1",
      environmentId: "local",
    } as Thread;
    const remoteThread = {
      id: "thread-1",
      projectId: "project-1",
      environmentId: "remote",
    } as Thread;

    expect(
      resolveCommandPaletteWorkspaceContext({
        projects: [localProject, remoteProject],
        threads: [localThread, remoteThread],
        threadId: "thread-1",
        environmentId: "remote",
      }),
    ).toEqual({ project: remoteProject, thread: remoteThread });
  });
});

describe("buildCommandPaletteProjectMetadata", () => {
  const locations = new Map([
    ["env-local", { label: "Local" }],
    ["env-buildbox", { label: "Build Box" }],
  ]);

  it("makes every member environment and path searchable", () => {
    const metadata = buildCommandPaletteProjectMetadata({
      projects: [
        {
          environmentId: "env-local",
          name: "Tabs",
          cwd: "/Users/dev/tabs",
        },
        {
          environmentId: "env-buildbox",
          name: "tabs-service",
          cwd: "/srv/tabs",
        },
      ],
      locationByEnvironmentId: locations,
    });

    expect(metadata.searchTerms).toEqual([
      "Tabs",
      "/Users/dev/tabs",
      "Local",
      "tabs-service",
      "/srv/tabs",
      "Build Box",
    ]);
    expect(metadata.environmentLabels).toEqual(["Local", "Build Box"]);
  });

  it("deduplicates distinct environments with the same label", () => {
    const metadata = buildCommandPaletteProjectMetadata({
      projects: [
        { environmentId: "env-1", name: "Tabs", cwd: "/srv/tabs-1" },
        { environmentId: "env-2", name: "Tabs 2", cwd: "/srv/tabs-2" },
      ],
      locationByEnvironmentId: new Map([
        ["env-1", { label: "Cloud Node" }],
        ["env-2", { label: "Cloud Node" }],
      ]),
    });

    expect(metadata.environmentLabels).toEqual(["Cloud Node"]);
  });

  it("falls back to human-readable label when presentation data is unavailable", () => {
    expect(resolveEnvironmentLabel(undefined)).toBe("Local");
    expect(resolveEnvironmentLabel("local")).toBe("Local");
    expect(resolveEnvironmentLabel("remote-box", new Map())).toBe("remote-box");
  });
});

describe("buildProjectActionItems environment disambiguation", () => {
  it("disambiguates same-named projects across environments and avoids same-ID collision", async () => {
    const runProject = vi.fn(async () => {});
    const localProject = {
      id: "proj-1",
      name: "Tabs App",
      cwd: "/local/tabs",
      environmentId: "local",
    } as Project;
    const remoteProject = {
      id: "proj-1",
      name: "Tabs App",
      cwd: "/remote/tabs",
      environmentId: "remote-worker",
    } as Project;

    const items = buildProjectActionItems({
      projects: [localProject, remoteProject],
      valuePrefix: "project",
      icon: () => null,
      runProject,
      locationByEnvironmentId: new Map([
        ["local", { label: "Local Machine" }],
        ["remote-worker", { label: "Worker 1" }],
      ]),
    });

    expect(items).toHaveLength(2);
    // Unique scoped values prevent cmdk selection collision
    expect(items[0]?.value).toBe("project:local:proj-1");
    expect(items[1]?.value).toBe("project:remote-worker:proj-1");

    // Search terms include the environment label for easy search ranking
    expect(items[0]?.searchTerms).toContain("Local Machine");
    expect(items[1]?.searchTerms).toContain("Worker 1");

    // Descriptions clearly indicate which machine owns the project
    expect(items[0]?.description).toBe("/local/tabs · Local Machine");
    expect(items[1]?.description).toBe("/remote/tabs · Worker 1");

    await items[1]?.run();
    expect(runProject).toHaveBeenCalledWith(remoteProject);
  });
});

describe("buildThreadActionItems environment disambiguation", () => {
  it("scopes thread values and disambiguates threads with identical titles across environments", async () => {
    const runThread = vi.fn(async () => {});
    const localThread = {
      id: "thread-abc",
      projectId: "proj-1",
      title: "Fix crash on launch",
      environmentId: "local",
      messages: [],
      archivedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
    } as unknown as Thread;
    const remoteThread = {
      id: "thread-abc",
      projectId: "proj-2",
      title: "Fix crash on launch",
      environmentId: "remote-cluster",
      messages: [],
      archivedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
    } as unknown as Thread;

    const items = buildThreadActionItems({
      threads: [localThread, remoteThread],
      projectTitleById: new Map([
        ["proj-1", "Local Tabs"],
        ["proj-2", "Cluster Tabs"],
      ]),
      sortOrder: "updated_at",
      icon: null,
      locationByEnvironmentId: new Map([
        ["local", { label: "Local" }],
        ["remote-cluster", { label: "Cloud Cluster" }],
      ]),
      runThread,
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.value).toBe("thread:local:thread-abc");
    expect(items[1]?.value).toBe("thread:remote-cluster:thread-abc");

    expect(items[0]?.searchTerms).toContain("Local");
    expect(items[1]?.searchTerms).toContain("Cloud Cluster");

    expect(items[0]?.description).toContain("Local");
    expect(items[1]?.description).toContain("Cloud Cluster");

    await items[1]?.run();
    expect(runThread).toHaveBeenCalledWith(remoteThread);
  });

  it("includes linked pull request search terms, URLs, numbers, and stack indicators", () => {
    const threadWithPrs = {
      id: "thread-pr-1",
      projectId: "proj-1",
      title: "Feature branch work",
      environmentId: "local",
      messages: [],
      archivedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      pullRequests: [
        {
          host: "github.com",
          repository: "tabs/ide",
          number: 240,
          url: "https://github.com/tabs/ide/pull/240",
          source: "created",
          linkedAt: "2026-03-01T00:00:00.000Z",
          snapshot: {
            state: "open",
            title: "Add tabs support",
            headBranch: "feat/tabs",
            baseBranch: "main",
            isDraft: false,
            updatedAt: "2026-03-01T00:00:00.000Z",
            syncedAt: "2026-03-01T00:00:00.000Z",
          },
          stack: null,
        },
      ],
    } as unknown as Thread;

    const threadWithStack = {
      id: "thread-pr-2",
      projectId: "proj-1",
      title: "Stack branch work",
      environmentId: "remote-cluster",
      messages: [],
      archivedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      pullRequests: [
        {
          host: "github.com",
          repository: "tabs/ide",
          number: 241,
          url: "https://github.com/tabs/ide/pull/241",
          source: "created",
          linkedAt: "2026-03-01T00:00:00.000Z",
          snapshot: {
            state: "open",
            title: "Layer 1",
            headBranch: "feat/layer-1",
            baseBranch: "main",
            isDraft: false,
            updatedAt: "2026-03-01T00:00:00.000Z",
            syncedAt: "2026-03-01T00:00:00.000Z",
          },
          stack: {
            kind: "native",
            id: "stack-1",
            number: 1,
            url: "https://github.com/tabs/ide/stacks/1",
            base: "main",
            layers: [
              { number: 241, headBranch: "feat/layer-1", state: "open" },
              { number: 242, headBranch: "feat/layer-2", state: "open" },
            ],
          },
        },
        {
          host: "github.com",
          repository: "tabs/ide",
          number: 242,
          url: "https://github.com/tabs/ide/pull/242",
          source: "created",
          linkedAt: "2026-03-01T01:00:00.000Z",
          snapshot: {
            state: "open",
            title: "Layer 2",
            headBranch: "feat/layer-2",
            baseBranch: "feat/layer-1",
            isDraft: false,
            updatedAt: "2026-03-01T01:00:00.000Z",
            syncedAt: "2026-03-01T01:00:00.000Z",
          },
          stack: {
            kind: "native",
            id: "stack-1",
            number: 1,
            url: "https://github.com/tabs/ide/stacks/1",
            base: "main",
            layers: [
              { number: 241, headBranch: "feat/layer-1", state: "open" },
              { number: 242, headBranch: "feat/layer-2", state: "open" },
            ],
          },
        },
      ],
    } as unknown as Thread;

    const items = buildThreadActionItems({
      threads: [threadWithPrs, threadWithStack],
      projectTitleById: new Map([["proj-1", "Tabs Repo"]]),
      sortOrder: "updated_at",
      icon: null,
      locationByEnvironmentId: new Map([
        ["local", { label: "Local" }],
        ["remote-cluster", { label: "Cloud Cluster" }],
      ]),
      runThread: vi.fn(),
    });

    expect(items).toHaveLength(2);
    const item1 = items.find((i) => i.value.includes("thread-pr-1"));
    const item2 = items.find((i) => i.value.includes("thread-pr-2"));
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();

    // Verify threadWithPrs search terms and description
    expect(item1?.searchTerms).toContain("#240");
    expect(item1?.searchTerms).toContain("240");
    expect(item1?.searchTerms).toContain("https://github.com/tabs/ide/pull/240");
    expect(item1?.searchTerms).toContain("github");
    expect(item1?.searchTerms).toContain("tabs/ide");
    expect(item1?.searchTerms).toContain("feat/tabs");
    expect(item1?.searchTerms).toContain("Add tabs support");
    expect(item1?.description).toContain("#240");

    // Verify stack search terms and description
    expect(item2?.searchTerms).toContain("#242");
    expect(item2?.searchTerms).toContain("#241");
    expect(item2?.description).toContain("#242 (2 in stack)");
  });
});

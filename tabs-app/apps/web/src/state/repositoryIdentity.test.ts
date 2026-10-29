import {
  EnvironmentId,
  ProjectId,
  type OrchestrationProjectShell,
  type OrchestrationReadModel,
  type OrchestrationV2ShellSnapshot,
  type RepositoryIdentity,
} from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import type { Project } from "../types";
import {
  mergeV2ProjectEnrichment,
  syncServerReadModel,
  syncV2ShellSnapshot,
  type AppState,
} from "./readModelTransitions";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const projectId = ProjectId.make("same-project-id");

function identity(canonicalKey: string, rootPath: string): RepositoryIdentity {
  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: `https://github.com/${canonicalKey}.git`,
    },
    rootPath,
    displayName: canonicalKey,
  };
}

function shellProject(
  repositoryIdentity: RepositoryIdentity | null | undefined,
): OrchestrationProjectShell {
  return {
    id: projectId,
    title: "Project",
    workspaceRoot: "/workspace/project",
    ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }),
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function v2Snapshot(project: OrchestrationProjectShell): OrchestrationV2ShellSnapshot {
  return {
    schemaVersion: 1,
    snapshotSequence: 1,
    projects: [project],
    threads: [],
    archivedThreads: [],
  } as OrchestrationV2ShellSnapshot;
}

function initialState(projects: Project[] = []): AppState {
  return { projects, threads: [], threadsHydrated: false };
}

describe("project repository identity mapping", () => {
  it("maps identity from a fresh V2 snapshot and preserves it when enrichment omits it", () => {
    const repo = identity("owner/repo", "/workspace/project");
    const loaded = syncV2ShellSnapshot(initialState(), v2Snapshot(shellProject(repo)), remote);

    expect(loaded.projects[0]?.repositoryIdentity).toEqual(repo);

    const enriched = mergeV2ProjectEnrichment(loaded, v2Snapshot(shellProject(undefined)), remote);
    expect(enriched.projects[0]?.repositoryIdentity).toEqual(repo);
  });

  it("honors explicit null as an identity clear", () => {
    const loaded = syncV2ShellSnapshot(
      initialState(),
      v2Snapshot(shellProject(identity("owner/repo", "/workspace/project"))),
      remote,
    );

    const cleared = mergeV2ProjectEnrichment(loaded, v2Snapshot(shellProject(null)), remote);
    expect(cleared.projects[0]?.repositoryIdentity).toBeNull();
  });

  it("keeps same-id project identities isolated across environments during enrichment", () => {
    const localIdentity = identity("local/repo", "/local/project");
    const remoteIdentity = identity("remote/repo", "/remote/project");
    const state = initialState([
      {
        id: projectId,
        environmentId: local,
        name: "Local",
        cwd: "/local/project",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
        repositoryIdentity: localIdentity,
      },
      {
        id: projectId,
        environmentId: remote,
        name: "Remote",
        cwd: "/remote/project",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
        repositoryIdentity: remoteIdentity,
      },
    ]);

    const enriched = mergeV2ProjectEnrichment(state, v2Snapshot(shellProject(undefined)), remote);

    expect(enriched.projects.map((project) => project.repositoryIdentity)).toEqual([
      localIdentity,
      remoteIdentity,
    ]);
  });

  it("maps legacy read model identity and preserves it when omitted later", () => {
    const repo = identity("owner/legacy", "/legacy/project");
    const readModel = (repositoryIdentity: RepositoryIdentity | null | undefined) =>
      ({
        snapshotSequence: 1,
        projects: [
          {
            id: projectId,
            title: "Legacy",
            workspaceRoot: "/legacy/project",
            ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }),
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deletedAt: null,
          },
        ],
        threads: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as unknown as OrchestrationReadModel;

    const loaded = syncServerReadModel(initialState(), readModel(repo), remote);
    expect(loaded.projects[0]?.repositoryIdentity).toEqual(repo);

    const refreshed = syncServerReadModel(loaded, readModel(undefined), remote);
    expect(refreshed.projects[0]?.repositoryIdentity).toEqual(repo);

    const cleared = syncServerReadModel(refreshed, readModel(null), remote);
    expect(cleared.projects[0]?.repositoryIdentity).toBeNull();
  });
});

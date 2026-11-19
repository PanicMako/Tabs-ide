import { describe, expect, it } from "vitest";
import {
  EnvironmentId,
  ProjectId,
  type ExecutionEnvironmentDescriptor,
  type RepositoryIdentity,
} from "@tabs/contracts";
import type { Project } from "../types";
import { nextComposerMachine, resolveComposerMachines } from "./BranchToolbarEnvironmentSelector";

const identity = (canonicalKey: string, origin?: string): RepositoryIdentity => ({
  canonicalKey,
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "https://example.test/repo.git",
  },
  ...(origin ? { origin: { canonicalKey: origin } } : {}),
});
const project = (env: string, key?: string, origin?: string): Project => ({
  id: ProjectId.make(`project-${env}`),
  environmentId: EnvironmentId.make(env),
  cwd: `/${env}/repo`,
  name: "same-name",
  defaultModelSelection: null,
  expanded: true,
  scripts: [],
  ...(key ? { repositoryIdentity: identity(key, origin) } : {}),
});
const machines = ["local", "remote"].map((env) => ({
  environmentId: EnvironmentId.make(env),
  label: env,
})) as ExecutionEnvironmentDescriptor[];

describe("composer machine targets", () => {
  it("matches repository identity across machines with different checkout paths", () => {
    const local = project("local", "github:owner/repo");
    const remote = project("remote", "github:owner/repo");
    expect(resolveComposerMachines(local, [local, remote], machines)[1]?.project).toBe(remote);
  });
  it("does not confuse similarly named projects or a fork with its upstream", () => {
    const local = project("local", "github:owner/repo");
    expect(
      resolveComposerMachines(
        local,
        [local, project("remote", "github:owner/repo", "github:other/fork")],
        machines,
      )[1]?.project,
    ).toBeNull();
    expect(
      resolveComposerMachines(project("local"), [project("local"), project("remote")], machines)[1]
        ?.project,
    ).toBeNull();
  });
  it("offers only connected machines and preserves the current checkout", () => {
    const local = project("local");
    expect(
      resolveComposerMachines(local, [local, project("remote")], machines.slice(0, 1)),
    ).toMatchObject([{ environmentId: "local", project: local }]);
  });
});

describe("nextComposerMachine", () => {
  const option = (environmentId: string, hasProject = true) => ({
    environmentId,
    project: hasProject ? {} : null,
  });
  it("moves to the next machine that has the project and wraps around", () => {
    const options = [option("a"), option("b", false), option("c")];
    expect(nextComposerMachine(options, "a")?.environmentId).toBe("c");
    expect(nextComposerMachine(options, "c")?.environmentId).toBe("a");
  });
  it("does nothing when there is only one place to be", () => {
    expect(nextComposerMachine([option("a"), option("b", false)], "a")).toBeNull();
    expect(nextComposerMachine([], undefined)).toBeNull();
  });
});

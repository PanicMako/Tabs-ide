import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { OrchestrationProject, OrchestrationReadModel, ProjectId } from "@tabs/contracts";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager, type TerminalManagerShape } from "../terminal/Services/Manager.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

const makeProject = (scripts: OrchestrationProject["scripts"]): OrchestrationProject => ({
  id: "project-1" as ProjectId,
  title: "Test Project",
  workspaceRoot: "/repo/project",
  defaultModelSelection: null,
  scripts,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const testLayer = (
  project: OrchestrationProject | null,
  terminalManagerMock: Partial<TerminalManagerShape>,
  serverSettingsLayer = ServerSettingsService.layerTest(),
) => {
  const snapshot: OrchestrationReadModel = {
    snapshotSequence: 1,
    projects: project ? [project] : [],
    threads: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const projectionMock = Layer.succeed(ProjectionSnapshotQuery, {
    getSnapshot: () => Effect.succeed(snapshot),
    getImportedAgentSessionSources: () => Effect.succeed([]),
  });

  const terminalMock = Layer.succeed(TerminalManager, {
    open: terminalManagerMock.open ?? (() => Effect.succeed({} as any)),
    list: () => Effect.succeed([]),
    write: terminalManagerMock.write ?? (() => Effect.void),
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () => Effect.succeed({} as any),
    close: () => Effect.void,
    subscribe: () => Effect.succeed(() => {}),
    dispose: Effect.void,
  });

  return ProjectSetupScriptRunner.layer.pipe(
    Layer.provideMerge(projectionMock),
    Layer.provideMerge(terminalMock),
    Layer.provideMerge(serverSettingsLayer),
  );
};

describe("ProjectSetupScriptRunner", () => {
  it("runs the setup action in the checkout's worktree", async () => {
    const open = vi.fn(() =>
      Effect.succeed({
        threadId: "thread-1",
        terminalId: "setup-default-setup",
        cwd: "/repo/worktrees/a",
        worktreePath: "/repo/worktrees/a",
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        label: "setup-default-setup",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as any),
    );
    const write = vi.fn(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
        return yield* runner.runForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath: "/repo/worktrees/a",
        });
      }).pipe(
        Effect.provide(
          testLayer(
            makeProject([]),
            { open, write },
            ServerSettingsService.layerTest({
              defaultProjectScripts: [
                {
                  id: "default-setup",
                  name: "Setup",
                  command: "npm install",
                  icon: "configure",
                  runOnWorktreeCreate: true,
                },
              ],
            }),
          ),
        ),
      ),
    );

    expect(result).toMatchObject({ status: "started", scriptId: "default-setup" });
    expect(open).toHaveBeenCalledWith({
      threadId: "thread-1",
      terminalId: "setup-default-setup",
      cwd: "/repo/worktrees/a",
      worktreePath: "/repo/worktrees/a",
      env: {
        TABS_PROJECT_ROOT: "/repo/project",
        T3CODE_PROJECT_ROOT: "/repo/project",
        TABS_WORKTREE_PATH: "/repo/worktrees/a",
        T3CODE_WORKTREE_PATH: "/repo/worktrees/a",
      },
    });
    expect(write).toHaveBeenCalledWith({
      threadId: "thread-1",
      terminalId: "setup-default-setup",
      data: "npm install\r",
    });
  });

  it("returns no-script when no setup script exists", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
        return yield* runner.runForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath: "/repo/worktrees/a",
        });
      }).pipe(Effect.provide(testLayer(makeProject([]), {}))),
    );

    expect(result).toEqual({ status: "no-script" });
  });

  it("fails with ProjectSetupScriptProjectNotFoundError when project does not exist", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
          return yield* runner.runForThread({
            threadId: "thread-1",
            projectId: "missing-project",
            worktreePath: "/repo/worktrees/a",
          });
        }).pipe(Effect.provide(testLayer(null, {}))),
      ),
    ).rejects.toThrow();
  });
});

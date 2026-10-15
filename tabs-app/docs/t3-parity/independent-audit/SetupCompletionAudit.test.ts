import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { OrchestrationProject, OrchestrationReadModel, ProjectId } from "@tabs/contracts";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Option from "effect/Option";

import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager, type TerminalManagerShape } from "../terminal/Services/Manager.ts";
import * as ProjectService from "./ProjectService.ts";
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
  const projectMock = Layer.succeed(ProjectService.ProjectService, {
    getById: (id: ProjectId) =>
      Effect.succeed(project && project.id === id ? Option.some(project as any) : Option.none()),
    getByWorkspaceRoot: (root: string) =>
      Effect.succeed(
        project && project.workspaceRoot === root ? Option.some(project as any) : Option.none(),
      ),
  } as any);

  const terminalMock = Layer.succeed(TerminalManager, {
    open: terminalManagerMock.open ?? (() => Effect.succeed({} as any)),
    list: () => Effect.succeed([]),
    attachStream: () => Effect.succeed(() => {}),
    write: terminalManagerMock.write ?? (() => Effect.void),
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () => Effect.succeed({} as any),
    close: () => Effect.void,
    closeIdle: terminalManagerMock.closeIdle ?? (() => Effect.void),
    subscribe: terminalManagerMock.subscribe ?? (() => Effect.succeed(() => {})),
    subscribeMetadata: () => Effect.succeed(() => {}),
  } as any);

  return ProjectSetupScriptRunner.layer.pipe(
    Layer.provideMerge(projectMock),
    Layer.provideMerge(terminalMock),
    Layer.provideMerge(serverSettingsLayer),
    Layer.provideMerge(NodeCrypto.layer),
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
        COLORTERM: "",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
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

it("audit: observed completion handles fragmented sentinel and filters wrapper echoes", async () => {
  let listener: any;
  let unsubscribed = 0;
  const lines: string[] = [];
  const closeIdle = vi.fn(() => Effect.void);
  const project = makeProject([
    {
      id: "setup",
      name: "Setup",
      command: "echo hello",
      icon: "configure",
      runOnWorktreeCreate: true,
    },
  ] as any);
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const started = yield* runner.runForThread({
        threadId: "thread-1",
        projectId: "project-1",
        worktreePath: "/repo/worktree",
        observeCompletion: {
          onOutputLine: (line) =>
            Effect.sync(() => {
              lines.push(line);
            }),
        },
      });
      if (started.status !== "started" || !started.completion)
        throw new Error("missing completion");
      return yield* started.completion;
    }).pipe(
      Effect.provide(
        testLayer(project, {
          subscribe: (handler: any) =>
            Effect.sync(() => {
              listener = handler;
              return () => {
                unsubscribed++;
              };
            }),
          closeIdle,
          write: (input: any) =>
            Effect.gen(function* () {
              const token = input.data.match(/__T3_SETUP_DONE__[a-zA-Z0-9_]+:/)?.[0];
              if (!token) throw new Error("missing sentinel in wrapper");
              yield* listener({
                type: "output",
                threadId: "other",
                terminalId: "setup-setup",
                data: "ignored\n",
              });
              yield* listener({
                type: "output",
                threadId: "thread-1",
                terminalId: "setup-setup",
                data: input.data,
              });
              yield* listener({
                type: "output",
                threadId: "thread-1",
                terminalId: "setup-setup",
                data: "\u001b[31mhello\u001b[0m\rprogress\n" + token.slice(0, 10),
              });
              yield* listener({
                type: "output",
                threadId: "thread-1",
                terminalId: "setup-setup",
                data: token.slice(10) + "0\n",
              });
            }),
        }),
      ),
    ),
  );
  expect(result.exitCode).toBe(0);
  expect(lines).toEqual(["hello", "progress"]);
  expect(unsubscribed).toBe(1);
  expect(closeIdle).toHaveBeenCalledWith({ threadId: "thread-1", terminalId: "setup-setup" });
});
it("audit: failed command write releases the completion listener", async () => {
  let unsubscribed = 0;
  const project = makeProject([
    {
      id: "setup",
      name: "Setup",
      command: "echo hello",
      icon: "configure",
      runOnWorktreeCreate: true,
    },
  ] as any);
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      return yield* runner
        .runForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath: "/repo/worktree",
          observeCompletion: {},
        })
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        testLayer(project, {
          subscribe: () =>
            Effect.succeed(() => {
              unsubscribed++;
            }),
          write: () => Effect.fail(new Error("write failed") as never),
        }),
      ),
    ),
  );
  expect(result._tag).toBe("Failure");
  expect(unsubscribed).toBe(1);
});

it("audit: interruption during command write releases the completion listener", async () => {
  let unsubscribed = 0;
  const project = makeProject([
    {
      id: "setup",
      name: "Setup",
      command: "echo hello",
      icon: "configure",
      runOnWorktreeCreate: true,
    },
  ] as any);
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const fiber = yield* Effect.gen(function* () {
        const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
        return yield* runner.runForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath: "/repo/worktree",
          observeCompletion: {},
        });
      }).pipe(
        Effect.provide(
          testLayer(project, {
            subscribe: () =>
              Effect.succeed(() => {
                unsubscribed++;
              }),
            write: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
    }),
  );
  expect(unsubscribed).toBe(1);
});

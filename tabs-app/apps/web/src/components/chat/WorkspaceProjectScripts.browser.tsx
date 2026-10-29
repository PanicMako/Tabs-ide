import "../../index.css";
import { EnvironmentId, ProjectId } from "@tabs/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render as renderComponent } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
const render = (element: ReactElement) =>
  renderComponent(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      {element}
    </QueryClientProvider>,
  );
import { WorkspaceProjectScripts } from "./WorkspaceProjectScripts";

const calls = vi.hoisted(() => ({
  dispatch: vi.fn(),
  environment: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async (id: string) => {
    calls.environment(id);
    return {
      orchestration: { dispatchCommand: calls.dispatch },
      server: { upsertKeybinding: vi.fn(), removeKeybinding: vi.fn() },
      projects: { readFile: calls.readFile },
    };
  },
}));

beforeEach(() => {
  calls.dispatch.mockReset();
  calls.environment.mockReset();
  calls.readFile.mockReset();
  calls.dispatch.mockResolvedValue(undefined);
  calls.readFile.mockRejectedValue(new Error("File not found"));
});

it("adds a script on its owning machine using project configuration", async () => {
  const view = await render(
    <WorkspaceProjectScripts
      project={{
        id: ProjectId.make("project"),
        environmentId: EnvironmentId.make("remote"),
        name: "Project",
        cwd: "/repo",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      }}
      keybindings={[]}
      onRunScript={vi.fn()}
    />,
  );
  try {
    await page.getByRole("button", { name: "Add action" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Check types");
    await page.getByRole("textbox", { name: "Command", exact: true }).fill("bun typecheck");
    await page.getByRole("button", { name: "Save action", exact: true }).click();
    await expect.poll(() => calls.dispatch.mock.calls.length).toBe(1);
    expect(calls.environment).toHaveBeenCalledWith("remote");
    expect(calls.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "project.meta.update",
      projectId: "project",
      scripts: [
        {
          id: "check-types",
          name: "Check types",
          command: "bun typecheck",
          icon: "play",
          runOnWorktreeCreate: false,
        },
      ],
    });
  } finally {
    await view.unmount();
  }
});

it("imports an action from t3.json fileScripts", async () => {
  const view = await render(
    <WorkspaceProjectScripts
      project={{
        id: ProjectId.make("project"),
        environmentId: EnvironmentId.make("remote"),
        name: "Project",
        cwd: "/repo",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      }}
      fileScripts={[
        {
          name: "Build App",
          command: "bun run build",
          icon: "build",
        },
      ]}
      keybindings={[]}
      onRunScript={vi.fn()}
    />,
  );
  try {
    await page.getByRole("button", { name: "Script actions" }).click();
    await expect.element(page.getByText("From t3.json")).toBeVisible();
    await page.getByRole("menuitem", { name: "Build App" }).click();
    await expect.poll(() => calls.dispatch.mock.calls.length).toBe(1);
    expect(calls.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "project.meta.update",
      projectId: "project",
      scripts: [
        {
          id: "build-app",
          name: "Build App",
          command: "bun run build",
          icon: "build",
          runOnWorktreeCreate: false,
        },
      ],
    });
  } finally {
    await view.unmount();
  }
});

it("filters out t3.json scripts that collide with existing project scripts by name or command", async () => {
  const view = await render(
    <WorkspaceProjectScripts
      project={{
        id: ProjectId.make("project"),
        environmentId: EnvironmentId.make("remote"),
        name: "Project",
        cwd: "/repo",
        defaultModelSelection: null,
        expanded: true,
        scripts: [
          {
            id: "test",
            name: "Test",
            command: "bun test",
            icon: "test",
            runOnWorktreeCreate: false,
          },
        ],
      }}
      fileScripts={[
        {
          name: "test", // colliding name
          command: "bun test:different",
        },
        {
          name: "Run Tests",
          command: "bun test", // colliding command
        },
        {
          name: "Deploy",
          command: "bun run deploy",
          icon: "play",
        },
      ]}
      keybindings={[]}
      onRunScript={vi.fn()}
    />,
  );
  try {
    await page.getByRole("button", { name: "Script actions" }).click();
    await expect.element(page.getByText("From t3.json")).toBeVisible();
    // Deploy should be available to import
    await expect.element(page.getByRole("menuitem", { name: "Deploy" })).toBeVisible();
    // Neither colliding item should be present under From t3.json
    await expect.element(page.getByRole("menuitem", { name: "Run Tests" })).not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("executes a script only on deliberate user click", async () => {
  const onRun = vi.fn();
  const script = {
    id: "run-dev",
    name: "Dev",
    command: "bun dev",
    icon: "play" as const,
    runOnWorktreeCreate: false,
  };
  const view = await render(
    <WorkspaceProjectScripts
      project={{
        id: ProjectId.make("project"),
        environmentId: EnvironmentId.make("remote"),
        name: "Project",
        cwd: "/repo",
        defaultModelSelection: null,
        expanded: true,
        scripts: [script],
      }}
      keybindings={[]}
      onRunScript={onRun}
    />,
  );
  try {
    expect(onRun).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Dev" }).click();
    expect(onRun).toHaveBeenCalledWith(script);
  } finally {
    await view.unmount();
  }
});

it("reads repository actions from the active worktree on its owning machine", async () => {
  calls.readFile.mockResolvedValue({ contents: '{"scripts":[]}', truncated: false });
  const view = await render(
    <WorkspaceProjectScripts
      project={{
        id: ProjectId.make("project"),
        environmentId: EnvironmentId.make("remote"),
        name: "Project",
        cwd: "/root",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      }}
      cwd="/worktree"
      keybindings={[]}
      onRunScript={vi.fn()}
    />,
  );
  try {
    await expect.poll(() => calls.readFile.mock.calls.length).toBe(1);
    expect(calls.readFile).toHaveBeenCalledWith({ cwd: "/worktree", relativePath: "t3.json" });
    expect(calls.environment).toHaveBeenCalledWith("remote");
  } finally {
    await view.unmount();
  }
});

import "../../index.css";
import { EnvironmentId, ProjectId } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkspaceProjectScripts } from "./WorkspaceProjectScripts";
const calls = vi.hoisted(() => ({ dispatch: vi.fn(), environment: vi.fn() }));
vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async (id: string) => {
    calls.environment(id);
    return {
      orchestration: { dispatchCommand: calls.dispatch },
      server: { upsertKeybinding: vi.fn(), removeKeybinding: vi.fn() },
    };
  },
}));
it("adds a script on its owning machine using project configuration", async () => {
  calls.dispatch.mockResolvedValue(undefined);
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
    await page.getByRole("button", { name: "Add project script" }).click();
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

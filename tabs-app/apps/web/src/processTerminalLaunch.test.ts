import { describe, expect, it } from "vitest";
import { processTerminalLaunch } from "./processTerminalLaunch";

describe("processTerminalLaunch", () => {
  it("gives the runner and the terminal views one identical launch context", () => {
    const preset = { cwd: "  ", env: { PORT: "3000" } };
    const runner = processTerminalLaunch({ projectCwd: "/repo", process: preset });
    const view = processTerminalLaunch({ projectCwd: "/repo", process: preset });
    expect(runner).toEqual(view);
    expect(runner).toEqual({ cwd: "/repo", env: { TABS_PROJECT_ROOT: "/repo", PORT: "3000" } });
  });

  it("keeps the project root variable for presets without their own env", () => {
    expect(processTerminalLaunch({ projectCwd: "/repo", process: { cwd: "/repo/web" } })).toEqual({
      cwd: "/repo/web",
      env: { TABS_PROJECT_ROOT: "/repo" },
    });
  });
});

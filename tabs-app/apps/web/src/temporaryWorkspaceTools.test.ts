import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_WORKSPACE_SETTINGS,
  type ProjectWorkspaceSettings,
} from "@tabs/contracts/settings";
import {
  closeWorkspaceTool,
  isTemporaryWorkspaceTool,
  keepWorkspaceTool,
} from "./temporaryWorkspaceTools";
const settings = (): ProjectWorkspaceSettings => ({
  ...DEFAULT_PROJECT_WORKSPACE_SETTINGS,
  tools: [
    ...DEFAULT_PROJECT_WORKSPACE_SETTINGS.tools,
    {
      id: "scratch-browser-1",
      kind: "custom_embed",
      label: "Scratch browser",
      visible: true,
      temporary: true,
      customEmbedId: "embed",
    },
    {
      id: "scratch-terminal-1",
      kind: "custom_process",
      label: "Terminal",
      visible: true,
      temporary: true,
      terminalProcessId: "shell",
    },
  ],
  customEmbeds: [
    {
      id: "embed",
      label: "Scratch browser",
      url: "https://example.com",
      resumeLastVisitedPage: true,
      partitionMode: "isolated",
    },
  ],
  terminalProcesses: [
    {
      id: "shell",
      label: "Terminal",
      commands: [],
      cwd: "/repo",
      env: {},
      autoStart: false,
      interactiveShell: true,
    },
  ],
});
describe("temporary workspace tools", () => {
  it("keeps a renamed browser without changing its URL, partition or identity", () => {
    const saved = keepWorkspaceTool(settings(), "scratch-browser-1", "Documentation");
    expect(saved.tools.find((tool) => tool.id === "scratch-browser-1")).toMatchObject({
      label: "Documentation",
      temporary: false,
      customEmbedId: "embed",
    });
    expect(saved.customEmbeds[0]).toMatchObject({
      label: "Documentation",
      url: "https://example.com",
      partitionMode: "isolated",
    });
    expect(
      isTemporaryWorkspaceTool(saved.tools.find((tool) => tool.id === "scratch-browser-1")!),
    ).toBe(false);
  });
  it("discards only a closed temporary tool's definitions", () => {
    const result = closeWorkspaceTool(settings(), "scratch-terminal-1");
    expect(result.terminalProcesses).toEqual([]);
    expect(result.customEmbeds).toHaveLength(1);
    expect(result.tools.some((tool) => tool.id === "code")).toBe(true);
    expect(result.tools.some((tool) => tool.id === "scratch-terminal-1")).toBe(false);
  });
  it("hides a kept tool so it can be reopened from workspace settings", () => {
    const saved = keepWorkspaceTool(settings(), "scratch-terminal-1", "Project shell");
    const result = closeWorkspaceTool(saved, "scratch-terminal-1");
    expect(result.tools.find((tool) => tool.id === "scratch-terminal-1")?.visible).toBe(false);
    expect(result.terminalProcesses[0]).toMatchObject({
      label: "Project shell",
      interactiveShell: true,
    });
  });
  it("recognizes older scratch browser tabs and preserves shared backing definitions", () => {
    const input = settings();
    const legacy = {
      ...input.tools.find((tool) => tool.id === "scratch-browser-1")!,
    };
    delete legacy.temporary;
    expect(isTemporaryWorkspaceTool(legacy)).toBe(true);
    const shared = {
      ...input,
      tools: [
        ...input.tools,
        {
          id: "another-view",
          kind: "custom_embed" as const,
          label: "Other view",
          visible: true,
          customEmbedId: "embed",
        },
      ],
    };
    expect(closeWorkspaceTool(shared, "scratch-browser-1").customEmbeds).toHaveLength(1);
    expect(closeWorkspaceTool(input, "code")).toBe(input);
  });
});

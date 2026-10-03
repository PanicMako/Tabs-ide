import { decodeProjectWorkspaceSettings } from "./apps/web/src/workspaceShellStore";

const mockSettings = {
  tools: [
    {
      id: "tool-browser",
      kind: "browser",
      label: "Browser",
      visible: false,
    },
  ],
  browser: {},
  terminalProcesses: [],
  serverPresets: [],
  customEmbeds: [],
};

try {
  const result = decodeProjectWorkspaceSettings(mockSettings as any, true);
  console.log("Success!", result.tools);
} catch (err) {
  console.error("Failed:", err);
}

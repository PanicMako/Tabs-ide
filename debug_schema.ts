import {
  decodeProjectWorkspaceSettingsSchema,
  ProjectWorkspaceSettings,
} from "./packages/contracts/src/settings.ts";
import { Schema } from "@effect/schema";

const sampleInput = {
  tools: [
    {
      id: "tool-browser",
      kind: "browser", // custom_embed? wait, browser tab is custom_embed? let me check ProjectWorkspaceSettingsSection
      label: "My Browser",
      visible: true,
      customEmbedId: "embed-1",
    },
    {
      id: "tool-terminal",
      kind: "custom_process",
      label: "My Terminal",
      visible: true,
      terminalProcessId: "term-1", // previously serverProcessId
    },
  ],
  terminalProcesses: [
    {
      id: "term-1",
      label: "My Terminal",
      commands: ["echo hi"],
      cwd: ".",
      autoStart: false,
    },
  ],
  customEmbeds: [
    {
      id: "embed-1",
      label: "My Browser",
      url: "https://example.com",
    },
  ],
  serverPresets: [],
};

try {
  decodeProjectWorkspaceSettingsSchema(sampleInput);
  console.log("Success");
} catch (e: any) {
  console.log("Error:", e.message);
}

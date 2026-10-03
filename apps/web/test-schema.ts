import * as Schema from "effect/Schema";
import { ProjectWorkspaceSettings } from "../../packages/contracts/src/settings.ts";

const current = {
  tools: [
    { id: "code", kind: "code", label: "Code", visible: true },
    { id: "agents", kind: "agents", label: "Agents", visible: true },
    { id: "server", kind: "server", label: "Server", visible: true },
    { id: "git", kind: "git", label: "Git", visible: true },
    { id: "browser", kind: "browser", label: "Browser", visible: true },
  ],
  browser: { defaultUrl: "", openExternalByDefault: false },
  serverProcesses: [],
  customEmbeds: [],
};

const nextCustomEmbeds = [
  {
    id: "embed-1234",
    label: "Figma",
    url: "https://figma.com",
  },
];

const nextCustomEmbedTools = [
  {
    id: "custom-embed-1234",
    kind: "custom_embed",
    label: "Figma",
    visible: true,
    customEmbedId: "embed-1234",
  },
];

const nextSettings = {
  ...current,
  customEmbeds: nextCustomEmbeds,
  tools: [...current.tools, ...nextCustomEmbedTools],
};

try {
  const decode = Schema.decodeUnknownSync(ProjectWorkspaceSettings);
  const result = decode(nextSettings);
  console.log("Success!");
} catch (err: any) {
  console.error("Validation failed:", err.message);
  console.error(err.issue ? JSON.stringify(err.issue, null, 2) : "");
}

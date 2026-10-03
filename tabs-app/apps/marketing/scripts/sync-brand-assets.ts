import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
import {
  OpenAI,
  ClaudeAI,
  CursorIcon,
  CopilotIcon,
  GrokIcon,
  OpenCodeIcon,
  KiloIcon,
  AntigravityIcon,
  DroidIcon,
  OpenRouterIcon,
  Gemini,
} from "../../web/src/components/Icons";
// Keep marketing provider identities identical to the Tabs application.
const brands = {
  codex: OpenAI,
  claude: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  antigravity: AntigravityIcon,
  "factory-droid": DroidIcon,
  openrouter: OpenRouterIcon,
  gemini: Gemini,
};
await mkdir("public/providers", { recursive: true });
for (const [name, icon] of Object.entries(brands))
  await writeFile(
    `public/providers/${name}.svg`,
    renderToStaticMarkup(
      createElement(icon, { xmlns: "http://www.w3.org/2000/svg", width: 64, height: 64 }),
    ).replaceAll("currentColor", "#18181b"),
  );

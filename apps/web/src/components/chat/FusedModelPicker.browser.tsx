import "../../index.css";
import { type ModelSlug } from "@tabs/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { FusedModelPicker } from "./FusedModelPicker";
import { makeTestServerProvider } from "../../test/serverProviderFixture";

test("routes Copilot Auto to Copilot when the current selection belongs to Claude", async () => {
  const select = vi.fn();
  const screen = await render(
    <FusedModelPicker
      provider="claudeAgent"
      lockedProvider={null}
      model="claude-model"
      providers={[
        makeTestServerProvider({
          instanceId: "claudeAgent",
          models: [
            { slug: "claude-model", name: "Claude model", isCustom: false, capabilities: {} },
          ],
        }),
        makeTestServerProvider({
          instanceId: "copilot",
          models: [{ slug: "auto", name: "Auto", isCustom: false, capabilities: {} }],
        }),
      ]}
      prompt=""
      onPromptChange={vi.fn()}
      onProviderModelChange={select}
      onModelOptionsChange={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "Claude model" }).click();
  await page.getByRole("button", { name: "GitHub Copilot", exact: true }).click();
  await page.getByText("Auto", { exact: true }).click();
  expect(select).toHaveBeenCalledWith("copilot", "auto", undefined);
  await screen.unmount();
});

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdateSettings: () => ({ updateSettings: vi.fn() }),
}));

test("groups native thinking models and dispatches exact IDs without a fabricated option", async () => {
  const select = vi.fn();
  const providers = [
    makeTestServerProvider({
      instanceId: "antigravity",
      models: ["high", "medium", "low"].map((level) => ({
        slug: `gemini-3.8-flash-${level}`,
        name: `Gemini 3.8 Flash (${level[0]!.toUpperCase() + level.slice(1)})`,
        isCustom: false,
        capabilities: {},
      })),
    }),
  ];
  const screen = await render(
    <FusedModelPicker
      provider="antigravity"
      lockedProvider="antigravity"
      model={"gemini-3.8-flash-high" as ModelSlug}
      providers={providers}
      prompt=""
      onPromptChange={vi.fn()}
      onProviderModelChange={select}
      onModelOptionsChange={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "Gemini 3.8 Flash (High)" }).click();
  const slider = page.getByRole("slider", { name: "Gemini 3.8 Flash thinking level" });
  await expect.element(slider).toBeVisible();
  expect(document.querySelectorAll('[role="slider"]')).toHaveLength(1);
  const keyTests: readonly [string, string][] = [
    ["Home", "low"],
    ["ArrowLeft", "medium"],
    ["End", "high"],
  ];
  for (const [key, level] of keyTests) {
    slider.element().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(select).toHaveBeenLastCalledWith("antigravity", `gemini-3.8-flash-${level}`, undefined);
  }
  await screen.unmount();
});

test("shows every server-enabled provider despite different local preference defaults", async () => {
  const enabled = new Set(["codex", "copilot", "grok", "opencode", "antigravity"]);
  const ids = [
    "codex",
    "claudeAgent",
    "cursor",
    "copilot",
    "grok",
    "opencode",
    "kilo",
    "droid",
    "antigravity",
    "openrouter",
  ];
  const providers = ids.map((id) =>
    makeTestServerProvider({
      instanceId: id,
      enabled: enabled.has(id),
      models: [{ slug: `${id}-model`, name: `${id} model`, isCustom: false, capabilities: {} }],
    }),
  );
  const screen = await render(
    <FusedModelPicker
      provider="codex"
      lockedProvider={null}
      model="codex-model"
      providers={providers}
      prompt=""
      onPromptChange={vi.fn()}
      onProviderModelChange={vi.fn()}
      onModelOptionsChange={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "codex model" }).click();
  for (const name of ["Codex", "GitHub Copilot", "Grok", "OpenCode", "Antigravity"]) {
    await expect.element(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect
    .element(page.getByRole("button", { name: "Claude", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});

test("shows all ten providers, permits a live retry after a status error, and labels text-only capability", async () => {
  const ids = [
    "codex",
    "claudeAgent",
    "cursor",
    "copilot",
    "grok",
    "opencode",
    "kilo",
    "droid",
    "antigravity",
    "openrouter",
  ];
  const providers = ids.map((instanceId) =>
    makeTestServerProvider({
      instanceId,
      enabled: true,
      ...(instanceId === "codex"
        ? { status: "error", message: "Timed out while checking Codex app-server provider status." }
        : {}),
      ...(instanceId === "openrouter"
        ? {
            capabilities: {
              modelDiscovery: "runtime",
              agentSessions: "unsupported",
              textGeneration: "supported",
              structuredGeneration: "supported",
              nativeReview: "unsupported",
              login: "supported",
              logout: "supported",
              accountSwitch: "supported",
              installation: "unsupported",
            },
          }
        : {}),
      models: [
        {
          slug: `${instanceId}-model`,
          name: `${instanceId} model`,
          isCustom: false,
          capabilities: {},
        },
      ],
    }),
  );
  const screen = await render(
    <FusedModelPicker
      provider="codex"
      lockedProvider={null}
      model="codex-model"
      providers={providers}
      prompt=""
      onPromptChange={vi.fn()}
      onProviderModelChange={vi.fn()}
      onModelOptionsChange={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "codex model" }).click();
  for (const name of [
    "Codex",
    "Claude",
    "Cursor",
    "GitHub Copilot",
    "Grok",
    "OpenCode",
    "Kilo",
    "Factory Droid",
    "Antigravity",
    "OpenRouter",
  ]) {
    await expect.element(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect.element(page.getByRole("button", { name: "Codex", exact: true })).toBeEnabled();
  const textOnly = page.getByRole("button", { name: "OpenRouter", exact: true });
  await expect.element(textOnly).toBeDisabled();
  await expect
    .element(textOnly)
    .toHaveAttribute("title", expect.stringContaining("Text generation only"));
  await screen.unmount();
});

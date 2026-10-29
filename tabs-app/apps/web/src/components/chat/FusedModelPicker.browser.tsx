import "../../index.css";
import { type ModelSlug } from "@tabs/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
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

test("shows a capitalized provider heading with an unboxed logo and quiet model-default metadata", async () => {
  const themeSnapshot = snapshotThemeState();
  const storedTheme = localStorage.getItem("tabs:theme");
  localStorage.setItem("tabs:theme", "tabs-monotone-light");
  restoreThemeSnapshot({ ...themeSnapshot, theme: "tabs-monotone-light" });
  const screen = await render(
    <FusedModelPicker
      provider="openrouter"
      lockedProvider="openrouter"
      model="example/default"
      providers={[
        makeTestServerProvider({
          instanceId: "openrouter",
          models: [
            { slug: "example/default", name: "Example default", isCustom: false, capabilities: {} },
          ],
        }),
      ]}
      prompt=""
      onPromptChange={vi.fn()}
      onProviderModelChange={vi.fn()}
      onModelOptionsChange={vi.fn()}
    />,
  );
  try {
    await page.getByRole("button", { name: "Example default", exact: true }).click();
    const heading = page.getByRole("heading", { name: "OpenRouter", exact: true });
    await expect.element(heading).toBeVisible();
    expect(heading.element().previousElementSibling?.tagName.toLowerCase()).toBe("svg");
    const status = page.getByText("Model default", { exact: true });
    await expect.element(status).toBeVisible();
    expect(status.element().querySelector("svg")).toBeNull();
    expect(status.element().children).toHaveLength(0);
    expect(getComputedStyle(status.element()).borderTopWidth).toBe("0px");
    expect(getComputedStyle(document.querySelector('span[title="Example default"]')!).color).toBe(
      "rgb(59, 59, 59)",
    );
  } finally {
    await screen.unmount();
    if (storedTheme === null) localStorage.removeItem("tabs:theme");
    else localStorage.setItem("tabs:theme", storedTheme);
    restoreThemeSnapshot(themeSnapshot);
  }
});

test("keeps the provider heading inside a short viewport with a long provider rail", async () => {
  await page.viewport(1280, 720);
  const providerIds = [
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
  const screen = await render(
    <div style={{ position: "fixed", left: 100, bottom: 180 }}>
      <FusedModelPicker
        provider="openrouter"
        lockedProvider={null}
        model="example/viewport"
        providers={providerIds.map((instanceId) =>
          makeTestServerProvider({
            instanceId,
            models: [
              {
                slug: "example/viewport",
                name: "Viewport model",
                isCustom: false,
                capabilities: {},
              },
            ],
          }),
        )}
        prompt=""
        onPromptChange={vi.fn()}
        onProviderModelChange={vi.fn()}
        onModelOptionsChange={vi.fn()}
      />
    </div>,
  );
  try {
    await page.getByRole("button", { name: "Viewport model", exact: true }).click();
    const heading = page.getByRole("heading", { name: "OpenRouter", exact: true });
    await expect.element(heading).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-fused-picker-panel]")!.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(0);
    expect(heading.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(
      document.querySelector("[data-fused-picker-panel]")!.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(720);
  } finally {
    await screen.unmount();
  }
});

test("uses the available model-list height beside a long provider rail", async () => {
  await page.viewport(1280, 1100);
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
  const screen = await render(
    <div style={{ position: "fixed", left: 100, bottom: 30 }}>
      <FusedModelPicker
        provider="openrouter"
        lockedProvider={null}
        model="example/0"
        providers={ids.map((instanceId) =>
          makeTestServerProvider({
            instanceId,
            models: Array.from({ length: 40 }, (_, index) => ({
              slug: `example/${index}`,
              name: `Height model ${index}`,
              isCustom: false,
              capabilities: {},
            })),
          }),
        )}
        prompt=""
        onPromptChange={vi.fn()}
        onProviderModelChange={vi.fn()}
        onModelOptionsChange={vi.fn()}
      />
    </div>,
  );
  try {
    await page.getByRole("button", { name: "Height model 0", exact: true }).click();
    await expect
      .poll(() => document.querySelector<HTMLElement>("[data-fused-model-list]")?.clientHeight ?? 0)
      .toBeGreaterThan(380);
    const panel = document.querySelector<HTMLElement>("[data-fused-picker-panel]")!;
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(560);
    const list = panel.querySelector<HTMLElement>("[data-fused-model-list]")!;
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    list.scrollTop = list.scrollHeight;
    expect(list.scrollTop).toBeGreaterThan(0);
    await expect.element(page.getByText("Height model 39", { exact: true })).toBeVisible();
    await page.screenshot({ path: "__screenshots__/model-picker/capped-list.png" });
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(1100);
    await page.viewport(1280, 640);
    await expect.poll(() => panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(640);
  } finally {
    await screen.unmount();
  }
});

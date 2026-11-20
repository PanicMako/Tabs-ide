import "../../index.css";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ServerProvider, UnifiedSettings } from "@tabs/contracts";
import { PinnedModelsPanel, type PinnedModelsProvider } from "./PinnedModelsPanel";

const model = (slug: string, name: string) => ({ slug, name, isCustom: false, capabilities: null });
const serverProviders = [
  { instanceId: "codex", models: [model("gpt-5", "GPT-5"), model("gpt-5-mini", "GPT-5 mini")] },
  { instanceId: "claudeAgent", models: [model("opus", "Opus"), model("sonnet", "Sonnet")] },
] as unknown as ServerProvider[];
const providers: PinnedModelsProvider[] = [
  { provider: "claudeAgent", title: "Claude", enabled: true },
  { provider: "codex", title: "Codex", enabled: true },
];

let latest: ReadonlyArray<{ provider: string; model: string }> = [];
function Panel({ initial = [] as Array<{ provider: string; model: string }> }) {
  const [settings, setSettings] = useState<Partial<UnifiedSettings>>({
    pinnedModels: initial as any,
  });
  latest = (settings.pinnedModels ?? []) as any;
  return (
    <div style={{ width: 720 }}>
      <PinnedModelsPanel
        serverProviders={serverProviders}
        settings={settings}
        updateSettings={(next) => setSettings((current) => ({ ...current, ...next }))}
        providers={providers}
      />
    </div>
  );
}

// Some tests need a desktop-width window; give later suites the default one back.
afterEach(async () => {
  await page.viewport(414, 896);
});

it("offers one-click suggestions from enabled providers when nothing is pinned", async () => {
  await page.viewport(1200, 900);
  const view = await render(<Panel />);
  try {
    // Suggestions follow the directory order: Claude was arranged first.
    const suggestions = [...document.querySelectorAll(".pinned-models-suggestion")].map(
      (node) => node.textContent,
    );
    expect(suggestions).toEqual(["Opus", "GPT-5"]);
    await page.getByRole("button", { name: "Pin Opus from Claude" }).click();
    await expect.poll(() => latest).toEqual([{ provider: "claudeAgent", model: "opus" }]);
    await expect.element(page.getByText("1 pinned")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Unpin Opus" })).toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("pins and unpins from the grouped picker without closing it", async () => {
  await page.viewport(1200, 900);
  const view = await render(<Panel />);
  try {
    await page.getByRole("button", { name: "Pin a model" }).click();
    await page.getByRole("textbox", { name: "Search models" }).fill("mini");
    const mini = page.getByRole("listitem").filter({ hasText: "GPT-5 mini" });
    await expect.element(mini).toHaveAttribute("aria-pressed", "false");
    await mini.click();
    await expect.element(mini).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => latest).toEqual([{ provider: "codex", model: "gpt-5-mini" }]);
    await page.getByRole("textbox", { name: "Search models" }).fill("nothing-like-this");
    await expect.element(page.getByText("No models match “nothing-like-this”.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect
      .element(page.getByRole("button", { name: "Unpin GPT-5 mini" }))
      .toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("lists pins in picker order, reorders with the keyboard and unpins", async () => {
  await page.viewport(1200, 900);
  const view = await render(
    <Panel
      initial={[
        { provider: "codex", model: "gpt-5" },
        { provider: "claudeAgent", model: "sonnet" },
        { provider: "codex", model: "retired-model" },
      ]}
    />,
  );
  try {
    const rows = () =>
      [...document.querySelectorAll(".pinned-model-name")].map((node) => node.textContent);
    expect(rows()).toEqual(["GPT-5", "Sonnet", "retired-model"]);
    await expect.element(page.getByText("Codex · not available right now")).toBeVisible();

    (page.getByRole("button", { name: "Reorder Sonnet" }).element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard(" ");
    await expect.poll(rows).toEqual(["Sonnet", "GPT-5", "retired-model"]);

    await page.getByRole("button", { name: "Unpin retired-model" }).click();
    await expect.poll(rows).toEqual(["Sonnet", "GPT-5"]);
    expect(latest).toEqual([
      { provider: "claudeAgent", model: "sonnet" },
      { provider: "codex", model: "gpt-5" },
    ]);
  } finally {
    await view.unmount();
  }
});

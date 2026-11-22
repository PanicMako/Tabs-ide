import "../../index.css";

import type { ModelSlug, ServerProvider } from "@tabs/contracts";
import { createModelCapabilities } from "@tabs/shared/model";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { makeTestServerProvider } from "../../test/serverProviderFixture";
import { CompactModelPicker } from "./CompactModelPicker";

const effort = (defaultId: string) =>
  createModelCapabilities({
    optionDescriptors: [
      {
        id: "effort",
        label: "Thinking",
        type: "select",
        options: [
          { id: "low", label: "Low", ...(defaultId === "low" ? { isDefault: true } : {}) },
          { id: "medium", label: "Medium", ...(defaultId === "medium" ? { isDefault: true } : {}) },
          { id: "high", label: "High", ...(defaultId === "high" ? { isDefault: true } : {}) },
        ],
        promptInjectedValues: [],
      },
    ],
  });

const PROVIDERS: ReadonlyArray<ServerProvider> = [
  makeTestServerProvider({
    instanceId: "claudeAgent",
    version: "0.1.0",
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: effort("high"),
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  }),
];
const OPTIONS = {
  claudeAgent: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
};

function mount(onModel = vi.fn(), onOptions = vi.fn()) {
  return render(
    <CompactModelPicker
      provider="claudeAgent"
      model={"claude-opus-4-6" as ModelSlug}
      lockedProvider="claudeAgent"
      providers={PROVIDERS}
      modelOptionsByProvider={OPTIONS}
      onProviderModelChange={onModel}
      onModelOptionsChange={onOptions}
    />,
  );
}

describe("CompactModelPicker", () => {
  it("shows the chosen model and sets its thinking level in the same panel", async () => {
    const onOptions = vi.fn();
    await mount(vi.fn(), onOptions);
    await page.getByRole("button", { name: /Claude Opus 4.6/ }).click();
    await expect.element(page.getByRole("option", { name: /Claude Haiku 4.5/ })).toBeVisible();
    await page.getByRole("radio", { name: "Low" }).click();
    expect(onOptions).toHaveBeenCalledWith([{ id: "effort", value: "low" }]);
  });

  it("filters by search and picks a model, closing when it has no thinking levels", async () => {
    const onModel = vi.fn();
    await mount(onModel);
    await page.getByRole("button", { name: /Claude Opus 4.6/ }).click();
    await page.getByRole("textbox", { name: "Search models" }).fill("haiku");
    await expect.element(page.getByRole("option", { name: /Opus/ })).not.toBeInTheDocument();
    await page.getByRole("option", { name: /Haiku/ }).click();
    expect(onModel).toHaveBeenCalledWith("claudeAgent", "claude-haiku-4-5");
    await expect.element(page.getByRole("listbox", { name: "Models" })).not.toBeInTheDocument();
  });
});

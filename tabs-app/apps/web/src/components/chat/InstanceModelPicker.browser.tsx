import "../../index.css";

import type { ModelSelection, ServerProvider } from "@tabs/contracts";
import { createModelCapabilities } from "@tabs/shared/model";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { makeTestServerProvider } from "../../test/serverProviderFixture";
import { InstanceModelPicker, modelSelectionFrom } from "./InstanceModelPicker";

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
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "effort",
              label: "Effort",
              type: "select",
              options: [
                { id: "low", label: "Low" },
                { id: "high", label: "High", isDefault: true },
                { id: "max", label: "Max" },
              ],
              promptInjectedValues: [],
            },
          ],
        }),
      },
    ],
  }),
];

describe("modelSelectionFrom", () => {
  it("keeps only id and value of each option and drops an empty list", () => {
    const id = "claudeAgent" as ModelSelection["instanceId"];
    expect(modelSelectionFrom(id, "m", undefined)).toEqual({ instanceId: id, model: "m" });
    expect(modelSelectionFrom(id, "m", [])).toEqual({ instanceId: id, model: "m" });
    expect(modelSelectionFrom(id, "m", [{ id: "effort", value: "max" }])).toEqual({
      instanceId: id,
      model: "m",
      options: [{ id: "effort", value: "max" }],
    });
  });
});

describe("InstanceModelPicker", () => {
  it("sets the thinking level inside the slim panel when compact", async () => {
    const onChange = vi.fn();
    await render(
      <InstanceModelPicker
        providers={PROVIDERS}
        value={{ instanceId: PROVIDERS[0]!.instanceId, model: "claude-opus-4-6" }}
        ariaLabel="Model"
        forceCompact
        onChange={onChange}
      />,
    );
    await expect.element(page.getByText("Claude Opus 4.6")).toBeVisible();
    await page.getByRole("button", { name: /Claude Opus 4.6/ }).click();
    await page.getByRole("radio", { name: "Max" }).click();
    expect(onChange).toHaveBeenCalledWith({
      instanceId: PROVIDERS[0]!.instanceId,
      model: "claude-opus-4-6",
      options: [{ id: "effort", value: "max" }],
    });
  });
});

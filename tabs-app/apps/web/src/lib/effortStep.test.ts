import type { ProviderOptionDescriptor } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { stepEffort } from "./effortStep";

const effort = (currentValue?: string): ProviderOptionDescriptor =>
  ({
    id: "reasoningEffort",
    label: "Effort",
    type: "select",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "ultrathink", label: "Ultrathink" },
    ],
    promptInjectedValues: ["ultrathink"],
    ...(currentValue ? { currentValue } : {}),
  }) as ProviderOptionDescriptor;

describe("stepEffort", () => {
  it("moves up and down the ladder from the current value", () => {
    expect(stepEffort([effort("medium")], 1)).toEqual([{ id: "reasoningEffort", value: "high" }]);
    expect(stepEffort([effort("medium")], -1)).toEqual([{ id: "reasoningEffort", value: "low" }]);
  });

  it("starts from the default when nothing is chosen", () => {
    expect(stepEffort([effort()], 1)).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });

  it("stops at the ends instead of wrapping, and never steps onto a prompt-only choice", () => {
    expect(stepEffort([effort("low")], -1)).toBeNull();
    expect(stepEffort([effort("high")], 1)).toBeNull();
  });

  it("does nothing for a model with no effort option", () => {
    expect(stepEffort([], 1)).toBeNull();
    expect(
      stepEffort([{ id: "fast", label: "Fast", type: "boolean" } as ProviderOptionDescriptor], 1),
    ).toBeNull();
  });

  it("keeps the other options as they were", () => {
    const fast = {
      id: "fast",
      label: "Fast",
      type: "boolean",
      currentValue: true,
    } as ProviderOptionDescriptor;
    expect(stepEffort([effort("low"), fast], 1)).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "fast", value: true },
    ]);
  });
});

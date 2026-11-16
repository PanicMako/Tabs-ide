import { describe, expect, it } from "vitest";

import { summarizeSubagentModels } from "./OvermindWorkerPicker";

const providers = [
  {
    instanceId: "codex",
    models: [{ slug: "gpt-6-luna", name: "GPT-6-Luna" }],
  },
] as never;

const luna = { instanceId: "codex", model: "gpt-6-luna" } as never;

describe("summarizeSubagentModels", () => {
  it("says the lead picks when the choice is off or empty", () => {
    expect(summarizeSubagentModels({ enabled: false, workers: luna, roles: {} }, providers)).toBe(
      "The lead picks sub-agent models",
    );
    expect(summarizeSubagentModels({ enabled: true, workers: null, roles: {} }, providers)).toBe(
      "The lead picks sub-agent models",
    );
  });

  it("names the default model and counts task-type overrides", () => {
    expect(summarizeSubagentModels({ enabled: true, workers: luna, roles: {} }, providers)).toBe(
      "GPT-6-Luna",
    );
    expect(
      summarizeSubagentModels(
        {
          enabled: true,
          workers: luna,
          roles: { review: { instanceId: "codex", model: "x" } },
        } as never,
        providers,
      ),
    ).toBe("GPT-6-Luna · 1 by task type");
  });

  it("counts a role-only choice as active", () => {
    expect(
      summarizeSubagentModels(
        { enabled: true, workers: null, roles: { design: luna } } as never,
        providers,
      ),
    ).toBe("Lead's choice · 1 by task type");
  });
});

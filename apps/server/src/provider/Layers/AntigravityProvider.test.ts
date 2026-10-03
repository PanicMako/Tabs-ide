import { describe, expect, it } from "vitest";

import { makeAntigravityCommand, parseAntigravityModels } from "./AntigravityProvider.ts";

describe("parseAntigravityModels", () => {
  it("collapses multi-effort families and preserves fixed variants", () => {
    const models = parseAntigravityModels(
      [
        "Fetching available models...",
        "gemini-3.7-flash-high\tGemini 3.7 Flash (High)",
        "gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)",
        "gemini-3.7-flash-low\tGemini 3.7 Flash (Low)",
        "gemini-3.1-pro-high\tGemini 3.1 Pro (High)",
        "gemini-3.1-pro-low\tGemini 3.1 Pro (Low)",
        "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
        "claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)",
        "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
      ].join("\n"),
    );

    expect(models.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
      { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { slug: "claude-opus-4-6-thinking", name: "Claude Opus 4.6" },
      { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B" },
    ]);
    expect(models[0]?.capabilities?.reasoningEffortLevels).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]);
    expect(models[1]?.capabilities?.reasoningEffortLevels).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ]);
    expect(
      models.slice(2).every((model) => model.capabilities?.reasoningEffortLevels.length === 0),
    ).toBe(true);
    expect(parseAntigravityModels("\n# unavailable\n")).toEqual([]);
  });
});

describe("makeAntigravityCommand", () => {
  it("closes stdin so non-interactive discovery can exit", () => {
    const command = makeAntigravityCommand(
      {
        enabled: true,
        authMethod: "oauth-personal",
        apiKey: "",
        gcpProject: "",
        gcpLocation: "",
        binaryPath: "/custom/agy",
        customModels: [],
      },
      ["models"],
      { PATH: "/custom/bin" },
    );

    expect(command.command).toBe("/custom/agy");
    expect(command.args).toEqual(["models"]);
    expect(command.options).toMatchObject({
      env: { PATH: "/custom/bin" },
      stdin: "ignore",
    });
  });
});

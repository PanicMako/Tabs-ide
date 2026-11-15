import { describe, expect, it } from "vitest";

import { ACP_AGENT_PRESETS, nextAgentInstanceId, splitCommandArgs } from "./CustomAgentProviders";

describe("custom agent providers", () => {
  it("derives a unique instance id from the agent name", () => {
    expect(nextAgentInstanceId("Kiro", new Set())).toBe("kiro");
    expect(nextAgentInstanceId("Kiro", new Set(["kiro"]))).toBe("kiro-2");
    expect(nextAgentInstanceId("My Agent!", new Set(["my-agent", "my-agent-2"]))).toBe(
      "my-agent-3",
    );
    expect(nextAgentInstanceId("  ", new Set())).toBe("agent");
  });

  it("splits arguments and keeps quoted segments together", () => {
    expect(splitCommandArgs("acp --model \"big model\" 'x y'")).toEqual([
      "acp",
      "--model",
      "big model",
      "x y",
    ]);
    expect(splitCommandArgs("   ")).toEqual([]);
  });

  it("launches Kiro on its V3 ACP engine with CLI auth", () => {
    const kiro = ACP_AGENT_PRESETS.find((preset) => preset.id === "kiro");
    expect(kiro?.command).toBe("kiro-cli");
    expect(kiro?.args).toEqual(["acp", "--agent-engine=v3", "--auth-method=cli"]);
  });
});

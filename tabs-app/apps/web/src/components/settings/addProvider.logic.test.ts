import { describe, expect, it } from "vitest";

import {
  accountFolderFieldFor,
  availableInstanceId,
  buildBuiltInInstance,
  buildLocalAcpInstance,
  buildRegistryInstance,
  configuredRegistryAgentIds,
  instanceLoginCommand,
  sharesLoginAcrossInstances,
  suggestAccountLabel,
  validateInstanceId,
} from "./addProvider.logic";

describe("add provider logic", () => {
  it("derives unique, valid instance ids", () => {
    expect(availableInstanceId("codex", "Work", new Set())).toBe("codex_work");
    expect(availableInstanceId("codex", "Work", new Set(["codex_work"]))).toBe("codex_work-2");
    expect(availableInstanceId("claudeAgent", "!!!", new Set())).toBe("claudeAgent_account");
    expect(validateInstanceId(availableInstanceId("codex", "Étude 1", new Set()), new Set())).toBe(
      null,
    );
  });

  it("validates instance ids", () => {
    expect(validateInstanceId("", new Set())).not.toBeNull();
    expect(validateInstanceId("1abc", new Set())).not.toBeNull();
    expect(validateInstanceId("codex_a", new Set(["codex_a"]))).not.toBeNull();
    expect(validateInstanceId("codex_a", new Set())).toBeNull();
  });

  it("numbers account labels from 2", () => {
    expect(suggestAccountLabel("Codex", ["Codex"])).toBe("Codex 2");
    expect(suggestAccountLabel("Codex", ["Codex", "codex 2"])).toBe("Codex 3");
  });

  it("puts a second Codex account in its own shadow home", () => {
    const field = accountFolderFieldFor("codex");
    expect(field?.configKey).toBe("shadowHomePath");
    const instance = buildBuiltInInstance({
      driver: "codex",
      label: " Work ",
      accountFolder: field!.suggest("codex_work"),
      binaryPath: "",
    });
    expect(instance).toEqual({
      driver: "codex",
      displayName: "Work",
      enabled: true,
      config: { enabled: true, shadowHomePath: "~/.codex-tabs/codex_work" },
    });
    expect(accountFolderFieldFor("claudeAgent")?.configKey).toBe("homePath");
    expect(accountFolderFieldFor("opencode")).toBeUndefined();
    expect(sharesLoginAcrossInstances("fx")).toBe(true);
    expect(sharesLoginAcrossInstances("codex")).toBe(false);
  });

  it("builds registry and local ACP instances", () => {
    expect(buildRegistryInstance({ agentId: "devin", label: "Devin" }).config).toEqual({
      source: "registry",
      agentId: "devin",
      distribution: "auto",
    });
    expect(
      buildLocalAcpInstance({ label: "Mine", command: "my-agent", args: 'acp --x "a b"' }).config,
    ).toEqual({ source: "local", commandPath: "my-agent", commandArgs: ["acp", "--x", "a b"] });
  });

  it("finds registry agents that already have an instance", () => {
    expect(
      configuredRegistryAgentIds({
        a: { driver: "acpRegistry", config: { source: "registry", agentId: "devin" } },
        b: { driver: "acpRegistry", config: { source: "local", agentId: "x" } },
        c: { driver: "codex", config: {} },
      }),
    ).toEqual(new Set(["devin"]));
  });
});

describe("instanceLoginCommand", () => {
  it("points the login at the account folder", () => {
    expect(
      instanceLoginCommand("claudeAgent", { homePath: "~/.claude-tabs/x" }, "claude auth login"),
    ).toBe(`CLAUDE_CONFIG_DIR="$HOME"/'.claude-tabs/x' claude auth login`);
    expect(instanceLoginCommand("codex", { shadowHomePath: "/a b" }, "codex login")).toBe(
      "CODEX_HOME='/a b' codex login",
    );
  });
  it("leaves drivers without an account folder alone", () => {
    expect(instanceLoginCommand("cursor", {}, "cursor-agent login")).toBe("cursor-agent login");
    expect(instanceLoginCommand("codex", {}, "codex login")).toBe("codex login");
  });
});

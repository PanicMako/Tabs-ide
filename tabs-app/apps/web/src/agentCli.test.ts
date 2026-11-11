import { describe, expect, it } from "vitest";
import type { OrchestrationV2ThreadProjection, ServerProvider } from "@tabs/contracts";
import {
  agentCliSupportsFork,
  buildAgentCliCommand,
  findNativeSessionId,
  listAgentCliOptions,
  quoteShellArg,
  resolveAgentCliBinary,
} from "./agentCli";
import {
  EMPTY_AGENT_CLI_WORKSPACE,
  addAgentCliSession,
  removeAgentCliSession,
  replaceAgentCliSession,
  type AgentCliSession,
} from "./stores/agentCliStore";

const SESSION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("buildAgentCliCommand", () => {
  it("starts Claude with the thread's model", () => {
    expect(
      buildAgentCliCommand({ driver: "claudeAgent", binary: "claude", model: "claude-opus-4-1" }),
    ).toEqual({ command: "claude --model claude-opus-4-1", forked: false });
  });

  it("forks an existing Claude session instead of resuming it in place", () => {
    expect(
      buildAgentCliCommand({
        driver: "claudeAgent",
        binary: "claude",
        forkFromSessionId: SESSION_ID,
      }),
    ).toEqual({ command: `claude --resume ${SESSION_ID} --fork-session`, forked: true });
  });

  it("forks Codex sessions with the fork subcommand", () => {
    expect(
      buildAgentCliCommand({
        driver: "codex",
        binary: "/opt/bin/codex",
        model: "gpt-5-codex",
        forkFromSessionId: SESSION_ID,
      }),
    ).toEqual({ command: `/opt/bin/codex fork ${SESSION_ID} -m gpt-5-codex`, forked: true });
  });

  it("does not pass models or forks to CLIs that cannot take them", () => {
    expect(agentCliSupportsFork("cursor")).toBe(false);
    expect(
      buildAgentCliCommand({
        driver: "cursor",
        binary: "cursor-agent",
        model: "sonnet-4",
        forkFromSessionId: SESSION_ID,
      }),
    ).toEqual({ command: "cursor-agent", forked: false });
  });

  it("returns null for drivers without a CLI", () => {
    expect(buildAgentCliCommand({ driver: "openrouter", binary: "x" })).toBeNull();
  });

  it("quotes paths with spaces", () => {
    expect(quoteShellArg("/Users/me/My Tools/claude")).toBe("'/Users/me/My Tools/claude'");
    expect(quoteShellArg("it's")).toBe(`'it'\\''s'`);
  });
});

describe("resolveAgentCliBinary", () => {
  it("prefers the instance's configured binary", () => {
    expect(
      resolveAgentCliBinary({
        driver: "codex",
        instanceId: "codex_work",
        settings: {
          providerInstances: {
            codex_work: { driver: "codex", config: { binaryPath: "/work/codex" } },
          },
          providers: {},
        } as never,
      }),
    ).toBe("/work/codex");
  });

  it("falls back to the legacy per-driver setting, then the CLI name", () => {
    expect(
      resolveAgentCliBinary({
        driver: "claudeAgent",
        instanceId: "claudeAgent",
        settings: {
          providerInstances: {},
          providers: { claudeAgent: { binaryPath: "/c" } },
        } as never,
      }),
    ).toBe("/c");
    expect(resolveAgentCliBinary({ driver: "grok", instanceId: "grok", settings: null })).toBe(
      "grok",
    );
  });
});

describe("findNativeSessionId", () => {
  const providerThread = (overrides: Record<string, unknown>) => ({
    appThreadId: "thread-1",
    driver: "claudeAgent",
    lastRunOrdinal: 1,
    nativeThreadRef: { driver: "claudeAgent", nativeId: SESSION_ID, strength: "strong" },
    ...overrides,
  });

  it("picks the latest real session for the thread and driver", () => {
    const later = "1f8fad5b-d9cb-469f-a165-70867728950e";
    const projection = {
      providerThreads: [
        providerThread({}),
        providerThread({
          lastRunOrdinal: 3,
          nativeThreadRef: { driver: "claudeAgent", nativeId: later, strength: "strong" },
        }),
        providerThread({ driver: "codex", lastRunOrdinal: 9 }),
        providerThread({ appThreadId: "other", lastRunOrdinal: 9 }),
      ],
    } as unknown as Pick<OrchestrationV2ThreadProjection, "providerThreads">;
    expect(findNativeSessionId(projection, { threadId: "thread-1", driver: "claudeAgent" })).toBe(
      later,
    );
  });

  it("ignores pending placeholders", () => {
    const projection = {
      providerThreads: [
        providerThread({
          nativeThreadRef: { driver: "claudeAgent", nativeId: "pending:run-1", strength: "weak" },
        }),
      ],
    } as unknown as Pick<OrchestrationV2ThreadProjection, "providerThreads">;
    expect(
      findNativeSessionId(projection, { threadId: "thread-1", driver: "claudeAgent" }),
    ).toBeNull();
  });
});

describe("listAgentCliOptions", () => {
  it("lists enabled, installed providers that have a CLI", () => {
    const providers = [
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
      },
      { instanceId: "claudeAgent", driver: "claudeAgent", enabled: false, installed: true },
      { instanceId: "openrouter", driver: "openrouter", enabled: true, installed: true },
    ] as unknown as ServerProvider[];
    expect(listAgentCliOptions(providers)).toEqual([
      { instanceId: "codex", driver: "codex", label: "Codex" },
    ]);
  });
});

describe("agent CLI sessions", () => {
  const session = (terminalId: string): AgentCliSession => ({
    terminalId,
    instanceId: "codex",
    driver: "codex",
    label: "Codex",
    command: "codex",
  });

  it("adds tabs, splits into the active group, and removes", () => {
    let workspace = addAgentCliSession(EMPTY_AGENT_CLI_WORKSPACE, session("a"));
    workspace = addAgentCliSession(workspace, session("b"), { split: true });
    workspace = addAgentCliSession(workspace, session("c"));
    expect(workspace.groups.map((group) => group.terminalIds)).toEqual([["a", "b"], ["c"]]);
    expect(workspace.activeTerminalId).toBe("c");

    workspace = removeAgentCliSession(workspace, "c");
    expect(workspace.groups.map((group) => group.terminalIds)).toEqual([["a", "b"]]);
    expect(workspace.activeTerminalId).toBe("b");
  });

  it("replaces a session in place for restarts", () => {
    let workspace = addAgentCliSession(EMPTY_AGENT_CLI_WORKSPACE, session("a"));
    workspace = replaceAgentCliSession(workspace, "a", session("a2"));
    expect(workspace.sessions.map((entry) => entry.terminalId)).toEqual(["a2"]);
    expect(workspace.groups[0]?.terminalIds).toEqual(["a2"]);
    expect(workspace.activeTerminalId).toBe("a2");
  });
});

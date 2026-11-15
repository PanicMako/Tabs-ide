import { describe, expect, it } from "vitest";
import type { ServerProviderModel } from "@tabs/contracts";

import { kiroAgentDescriptor, kiroAuthFromWhoami, kiroDefaultModelId } from "./KiroProvider.ts";
import {
  kiroApprovalOptions,
  kiroAutopilotValue,
  kiroPermissionDisposition,
} from "./acp/KiroAcpSupport.ts";

describe("kiroAuthFromWhoami", () => {
  it("treats a null account with a failing exit as signed out", () => {
    expect(kiroAuthFromWhoami({ code: 1, stdout: '{"account":null}' }, {})).toEqual({
      status: "unauthenticated",
    });
  });

  it("reports unknown when the command did not run or failed for another reason", () => {
    expect(kiroAuthFromWhoami(undefined, {})).toEqual({ status: "unknown" });
    expect(kiroAuthFromWhoami({ code: 2, stdout: "boom" }, {})).toEqual({ status: "unknown" });
  });

  it("reads only the first line, which a Identity Center login follows with a profile block", () => {
    const auth = kiroAuthFromWhoami(
      {
        code: 0,
        stdout: '{"accountType":"IamIdentityCenter","email":"a@b.dev"}\nProfile:\n  Name: x',
      },
      {},
    );
    expect(auth).toEqual({ status: "authenticated", label: "Kiro account", email: "a@b.dev" });
  });

  it("recognises API-key sign-in from the account type or the environment", () => {
    const expected = { status: "authenticated", type: "api_key", label: "Kiro API key" };
    expect(kiroAuthFromWhoami({ code: 0, stdout: '{"accountType":"ApiKey"}' }, {})).toEqual(
      expected,
    );
    expect(kiroAuthFromWhoami({ code: 0, stdout: "{}" }, { KIRO_API_KEY: "k" })).toEqual(expected);
  });
});

describe("kiroAgentDescriptor", () => {
  const template = (options: ReadonlyArray<{ value: string; name: string }>, current = "kiro") => ({
    configOptions: [{ id: "mode", type: "select", currentValue: current, options }],
  });

  it("offers nothing to pick between when there is one agent", () => {
    expect(kiroAgentDescriptor(template([{ value: "kiro", name: "Kiro" }]))).toBeUndefined();
  });

  it("lists the agents and marks the default", () => {
    const descriptor = kiroAgentDescriptor(
      template([
        { value: "kiro", name: "Kiro" },
        { value: "planner", name: "Planner" },
      ]),
    );
    expect(descriptor?.id).toBe("mode");
    expect(descriptor?.type).toBe("select");
    expect(descriptor).toMatchObject({
      currentValue: "kiro",
      options: [
        { id: "kiro", label: "Kiro", isDefault: true },
        { id: "planner", label: "Planner" },
      ],
    });
  });

  it("ignores malformed templates", () => {
    expect(kiroAgentDescriptor({ nope: true })).toBeUndefined();
  });
});

describe("kiroDefaultModelId", () => {
  const model = (slug: string, aliases?: ReadonlyArray<string>): ServerProviderModel => ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: null,
    ...(aliases ? { aliases } : {}),
  });

  it("uses the alias Kiro's model list gave the default entry", () => {
    expect(kiroDefaultModelId([model("default", ["claude-sonnet-5"])])).toBe("claude-sonnet-5");
  });

  it("falls back to auto", () => {
    expect(kiroDefaultModelId([model("other")])).toBe("auto");
  });
});

describe("kiro permissions", () => {
  const request = (...kinds: ReadonlyArray<string>) =>
    ({
      sessionId: "s",
      toolCall: { toolCallId: "t" },
      options: kinds.map((kind) => ({ kind, optionId: kind, name: kind })),
    }) as never;

  it("turns Autopilot on only for unrestricted full access", () => {
    expect(kiroAutopilotValue({ runtimeMode: "full-access" })).toBe("on");
    expect(kiroAutopilotValue({ runtimeMode: "approval-required" })).toBe("off");
    expect(kiroAutopilotValue({ runtimeMode: "full-access", approvalPolicy: "never" })).toBe("off");
  });

  it("offers Always allow only when there is no one-time choice", () => {
    expect(kiroApprovalOptions(request("allow_once", "allow_always", "reject_once"))).toEqual([
      { decision: "accept", label: "Allow once" },
      { decision: "decline", label: "Deny" },
      { decision: "cancel", label: "Cancel" },
    ]);
    expect(kiroApprovalOptions(request("allow_always"))[0]).toEqual({
      decision: "acceptForSession",
      label: "Always allow",
    });
  });

  it("never lets policy persist an always-allow grant", () => {
    const policy = { runtimeMode: "full-access", cwd: null } as const;
    expect(kiroPermissionDisposition(policy, request("allow_always"))).toBe("ask");
  });
});

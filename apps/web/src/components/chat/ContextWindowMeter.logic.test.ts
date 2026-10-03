import { describe, expect, it } from "vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@tabs/contracts";
import {
  formatContextWindowCompactionMessage,
  isCompactCommandMessage,
  providerSupportsManualCompaction,
} from "./ContextWindowMeter.logic";

describe("isCompactCommandMessage", () => {
  it("matches plain /compact user message", () => {
    expect(isCompactCommandMessage({ role: "user", text: "/compact", attachments: [] })).toBe(true);
    expect(isCompactCommandMessage({ role: "user", text: "  /COMPACT  ", attachments: [] })).toBe(
      true,
    );
  });

  it("does not match when attachments are present", () => {
    expect(
      isCompactCommandMessage({
        role: "user",
        text: "/compact",
        attachments: [{ type: "image", id: "img-1" }],
      }),
    ).toBe(false);
  });

  it("does not match non-user messages or non-compact text", () => {
    expect(isCompactCommandMessage({ role: "assistant", text: "/compact", attachments: [] })).toBe(
      false,
    );
    expect(
      isCompactCommandMessage({ role: "user", text: "/compact this please", attachments: [] }),
    ).toBe(false);
    expect(isCompactCommandMessage({ role: "user", text: "hello", attachments: [] })).toBe(false);
  });
});

describe("providerSupportsManualCompaction", () => {
  it("returns true when slashCommands contains compact", () => {
    const provider: ServerProvider = {
      instanceId: ProviderInstanceId.make("custom-provider"),
      driver: ProviderDriverKind.make("custom"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-08-24T12:00:00.000Z",
      models: [],
      slashCommands: [{ name: "compact", description: "Compact thread" }],
      skills: [],
    };
    expect(providerSupportsManualCompaction(provider)).toBe(true);
  });

  it("returns true for known native providers like codex and claudeAgent", () => {
    const codexProvider: ServerProvider = {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-08-24T12:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    };
    expect(providerSupportsManualCompaction(codexProvider)).toBe(true);
  });

  it("returns false for provider without compact support", () => {
    const otherProvider: ServerProvider = {
      instanceId: ProviderInstanceId.make("custom"),
      driver: ProviderDriverKind.make("custom"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-08-24T12:00:00.000Z",
      models: [],
      slashCommands: [{ name: "diff", description: "Show diff" }],
      skills: [],
    };
    expect(providerSupportsManualCompaction(otherProvider)).toBe(false);
    expect(providerSupportsManualCompaction(null)).toBe(false);
  });
});

describe("formatContextWindowCompactionMessage", () => {
  it("formats with threshold count", () => {
    expect(formatContextWindowCompactionMessage("GPT-5", 200_000)).toBe(
      "Compacts automatically at 200,000 tokens.",
    );
  });

  it("formats with model display name", () => {
    expect(formatContextWindowCompactionMessage("Claude 3.7 Sonnet")).toBe(
      "Context for Claude 3.7 Sonnet compacts automatically when needed.",
    );
  });

  it("formats fallback message", () => {
    expect(formatContextWindowCompactionMessage(null)).toBe(
      "Context compacts automatically when needed.",
    );
  });
});

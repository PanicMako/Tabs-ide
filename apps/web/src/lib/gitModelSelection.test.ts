import { describe, expect, it } from "vitest";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { pickGitProviderInstance } from "./gitModelSelection";
import { ProviderInstanceId, ProviderDriverKind, type ServerProvider } from "@tabs/contracts";

const entries = deriveProviderInstanceEntries([
  {
    instanceId: ProviderInstanceId.makeUnsafe("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    availability: "available",
    models: [],
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T00:00:00Z",
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: ProviderInstanceId.makeUnsafe("work-codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    availability: "available",
    models: [],
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T00:00:00Z",
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: ProviderInstanceId.makeUnsafe("offline"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    availability: "unavailable",
    models: [],
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T00:00:00Z",
    slashCommands: [],
    skills: [],
  },
] as ServerProvider[]);

describe("Git Fusion provider routing", () => {
  it("retains a custom provider account while changing models", () => {
    expect(pickGitProviderInstance(entries, "codex", "work-codex")?.instanceId).toBe("work-codex");
  });
  it("uses the default account when moving to a different driver", () => {
    expect(pickGitProviderInstance(entries, "codex", "other")?.instanceId).toBe("codex");
  });
  it("does not dispatch to an unavailable provider", () => {
    expect(pickGitProviderInstance(entries, "claudeAgent", "offline")).toBeUndefined();
  });
});

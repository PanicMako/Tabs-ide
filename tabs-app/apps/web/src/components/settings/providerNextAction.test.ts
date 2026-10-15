import { describe, expect, it } from "vitest";
import {
  providerNextAction,
  isProviderDetectionPending,
  type ProviderNextActionInput,
} from "./providerNextAction";

const ready: ProviderNextActionInput = {
  enabled: true,
  needsInstall: false,
  needsAuth: false,
  needsAttention: false,
};
describe("provider next action", () => {
  it("distinguishes the initial unchecked CLI snapshot from a confirmed missing CLI", () => {
    const pending = {
      installed: false,
      status: "warning",
      auth: { status: "unknown" },
      message: "Codex provider status has not been checked in this session yet.",
    };
    expect(isProviderDetectionPending(pending)).toBe(true);
    expect(
      isProviderDetectionPending({ ...pending, status: "error", message: "Codex CLI not found." }),
    ).toBe(false);
    expect(isProviderDetectionPending({ ...pending, installed: true })).toBe(false);
  });
  it("prioritizes installation and authentication before an update", () => {
    const pending = {
      ...ready,
      needsInstall: true,
      needsAuth: true,
      installCommand: "install",
      loginCommand: "login",
      updateCommand: "update",
    };
    expect(providerNextAction(pending)).toMatchObject({ label: "Install", command: "install" });
    expect(providerNextAction({ ...pending, needsInstall: false })).toMatchObject({
      label: "Sign in",
      command: "login",
    });
    expect(providerNextAction({ ...pending, needsInstall: false, needsAuth: false })).toMatchObject(
      { label: "Update", command: "update" },
    );
  });
  it("offers configuration when a provider has no CLI setup command", () => {
    expect(providerNextAction({ ...ready, needsInstall: true })).toMatchObject({ label: "Set up" });
    expect(providerNextAction({ ...ready, needsAuth: true })).toMatchObject({ label: "Connect" });
    expect(providerNextAction({ ...ready, needsAttention: true })).toMatchObject({
      label: "Check",
    });
  });
  it("does not suggest maintenance for disabled or healthy providers", () => {
    expect(
      providerNextAction({ ...ready, enabled: false, needsInstall: true, updateCommand: "update" }),
    ).toBeNull();
    expect(providerNextAction(ready)).toBeNull();
  });
});

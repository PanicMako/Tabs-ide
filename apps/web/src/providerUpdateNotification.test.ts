import { describe, expect, it } from "vitest";

import { makeTestServerProvider } from "./test/serverProviderFixture";
import {
  collectProviderUpdateCandidates,
  providerUpdateNotificationKey,
} from "./providerUpdateNotification";

describe("provider update notifications", () => {
  it("builds a stable version-scoped dismissal key", () => {
    const candidates = collectProviderUpdateCandidates([
      makeTestServerProvider({
        instanceId: "codex-work",
        displayName: "Codex",
        version: "1.0.0",
        versionAdvisory: {
          status: "behind_latest",
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          updateCommand: "npm update -g @openai/codex",
          canUpdate: true,
          checkedAt: "2026-09-10T00:00:00.000Z",
          message: null,
        },
      }),
    ]);

    expect(candidates).toEqual([
      {
        instanceId: "codex-work",
        displayName: "Codex",
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
      },
    ]);
    expect(providerUpdateNotificationKey(candidates)).toBe("codex-work:1.1.0");
  });

  it("ignores current, disabled, and uninstalled providers", () => {
    expect(
      collectProviderUpdateCandidates([
        makeTestServerProvider(),
        makeTestServerProvider({
          instanceId: "disabled",
          enabled: false,
          versionAdvisory: {
            status: "behind_latest",
            currentVersion: "1",
            latestVersion: "2",
            updateCommand: null,
            canUpdate: false,
            checkedAt: null,
            message: null,
          },
        }),
      ]),
    ).toEqual([]);
  });
});

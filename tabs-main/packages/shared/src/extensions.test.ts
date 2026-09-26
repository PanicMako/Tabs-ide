import { describe, expect, it } from "vitest";
import {
  extensionProfileForProject,
  isExtensionEnabledForProject,
  validateTabsExtensionManifest,
} from "./extensions.ts";

const manifest = {
  manifestVersion: 1,
  publisher: "acme",
  name: "deployments",
  version: "1.0.0",
  displayName: "Deployments",
  description: "Shows deployments",
  engines: { tabs: ">=1.3.0 <2.0.0" },
  contributes: { tools: [{ id: "dashboard", label: "Deployments", entry: "dist/index.html" }] },
};

describe("Tabs extension manifest", () => {
  it("accepts a UI-only manifest", () => {
    expect(validateTabsExtensionManifest(manifest, "1.3.17")).toMatchObject({
      ok: true,
      id: "acme.deployments",
    });
  });

  it("accepts only supported capabilities without duplicates", () => {
    expect(
      validateTabsExtensionManifest(
        { ...manifest, capabilities: ["profile-storage", "workspace-read"] },
        "1.3.17",
      ).ok,
    ).toBe(true);
    expect(
      validateTabsExtensionManifest(
        { ...manifest, capabilities: ["workspace-read", "workspace-read"] },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest({ ...manifest, capabilities: ["network"] }, "1.3.17").ok,
    ).toBe(false);
  });

  it("accepts bounded release notes and HTTPS publisher links", () => {
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          releaseNotes: "Fixed a bug",
          sourceUrl: "https://github.com/acme/dashboard",
          supportUrl: "https://acme.example/help",
          privacyUrl: "https://acme.example/privacy",
        },
        "1.3.17",
      ).ok,
    ).toBe(true);
    for (const sourceUrl of [
      "http://example.com",
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "https://example.com/\n",
    ]) {
      expect(validateTabsExtensionManifest({ ...manifest, sourceUrl }, "1.3.17").ok).toBe(false);
    }
    expect(
      validateTabsExtensionManifest({ ...manifest, releaseNotes: "x".repeat(10_001) }, "1.3.17").ok,
    ).toBe(false);
  });

  it("rejects traversal and unsupported executable contributions", () => {
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          contributes: {
            tools: [{ id: "dashboard", label: "Deployments", entry: "../index.html" }],
          },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest({ ...manifest, runtime: { entry: "index.js" } }, "1.3.17").ok,
    ).toBe(false);
  });

  it("rejects duplicate tool ids", () => {
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          contributes: { tools: [manifest.contributes.tools[0], manifest.contributes.tools[0]] },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
  });
});

describe("Tabs extension assignments", () => {
  const assignment = {
    extensionId: "acme.deployments",
    enabledGlobally: true,
    enabledProjectIds: [],
    disabledProjectIds: ["personal"],
    defaultProfileId: "work",
    profileIdByProjectId: { personal: "personal" },
  };

  it("supports global enablement with a project override", () => {
    expect(isExtensionEnabledForProject(assignment, "work-project")).toBe(true);
    expect(isExtensionEnabledForProject(assignment, "personal")).toBe(false);
  });

  it("selects independent account profiles per project", () => {
    expect(extensionProfileForProject(assignment, "work-project")).toBe("work");
    expect(extensionProfileForProject(assignment, "personal")).toBe("personal");
  });
});

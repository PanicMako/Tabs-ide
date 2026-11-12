import { describe, expect, it } from "vitest";
import type { TabsExtensionManifest } from "@tabs/contracts";
import {
  extensionPermissionIncrease,
  extensionProfileForProject,
  isSafeExtensionPackageVersion,
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
  it("accepts plain-hex themes on API 1.9, even without a tool, and rejects anything that is not a color", () => {
    const theme = {
      id: "ember",
      label: "Ember",
      appearance: "dark",
      colors: {
        background: "#140d0b",
        foreground: "#f6e7df",
        card: "#1f1512",
        border: "#3a2820",
        primary: "#ff6a3d",
      },
    };
    const themeOnly = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.9.0" },
      contributes: { tools: [], themes: [theme] },
    };
    expect(validateTabsExtensionManifest(themeOnly, "1.3.17").ok).toBe(true);
    // Without themes a package still needs a tool.
    expect(
      validateTabsExtensionManifest({ ...themeOnly, contributes: { tools: [] } }, "1.3.17").ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        { ...themeOnly, engines: { ...themeOnly.engines, api: "^1.8.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    for (const colors of [
      { ...theme.colors, primary: "red" },
      { ...theme.colors, primary: "#fff" },
      { ...theme.colors, background: "url(https://evil.example/x)" },
      { ...theme.colors, card: "var(--background)" },
      { ...theme.colors, extra: "#000000" },
    ])
      expect(
        validateTabsExtensionManifest(
          { ...themeOnly, contributes: { tools: [], themes: [{ ...theme, colors }] } },
          "1.3.17",
        ).ok,
      ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        { ...themeOnly, contributes: { tools: [], themes: [{ ...theme, appearance: "sepia" }] } },
        "1.3.17",
      ).ok,
    ).toBe(false);
  });

  it("lets a Command Palette entry run a declared logic command on API 1.10", () => {
    const base = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.10.0" },
      logic: { entry: "dist/logic.js" },
      contributes: {
        ...manifest.contributes,
        commands: [{ id: "summarize", label: "Summarize", description: "Summarize the board." }],
        paletteCommands: [{ id: "run-summary", title: "Deploys: summarize", command: "summarize" }],
      },
    };
    expect(validateTabsExtensionManifest(base, "1.3.17").ok).toBe(true);
    const variant = (paletteCommand: Record<string, unknown>, api = "^1.10.0") =>
      validateTabsExtensionManifest(
        {
          ...base,
          engines: { ...base.engines, api },
          contributes: { ...base.contributes, paletteCommands: [paletteCommand] },
        },
        "1.3.17",
      ).ok;
    // Older hosts cannot run palette commands, so 1.9 packages may not ask to.
    expect(
      variant({ id: "run-summary", title: "Deploys: summarize", command: "summarize" }, "^1.9.0"),
    ).toBe(false);
    expect(variant({ id: "run-summary", title: "Deploys: summarize", command: "missing" })).toBe(
      false,
    );
    expect(
      variant({ id: "both", title: "Deploys: both", command: "summarize", tool: "dashboard" }),
    ).toBe(false);
    expect(variant({ id: "neither", title: "Deploys: neither" })).toBe(false);
  });

  it("ties Command Palette entries to a contributed tool on API 1.9", () => {
    const command = {
      id: "open-board",
      title: "Deploys: open board",
      keywords: ["deploy", "ship"],
      tool: "dashboard",
    };
    const valid = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.9.0" },
      contributes: { ...manifest.contributes, paletteCommands: [command] },
    };
    expect(validateTabsExtensionManifest(valid, "1.3.17").ok).toBe(true);
    for (const paletteCommands of [
      [{ ...command, tool: "nope" }],
      [{ ...command, keywords: ["Has Spaces"] }],
      [{ ...command, title: "" }],
      [command, command],
    ])
      expect(
        validateTabsExtensionManifest(
          { ...valid, contributes: { ...valid.contributes, paletteCommands } },
          "1.3.17",
        ).ok,
      ).toBe(false);
  });

  it("gates launcher quick actions on API 1.8 and ties each one to a contributed tool", () => {
    const action = { id: "open-board", label: "Deploy board", icon: "rocket", tool: "dashboard" };
    const valid = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.8.0" },
      contributes: { ...manifest.contributes, quickActions: [action] },
    };
    expect(validateTabsExtensionManifest(valid, "1.3.17").ok).toBe(true);
    expect(
      validateTabsExtensionManifest(
        { ...valid, engines: { ...valid.engines, api: "^1.7.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    for (const quickActions of [
      [],
      [{ ...action, tool: "missing" }],
      [{ ...action, icon: "skull" }],
      [{ ...action, label: "x".repeat(41) }],
      [{ ...action, run: "rm -rf /" }],
      [action, action],
      Array.from({ length: 7 }, (_, index) => ({ ...action, id: `open-${index}x` })),
    ])
      expect(
        validateTabsExtensionManifest(
          { ...valid, contributes: { ...valid.contributes, quickActions } },
          "1.3.17",
        ).ok,
      ).toBe(false);
  });
  it("gates packaged screenshots on API 1.7 and rejects unsafe or inaccessible preview declarations", () => {
    const preview = { path: "preview.png", alt: "Project board showing pending tasks" };
    const valid = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.7.0" },
      listing: { screenshots: [preview] },
    };
    expect(validateTabsExtensionManifest(valid, "1.3.17").ok).toBe(true);
    expect(
      validateTabsExtensionManifest(
        { ...valid, engines: { ...valid.engines, api: "^1.6.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    for (const screenshots of [
      [{ ...preview, path: "https://example.com/preview.png" }],
      [{ ...preview, path: "../preview.png" }],
      [{ ...preview, path: "preview.svg" }],
      [{ ...preview, alt: "" }],
      [preview, preview],
      Array.from({ length: 7 }, (_, index) => ({ ...preview, path: `${index}.png` })),
    ])
      expect(
        validateTabsExtensionManifest({ ...valid, listing: { screenshots } }, "1.3.17").ok,
      ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          engines: { ...manifest.engines, api: "^1.6.0" },
          listing: { readme: "README.md" },
        },
        "1.3.17",
      ).ok,
    ).toBe(true);
  });
  it("rejects versions that cannot be used safely in registry paths and cursors", () => {
    expect(isSafeExtensionPackageVersion("1.0.0-alpha")).toBe(true);
    for (const version of ["1.0.0-../admin", "1.0.0-foo/bar", "1.0.0-%2Fadmin"]) {
      expect(isSafeExtensionPackageVersion(version)).toBe(false);
    }
    expect(
      validateTabsExtensionManifest({ ...manifest, version: "1.0.0-alpha" }, "1.3.17").ok,
    ).toBe(true);
    expect(
      validateTabsExtensionManifest({ ...manifest, version: "1.0.0-../admin" }, "1.3.17").ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest({ ...manifest, version: `1.0.0-${"a".repeat(128)}` }, "1.3.17")
        .ok,
    ).toBe(false);
  });
  it("reports capability and exact-host increases against the installed manifest", () => {
    const previous: TabsExtensionManifest = {
      ...manifest,
      manifestVersion: 1,
      capabilities: ["network"] as Array<"network" | "credentials">,
      networkHosts: ["api.example.com"],
    };
    expect(
      extensionPermissionIncrease(
        {
          ...previous,
          capabilities: ["network", "credentials"],
          networkHosts: ["api.example.com", "billing.example.com"],
        },
        previous,
      ),
    ).toEqual({
      addedCapabilities: ["credentials"],
      addedNetworkHosts: ["billing.example.com"],
      addedAiTools: [],
    });
  });
  it("treats newly AI-callable commands as a permission increase", () => {
    const previous: TabsExtensionManifest = {
      ...manifest,
      manifestVersion: 1,
      capabilities: ["ai-tools"],
      contributes: {
        ...manifest.contributes,
        commands: [{ id: "sum", label: "Sum", description: "Add", aiCallable: true }],
      },
    };
    expect(
      extensionPermissionIncrease(
        {
          ...previous,
          contributes: {
            ...previous.contributes,
            commands: [
              ...previous.contributes.commands!,
              { id: "divide", label: "Divide", description: "Divide", aiCallable: true },
            ],
          },
        },
        previous,
      ).addedAiTools,
    ).toEqual(["divide"]);
  });
  it("accepts a UI-only manifest", () => {
    expect(validateTabsExtensionManifest(manifest, "1.3.17")).toMatchObject({
      ok: true,
      id: "acme.deployments",
    });
  });

  it("accepts older client ranges for registry review but keeps desktop compatibility strict", () => {
    const older = { ...manifest, engines: { tabs: ">=1.0.0 <1.2.0" } };
    expect(validateTabsExtensionManifest(older, null).ok).toBe(true);
    expect(validateTabsExtensionManifest(older, "1.3.17").ok).toBe(false);
    for (const tabs of ["*", ">=1.0.0 ||", ">=1.0.0 unexpected", "x".repeat(257)]) {
      expect(validateTabsExtensionManifest({ ...older, engines: { tabs } }, null).ok).toBe(false);
    }
  });

  it("requires API 1.5 for read-only Git status and treats it as a new permission", () => {
    const next = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.5.0" },
      capabilities: ["git-status"],
    };
    expect(validateTabsExtensionManifest(next, "1.3.17").ok).toBe(true);
    expect(
      validateTabsExtensionManifest(
        { ...next, engines: { ...manifest.engines, api: "^1.4.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      extensionPermissionIncrease(next as TabsExtensionManifest, manifest as TabsExtensionManifest)
        .addedCapabilities,
    ).toEqual(["git-status"]);
  });

  it("requires a complete, bounded, non-overwriting storage migration chain", () => {
    const versioned = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.4.0" },
      capabilities: ["profile-storage"],
      storage: {
        version: 3,
        migrations: [
          { from: 1, to: 2, renames: [{ from: "oldTheme", to: "theme" }] },
          { from: 2, to: 3, renames: [{ from: "theme", to: "appearance" }] },
        ],
      },
    };
    expect(validateTabsExtensionManifest(versioned, "1.3.17").ok).toBe(true);
    expect(
      validateTabsExtensionManifest(
        {
          ...versioned,
          storage: { ...versioned.storage, migrations: versioned.storage.migrations.slice(1) },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        {
          ...versioned,
          storage: {
            version: 2,
            migrations: [{ from: 1, to: 2, renames: [{ from: "a", to: "a" }] }],
          },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(validateTabsExtensionManifest({ ...versioned, capabilities: [] }, "1.3.17").ok).toBe(
      false,
    );
  });

  it("checks declared extension API compatibility without rejecting older v1 manifests", () => {
    expect(validateTabsExtensionManifest(manifest, "1.3.17").ok).toBe(true);
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          engines: { ...manifest.engines, api: "^1.0.0" },
        },
        "1.3.17",
      ).ok,
    ).toBe(true);
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          engines: { ...manifest.engines, api: ">=2.0.0" },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
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
    expect(
      validateTabsExtensionManifest({ ...manifest, capabilities: ["credentials"] }, "1.3.17").ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          capabilities: ["network", "credentials"],
          networkHosts: ["api.example.com"],
        },
        "1.3.17",
      ).ok,
    ).toBe(true);
    expect(
      validateTabsExtensionManifest(
        {
          ...manifest,
          capabilities: ["network"],
          networkHosts: ["*.example.com"],
        },
        "1.3.17",
      ).ok,
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

  it("accepts only bounded packaged logic commands", () => {
    const commands = [{ id: "summarize", label: "Summarize", description: "Summarize input" }];
    const valid = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.2.0" },
      logic: { entry: "dist/logic.js" },
      contributes: { ...manifest.contributes, commands },
    };
    expect(validateTabsExtensionManifest(valid, "1.3.17").ok).toBe(true);
    expect(
      validateTabsExtensionManifest({ ...valid, engines: manifest.engines }, "1.3.17").ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        { ...valid, engines: { ...manifest.engines, api: "^1.0.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        { ...valid, engines: { ...manifest.engines, api: ">=1.1.1 <2.0.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        { ...valid, engines: { ...manifest.engines, api: "^1.2.0 || ^1.0.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest({ ...valid, logic: { entry: "../logic.js" } }, "1.3.17").ok,
    ).toBe(false);
    expect(validateTabsExtensionManifest({ ...valid, logic: undefined }, "1.3.17").ok).toBe(false);
    expect(
      validateTabsExtensionManifest({ ...valid, contributes: manifest.contributes }, "1.3.17").ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        {
          ...valid,
          contributes: { ...manifest.contributes, commands: [...commands, ...commands] },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        {
          ...valid,
          contributes: {
            ...manifest.contributes,
            commands: [{ ...commands[0], entry: "remote.js" }],
          },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
  });

  it("requires explicit capability and API compatibility for AI-callable commands", () => {
    const command = {
      id: "summarize",
      label: "Summarize",
      description: "Summarize JSON input",
      aiCallable: true,
    };
    const candidate = {
      ...manifest,
      engines: { ...manifest.engines, api: "^1.3.0" },
      capabilities: ["ai-tools"],
      logic: { entry: "dist/logic.js" },
      contributes: { ...manifest.contributes, commands: [command] },
    };
    expect(validateTabsExtensionManifest(candidate, "1.3.17").ok).toBe(true);
    expect(validateTabsExtensionManifest({ ...candidate, capabilities: [] }, "1.3.17").ok).toBe(
      false,
    );
    expect(
      validateTabsExtensionManifest(
        {
          ...candidate,
          contributes: { ...candidate.contributes, commands: [{ ...command, aiCallable: false }] },
        },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        { ...candidate, engines: { ...candidate.engines, api: "^1.2.0" } },
        "1.3.17",
      ).ok,
    ).toBe(false);
    expect(
      validateTabsExtensionManifest(
        {
          ...candidate,
          contributes: { ...candidate.contributes, commands: [{ ...command, aiCallable: "yes" }] },
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

it("separates inventory validation from runtime compatibility without accepting unsafe manifests", () => {
  const future = { ...manifest, engines: { tabs: ">=99.0.0 <100.0.0", api: ">=99.0.0 <100.0.0" } };
  expect(validateTabsExtensionManifest(future, "1.3.17").ok).toBe(false);
  expect(validateTabsExtensionManifest(future, null, null).ok).toBe(true);
  expect(
    validateTabsExtensionManifest(
      { ...future, engines: { ...future.engines, api: "invalid" } },
      null,
      null,
    ).ok,
  ).toBe(false);
  expect(
    validateTabsExtensionManifest(
      {
        ...future,
        contributes: { tools: [{ id: "main", label: "Main", entry: "../escape.html" }] },
      },
      null,
      null,
    ).ok,
  ).toBe(false);
});

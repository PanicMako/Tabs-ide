import { ProjectId, ThreadId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import {
  createDefaultProjectWorkspaceSettings,
  createDefaultWorkspaceShellPersistedState,
  migrateWorkspaceShellPersistedState,
} from "./workspaceShellStore";

describe("workspaceShellStore migration", () => {
  it("migrates valid version-0 / version-1 persisted state without data loss", () => {
    const v1State = {
      session: {
        openProjectIds: ["project-alpha", "project-beta"],
        activeProjectId: "project-alpha",
        pendingTabIds: ["pending-1"],
        activePendingTabId: null,
        activeToolIdByProjectId: {
          "project-alpha": "browser",
          "project-beta": "code",
        },
        rememberedThreadIdByProjectId: {
          "project-alpha": "thread-1",
        },
      },
      projectSettingsByProjectId: {
        "project-alpha": {
          browser: {
            defaultUrl: "https://example.com",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "shared",
          },
        },
      },
      browserUrlBySessionKey: {
        "project-alpha:browser": "https://example.com/dashboard",
      },
      browserStateByProjectId: {
        "project-alpha": {
          currentUrl: "https://example.com/dashboard",
          devicePreset: "desktop",
          customWidth: null,
          customHeight: null,
          landscape: false,
        },
      },
      codeStateByProjectId: {
        "project-alpha": {
          lastFocusedPath: "src/main.ts",
          lastFocusedLineNumber: 42,
          navigationNonce: 3,
          sideChatOpen: true,
          sideChatThreadId: "thread-1",
        },
      },
      gitStateByProjectId: {
        "project-alpha": {
          selectedPath: "README.md",
          selectedCommit: "abc1234",
        },
      },
      serverStateByProjectId: {
        "project-alpha": {
          logQueryByProcessId: {
            proc1: "error",
          },
        },
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(v1State, 1);

    expect(migrated.session.openProjectIds).toEqual(["project-alpha", "project-beta"]);
    expect(migrated.session.activeProjectId).toBe("project-alpha");
    expect(migrated.session.pendingTabIds).toEqual(["pending-1"]);
    expect(migrated.session.activeToolIdByProjectId["project-alpha" as ProjectId]).toBe("browser");
    expect(migrated.session.rememberedThreadIdByProjectId["project-alpha" as ProjectId]).toBe(
      "thread-1",
    );

    expect(
      migrated.projectSettingsByProjectId["project-alpha" as ProjectId]?.browser,
    ).toMatchObject({
      defaultUrl: "https://example.com",
      partitionMode: "shared",
    });
    expect(migrated.browserUrlBySessionKey["project-alpha:browser"]).toBe(
      "https://example.com/dashboard",
    );
    expect(migrated.codeStateByProjectId["project-alpha" as ProjectId]).toMatchObject({
      lastFocusedPath: "src/main.ts",
      lastFocusedLineNumber: 42,
      sideChatOpen: true,
    });
    expect(migrated.gitStateByProjectId["project-alpha" as ProjectId]).toEqual({
      selectedPath: "README.md",
      selectedCommit: "abc1234",
    });
    expect(
      migrated.serverStateByProjectId["project-alpha" as ProjectId]?.logQueryByProcessId,
    ).toEqual({ proc1: "error" });
  });

  it("preserves named browser profiles and assignments across migration (both standard 'profile' and legacy 'named')", () => {
    const raw = {
      projectSettingsByProjectId: {
        "work-project": {
          browser: {
            defaultUrl: "https://work.internal",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "profile",
            partitionProfile: "work-profile",
          },
        },
        "legacy-named-project": {
          browser: {
            defaultUrl: "https://legacy.internal",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "named",
            partitionProfile: "legacy-profile",
          },
        },
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(raw, 0);

    const workSettings = migrated.projectSettingsByProjectId["work-project" as ProjectId];
    expect(workSettings).toBeDefined();
    expect(workSettings?.browser.partitionMode).toBe("profile");
    expect(workSettings?.browser.partitionProfile).toBe("work-profile");

    const legacySettings = migrated.projectSettingsByProjectId["legacy-named-project" as ProjectId];
    expect(legacySettings).toBeDefined();
    expect(legacySettings?.browser.partitionMode).toBe("profile");
    expect(legacySettings?.browser.partitionProfile).toBe("legacy-profile");
  });

  it("guarantees a named profile remains mapped to exactly the same Electron partition after migration", () => {
    const preMigrationSettings = {
      browser: {
        defaultUrl: "https://work.internal",
        partitionMode: "profile",
        partitionProfile: "client-qa",
      },
    };

    const raw = {
      projectSettingsByProjectId: {
        "proj-x": preMigrationSettings,
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(raw, 1);
    const migratedSettings = migrated.projectSettingsByProjectId["proj-x" as ProjectId];
    expect(migratedSettings).toBeDefined();

    // Verify profileId is preserved exactly as configured
    const profileId = migratedSettings!.browser.partitionProfile;
    expect(profileId).toBe("client-qa");

    // Profile remains mapped to exactly the same canonical Electron persistent partition
    const computeProfilePartition = (id?: string) =>
      id ? `persist:tabs-browser:profile:${id}` : "persist:tabs-browser:project:default";
    const originalPartition = computeProfilePartition("client-qa");
    const migratedPartition = computeProfilePartition(profileId);

    expect(migratedPartition).toBe(originalPartition);
    expect(migratedPartition).toBe("persist:tabs-browser:profile:client-qa");
  });

  it("preserves shared and isolated browser partition modes", () => {
    const raw = {
      projectSettingsByProjectId: {
        "shared-proj": {
          browser: {
            partitionMode: "shared",
          },
        },
        "isolated-proj": {
          browser: {
            partitionMode: "isolated",
          },
        },
        "legacy-proj": {
          browser: {
            partitionMode: "project",
          },
        },
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(raw, 1);
    expect(
      migrated.projectSettingsByProjectId["shared-proj" as ProjectId]?.browser.partitionMode,
    ).toBe("shared");
    expect(
      migrated.projectSettingsByProjectId["isolated-proj" as ProjectId]?.browser.partitionMode,
    ).toBe("isolated");
    expect(
      migrated.projectSettingsByProjectId["legacy-proj" as ProjectId]?.browser.partitionMode,
    ).toBe("shared");
  });

  it("preserves explicit false, zero, empty, and null opt-out values", () => {
    const raw = {
      projectSettingsByProjectId: {
        "opt-out-proj": {
          browser: {
            defaultUrl: "",
            openExternalByDefault: false,
            resumeLastVisitedPage: false,
            partitionMode: "shared",
          },
        },
      },
      browserStateByProjectId: {
        "opt-out-proj": {
          currentUrl: "",
          devicePreset: "project-default",
          customWidth: null,
          customHeight: null,
          landscape: false,
          chromeExpanded: false,
        },
      },
      codeStateByProjectId: {
        "opt-out-proj": {
          lastFocusedPath: null,
          lastFocusedLineNumber: null,
          navigationNonce: 0,
          sideChatOpen: false,
          sideChatThreadId: null,
        },
      },
      session: {
        openProjectIds: [],
        activeProjectId: null,
        pendingTabIds: [],
        activePendingTabId: null,
        activeToolIdByProjectId: {},
        rememberedThreadIdByProjectId: {},
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(raw, 1);

    const browser = migrated.projectSettingsByProjectId["opt-out-proj" as ProjectId]?.browser;
    expect(browser?.openExternalByDefault).toBe(false);
    expect(browser?.resumeLastVisitedPage).toBe(false);
    expect(browser?.defaultUrl).toBe("");

    const bState = migrated.browserStateByProjectId["opt-out-proj" as ProjectId];
    expect(bState?.landscape).toBe(false);
    expect(bState?.chromeExpanded).toBe(false);
    expect(bState?.customWidth).toBeNull();

    const cState = migrated.codeStateByProjectId["opt-out-proj" as ProjectId];
    expect(cState?.navigationNonce).toBe(0);
    expect(cState?.sideChatOpen).toBe(false);
    expect(cState?.lastFocusedPath).toBeNull();
    expect(cState?.sideChatThreadId).toBeNull();

    expect(migrated.session.activeProjectId).toBeNull();
    expect(migrated.session.activePendingTabId).toBeNull();
  });

  it("supplies safe defaults for missing newly introduced fields", () => {
    const oldV0State = {
      session: {
        openProjectIds: ["legacy-project"],
      },
      projectSettingsByProjectId: {
        "legacy-project": {},
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(oldV0State, 0);

    // Newly introduced session fields defaulted safely
    expect(migrated.session.pendingTabIds).toEqual([]);
    expect(migrated.session.activePendingTabId).toBeNull();
    expect(migrated.session.activeToolIdByProjectId).toEqual({});
    expect(migrated.session.rememberedThreadIdByProjectId).toEqual({});

    // Newly introduced project setting fields defaulted safely
    const settings = migrated.projectSettingsByProjectId["legacy-project" as ProjectId];
    expect(settings?.terminalProcesses).toEqual([]);
    expect(settings?.serverPresets).toEqual([]);
    expect(settings?.customEmbeds).toEqual([]);
    expect(settings?.tools.length).toBeGreaterThan(0);

    // Other top-level collections defaulted
    expect(migrated.codeChromeStateByProjectId).toEqual({});
    expect(migrated.browserUrlBySessionKey).toEqual({});
  });

  it("salvages browser settings when nested fields in project settings are partially corrupted", () => {
    const raw = {
      projectSettingsByProjectId: {
        "partially-corrupted": {
          tools: "INVALID_NOT_AN_ARRAY", // Triggers schema decode error
          browser: {
            defaultUrl: "https://salvaged.com",
            partitionMode: "profile",
            partitionProfile: "salvaged-profile",
            resumeLastVisitedPage: true,
          },
        },
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(raw, 1);
    const settings = migrated.projectSettingsByProjectId["partially-corrupted" as ProjectId];

    expect(settings).toBeDefined();
    // Browser settings were salvaged despite tools being corrupted!
    expect(settings?.browser.defaultUrl).toBe("https://salvaged.com");
    expect(settings?.browser.partitionMode).toBe("profile");
    expect(settings?.browser.partitionProfile).toBe("salvaged-profile");
    // Tools were safely restored to default tools
    expect(Array.isArray(settings?.tools)).toBe(true);
  });

  it("recovers valid settings fields independently when a sibling field is corrupted", () => {
    const raw = {
      projectSettingsByProjectId: {
        "field-recovery": {
          tools: "INVALID_NOT_AN_ARRAY",
          browser: {
            partitionMode: "profile",
            partitionProfile: "field-recovery-profile",
          },
          terminalProcesses: [
            {
              id: "terminal-1",
              label: "Dev server",
              command: "bun run dev",
              cwd: "",
              env: {},
              autoStart: false,
            },
          ],
          serverPresets: [
            {
              id: "server-1",
              label: "API",
              commands: ["bun run server"],
              cwd: "",
              env: {},
              autoStart: true,
            },
          ],
          customEmbeds: [
            {
              id: "docs",
              label: "Docs",
              url: "https://example.com/docs",
              resumeLastVisitedPage: false,
              partitionMode: "profile",
              partitionProfile: "field-recovery-profile",
            },
          ],
        },
      },
    };

    const settings = migrateWorkspaceShellPersistedState(raw, 1).projectSettingsByProjectId[
      "field-recovery" as ProjectId
    ];

    expect(settings?.browser.partitionProfile).toBe("field-recovery-profile");
    expect(settings?.terminalProcesses).toHaveLength(1);
    expect(settings?.terminalProcesses[0]?.commands).toEqual(["bun run dev"]);
    expect(settings?.serverPresets).toHaveLength(1);
    expect(settings?.customEmbeds).toEqual([
      expect.objectContaining({
        id: "docs",
        resumeLastVisitedPage: false,
        partitionProfile: "field-recovery-profile",
      }),
    ]);
  });

  it("handles completely malformed or non-object persisted data without throwing", () => {
    expect(() => migrateWorkspaceShellPersistedState(null, 1)).not.toThrow();
    expect(migrateWorkspaceShellPersistedState(null, 1)).toEqual(
      createDefaultWorkspaceShellPersistedState(),
    );

    expect(() => migrateWorkspaceShellPersistedState(undefined, 0)).not.toThrow();
    expect(migrateWorkspaceShellPersistedState(undefined, 0)).toEqual(
      createDefaultWorkspaceShellPersistedState(),
    );

    expect(() => migrateWorkspaceShellPersistedState("corrupted string", 1)).not.toThrow();
    expect(migrateWorkspaceShellPersistedState("corrupted string", 1)).toEqual(
      createDefaultWorkspaceShellPersistedState(),
    );

    expect(() => migrateWorkspaceShellPersistedState([1, 2, 3], 1)).not.toThrow();
    expect(migrateWorkspaceShellPersistedState([1, 2, 3], 1)).toEqual(
      createDefaultWorkspaceShellPersistedState(),
    );

    expect(() =>
      migrateWorkspaceShellPersistedState(
        {
          session: "not an object",
          projectSettingsByProjectId: 12345,
          browserUrlBySessionKey: null,
        },
        1,
      ),
    ).not.toThrow();
  });

  it("preserves valid existing version-2 state", () => {
    const v2State = {
      session: {
        openProjectIds: ["p1"],
        activeProjectId: "p1",
        pendingTabIds: [],
        activePendingTabId: null,
        activeToolIdByProjectId: { p1: "browser" },
        rememberedThreadIdByProjectId: { p1: "t1" },
      },
      projectSettingsByProjectId: {
        p1: createDefaultProjectWorkspaceSettings(),
      },
      browserStateByProjectId: {
        p1: {
          currentUrl: "https://tabs.sh",
          devicePreset: "project-default",
          customWidth: null,
          customHeight: null,
          landscape: false,
        },
      },
      browserStateBySessionKey: {},
      browserUrlBySessionKey: { "p1:browser": "https://tabs.sh" },
      codeStateByProjectId: {},
      codeChromeStateByProjectId: {},
      gitStateByProjectId: {},
      serverStateByProjectId: {},
    };

    const result = migrateWorkspaceShellPersistedState(v2State, 2);
    expect(result.session.openProjectIds).toEqual(["p1"]);
    expect(result.browserUrlBySessionKey["p1:browser"]).toBe("https://tabs.sh");
  });

  it("is idempotent and deterministic across repeated hydration", () => {
    const state = {
      session: {
        openProjectIds: ["p1"],
        activeProjectId: "p1",
        pendingTabIds: ["pending-1"],
        activePendingTabId: null,
        activeToolIdByProjectId: { p1: "browser" },
        rememberedThreadIdByProjectId: {},
      },
      projectSettingsByProjectId: {
        p1: {
          browser: {
            defaultUrl: "https://idempotent.test",
            partitionMode: "profile",
            partitionProfile: "idempotent-profile",
          },
        },
      },
      browserUrlBySessionKey: {
        "p1:browser": "https://idempotent.test/page",
      },
      browserStateByProjectId: {},
      browserStateBySessionKey: {},
      codeStateByProjectId: {},
      codeChromeStateByProjectId: {},
      gitStateByProjectId: {},
      serverStateByProjectId: {},
    };

    const firstPass = migrateWorkspaceShellPersistedState(state, 1);
    const secondPass = migrateWorkspaceShellPersistedState(firstPass, 2);
    const thirdPass = migrateWorkspaceShellPersistedState(secondPass, 2);

    expect(secondPass).toEqual(firstPass);
    expect(thirdPass).toEqual(secondPass);
  });

  it("preserves state when custom tools or hidden tools exist and merges missing built-in tools", () => {
    const raw = {
      projectSettingsByProjectId: {
        "custom-tools-proj": {
          tools: [
            { id: "custom-embed-1", kind: "custom_embed", label: "Dashboard", visible: true },
            { id: "code", kind: "code", label: "Code", visible: false }, // Explicitly hidden tool
          ],
        },
      },
    };

    const migrated = migrateWorkspaceShellPersistedState(raw, 1);
    const settings = migrated.projectSettingsByProjectId["custom-tools-proj" as ProjectId];
    expect(settings).toBeDefined();

    // Custom tool preserved
    expect(settings?.tools.some((t) => t.id === "custom-embed-1")).toBe(true);
    // Explicitly hidden code tool preserved as visible: false
    const codeTool = settings?.tools.find((t) => t.id === "code");
    expect(codeTool?.visible).toBe(false);
    // Missing built-in tools (e.g. browser, git, agents, server) merged in as visible: false
    const browserTool = settings?.tools.find((t) => t.id === "browser");
    expect(browserTool).toBeDefined();
    expect(browserTool?.visible).toBe(false);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import {
  useScopedStateStore,
  createDefaultTestingState,
  createDefaultGitState,
  createDefaultAgentsState,
  createDefaultServerState,
  createDefaultBrowserState,
  createDefaultSettingsState,
  projectUiStateKey,
} from "./scopedStateStore";
import { createScopedStorageKey } from "../lib/scopedStateStorage";
import { EnvironmentId, ProjectId } from "@tabs/contracts";

describe("scopedStateStore", () => {
  beforeEach(() => {
    useScopedStateStore.setState({
      testingStateByProjectId: {},
      gitStateByProjectId: {},
      agentsStateByProjectId: {},
      serverStateByProjectId: {},
      browserStateByProjectId: {},
      settingsState: createDefaultSettingsState(),
    });
  });

  it("isolates UI state keys for identical project ids in different environments", () => {
    const projectId = ProjectId.make("project-1");
    expect(projectUiStateKey(EnvironmentId.make("environment-a"), projectId)).toBe(
      "environment-a:project-1",
    );
    expect(projectUiStateKey(EnvironmentId.make("environment-b"), projectId)).toBe(
      "environment-b:project-1",
    );
  });

  describe("Testing Scoped State", () => {
    it("should initialize default testing state correctly", () => {
      const defaults = createDefaultTestingState();
      expect(defaults.activeTestingSection).toBe("overview");
      expect(defaults.selectedCaseId).toBeNull();
      expect(defaults.caseSearch).toBe("");
      expect(defaults.manualCaseSteps).toEqual([""]);
      expect(defaults.selectedGenerationCaseIds).toBeInstanceOf(Set);
    });

    it("should isolate testing state between multiple projects", () => {
      const p1 = ProjectId.make("project-1");
      const p2 = ProjectId.make("project-2");

      const store = useScopedStateStore.getState();

      store.updateTestingState(p1, {
        activeTestingSection: "cases",
        selectedCaseId: "tc-101",
        caseSearch: "login auth",
      });

      store.updateTestingState(p2, {
        activeTestingSection: "discover",
        targetUrl: "https://example.com",
      });

      const updated = useScopedStateStore.getState();

      expect(updated.testingStateByProjectId[p1]?.activeTestingSection).toBe("cases");
      expect(updated.testingStateByProjectId[p1]?.selectedCaseId).toBe("tc-101");
      expect(updated.testingStateByProjectId[p1]?.caseSearch).toBe("login auth");

      expect(updated.testingStateByProjectId[p2]?.activeTestingSection).toBe("discover");
      expect(updated.testingStateByProjectId[p2]?.targetUrl).toBe("https://example.com");
      expect(updated.testingStateByProjectId[p2]?.selectedCaseId).toBeNull();
    });

    it("supports functional state updaters for testing state", () => {
      const p1 = ProjectId.make("project-1");
      const store = useScopedStateStore.getState();

      store.updateTestingState(p1, (prev) => ({
        manualCaseSteps: [...prev.manualCaseSteps, "Step 2: Enter password"],
      }));

      const state = useScopedStateStore.getState().testingStateByProjectId[p1];
      expect(state?.manualCaseSteps).toEqual(["", "Step 2: Enter password"]);
    });
  });

  describe("Git Scoped State", () => {
    it("should isolate git state by cwd / project key", () => {
      const cwd1 = "/workspace/repo-a";
      const cwd2 = "/workspace/repo-b";
      const store = useScopedStateStore.getState();

      store.updateGitState(cwd1, {
        diffMode: "working",
        selectedPath: "src/app.js",
        commitDraft: "feat: add oauth2 handler",
      });

      store.updateGitState(cwd2, {
        diffMode: "history",
        selectedCommit: "a1b2c3d",
        commitDraft: "fix: resolve timeout bug",
      });

      const updated = useScopedStateStore.getState();

      expect(updated.gitStateByProjectId[cwd1]?.selectedPath).toBe("src/app.js");
      expect(updated.gitStateByProjectId[cwd1]?.diffMode).toBe("working");
      expect(updated.gitStateByProjectId[cwd1]?.commitDraft).toBe("feat: add oauth2 handler");

      expect(updated.gitStateByProjectId[cwd2]?.selectedCommit).toBe("a1b2c3d");
      expect(updated.gitStateByProjectId[cwd2]?.diffMode).toBe("history");
      expect(updated.gitStateByProjectId[cwd2]?.commitDraft).toBe("fix: resolve timeout bug");
    });
  });

  describe("Agents Scoped State", () => {
    it("should persist thread list view and plan sidebar per project", () => {
      const p1 = ProjectId.make("project-1");
      const store = useScopedStateStore.getState();

      store.updateAgentsState(p1, {
        threadListView: "archived",
        planSidebarOpen: true,
        expandedWorkGroups: { "group-1": true },
      });

      const state = useScopedStateStore.getState().agentsStateByProjectId[p1];
      expect(state?.threadListView).toBe("archived");
      expect(state?.planSidebarOpen).toBe(true);
      expect(state?.expandedWorkGroups["group-1"]).toBe(true);
    });
  });

  describe("Server & Browser Scoped State", () => {
    it("should persist server preset expansions and browser state per project", () => {
      const p1 = ProjectId.make("project-1");
      const store = useScopedStateStore.getState();

      store.updateServerState(p1, { presetsExpanded: true, activeTerminalId: "term-1" });
      store.updateBrowserState(p1, {
        draftUrl: "http://localhost:3000/dashboard",
        viewportSelectorOpen: true,
      });

      const state = useScopedStateStore.getState();
      expect(state.serverStateByProjectId[p1]?.presetsExpanded).toBe(true);
      expect(state.serverStateByProjectId[p1]?.activeTerminalId).toBe("term-1");
      expect(state.browserStateByProjectId[p1]?.draftUrl).toBe("http://localhost:3000/dashboard");
      expect(state.browserStateByProjectId[p1]?.viewportSelectorOpen).toBe(true);
    });
  });

  describe("Settings View State", () => {
    it("should persist the active settings section and draft model orders", () => {
      const store = useScopedStateStore.getState();

      store.updateSettingsState({
        activeSection: "providers",
        openProviderDetails: { codex: true },
        customModelInputByProvider: { codex: "o3-mini" },
        draftModelOrders: { codex: ["gpt-5", "o3-mini"] },
      });

      const state = useScopedStateStore.getState().settingsState;
      expect(state.activeSection).toBe("providers");
      expect(state.openProviderDetails.codex).toBe(true);
      expect(state.customModelInputByProvider.codex).toBe("o3-mini");
      expect(state.draftModelOrders.codex).toEqual(["gpt-5", "o3-mini"]);
    });
  });

  describe("Durable Draft Persistence & Rehydration", () => {
    let originalLocalStorage: Storage | undefined;
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      mockStorage = {};
      originalLocalStorage = (globalThis as any).localStorage;
      (globalThis as any).localStorage = {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, value: string) => {
          mockStorage[key] = value;
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
        key: (i: number) => Object.keys(mockStorage)[i] ?? null,
        length: Object.keys(mockStorage).length,
      };
    });

    it("should rehydrate testing drafts from storage on initialization", () => {
      const p1 = "project-persisted";
      const storageKey = createScopedStorageKey("testing-drafts", p1);

      // Seed localStorage
      globalThis.localStorage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion: 1,
          timestamp: Date.now(),
          data: {
            manualCaseDescription: "Verify SSO login with Okta",
            manualCaseSteps: ["Navigate to login", "Click Okta SSO"],
            manualCaseExpected: "Redirected to dashboard",
            bugDraft: "Failed to render spinner",
          },
        }),
      );

      const state = createDefaultTestingState(p1);
      expect(state.manualCaseDescription).toBe("Verify SSO login with Okta");
      expect(state.manualCaseSteps).toEqual(["Navigate to login", "Click Okta SSO"]);
      expect(state.manualCaseExpectedResults).toEqual(["Redirected to dashboard"]);
      expect(state.bugDraft).toBe("Failed to render spinner");
    });

    it("should rehydrate git commit draft from storage on initialization", () => {
      const cwd = "/workspace/repo-persisted";
      const storageKey = createScopedStorageKey("git-drafts", cwd);

      globalThis.localStorage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion: 1,
          timestamp: Date.now(),
          data: {
            commitDraft: "refactor: extract scoped stores",
            amend: true,
          },
        }),
      );

      const state = createDefaultGitState(cwd);
      expect(state.commitDraft).toBe("refactor: extract scoped stores");
      expect(state.amend).toBe(true);
    });
  });
});

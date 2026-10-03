import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectId } from "@tabs/contracts";
import { MasterDetailItem } from "./ui/master-detail";
import { useWorkspaceShellStore } from "../workspaceShellStore";
import { workspaceShellActions } from "../state/workspaceShell";
import {
  createCustomEmbedDrafts,
  createTerminalProcessDrafts,
  createServerPresetDrafts,
  createCustomEmbedToolId,
  createServerProcessToolId,
  isCustomEmbedDraftDirty,
  isServerProcessDraftDirty,
  updatePersistedEmbedPartition,
  updateEmbedDraftPartition,
  deletePersistedCustomEmbed,
  deletePersistedServerProcess,
  deletePersistedServerPreset,
  deleteCustomEmbedDraft,
  deleteServerProcessDraft,
  deleteServerPresetDraft,
  syncCustomEmbedDrafts,
  syncTerminalProcessDrafts,
  syncServerPresetDrafts,
  commitCustomEmbedDrafts,
  savePersistedCustomEmbed,
  commitSingleCustomEmbedDraft,
  resetSingleCustomEmbedDraft,
  savePersistedServerProcess,
  commitSingleServerProcessDraft,
  resetSingleServerProcessDraft,
  savePersistedServerPreset,
  commitSingleServerPresetDraft,
  resetSingleServerPresetDraft,
  getProjectWorkspaceDrafts,
  setProjectWorkspaceDrafts,
  clearProjectWorkspaceDrafts,
} from "./projectWorkspaceDrafts";

const { resetStorage } = vi.hoisted(() => {
  let storage: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  const testWindow = ((globalThis as any).window ??= {});
  Object.defineProperty(testWindow, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  testWindow.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  return {
    resetStorage: () => {
      storage = {};
    },
  };
});

describe("ProjectWorkspaceSettingsSection Integration & Boundary Contracts", () => {
  const projectIdA = "project-alpha" as ProjectId;
  const projectIdB = "project-beta" as ProjectId;

  beforeEach(() => {
    resetStorage();
    const initialSession = useWorkspaceShellStore.getInitialState().session;
    useWorkspaceShellStore.setState({
      session: {
        ...initialSession,
        openProjectIds: [projectIdA, projectIdB],
        activeProjectId: projectIdA,
        activeToolIdByProjectId: {
          [projectIdA]: "code",
          [projectIdB]: "code",
        },
      },
      projectSettingsByProjectId: {
        [projectIdA]: {
          tools: [
            { id: "code", kind: "code", label: "Code", visible: true },
            { id: "browser", kind: "browser", label: "Browser", visible: true },
            {
              id: "custom-embed-1",
              kind: "custom_embed",
              label: "Docs A",
              visible: true,
              customEmbedId: "embed-1",
            },
            {
              id: "custom-embed-2",
              kind: "custom_embed",
              label: "Metrics A",
              visible: true,
              customEmbedId: "embed-2",
            },
            {
              id: "terminal-proc-1",
              kind: "custom_process",
              label: "Terminal A1",
              visible: true,
              terminalProcessId: "proc-1",
            },
            {
              id: "terminal-proc-2",
              kind: "custom_process",
              label: "Terminal A2",
              visible: true,
              terminalProcessId: "proc-2",
            },
          ],
          browser: {
            defaultUrl: "http://localhost:3000",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "shared",
            partitionProfile: "",
          },
          customEmbeds: [
            {
              id: "embed-1",
              label: "Docs A",
              url: "https://docs.a.local",
              resumeLastVisitedPage: true,
              partitionMode: "shared",
              partitionProfile: "",
            },
            {
              id: "embed-2",
              label: "Metrics A",
              url: "https://metrics.a.local",
              resumeLastVisitedPage: true,
              partitionMode: "shared",
              partitionProfile: "",
            },
          ],
          terminalProcesses: [
            {
              id: "proc-1",
              label: "Terminal A1",
              commands: ["npm start"],
              cwd: "/app",
              env: {},
              autoStart: true,
            },
            {
              id: "proc-2",
              label: "Terminal A2",
              commands: ["npm test"],
              cwd: "/app",
              env: {},
              autoStart: false,
            },
          ],
          serverPresets: [
            {
              id: "preset-1",
              label: "Preset A1",
              commands: ["cargo run"],
              cwd: "/src",
              env: {},
              autoStart: true,
            },
            {
              id: "preset-2",
              label: "Preset A2",
              commands: ["cargo test"],
              cwd: "/src",
              env: {},
              autoStart: false,
            },
          ],
        },
        [projectIdB]: {
          tools: [
            { id: "code", kind: "code", label: "Code", visible: true },
            { id: "browser", kind: "browser", label: "Browser", visible: true },
            {
              id: "custom-embed-b1",
              kind: "custom_embed",
              label: "Docs B",
              visible: true,
              customEmbedId: "embed-b1",
            },
          ],
          browser: {
            defaultUrl: "http://localhost:8000",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "isolated",
            partitionProfile: "",
          },
          customEmbeds: [
            {
              id: "embed-b1",
              label: "Docs B",
              url: "https://docs.b.local",
              resumeLastVisitedPage: true,
              partitionMode: "isolated",
              partitionProfile: "",
            },
          ],
          terminalProcesses: [],
          serverPresets: [],
        },
      },
    });
  });

  it("Scenario 1: changing Tab B partition writes only Tab B partition to store and leaves Tab A dirty and uncommitted", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createCustomEmbedDrafts(settingsA);

    // Edit Tab 1
    drafts[0] = { ...drafts[0]!, label: "Docs A (Dirty)", url: "https://dirty.local" };
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);

    // User changes Tab 2's partition to profile "Work"
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      updatePersistedEmbedPartition(current, "embed-2", "profile", "Work"),
    );
    drafts = updateEmbedDraftPartition(drafts, "embed-2", "profile", "Work");

    // Verify store has only Tab 2 updated
    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    const persistedEmbed1 = persisted.customEmbeds.find((e) => e.id === "embed-1")!;
    const persistedEmbed2 = persisted.customEmbeds.find((e) => e.id === "embed-2")!;

    expect(persistedEmbed1.label).toBe("Docs A"); // NOT dirty label!
    expect(persistedEmbed1.url).toBe("https://docs.a.local"); // NOT dirty url!
    expect(persistedEmbed2.partitionMode).toBe("profile");
    expect(persistedEmbed2.partitionProfile).toBe("Work");

    // Local draft Tab 1 remains dirty
    expect(drafts[0]!.label).toBe("Docs A (Dirty)");
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);
    expect(isCustomEmbedDraftDirty(drafts[1]!)).toBe(false);

    // Store sync effect preserves Tab 1's dirty draft
    const synced = syncCustomEmbedDrafts(drafts, persisted);
    expect(synced[0]!.label).toBe("Docs A (Dirty)");
    expect(isCustomEmbedDraftDirty(synced[0]!)).toBe(true);
  });

  it("Scenario 2: deleting Tab B removes B from store and drafts while preserving Tab A's dirty draft", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createCustomEmbedDrafts(settingsA);

    drafts[0] = { ...drafts[0]!, label: "In Progress Tab A" };
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);

    // Delete Tab 2
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      deletePersistedCustomEmbed(current, "embed-2"),
    );
    drafts = deleteCustomEmbedDraft(drafts, "embed-2");

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    expect(persisted.customEmbeds.map((e) => e.id)).toEqual(["embed-1"]);
    expect(persisted.customEmbeds[0]!.label).toBe("Docs A"); // Store NOT overwritten with draft label
    expect(persisted.tools.some((t) => t.id === createCustomEmbedToolId("embed-2"))).toBe(false);

    expect(drafts.map((d) => d.id)).toEqual(["embed-1"]);
    expect(drafts[0]!.label).toBe("In Progress Tab A");
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);
  });

  it("Scenario 3: deleting Terminal Tab B removes B from store while preserving Terminal Tab A's dirty draft", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createTerminalProcessDrafts(settingsA);

    drafts[0] = { ...drafts[0]!, cwd: "/dirty/cwd" };
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);

    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      deletePersistedServerProcess(current, "proc-2"),
    );
    drafts = deleteServerProcessDraft(drafts, "proc-2");

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    expect(persisted.terminalProcesses.map((p) => p.id)).toEqual(["proc-1"]);
    expect(persisted.terminalProcesses[0]!.cwd).toBe("/app");
    expect(persisted.tools.some((t) => t.id === createServerProcessToolId("proc-2"))).toBe(false);

    expect(drafts[0]!.cwd).toBe("/dirty/cwd");
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);
  });

  it("Scenario 4: deleting Server Preset B removes B from store while preserving Server Preset A's dirty draft", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createServerPresetDrafts(settingsA);

    drafts[0] = { ...drafts[0]!, commands: ["cargo watch -x run"] };
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);

    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      deletePersistedServerPreset(current, "preset-2"),
    );
    drafts = deleteServerPresetDraft(drafts, "preset-2");

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    expect(persisted.serverPresets.map((p) => p.id)).toEqual(["preset-1"]);
    expect(persisted.serverPresets[0]!.commands).toEqual(["cargo run"]);

    expect(drafts[0]!.commands).toEqual(["cargo watch -x run"]);
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);
  });

  it("Scenario 5: toolbar reorder updates tools in store without clobbering dirty drafts", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let embedDrafts = createCustomEmbedDrafts(settingsA);
    let termDrafts = createTerminalProcessDrafts(settingsA);
    let presetDrafts = createServerPresetDrafts(settingsA);

    embedDrafts[0] = { ...embedDrafts[0]!, label: "Dirty Embed" };
    termDrafts[0] = { ...termDrafts[0]!, label: "Dirty Term" };
    presetDrafts[0] = { ...presetDrafts[0]!, label: "Dirty Preset" };

    // Reorder tools in store
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) => ({
      ...current,
      tools: [...current.tools].reverse(),
    }));

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    embedDrafts = syncCustomEmbedDrafts(embedDrafts, persisted);
    termDrafts = syncTerminalProcessDrafts(termDrafts, persisted);
    presetDrafts = syncServerPresetDrafts(presetDrafts, persisted);

    expect(embedDrafts.find((e) => e.id === "embed-1")?.label).toBe("Dirty Embed");
    expect(isCustomEmbedDraftDirty(embedDrafts.find((e) => e.id === "embed-1")!)).toBe(true);

    expect(termDrafts.find((t) => t.id === "proc-1")?.label).toBe("Dirty Term");
    expect(isServerProcessDraftDirty(termDrafts.find((t) => t.id === "proc-1")!)).toBe(true);

    expect(presetDrafts.find((p) => p.id === "preset-1")?.label).toBe("Dirty Preset");
    expect(isServerProcessDraftDirty(presetDrafts.find((p) => p.id === "preset-1")!)).toBe(true);
  });

  it("Scenario 6: toolbar visibility toggle in store does not reset drafts", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let embedDrafts = createCustomEmbedDrafts(settingsA);

    embedDrafts[0] = { ...embedDrafts[0]!, url: "https://edited-tab.com" };

    // Toggle visibility of code tool
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) => ({
      ...current,
      tools: current.tools.map((t) => (t.id === "code" ? { ...t, visible: false } : t)),
    }));

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    embedDrafts = syncCustomEmbedDrafts(embedDrafts, persisted);

    expect(embedDrafts[0]!.url).toBe("https://edited-tab.com");
    expect(isCustomEmbedDraftDirty(embedDrafts[0]!)).toBe(true);
  });

  it("Scenario 7: saving default browser settings in store does not reset custom drafts", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let embedDrafts = createCustomEmbedDrafts(settingsA);

    embedDrafts[0] = { ...embedDrafts[0]!, label: "My Tab Draft" };

    workspaceShellActions.upsertProjectSettings(projectIdA, (current) => ({
      ...current,
      browser: { ...current.browser, defaultUrl: "https://newdefault.com" },
    }));

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    embedDrafts = syncCustomEmbedDrafts(embedDrafts, persisted);

    expect(embedDrafts[0]!.label).toBe("My Tab Draft");
    expect(isCustomEmbedDraftDirty(embedDrafts[0]!)).toBe(true);
  });

  it("Scenario 8: switching active project loads destination drafts and does not leak drafts across projects", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let draftsA = createCustomEmbedDrafts(settingsA);
    draftsA[0] = { ...draftsA[0]!, label: "Project A In-Progress Tab" };

    // Switch active project to project B
    workspaceShellActions.setActiveProject(projectIdB);
    const settingsB = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdB]!;

    // Drafts for Project B must be loaded from Project B settings, NOT leaking draftsA
    const draftsB = createCustomEmbedDrafts(settingsB);
    expect(draftsB.length).toBe(1);
    expect(draftsB[0]!.id).toBe("embed-b1");
    expect(draftsB[0]!.label).toBe("Docs B");
    expect(draftsB.some((d) => d.label === "Project A In-Progress Tab")).toBe(false);
  });

  it("Scenario 9: explicit collection-level save persists all drafts and clears dirty state", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createCustomEmbedDrafts(settingsA);

    drafts[0] = { ...drafts[0]!, label: "Explicitly Saved Docs" };
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);

    // Save collection
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) => ({
      ...current,
      customEmbeds: drafts.map((d) => ({
        id: d.id,
        label: d.label,
        url: d.url,
        resumeLastVisitedPage: d.resumeLastVisitedPage,
        partitionMode: d.partitionMode,
        partitionProfile: d.partitionProfile,
      })),
    }));
    drafts = commitCustomEmbedDrafts(drafts);

    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(false);
    expect(drafts[0]!.originalLabel).toBe("Explicitly Saved Docs");

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    expect(persisted.customEmbeds[0]!.label).toBe("Explicitly Saved Docs");
  });

  it("Scenario 10: MasterDetailItem renders accessible sr-only text for unsaved indicator", () => {
    const htmlUnsaved = renderToStaticMarkup(
      <MasterDetailItem label="My Test Tab" isActive={true} isUnsaved={true} onSelect={() => {}} />,
    );
    expect(htmlUnsaved).toContain("sr-only");
    expect(htmlUnsaved).toContain("(unsaved changes)");

    const htmlClean = renderToStaticMarkup(
      <MasterDetailItem
        label="My Clean Tab"
        isActive={true}
        isUnsaved={false}
        onSelect={() => {}}
      />,
    );
    expect(htmlClean).not.toContain("(unsaved changes)");
  });

  it("Scenario 11: single-entity custom embed save does not commit dirty edits on other embeds", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createCustomEmbedDrafts(settingsA);
    expect(drafts.length).toBe(2);

    // Edit Tab 1 and Tab 2
    drafts[0] = { ...drafts[0]!, label: "Dirty Tab 1" };
    drafts[1] = { ...drafts[1]!, label: "Dirty Tab 2" };
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);
    expect(isCustomEmbedDraftDirty(drafts[1]!)).toBe(true);

    // Save ONLY Tab 2
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      savePersistedCustomEmbed(current, drafts[1]!),
    );
    drafts = commitSingleCustomEmbedDraft(drafts, drafts[1]!.id);

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    // Tab 2 should be persisted in store
    expect(persisted.customEmbeds.find((e) => e.id === "embed-2")?.label).toBe("Dirty Tab 2");
    // Tab 1 must NOT be persisted (retains original persisted label)
    expect(persisted.customEmbeds.find((e) => e.id === "embed-1")?.label).toBe("Docs A");

    // Tab 2 draft is clean, Tab 1 draft remains dirty
    expect(isCustomEmbedDraftDirty(drafts[1]!)).toBe(false);
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);
    expect(drafts[0]!.label).toBe("Dirty Tab 1");
  });

  it("Scenario 12: single-entity cancel resets only target embed, preserving dirty edits on other embeds", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createCustomEmbedDrafts(settingsA);

    drafts[0] = { ...drafts[0]!, label: "Dirty Tab 1" };
    drafts[1] = { ...drafts[1]!, label: "Dirty Tab 2" };

    // Reset ONLY Tab 1
    drafts = resetSingleCustomEmbedDraft(drafts, drafts[0]!.id, settingsA);

    // Tab 1 is reset back to original
    expect(drafts[0]!.label).toBe("Docs A");
    expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(false);

    // Tab 2 remains dirty!
    expect(drafts[1]!.label).toBe("Dirty Tab 2");
    expect(isCustomEmbedDraftDirty(drafts[1]!)).toBe(true);
  });

  it("Scenario 13: single-entity server process save and reset transactional isolation", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createTerminalProcessDrafts(settingsA);
    expect(drafts.length).toBe(2);

    drafts[0] = { ...drafts[0]!, label: "Dirty Proc 1" };
    drafts[1] = { ...drafts[1]!, label: "Dirty Proc 2" };

    // Save Proc 2 only
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      savePersistedServerProcess(current, drafts[1]!),
    );
    drafts = commitSingleServerProcessDraft(drafts, drafts[1]!.id);

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    expect(persisted.terminalProcesses.find((p) => p.id === "proc-2")?.label).toBe("Dirty Proc 2");
    expect(persisted.terminalProcesses.find((p) => p.id === "proc-1")?.label).toBe("Terminal A1");

    expect(isServerProcessDraftDirty(drafts[1]!)).toBe(false);
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);

    // Reset Proc 1 only
    drafts = resetSingleServerProcessDraft(drafts, drafts[0]!.id, persisted);
    expect(drafts[0]!.label).toBe("Terminal A1");
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(false);
  });

  it("Scenario 14: single-entity server preset save and reset transactional isolation", () => {
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let drafts = createServerPresetDrafts(settingsA);
    expect(drafts.length).toBe(2);

    drafts[0] = { ...drafts[0]!, label: "Dirty Preset 1" };
    drafts[1] = { ...drafts[1]!, label: "Dirty Preset 2" };

    // Save Preset 2 only
    workspaceShellActions.upsertProjectSettings(projectIdA, (current) =>
      savePersistedServerPreset(current, drafts[1]!),
    );
    drafts = commitSingleServerPresetDraft(drafts, drafts[1]!.id);

    const persisted = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    expect(persisted.serverPresets.find((p) => p.id === "preset-2")?.label).toBe("Dirty Preset 2");
    expect(persisted.serverPresets.find((p) => p.id === "preset-1")?.label).toBe("Preset A1");

    expect(isServerProcessDraftDirty(drafts[1]!)).toBe(false);
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);

    // Reset Preset 1 only
    drafts = resetSingleServerPresetDraft(drafts, drafts[0]!.id, persisted);
    expect(drafts[0]!.label).toBe("Preset A1");
    expect(isServerProcessDraftDirty(drafts[0]!)).toBe(false);
  });

  it("Scenario 15: scoped project drafts cache retains dirty drafts on section change and restores them", () => {
    clearProjectWorkspaceDrafts();
    const settingsA = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectIdA]!;
    let embedDrafts = createCustomEmbedDrafts(settingsA);
    embedDrafts[0] = { ...embedDrafts[0]!, label: "In Progress Uncommitted Tab" };

    // Cache unmount snapshot
    setProjectWorkspaceDrafts(projectIdA, {
      customEmbedDrafts: embedDrafts,
      serverProcessDrafts: createTerminalProcessDrafts(settingsA),
      serverPresetDrafts: createServerPresetDrafts(settingsA),
      browserDefaultUrlDraft: "http://localhost:4000",
      resumeLastVisitedPageDraft: true,
      browserPartitionModeDraft: "shared",
      browserPartitionProfileDraft: "",
    });

    // Simulating returning to Workspace tab after navigating away
    const cached = getProjectWorkspaceDrafts(projectIdA);
    expect(cached).toBeDefined();
    const restoredDrafts = syncCustomEmbedDrafts(cached!.customEmbedDrafts, settingsA);

    expect(restoredDrafts[0]!.label).toBe("In Progress Uncommitted Tab");
    expect(isCustomEmbedDraftDirty(restoredDrafts[0]!)).toBe(true);
    expect(cached!.browserDefaultUrlDraft).toBe("http://localhost:4000");

    clearProjectWorkspaceDrafts(projectIdA);
    expect(getProjectWorkspaceDrafts(projectIdA)).toBeUndefined();
  });
});

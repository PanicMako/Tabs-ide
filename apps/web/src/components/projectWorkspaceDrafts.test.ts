import { describe, expect, it } from "vitest";
import type { ProjectWorkspaceSettings } from "@tabs/contracts/settings";
import {
  createCustomEmbedDrafts,
  createCustomEmbedToolId,
  createServerPresetDrafts,
  createServerProcessToolId,
  createTerminalProcessDrafts,
  deleteCustomEmbedDraft,
  deletePersistedCustomEmbed,
  deletePersistedServerPreset,
  deletePersistedServerProcess,
  deleteServerPresetDraft,
  deleteServerProcessDraft,
  isCustomEmbedDraftDirty,
  isServerProcessDraftDirty,
  syncCustomEmbedDrafts,
  syncServerPresetDrafts,
  syncTerminalProcessDrafts,
  updateEmbedDraftPartition,
  updatePersistedEmbedPartition,
  commitCustomEmbedDrafts,
  commitServerProcessDrafts,
  commitServerPresetDrafts,
} from "./projectWorkspaceDrafts";

function createMockSettings(): ProjectWorkspaceSettings {
  return {
    tools: [
      { id: "code", kind: "code", label: "Code", visible: true },
      { id: "browser", kind: "browser", label: "Browser", visible: true },
      {
        id: "custom-embed-1",
        kind: "custom_embed",
        label: "Docs",
        visible: true,
        customEmbedId: "embed-1",
      },
      {
        id: "custom-embed-2",
        kind: "custom_embed",
        label: "Metrics",
        visible: true,
        customEmbedId: "embed-2",
      },
      {
        id: "terminal-proc-1",
        kind: "custom_process",
        label: "Dev Server",
        visible: true,
        terminalProcessId: "proc-1",
      },
      {
        id: "terminal-proc-2",
        kind: "custom_process",
        label: "Worker",
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
        label: "Docs",
        url: "https://docs.local",
        resumeLastVisitedPage: true,
        partitionMode: "shared",
        partitionProfile: "",
        lastVisitedUrl: "https://docs.local/api",
      },
      {
        id: "embed-2",
        label: "Metrics",
        url: "https://metrics.local",
        resumeLastVisitedPage: true,
        partitionMode: "shared",
        partitionProfile: "",
      },
    ],
    terminalProcesses: [
      {
        id: "proc-1",
        label: "Dev Server",
        commands: ["npm run dev"],
        cwd: "/apps/web",
        env: {},
        autoStart: true,
      },
      {
        id: "proc-2",
        label: "Worker",
        commands: ["npm run worker"],
        cwd: "/apps/worker",
        env: {},
        autoStart: false,
      },
    ],
    serverPresets: [
      {
        id: "preset-1",
        label: "Frontend Dev",
        commands: ["npm start"],
        cwd: "/frontend",
        env: {},
        autoStart: true,
        previewUrl: "http://localhost:5173",
      },
      {
        id: "preset-2",
        label: "Backend Dev",
        commands: ["cargo run"],
        cwd: "/backend",
        env: {},
        autoStart: false,
      },
    ],
  };
}

describe("projectWorkspaceDrafts pure helpers", () => {
  describe("Scenario 1: Browser Tab Partition Isolation", () => {
    it("changing Tab B session partition leaves Tab A dirty and does not persist Tab A's edited label or URL", () => {
      const persisted = createMockSettings();
      let drafts = createCustomEmbedDrafts(persisted);

      // User edits Tab 1 (dirty)
      drafts[0] = {
        ...drafts[0]!,
        label: "Docs (Staging)",
        url: "https://staging.docs.local",
      };
      expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);
      expect(isCustomEmbedDraftDirty(drafts[1]!)).toBe(false);

      // User changes Tab 2's partition to profile "Work"
      const updatedPersisted = updatePersistedEmbedPartition(
        persisted,
        "embed-2",
        "profile",
        "Work",
      );
      const updatedDrafts = updateEmbedDraftPartition(drafts, "embed-2", "profile", "Work");

      // 1. Tab A is NOT persisted in storage
      const persistedEmbed1 = updatedPersisted.customEmbeds.find((e) => e.id === "embed-1")!;
      expect(persistedEmbed1.label).toBe("Docs");
      expect(persistedEmbed1.url).toBe("https://docs.local");
      expect(persistedEmbed1.lastVisitedUrl).toBe("https://docs.local/api"); // preserved!

      // 2. Tab B's partition is persisted in storage
      const persistedEmbed2 = updatedPersisted.customEmbeds.find((e) => e.id === "embed-2")!;
      expect(persistedEmbed2.partitionMode).toBe("profile");
      expect(persistedEmbed2.partitionProfile).toBe("Work");

      // 3. Tab A remains dirty in drafts with its edited label and URL
      expect(updatedDrafts[0]!.label).toBe("Docs (Staging)");
      expect(updatedDrafts[0]!.url).toBe("https://staging.docs.local");
      expect(isCustomEmbedDraftDirty(updatedDrafts[0]!)).toBe(true);

      // 4. Tab B's draft is updated with the saved partition baseline and remains clean
      expect(updatedDrafts[1]!.partitionMode).toBe("profile");
      expect(updatedDrafts[1]!.partitionProfile).toBe("Work");
      expect(isCustomEmbedDraftDirty(updatedDrafts[1]!)).toBe(false);

      // 5. When store triggers sync, Tab A's dirty draft is still preserved
      const syncedDrafts = syncCustomEmbedDrafts(updatedDrafts, updatedPersisted);
      expect(syncedDrafts[0]!.label).toBe("Docs (Staging)");
      expect(syncedDrafts[0]!.url).toBe("https://staging.docs.local");
      expect(isCustomEmbedDraftDirty(syncedDrafts[0]!)).toBe(true);
    });

    it("clears a stale named profile when the assignment changes to the default profile", () => {
      const persisted = createMockSettings();
      const withNamedProfile = updatePersistedEmbedPartition(
        persisted,
        "embed-2",
        "profile",
        "Work",
      );

      const withDefaultProfile = updatePersistedEmbedPartition(
        withNamedProfile,
        "embed-2",
        "profile",
        "",
      );

      const updatedEmbed = withDefaultProfile.customEmbeds.find((embed) => embed.id === "embed-2");
      expect(updatedEmbed?.partitionMode).toBe("profile");
      expect(updatedEmbed?.partitionProfile).toBeUndefined();
    });
  });

  describe("Scenario 2: Browser Tab Deletion Isolation", () => {
    it("editing Browser Tab A and deleting Tab B removes B while preserving A's unsaved draft", () => {
      const persisted = createMockSettings();
      let drafts = createCustomEmbedDrafts(persisted);

      // User edits Tab 1
      drafts[0] = {
        ...drafts[0]!,
        label: "Docs (Work in progress)",
      };
      expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);

      // User deletes Tab 2
      const updatedPersisted = deletePersistedCustomEmbed(persisted, "embed-2");
      const updatedDrafts = deleteCustomEmbedDraft(drafts, "embed-2");

      // Persisted checks
      expect(updatedPersisted.customEmbeds.map((e) => e.id)).toEqual(["embed-1"]);
      expect(updatedPersisted.customEmbeds[0]!.label).toBe("Docs"); // NOT "Docs (Work in progress)"
      expect(updatedPersisted.tools.some((t) => t.id === createCustomEmbedToolId("embed-2"))).toBe(
        false,
      );
      expect(updatedPersisted.tools.some((t) => t.id === createCustomEmbedToolId("embed-1"))).toBe(
        true,
      );

      // Drafts checks
      expect(updatedDrafts.map((d) => d.id)).toEqual(["embed-1"]);
      expect(updatedDrafts[0]!.label).toBe("Docs (Work in progress)");
      expect(isCustomEmbedDraftDirty(updatedDrafts[0]!)).toBe(true);

      // Sync preserves Tab 1's dirty draft
      const synced = syncCustomEmbedDrafts(updatedDrafts, updatedPersisted);
      expect(synced.map((d) => d.id)).toEqual(["embed-1"]);
      expect(synced[0]!.label).toBe("Docs (Work in progress)");
      expect(isCustomEmbedDraftDirty(synced[0]!)).toBe(true);
    });
  });

  describe("Scenario 3: Terminal Tab Deletion Isolation", () => {
    it("editing Terminal Tab A and deleting Terminal Tab B preserves A's draft", () => {
      const persisted = createMockSettings();
      let drafts = createTerminalProcessDrafts(persisted);

      // User edits Terminal 1
      drafts[0] = {
        ...drafts[0]!,
        commands: ["npm run dev:custom", "echo ready"],
        cwd: "/apps/web/new-path",
      };
      expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);

      // User deletes Terminal 2
      const updatedPersisted = deletePersistedServerProcess(persisted, "proc-2");
      const updatedDrafts = deleteServerProcessDraft(drafts, "proc-2");

      // Persisted checks
      expect(updatedPersisted.terminalProcesses.map((p) => p.id)).toEqual(["proc-1"]);
      expect(updatedPersisted.terminalProcesses[0]!.commands).toEqual(["npm run dev"]); // original preserved!
      expect(updatedPersisted.tools.some((t) => t.id === createServerProcessToolId("proc-2"))).toBe(
        false,
      );

      // Draft checks
      expect(updatedDrafts.map((d) => d.id)).toEqual(["proc-1"]);
      expect(updatedDrafts[0]!.commands).toEqual(["npm run dev:custom", "echo ready"]);
      expect(isServerProcessDraftDirty(updatedDrafts[0]!)).toBe(true);

      // Sync preserves Terminal 1's dirty draft
      const synced = syncTerminalProcessDrafts(updatedDrafts, updatedPersisted);
      expect(synced.map((d) => d.id)).toEqual(["proc-1"]);
      expect(synced[0]!.commands).toEqual(["npm run dev:custom", "echo ready"]);
      expect(isServerProcessDraftDirty(synced[0]!)).toBe(true);
    });
  });

  describe("Scenario 4: Server Preset Deletion Isolation", () => {
    it("editing Server Preset A and deleting Preset B preserves A's draft", () => {
      const persisted = createMockSettings();
      let drafts = createServerPresetDrafts(persisted);

      // User edits Preset 1
      drafts[0] = {
        ...drafts[0]!,
        label: "Frontend Dev (Vite 6)",
        previewUrl: "http://localhost:3001",
      };
      expect(isServerProcessDraftDirty(drafts[0]!)).toBe(true);

      // User deletes Preset 2
      const updatedPersisted = deletePersistedServerPreset(persisted, "preset-2");
      const updatedDrafts = deleteServerPresetDraft(drafts, "preset-2");

      // Persisted checks
      expect(updatedPersisted.serverPresets.map((p) => p.id)).toEqual(["preset-1"]);
      expect(updatedPersisted.serverPresets[0]!.label).toBe("Frontend Dev"); // original preserved!
      expect(updatedPersisted.serverPresets[0]!.previewUrl).toBe("http://localhost:5173");

      // Draft checks
      expect(updatedDrafts.map((d) => d.id)).toEqual(["preset-1"]);
      expect(updatedDrafts[0]!.label).toBe("Frontend Dev (Vite 6)");
      expect(isServerProcessDraftDirty(updatedDrafts[0]!)).toBe(true);

      // Sync preserves Preset 1's dirty draft
      const synced = syncServerPresetDrafts(updatedDrafts, updatedPersisted);
      expect(synced.map((d) => d.id)).toEqual(["preset-1"]);
      expect(synced[0]!.label).toBe("Frontend Dev (Vite 6)");
      expect(isServerProcessDraftDirty(synced[0]!)).toBe(true);
    });
  });

  describe("Scenario 5: Reordering toolbar tools preserves drafts", () => {
    it("editing each draft type and reordering toolbar tools does not reset any drafts", () => {
      const persisted = createMockSettings();
      let embedDrafts = createCustomEmbedDrafts(persisted);
      let termDrafts = createTerminalProcessDrafts(persisted);
      let presetDrafts = createServerPresetDrafts(persisted);

      // Edit all three types
      embedDrafts[0] = { ...embedDrafts[0]!, label: "Edited Embed" };
      termDrafts[0] = { ...termDrafts[0]!, label: "Edited Terminal" };
      presetDrafts[0] = { ...presetDrafts[0]!, label: "Edited Preset" };

      expect(isCustomEmbedDraftDirty(embedDrafts[0]!)).toBe(true);
      expect(isServerProcessDraftDirty(termDrafts[0]!)).toBe(true);
      expect(isServerProcessDraftDirty(presetDrafts[0]!)).toBe(true);

      // Reorder toolbar tools: swap custom-embed-1 and custom-embed-2
      const reorderedTools = [
        persisted.tools[0]!,
        persisted.tools[1]!,
        persisted.tools[3]!, // embed-2
        persisted.tools[2]!, // embed-1
        persisted.tools[4]!,
        persisted.tools[5]!,
      ];
      const reorderedPersisted: ProjectWorkspaceSettings = {
        ...persisted,
        tools: reorderedTools,
      };

      // Synchronize with the updated persisted settings
      const syncedEmbeds = syncCustomEmbedDrafts(embedDrafts, reorderedPersisted);
      const syncedTerminals = syncTerminalProcessDrafts(termDrafts, reorderedPersisted);
      const syncedPresets = syncServerPresetDrafts(presetDrafts, reorderedPersisted);

      // Drafts must retain user edits!
      expect(syncedEmbeds.find((e) => e.id === "embed-1")?.label).toBe("Edited Embed");
      expect(isCustomEmbedDraftDirty(syncedEmbeds.find((e) => e.id === "embed-1")!)).toBe(true);

      expect(syncedTerminals.find((t) => t.id === "proc-1")?.label).toBe("Edited Terminal");
      expect(isServerProcessDraftDirty(syncedTerminals.find((t) => t.id === "proc-1")!)).toBe(true);

      expect(syncedPresets.find((p) => p.id === "preset-1")?.label).toBe("Edited Preset");
      expect(isServerProcessDraftDirty(syncedPresets.find((p) => p.id === "preset-1")!)).toBe(true);

      // Order of embeds should reflect the new tool rank
      expect(syncedEmbeds.map((e) => e.id)).toEqual(["embed-2", "embed-1"]);
    });
  });

  describe("Scenario 6: Toggling toolbar tool visibility preserves drafts", () => {
    it("editing each draft type and toggling another toolbar tool's visibility does not reset drafts", () => {
      const persisted = createMockSettings();
      let embedDrafts = createCustomEmbedDrafts(persisted);
      let termDrafts = createTerminalProcessDrafts(persisted);
      let presetDrafts = createServerPresetDrafts(persisted);

      embedDrafts[0] = { ...embedDrafts[0]!, url: "https://dirty-url.com" };
      termDrafts[0] = { ...termDrafts[0]!, commands: ["dirty command"] };
      presetDrafts[0] = { ...presetDrafts[0]!, autoStart: false };

      // Toggle tool visibility for Code tool in persisted settings
      const updatedPersisted: ProjectWorkspaceSettings = {
        ...persisted,
        tools: persisted.tools.map((t) => (t.id === "code" ? { ...t, visible: false } : t)),
      };

      const syncedEmbeds = syncCustomEmbedDrafts(embedDrafts, updatedPersisted);
      const syncedTerminals = syncTerminalProcessDrafts(termDrafts, updatedPersisted);
      const syncedPresets = syncServerPresetDrafts(presetDrafts, updatedPersisted);

      expect(syncedEmbeds[0]!.url).toBe("https://dirty-url.com");
      expect(isCustomEmbedDraftDirty(syncedEmbeds[0]!)).toBe(true);

      expect(syncedTerminals[0]!.commands).toEqual(["dirty command"]);
      expect(isServerProcessDraftDirty(syncedTerminals[0]!)).toBe(true);

      expect(syncedPresets[0]!.autoStart).toBe(false);
      expect(isServerProcessDraftDirty(syncedPresets[0]!)).toBe(true);
    });
  });

  describe("Scenario 7: Saving default Browser settings preserves drafts", () => {
    it("saving default browser settings does not reset custom embed, terminal, or preset drafts", () => {
      const persisted = createMockSettings();
      let embedDrafts = createCustomEmbedDrafts(persisted);
      let termDrafts = createTerminalProcessDrafts(persisted);
      let presetDrafts = createServerPresetDrafts(persisted);

      embedDrafts[0] = { ...embedDrafts[0]!, label: "In-Progress Tab" };
      termDrafts[0] = { ...termDrafts[0]!, cwd: "/custom/path" };
      presetDrafts[0] = { ...presetDrafts[0]!, previewUrl: "http://localhost:8080" };

      // Simulate saving default browser settings
      const updatedPersisted: ProjectWorkspaceSettings = {
        ...persisted,
        browser: {
          ...persisted.browser,
          defaultUrl: "https://google.com",
          partitionMode: "isolated",
        },
      };

      const syncedEmbeds = syncCustomEmbedDrafts(embedDrafts, updatedPersisted);
      const syncedTerminals = syncTerminalProcessDrafts(termDrafts, updatedPersisted);
      const syncedPresets = syncServerPresetDrafts(presetDrafts, updatedPersisted);

      expect(syncedEmbeds[0]!.label).toBe("In-Progress Tab");
      expect(isCustomEmbedDraftDirty(syncedEmbeds[0]!)).toBe(true);

      expect(syncedTerminals[0]!.cwd).toBe("/custom/path");
      expect(isServerProcessDraftDirty(syncedTerminals[0]!)).toBe(true);

      expect(syncedPresets[0]!.previewUrl).toBe("http://localhost:8080");
      expect(isServerProcessDraftDirty(syncedPresets[0]!)).toBe(true);
    });
  });

  describe("Scenario 8: New draft preservation", () => {
    it("preserves newly added uncommitted drafts during synchronization", () => {
      const persisted = createMockSettings();
      const embedDrafts = createCustomEmbedDrafts(persisted);

      // User adds a new Browser Tab (isNew: true)
      const newDraft = {
        id: "embed-new-999",
        label: "Brand New Tab",
        url: "http://newtab.local",
        visible: true,
        resumeLastVisitedPage: true,
        partitionMode: "shared" as const,
        partitionProfile: "",
        isNew: true,
        originalLabel: "",
        originalUrl: "",
        originalVisible: true,
        originalResumeLastVisitedPage: true,
        originalPartitionMode: "shared" as const,
        originalPartitionProfile: "",
      };
      const draftsWithNew = [...embedDrafts, newDraft];

      // Store updates externally (e.g. tools reordered or another setting saved)
      const updatedPersisted = {
        ...persisted,
        browser: { ...persisted.browser, defaultUrl: "http://other.local" },
      };

      const synced = syncCustomEmbedDrafts(draftsWithNew, updatedPersisted);
      expect(synced.some((d) => d.id === "embed-new-999")).toBe(true);
      expect(synced.find((d) => d.id === "embed-new-999")?.label).toBe("Brand New Tab");
      expect(isCustomEmbedDraftDirty(synced.find((d) => d.id === "embed-new-999")!)).toBe(true);
    });
  });

  describe("Scenario 9: Collection-level Save and Cancel", () => {
    it("commitCustomEmbedDrafts updates baselines so drafts become clean", () => {
      const persisted = createMockSettings();
      let drafts = createCustomEmbedDrafts(persisted);

      drafts[0] = { ...drafts[0]!, label: "Newly Saved Label", url: "https://newurl.com" };
      expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);

      const committed = commitCustomEmbedDrafts(drafts);
      expect(committed[0]!.label).toBe("Newly Saved Label");
      expect(committed[0]!.originalLabel).toBe("Newly Saved Label");
      expect(committed[0]!.originalUrl).toBe("https://newurl.com");
      expect(isCustomEmbedDraftDirty(committed[0]!)).toBe(false);
    });

    it("commitServerProcessDrafts and commitServerPresetDrafts update baselines so drafts become clean", () => {
      const persisted = createMockSettings();
      let termDrafts = createTerminalProcessDrafts(persisted);
      let presetDrafts = createServerPresetDrafts(persisted);

      termDrafts[0] = { ...termDrafts[0]!, label: "Saved Terminal", commands: ["npm run build"] };
      presetDrafts[0] = {
        ...presetDrafts[0]!,
        label: "Saved Preset",
        previewUrl: "http://saved.local",
      };

      expect(isServerProcessDraftDirty(termDrafts[0]!)).toBe(true);
      expect(isServerProcessDraftDirty(presetDrafts[0]!)).toBe(true);

      const committedTerms = commitServerProcessDrafts(termDrafts);
      const committedPresets = commitServerPresetDrafts(presetDrafts);

      expect(committedTerms[0]!.originalLabel).toBe("Saved Terminal");
      expect(isServerProcessDraftDirty(committedTerms[0]!)).toBe(false);

      expect(committedPresets[0]!.originalLabel).toBe("Saved Preset");
      expect(committedPresets[0]!.originalPreviewUrl).toBe("http://saved.local");
      expect(isServerProcessDraftDirty(committedPresets[0]!)).toBe(false);
    });

    it("canceling restores drafts to persisted baseline", () => {
      const persisted = createMockSettings();
      let drafts = createCustomEmbedDrafts(persisted);

      drafts[0] = { ...drafts[0]!, label: "Discarded Draft" };
      expect(isCustomEmbedDraftDirty(drafts[0]!)).toBe(true);

      // Cancel: re-create from persisted
      const restored = createCustomEmbedDrafts(persisted);
      expect(restored[0]!.label).toBe("Docs");
      expect(isCustomEmbedDraftDirty(restored[0]!)).toBe(false);
    });
  });
});

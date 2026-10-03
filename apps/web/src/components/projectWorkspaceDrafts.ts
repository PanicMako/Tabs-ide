import type {
  BrowserPartitionMode,
  ProjectCustomEmbedDefinition,
  ProjectWorkspaceSettings,
} from "@tabs/contracts/settings";

export function createCustomEmbedToolId(embedId: string): string {
  return `custom-${embedId}`;
}

export function createServerProcessToolId(processId: string): string {
  return `terminal-${processId}`;
}

export interface CustomEmbedDraft {
  id: string;
  label: string;
  url: string;
  visible: boolean;
  resumeLastVisitedPage: boolean;
  partitionMode: BrowserPartitionMode;
  partitionProfile: string;
  isNew: boolean;
  originalLabel: string;
  originalUrl: string;
  originalVisible: boolean;
  originalResumeLastVisitedPage: boolean;
  originalPartitionMode: BrowserPartitionMode;
  originalPartitionProfile: string;
}

export interface ServerProcessDraft {
  id: string;
  label: string;
  icon?: string | undefined;
  commands: string[];
  cwd: string;
  autoStart: boolean;
  visible: boolean;
  isNew: boolean;
  originalLabel: string;
  originalIcon?: string | undefined;
  originalCommands: string[];
  originalCwd: string;
  originalAutoStart: boolean;
  originalVisible: boolean;
  previewUrl?: string | undefined;
  autoOpenPreview?: boolean | undefined;
  previewOpenTarget?: "in-app" | "external" | undefined;
  previewFocus?: boolean | undefined;
  dependsOn?: readonly string[] | undefined;
  originalPreviewUrl?: string | undefined;
  originalAutoOpenPreview?: boolean | undefined;
  originalPreviewOpenTarget?: "in-app" | "external" | undefined;
  originalPreviewFocus?: boolean | undefined;
  originalDependsOn?: readonly string[] | undefined;
}

export function isCustomEmbedDraftDirty(draft: CustomEmbedDraft): boolean {
  return (
    draft.isNew ||
    draft.label !== draft.originalLabel ||
    draft.url !== draft.originalUrl ||
    draft.visible !== draft.originalVisible ||
    draft.resumeLastVisitedPage !== draft.originalResumeLastVisitedPage ||
    draft.partitionMode !== draft.originalPartitionMode ||
    draft.partitionProfile !== draft.originalPartitionProfile
  );
}

export function isServerProcessDraftDirty(draft: ServerProcessDraft): boolean {
  return (
    draft.isNew ||
    draft.label !== draft.originalLabel ||
    draft.icon !== draft.originalIcon ||
    draft.cwd !== draft.originalCwd ||
    draft.autoStart !== draft.originalAutoStart ||
    draft.visible !== draft.originalVisible ||
    draft.previewUrl !== draft.originalPreviewUrl ||
    draft.autoOpenPreview !== draft.originalAutoOpenPreview ||
    draft.previewOpenTarget !== draft.originalPreviewOpenTarget ||
    draft.previewFocus !== draft.originalPreviewFocus ||
    JSON.stringify(draft.dependsOn) !== JSON.stringify(draft.originalDependsOn) ||
    draft.commands.length !== draft.originalCommands.length ||
    draft.commands.some((command, index) => command !== draft.originalCommands[index])
  );
}

export function createCustomEmbedDrafts(
  settings: ProjectWorkspaceSettings | null | undefined,
): CustomEmbedDraft[] {
  if (!settings) return [];
  const toolRank = new Map(
    (settings.tools ?? [])
      .filter((entry) => entry.kind === "custom_embed")
      .map((entry, index) => [entry.id, index]),
  );
  return [...(settings.customEmbeds ?? [])]
    .sort((a, b) => {
      const aRank = toolRank.get(createCustomEmbedToolId(a.id)) ?? Number.MAX_SAFE_INTEGER;
      const bRank = toolRank.get(createCustomEmbedToolId(b.id)) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    })
    .map((embed) => {
      const tool = (settings.tools ?? []).find(
        (entry) => entry.kind === "custom_embed" && entry.customEmbedId === embed.id,
      );
      return {
        id: embed.id,
        label: embed.label,
        url: embed.url,
        resumeLastVisitedPage: embed.resumeLastVisitedPage ?? true,
        partitionMode: embed.partitionMode ?? "shared",
        partitionProfile: embed.partitionProfile ?? "",
        visible: tool?.visible ?? true,
        isNew: false,
        originalLabel: embed.label,
        originalUrl: embed.url,
        originalResumeLastVisitedPage: embed.resumeLastVisitedPage ?? true,
        originalPartitionMode: embed.partitionMode ?? "shared",
        originalPartitionProfile: embed.partitionProfile ?? "",
        originalVisible: tool?.visible ?? true,
      };
    });
}

export function createTerminalProcessDrafts(
  settings: ProjectWorkspaceSettings | null | undefined,
): ServerProcessDraft[] {
  if (!settings) return [];
  const toolRank = new Map(
    (settings.tools ?? [])
      .filter((entry) => entry.kind === "custom_process")
      .map((entry, index) => [entry.id, index]),
  );
  return [...(settings.terminalProcesses ?? [])]
    .sort((a, b) => {
      const aRank = toolRank.get(createServerProcessToolId(a.id)) ?? Number.MAX_SAFE_INTEGER;
      const bRank = toolRank.get(createServerProcessToolId(b.id)) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    })
    .map((process) => {
      const tool = (settings.tools ?? []).find(
        (entry) => entry.kind === "custom_process" && entry.terminalProcessId === process.id,
      );
      return {
        id: process.id,
        label: process.label,
        commands: process.commands.length > 0 ? [...process.commands] : [""],
        cwd: process.cwd,
        autoStart: process.autoStart,
        visible: tool?.visible ?? true,
        isNew: false,
        originalLabel: process.label,
        originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
        originalCwd: process.cwd,
        originalAutoStart: process.autoStart,
        originalVisible: tool?.visible ?? true,
      };
    });
}

export function createServerPresetDrafts(
  settings: ProjectWorkspaceSettings | null | undefined,
): ServerProcessDraft[] {
  if (!settings) return [];
  return (settings.serverPresets ?? []).map((process) => {
    return {
      id: process.id,
      label: process.label,
      icon: process.icon,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      visible: true,
      isNew: false,
      originalLabel: process.label,
      originalIcon: process.icon,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: true,
      previewUrl: process.previewUrl,
      autoOpenPreview: process.autoOpenPreview,
      previewOpenTarget: process.previewOpenTarget,
      previewFocus: process.previewFocus,
      dependsOn: process.dependsOn,
      originalPreviewUrl: process.previewUrl,
      originalAutoOpenPreview: process.autoOpenPreview,
      originalPreviewOpenTarget: process.previewOpenTarget,
      originalPreviewFocus: process.previewFocus,
      originalDependsOn: process.dependsOn,
    };
  });
}

/**
 * Narrow update helper for browser partition/profile on persisted ProjectWorkspaceSettings.
 * Updates ONLY the specified embed without touching any other embeds or tool list.
 */
export function updatePersistedEmbedPartition(
  current: ProjectWorkspaceSettings,
  embedId: string,
  partitionMode: BrowserPartitionMode,
  partitionProfile?: string,
): ProjectWorkspaceSettings {
  const resolvedProfile = partitionMode === "profile" ? (partitionProfile ?? "").trim() : "";
  const nextCustomEmbeds = (current.customEmbeds ?? []).map((embed) => {
    if (embed.id !== embedId) return embed;
    const { partitionProfile: _previousPartitionProfile, ...embedWithoutPartitionProfile } = embed;
    const updated: ProjectCustomEmbedDefinition = {
      ...embedWithoutPartitionProfile,
      partitionMode,
      ...(resolvedProfile ? { partitionProfile: resolvedProfile } : {}),
    };
    return updated;
  });
  return {
    ...current,
    customEmbeds: nextCustomEmbeds,
  };
}

/**
 * Narrow draft baseline synchronization for partition changes.
 * Updates partitionMode and partitionProfile for the targeted draft and synchronizes
 * its saved baseline so only that field is marked saved, preserving dirty label/url.
 */
export function updateEmbedDraftPartition(
  drafts: CustomEmbedDraft[],
  embedId: string,
  partitionMode: BrowserPartitionMode,
  partitionProfile?: string,
): CustomEmbedDraft[] {
  const resolvedProfile = partitionMode === "profile" ? (partitionProfile ?? "").trim() : "";
  return drafts.map((entry) => {
    if (entry.id !== embedId) return entry;
    return {
      ...entry,
      partitionMode,
      partitionProfile: resolvedProfile,
      originalPartitionMode: partitionMode,
      originalPartitionProfile: resolvedProfile,
    };
  });
}

/**
 * Narrow deletion helper: removes ONLY the target custom embed and its corresponding tool
 * from persisted ProjectWorkspaceSettings. Unrelated embeds and their dirty fields are untouched.
 */
export function deletePersistedCustomEmbed(
  current: ProjectWorkspaceSettings,
  embedId: string,
): ProjectWorkspaceSettings {
  const toolId = createCustomEmbedToolId(embedId);
  return {
    ...current,
    customEmbeds: (current.customEmbeds ?? []).filter((entry) => entry.id !== embedId),
    tools: (current.tools ?? []).filter((tool) => tool.id !== toolId),
  };
}

/**
 * Narrow deletion helper: removes ONLY the target terminal process and its tool
 * from persisted ProjectWorkspaceSettings.
 */
export function deletePersistedServerProcess(
  current: ProjectWorkspaceSettings,
  processId: string,
): ProjectWorkspaceSettings {
  const toolId = createServerProcessToolId(processId);
  return {
    ...current,
    terminalProcesses: (current.terminalProcesses ?? []).filter((entry) => entry.id !== processId),
    tools: (current.tools ?? []).filter((tool) => tool.id !== toolId),
  };
}

/**
 * Narrow deletion helper: removes ONLY the target server preset from persisted settings.
 */
export function deletePersistedServerPreset(
  current: ProjectWorkspaceSettings,
  presetId: string,
): ProjectWorkspaceSettings {
  return {
    ...current,
    serverPresets: (current.serverPresets ?? []).filter((entry) => entry.id !== presetId),
  };
}

export function deleteCustomEmbedDraft(
  drafts: CustomEmbedDraft[],
  embedId: string,
): CustomEmbedDraft[] {
  return drafts.filter((entry) => entry.id !== embedId);
}

export function deleteServerProcessDraft(
  drafts: ServerProcessDraft[],
  processId: string,
): ServerProcessDraft[] {
  return drafts.filter((entry) => entry.id !== processId);
}

export function deleteServerPresetDraft(
  drafts: ServerProcessDraft[],
  presetId: string,
): ServerProcessDraft[] {
  return drafts.filter((entry) => entry.id !== presetId);
}

/**
 * Deterministically merges persisted customEmbeds into current drafts without
 * overwriting dirty drafts or losing in-progress new tabs.
 */
export function syncCustomEmbedDrafts(
  currentDrafts: CustomEmbedDraft[],
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): CustomEmbedDraft[] {
  if (!persistedSettings) {
    return currentDrafts;
  }
  const persistedEmbeds = persistedSettings.customEmbeds ?? [];
  const persistedTools = persistedSettings.tools ?? [];
  const toolRank = new Map(
    persistedTools
      .filter((entry) => entry.kind === "custom_embed")
      .map((entry, index) => [entry.id, index]),
  );

  const existingDraftsById = new Map(currentDrafts.map((draft) => [draft.id, draft]));
  const persistedIds = new Set(persistedEmbeds.map((e) => e.id));
  const merged: CustomEmbedDraft[] = [];

  for (const embed of persistedEmbeds) {
    const existingDraft = existingDraftsById.get(embed.id);
    const tool = persistedTools.find(
      (entry) => entry.kind === "custom_embed" && entry.customEmbedId === embed.id,
    );
    const persistedVisible = tool?.visible ?? true;

    if (existingDraft) {
      if (isCustomEmbedDraftDirty(existingDraft)) {
        // Preserve user's in-progress dirty edits
        const visibleEdited = existingDraft.visible !== existingDraft.originalVisible;
        const visible = visibleEdited ? existingDraft.visible : persistedVisible;
        const originalVisible = persistedVisible;

        const partitionModeEdited =
          existingDraft.partitionMode !== existingDraft.originalPartitionMode;
        const partitionProfileEdited =
          existingDraft.partitionProfile !== existingDraft.originalPartitionProfile;

        const partitionMode = partitionModeEdited
          ? existingDraft.partitionMode
          : (embed.partitionMode ?? "shared");
        const originalPartitionMode = embed.partitionMode ?? "shared";

        const partitionProfile = partitionProfileEdited
          ? existingDraft.partitionProfile
          : (embed.partitionProfile ?? "");
        const originalPartitionProfile = embed.partitionProfile ?? "";

        merged.push({
          ...existingDraft,
          visible,
          originalVisible,
          partitionMode,
          originalPartitionMode,
          partitionProfile,
          originalPartitionProfile,
        });
      } else {
        // Clean draft: fully update to latest persisted state
        merged.push({
          id: embed.id,
          label: embed.label,
          url: embed.url,
          resumeLastVisitedPage: embed.resumeLastVisitedPage ?? true,
          partitionMode: embed.partitionMode ?? "shared",
          partitionProfile: embed.partitionProfile ?? "",
          visible: persistedVisible,
          isNew: false,
          originalLabel: embed.label,
          originalUrl: embed.url,
          originalResumeLastVisitedPage: embed.resumeLastVisitedPage ?? true,
          originalPartitionMode: embed.partitionMode ?? "shared",
          originalPartitionProfile: embed.partitionProfile ?? "",
          originalVisible: persistedVisible,
        });
      }
    } else {
      // Embed added in persisted store not in local drafts
      merged.push({
        id: embed.id,
        label: embed.label,
        url: embed.url,
        resumeLastVisitedPage: embed.resumeLastVisitedPage ?? true,
        partitionMode: embed.partitionMode ?? "shared",
        partitionProfile: embed.partitionProfile ?? "",
        visible: persistedVisible,
        isNew: false,
        originalLabel: embed.label,
        originalUrl: embed.url,
        originalResumeLastVisitedPage: embed.resumeLastVisitedPage ?? true,
        originalPartitionMode: embed.partitionMode ?? "shared",
        originalPartitionProfile: embed.partitionProfile ?? "",
        originalVisible: persistedVisible,
      });
    }
  }

  // Preserve in-progress new drafts that have not yet been committed
  for (const draft of currentDrafts) {
    if (draft.isNew && !persistedIds.has(draft.id)) {
      merged.push(draft);
    }
  }

  // Sort by tool order
  return merged.sort((a, b) => {
    const aRank = toolRank.get(createCustomEmbedToolId(a.id)) ?? Number.MAX_SAFE_INTEGER;
    const bRank = toolRank.get(createCustomEmbedToolId(b.id)) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return 0;
  });
}

/**
 * Deterministically merges persisted terminal processes into current drafts without
 * overwriting dirty drafts or losing in-progress new terminals.
 */
export function syncTerminalProcessDrafts(
  currentDrafts: ServerProcessDraft[],
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): ServerProcessDraft[] {
  if (!persistedSettings) {
    return currentDrafts;
  }
  const persistedProcesses = persistedSettings.terminalProcesses ?? [];
  const persistedTools = persistedSettings.tools ?? [];
  const toolRank = new Map(
    persistedTools
      .filter((entry) => entry.kind === "custom_process")
      .map((entry, index) => [entry.id, index]),
  );

  const existingDraftsById = new Map(currentDrafts.map((draft) => [draft.id, draft]));
  const persistedIds = new Set(persistedProcesses.map((p) => p.id));
  const merged: ServerProcessDraft[] = [];

  for (const process of persistedProcesses) {
    const existingDraft = existingDraftsById.get(process.id);
    const tool = persistedTools.find(
      (entry) => entry.kind === "custom_process" && entry.terminalProcessId === process.id,
    );
    const persistedVisible = tool?.visible ?? true;

    if (existingDraft) {
      if (isServerProcessDraftDirty(existingDraft)) {
        const visibleEdited = existingDraft.visible !== existingDraft.originalVisible;
        const visible = visibleEdited ? existingDraft.visible : persistedVisible;
        const originalVisible = persistedVisible;

        merged.push({
          ...existingDraft,
          visible,
          originalVisible,
        });
      } else {
        merged.push({
          id: process.id,
          label: process.label,
          commands: process.commands.length > 0 ? [...process.commands] : [""],
          cwd: process.cwd,
          autoStart: process.autoStart,
          visible: persistedVisible,
          isNew: false,
          originalLabel: process.label,
          originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
          originalCwd: process.cwd,
          originalAutoStart: process.autoStart,
          originalVisible: persistedVisible,
        });
      }
    } else {
      merged.push({
        id: process.id,
        label: process.label,
        commands: process.commands.length > 0 ? [...process.commands] : [""],
        cwd: process.cwd,
        autoStart: process.autoStart,
        visible: persistedVisible,
        isNew: false,
        originalLabel: process.label,
        originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
        originalCwd: process.cwd,
        originalAutoStart: process.autoStart,
        originalVisible: persistedVisible,
      });
    }
  }

  for (const draft of currentDrafts) {
    if (draft.isNew && !persistedIds.has(draft.id)) {
      merged.push(draft);
    }
  }

  return merged.sort((a, b) => {
    const aRank = toolRank.get(createServerProcessToolId(a.id)) ?? Number.MAX_SAFE_INTEGER;
    const bRank = toolRank.get(createServerProcessToolId(b.id)) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return 0;
  });
}

/**
 * Deterministically merges persisted server presets into current drafts without
 * overwriting dirty drafts or losing in-progress new presets.
 */
export function syncServerPresetDrafts(
  currentDrafts: ServerProcessDraft[],
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): ServerProcessDraft[] {
  if (!persistedSettings) {
    return currentDrafts;
  }
  const persistedPresets = persistedSettings.serverPresets ?? [];
  const existingDraftsById = new Map(currentDrafts.map((draft) => [draft.id, draft]));
  const persistedIds = new Set(persistedPresets.map((p) => p.id));
  const merged: ServerProcessDraft[] = [];

  for (const preset of persistedPresets) {
    const existingDraft = existingDraftsById.get(preset.id);
    if (existingDraft) {
      if (isServerProcessDraftDirty(existingDraft)) {
        merged.push(existingDraft);
      } else {
        merged.push({
          id: preset.id,
          label: preset.label,
          commands: preset.commands.length > 0 ? [...preset.commands] : [""],
          cwd: preset.cwd,
          autoStart: preset.autoStart,
          visible: true,
          isNew: false,
          originalLabel: preset.label,
          originalCommands: preset.commands.length > 0 ? [...preset.commands] : [""],
          originalCwd: preset.cwd,
          originalAutoStart: preset.autoStart,
          originalVisible: true,
          previewUrl: preset.previewUrl,
          autoOpenPreview: preset.autoOpenPreview,
          previewOpenTarget: preset.previewOpenTarget,
          previewFocus: preset.previewFocus,
          dependsOn: preset.dependsOn,
          originalPreviewUrl: preset.previewUrl,
          originalAutoOpenPreview: preset.autoOpenPreview,
          originalPreviewOpenTarget: preset.previewOpenTarget,
          originalPreviewFocus: preset.previewFocus,
          originalDependsOn: preset.dependsOn,
        });
      }
    } else {
      merged.push({
        id: preset.id,
        label: preset.label,
        commands: preset.commands.length > 0 ? [...preset.commands] : [""],
        cwd: preset.cwd,
        autoStart: preset.autoStart,
        visible: true,
        isNew: false,
        originalLabel: preset.label,
        originalCommands: preset.commands.length > 0 ? [...preset.commands] : [""],
        originalCwd: preset.cwd,
        originalAutoStart: preset.autoStart,
        originalVisible: true,
        previewUrl: preset.previewUrl,
        autoOpenPreview: preset.autoOpenPreview,
        previewOpenTarget: preset.previewOpenTarget,
        previewFocus: preset.previewFocus,
        dependsOn: preset.dependsOn,
        originalPreviewUrl: preset.previewUrl,
        originalAutoOpenPreview: preset.autoOpenPreview,
        originalPreviewOpenTarget: preset.previewOpenTarget,
        originalPreviewFocus: preset.previewFocus,
        originalDependsOn: preset.dependsOn,
      });
    }
  }

  for (const draft of currentDrafts) {
    if (draft.isNew && !persistedIds.has(draft.id)) {
      merged.push(draft);
    }
  }

  return merged;
}

/**
 * Commits collection-level custom embed drafts to clean baseline state.
 */
export function commitCustomEmbedDrafts(drafts: CustomEmbedDraft[]): CustomEmbedDraft[] {
  return drafts.map((draft) => {
    const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled tab";
    const url = draft.url.trim();
    const partitionProfile = draft.partitionMode === "profile" ? draft.partitionProfile.trim() : "";
    return {
      ...draft,
      label,
      url,
      partitionProfile,
      isNew: false,
      originalLabel: label,
      originalUrl: url,
      originalVisible: draft.visible,
      originalResumeLastVisitedPage: draft.resumeLastVisitedPage,
      originalPartitionMode: draft.partitionMode,
      originalPartitionProfile: partitionProfile,
    };
  });
}

/**
 * Commits collection-level server process drafts to clean baseline state.
 */
export function commitServerProcessDrafts(drafts: ServerProcessDraft[]): ServerProcessDraft[] {
  return drafts.map((draft) => {
    const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal";
    return {
      ...draft,
      label,
      isNew: false,
      originalLabel: label,
      originalCommands: [...draft.commands],
      originalCwd: draft.cwd,
      originalAutoStart: draft.autoStart,
      originalVisible: draft.visible,
    };
  });
}

/**
 * Commits collection-level server preset drafts to clean baseline state.
 */
export function commitServerPresetDrafts(drafts: ServerProcessDraft[]): ServerProcessDraft[] {
  return drafts.map((draft) => {
    const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled preset";
    return {
      ...draft,
      label,
      isNew: false,
      originalLabel: label,
      originalIcon: draft.icon,
      originalCommands: [...draft.commands],
      originalCwd: draft.cwd,
      originalAutoStart: draft.autoStart,
      originalPreviewUrl: draft.previewUrl,
      originalAutoOpenPreview: draft.autoOpenPreview,
      originalPreviewOpenTarget: draft.previewOpenTarget,
      originalPreviewFocus: draft.previewFocus,
      originalDependsOn: draft.dependsOn,
    };
  });
}

/**
 * Persists ONLY a single custom embed draft to canonical ProjectWorkspaceSettings,
 * leaving all other customEmbeds and their uncommitted drafts untouched.
 */
export function savePersistedCustomEmbed(
  current: ProjectWorkspaceSettings,
  draft: CustomEmbedDraft,
): ProjectWorkspaceSettings {
  const toolId = createCustomEmbedToolId(draft.id);
  const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled tab";
  const url = draft.url.trim();
  const partitionProfile = draft.partitionMode === "profile" ? draft.partitionProfile.trim() : "";

  const existingEmbed = (current.customEmbeds ?? []).find((e) => e.id === draft.id);
  const updatedEmbed: ProjectCustomEmbedDefinition = {
    id: draft.id,
    label,
    url,
    resumeLastVisitedPage: draft.resumeLastVisitedPage,
    partitionMode: draft.partitionMode,
    ...(partitionProfile ? { partitionProfile } : {}),
    ...(existingEmbed?.lastVisitedUrl ? { lastVisitedUrl: existingEmbed.lastVisitedUrl } : {}),
  };

  const nextCustomEmbeds = existingEmbed
    ? (current.customEmbeds ?? []).map((e) => (e.id === draft.id ? updatedEmbed : e))
    : [...(current.customEmbeds ?? []), updatedEmbed];

  const existingTool = (current.tools ?? []).find((t) => t.id === toolId);
  const updatedTool = {
    id: toolId,
    kind: "custom_embed" as const,
    label,
    visible: draft.visible,
    customEmbedId: draft.id,
  };
  const nextTools = existingTool
    ? (current.tools ?? []).map((t) => (t.id === toolId ? updatedTool : t))
    : [...(current.tools ?? []), updatedTool];

  return {
    ...current,
    customEmbeds: nextCustomEmbeds,
    tools: nextTools,
  };
}

/**
 * Commits ONLY a single custom embed draft to clean baseline state.
 */
export function commitSingleCustomEmbedDraft(
  drafts: CustomEmbedDraft[],
  embedId: string,
): CustomEmbedDraft[] {
  return drafts.map((draft) => {
    if (draft.id !== embedId) return draft;
    const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled tab";
    const url = draft.url.trim();
    const partitionProfile = draft.partitionMode === "profile" ? draft.partitionProfile.trim() : "";
    return {
      ...draft,
      label,
      url,
      partitionProfile,
      isNew: false,
      originalLabel: label,
      originalUrl: url,
      originalVisible: draft.visible,
      originalResumeLastVisitedPage: draft.resumeLastVisitedPage,
      originalPartitionMode: draft.partitionMode,
      originalPartitionProfile: partitionProfile,
    };
  });
}

/**
 * Resets ONLY a single custom embed draft to its canonical persisted state,
 * removing it if it was newly created and never persisted.
 */
export function resetSingleCustomEmbedDraft(
  drafts: CustomEmbedDraft[],
  embedId: string,
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): CustomEmbedDraft[] {
  const canonical = (persistedSettings?.customEmbeds ?? []).find((e) => e.id === embedId);
  if (!canonical) {
    return drafts.filter((d) => d.id !== embedId);
  }
  return drafts.map((draft) => {
    if (draft.id !== embedId) return draft;
    return {
      ...draft,
      label: canonical.label,
      url: canonical.url,
      resumeLastVisitedPage: canonical.resumeLastVisitedPage ?? true,
      partitionMode: canonical.partitionMode ?? "shared",
      partitionProfile: canonical.partitionProfile ?? "",
      visible: draft.originalVisible,
      isNew: false,
      originalLabel: canonical.label,
      originalUrl: canonical.url,
      originalResumeLastVisitedPage: canonical.resumeLastVisitedPage ?? true,
      originalPartitionMode: canonical.partitionMode ?? "shared",
      originalPartitionProfile: canonical.partitionProfile ?? "",
    };
  });
}

/**
 * Persists ONLY a single server process draft to canonical ProjectWorkspaceSettings.
 */
export function savePersistedServerProcess(
  current: ProjectWorkspaceSettings,
  draft: ServerProcessDraft,
): ProjectWorkspaceSettings {
  const toolId = createServerProcessToolId(draft.id);
  const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal";
  const updatedProcess = {
    id: draft.id,
    label,
    commands: [...draft.commands],
    cwd: draft.cwd,
    env: {},
    autoStart: draft.autoStart,
  };
  const existingProcess = (current.terminalProcesses ?? []).find((p) => p.id === draft.id);
  const nextProcesses = existingProcess
    ? (current.terminalProcesses ?? []).map((p) => (p.id === draft.id ? updatedProcess : p))
    : [...(current.terminalProcesses ?? []), updatedProcess];

  const existingTool = (current.tools ?? []).find((t) => t.id === toolId);
  const updatedTool = {
    id: toolId,
    kind: "custom_process" as const,
    label,
    visible: draft.visible,
    terminalProcessId: draft.id,
  };
  const nextTools = existingTool
    ? (current.tools ?? []).map((t) => (t.id === toolId ? updatedTool : t))
    : [...(current.tools ?? []), updatedTool];

  return {
    ...current,
    terminalProcesses: nextProcesses,
    tools: nextTools,
  };
}

/**
 * Commits ONLY a single server process draft to clean baseline state.
 */
export function commitSingleServerProcessDraft(
  drafts: ServerProcessDraft[],
  processId: string,
): ServerProcessDraft[] {
  return drafts.map((draft) => {
    if (draft.id !== processId) return draft;
    const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal";
    return {
      ...draft,
      label,
      isNew: false,
      originalLabel: label,
      originalCommands: [...draft.commands],
      originalCwd: draft.cwd,
      originalAutoStart: draft.autoStart,
      originalVisible: draft.visible,
    };
  });
}

/**
 * Resets ONLY a single server process draft to its canonical persisted state.
 */
export function resetSingleServerProcessDraft(
  drafts: ServerProcessDraft[],
  processId: string,
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): ServerProcessDraft[] {
  const canonical = (persistedSettings?.terminalProcesses ?? []).find((p) => p.id === processId);
  if (!canonical) {
    return drafts.filter((d) => d.id !== processId);
  }
  return drafts.map((draft) => {
    if (draft.id !== processId) return draft;
    return {
      ...draft,
      label: canonical.label,
      commands: [...canonical.commands],
      cwd: canonical.cwd,
      autoStart: canonical.autoStart,
      visible: draft.originalVisible,
      isNew: false,
      originalLabel: canonical.label,
      originalCommands: [...canonical.commands],
      originalCwd: canonical.cwd,
      originalAutoStart: canonical.autoStart,
    };
  });
}

/**
 * Persists ONLY a single server preset draft to canonical ProjectWorkspaceSettings.
 */
export function savePersistedServerPreset(
  current: ProjectWorkspaceSettings,
  draft: ServerProcessDraft,
): ProjectWorkspaceSettings {
  const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled preset";
  const updatedPreset = {
    id: draft.id,
    label,
    commands: [...draft.commands],
    cwd: draft.cwd,
    env: {},
    autoStart: draft.autoStart,
    ...(draft.icon ? { icon: draft.icon } : {}),
    ...(draft.previewUrl ? { previewUrl: draft.previewUrl } : {}),
    ...(draft.autoOpenPreview !== undefined ? { autoOpenPreview: draft.autoOpenPreview } : {}),
    ...(draft.previewOpenTarget ? { previewOpenTarget: draft.previewOpenTarget } : {}),
    ...(draft.previewFocus !== undefined ? { previewFocus: draft.previewFocus } : {}),
    ...(draft.dependsOn ? { dependsOn: draft.dependsOn } : {}),
  };
  const existingPreset = (current.serverPresets ?? []).find((p) => p.id === draft.id);
  const nextPresets = existingPreset
    ? (current.serverPresets ?? []).map((p) => (p.id === draft.id ? updatedPreset : p))
    : [...(current.serverPresets ?? []), updatedPreset];

  return {
    ...current,
    serverPresets: nextPresets,
  };
}

/**
 * Commits ONLY a single server preset draft to clean baseline state.
 */
export function commitSingleServerPresetDraft(
  drafts: ServerProcessDraft[],
  presetId: string,
): ServerProcessDraft[] {
  return drafts.map((draft) => {
    if (draft.id !== presetId) return draft;
    const label = draft.label.trim().length > 0 ? draft.label.trim() : "Untitled preset";
    return {
      ...draft,
      label,
      isNew: false,
      originalLabel: label,
      originalIcon: draft.icon,
      originalCommands: [...draft.commands],
      originalCwd: draft.cwd,
      originalAutoStart: draft.autoStart,
      originalPreviewUrl: draft.previewUrl,
      originalAutoOpenPreview: draft.autoOpenPreview,
      originalPreviewOpenTarget: draft.previewOpenTarget,
      originalPreviewFocus: draft.previewFocus,
      originalDependsOn: draft.dependsOn,
    };
  });
}

/**
 * Resets ONLY a single server preset draft to its canonical persisted state.
 */
export function resetSingleServerPresetDraft(
  drafts: ServerProcessDraft[],
  presetId: string,
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): ServerProcessDraft[] {
  const canonical = (persistedSettings?.serverPresets ?? []).find((p) => p.id === presetId);
  if (!canonical) {
    return drafts.filter((d) => d.id !== presetId);
  }
  return drafts.map((draft) => {
    if (draft.id !== presetId) return draft;
    return {
      ...draft,
      label: canonical.label,
      commands: canonical.commands.length > 0 ? [...canonical.commands] : [""],
      cwd: canonical.cwd,
      autoStart: canonical.autoStart,
      previewUrl: canonical.previewUrl,
      autoOpenPreview: canonical.autoOpenPreview,
      previewOpenTarget: canonical.previewOpenTarget,
      previewFocus: canonical.previewFocus,
      dependsOn: canonical.dependsOn,
      isNew: false,
      originalLabel: canonical.label,
      originalCommands: canonical.commands.length > 0 ? [...canonical.commands] : [""],
      originalCwd: canonical.cwd,
      originalAutoStart: canonical.autoStart,
      originalPreviewUrl: canonical.previewUrl,
      originalAutoOpenPreview: canonical.autoOpenPreview,
      originalPreviewOpenTarget: canonical.previewOpenTarget,
      originalPreviewFocus: canonical.previewFocus,
      originalDependsOn: canonical.dependsOn,
    };
  });
}

export interface ProjectWorkspaceDraftSnapshot {
  customEmbedDrafts: CustomEmbedDraft[];
  serverProcessDrafts: ServerProcessDraft[];
  serverPresetDrafts: ServerProcessDraft[];
  browserDefaultUrlDraft: string;
  resumeLastVisitedPageDraft: boolean;
  browserPartitionModeDraft: BrowserPartitionMode;
  browserPartitionProfileDraft: string;
}

const projectWorkspaceDraftCache = new Map<string, ProjectWorkspaceDraftSnapshot>();

export function getProjectWorkspaceDrafts(
  projectId: string,
): ProjectWorkspaceDraftSnapshot | undefined {
  return projectWorkspaceDraftCache.get(projectId);
}

export function setProjectWorkspaceDrafts(
  projectId: string,
  snapshot: ProjectWorkspaceDraftSnapshot,
): void {
  projectWorkspaceDraftCache.set(projectId, snapshot);
}

export function clearProjectWorkspaceDrafts(projectId?: string): void {
  if (projectId) {
    projectWorkspaceDraftCache.delete(projectId);
  } else {
    projectWorkspaceDraftCache.clear();
  }
}

export function isProjectWorkspaceSnapshotDirty(
  snapshot: ProjectWorkspaceDraftSnapshot,
  persistedSettings: ProjectWorkspaceSettings | null | undefined,
): boolean {
  if (!persistedSettings) return false;
  const isBrowserDefaultUrlDirty =
    snapshot.browserDefaultUrlDraft !== (persistedSettings.browser?.defaultUrl ?? "");
  const isResumeLastVisitedPageDirty =
    snapshot.resumeLastVisitedPageDraft !==
    (persistedSettings.browser?.resumeLastVisitedPage ?? true);
  const isBrowserPartitionModeDirty =
    snapshot.browserPartitionModeDraft !== (persistedSettings.browser?.partitionMode ?? "shared");
  const isBrowserPartitionProfileDirty =
    snapshot.browserPartitionProfileDraft !== (persistedSettings.browser?.partitionProfile ?? "");
  const isBrowserDirty =
    isBrowserDefaultUrlDirty ||
    isResumeLastVisitedPageDirty ||
    isBrowserPartitionModeDirty ||
    isBrowserPartitionProfileDirty;

  const customEmbedsDirty =
    snapshot.customEmbedDrafts.some(isCustomEmbedDraftDirty) ||
    snapshot.customEmbedDrafts.length !== (persistedSettings.customEmbeds?.length ?? 0);
  const serverPresetsDirty =
    snapshot.serverPresetDrafts.some(isServerProcessDraftDirty) ||
    snapshot.serverPresetDrafts.length !== (persistedSettings.serverPresets?.length ?? 0);
  const serverProcessesDirty =
    snapshot.serverProcessDrafts.some(isServerProcessDraftDirty) ||
    snapshot.serverProcessDrafts.length !== (persistedSettings.terminalProcesses?.length ?? 0);

  return isBrowserDirty || customEmbedsDirty || serverPresetsDirty || serverProcessesDirty;
}

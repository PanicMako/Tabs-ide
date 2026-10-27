import { useInstalledExtensions, refreshExtensions } from "../state/extensions";
import {
  mergeExtensionToolbarTools,
  preserveUnavailableExtensionTools,
} from "../extensionToolbarTools";
import { InstalledExtensionToolIcon } from "./InstalledExtensionToolIcon";
import { OrbitGroup } from "./ui/orbit-group";
import { type BrowserPartitionMode } from "@tabs/contracts/settings";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDownIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
  InfoIcon,
  LockIcon,
  CheckIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MasterDetail,
  MasterDetailContent,
  MasterDetailItem,
  MasterDetailList,
  MasterDetailSidebar,
} from "./ui/master-detail";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { ServerPresetFormFields, resolvePresetIconElement } from "./ServerPresetFormFields";

import { projectsAtom } from "../state/threads";
import { useAtomValue } from "@effect/atom-react";
import { SettingsSectionHeader } from "./settings/SettingsLayout";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import type { BrowserProfileDefinition } from "@tabs/contracts/settings";
import type { ProjectIconOverride } from "@tabs/contracts";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProjectIconPickerDialog } from "./settings/ProjectIconPickerDialog";
import { ensureNativeApi } from "~/nativeApi";
import { newCommandId } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "./ui/dialog";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "./ui/menu";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { useConfirm } from "~/hooks/useConfirm";
import { Alert, AlertDescription } from "./ui/alert";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { toastManager } from "./ui/toast";
import { Separator } from "./ui/separator";
import { cn } from "../lib/utils";
import {
  useProjectWorkspaceSettings,
  useWorkspaceActiveProjectId,
  workspaceShellActions,
} from "../state/workspaceShell";
import { useWorkspaceAppearanceStore } from "../stores/workspaceAppearanceStore";
import { useSettingsViewState } from "~/state/scopedStateStore";
import { registerDraftSource, useSettingsDraftSource } from "../state/settingsDraftRegistry";
import {
  type CustomEmbedDraft,
  type ServerProcessDraft,
  type ProjectWorkspaceDraftSnapshot,
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
  isProjectWorkspaceSnapshotDirty,
} from "./projectWorkspaceDrafts";

export type { CustomEmbedDraft, ServerProcessDraft };

function createCustomEmbedId() {
  return `embed-${crypto.randomUUID()}`;
}

function createServerProcessId() {
  return `process-${crypto.randomUUID()}`;
}

function BrowserGoogleSignInGuidance() {
  return (
    <Alert className="border-blue-500/25 bg-blue-500/5 text-foreground">
      <InfoIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      <AlertDescription className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Google sign-in workaround:</span> Google may
        block a fresh third-party login inside an embedded browser. Choose Shared (Project), or
        assign both tabs to the same Named Profile, then sign in to Google through a tab such as
        Figma or YouTube. ChatGPT can reuse that existing Google session. The session is stored for
        future app restarts, although the website can expire it or request verification again.
      </AlertDescription>
    </Alert>
  );
}

function describeToolKind(kind: string) {
  switch (kind) {
    case "custom_embed":
      return "browser tab";
    case "custom_process":
      return "terminal tab";
    default:
      return kind;
  }
}

function BrowserProfileSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");

  const profiles: readonly BrowserProfileDefinition[] = useMemo(() => {
    const list = [
      ...(settings.browserProfiles ?? [
        { id: "personal", label: "Personal", color: "#3b82f6", createdAt: 0 },
        { id: "work", label: "Work", color: "#10b981", createdAt: 0 },
      ]),
    ];
    if (value && !list.some((p) => p.id === value)) {
      list.push({ id: value, label: value, color: "#6366f1", createdAt: 0 });
    }
    return list;
  }, [settings.browserProfiles, value]);

  const selectedProfile = profiles.find((p) => p.id === value) ?? profiles[0];

  const handleCreateNew = () => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) return;
    const newProfile: BrowserProfileDefinition = {
      id: slug,
      label: trimmed,
      color: newColor,
      createdAt: Date.now(),
    };
    updateSettings({ browserProfiles: [...profiles, newProfile] });
    onChange(slug);
    setModalOpen(false);
    setNewLabel("");
  };

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-[0.12em] shrink-0">
          Profile:
        </div>
        <Menu>
          <MenuTrigger className="flex items-center justify-between gap-2 h-8 px-2.5 min-w-[200px] max-w-xs rounded-md border border-input bg-background hover:bg-accent/40 text-foreground text-xs shadow-xs transition-colors cursor-pointer outline-none focus:ring-1 focus:ring-ring">
            <div className="flex items-center gap-2 truncate">
              <div
                className="size-3 rounded-full shrink-0 ring-1 ring-border"
                style={{ backgroundColor: selectedProfile?.color || "#3b82f6" }}
              />
              <span className="font-medium truncate">
                {selectedProfile?.label || "Select profile"}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono truncate">
                ({selectedProfile?.id})
              </span>
            </div>
            <ChevronDownIcon className="size-3.5 opacity-60 shrink-0" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-[240px]">
            {profiles.map((p) => {
              const isSelected = (value || selectedProfile?.id) === p.id;
              return (
                <MenuItem
                  key={p.id}
                  onClick={() => onChange(p.id)}
                  className="flex items-center justify-between text-xs py-1.5 px-2 cursor-pointer"
                >
                  <div className="flex items-center gap-2 truncate">
                    <div
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color || "#3b82f6" }}
                    />
                    <span className="font-medium truncate">{p.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">({p.id})</span>
                  </div>
                  {isSelected && <CheckIcon className="size-3.5 text-foreground shrink-0" />}
                </MenuItem>
              );
            })}
            <MenuSeparator />
            <MenuItem
              onClick={() => {
                setNewLabel("");
                setModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs text-foreground font-medium py-1.5 px-2 cursor-pointer"
            >
              <PlusIcon className="size-3.5" />
              <span>Create new profile...</span>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {/* Clean Create Profile Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <PlusIcon className="size-4 text-foreground" />
              New browser profile
            </DialogTitle>
            <DialogDescription className="text-xs">
              Keep a separate set of browser logins.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="space-y-4 py-2">
            <div>
              <label
                htmlFor="project-profile-name"
                className="text-xs font-medium text-muted-foreground block mb-1.5"
              >
                Name
              </label>
              <Input
                id="project-profile-name"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Work, Personal…"
                className="text-xs"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Color
              </label>
              <div className="flex items-center gap-2 pt-0.5">
                {["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"].map((c) => (
                  <button
                    key={c}
                    aria-label={`Profile color ${c}`}
                    aria-pressed={newColor === c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={cn(
                      "size-7 rounded-full transition-all cursor-pointer flex items-center justify-center ring-offset-2 ring-offset-background",
                      newColor === c
                        ? "ring-2 ring-primary scale-105"
                        : "hover:scale-105 opacity-80 hover:opacity-100",
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {newColor === c && <CheckIcon className="size-4 text-white drop-shadow-xs" />}
                  </button>
                ))}
              </div>
            </div>
          </DialogPanel>

          <DialogFooter variant="bare">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateNew} disabled={!newLabel.trim()}>
              Create Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Sortable wrapper for a toolbar-tool row. Provides the draggable node + drag
 * transform; the row renders its own drag handle via the `attributes`/`listeners`
 * passed to the render-prop child so the rest of the row stays interactive.
 */
function SortableToolRow({
  id,
  children,
}: {
  id: string;
  children: (handle: Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10")}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

export function ProjectWorkspaceSettingsSection() {
  const installedExtensions = useInstalledExtensions();
  const [extensionToggleBusy, setExtensionToggleBusy] = useState(false);
  const { confirmDialog } = useConfirm();
  const activeProjectId = useWorkspaceActiveProjectId();
  const activeProject = useAtomValue(projectsAtom, (state) =>
    activeProjectId ? (state.find((project) => project.id === activeProjectId) ?? null) : null,
  );
  const projectSettings = useProjectWorkspaceSettings(activeProjectId);
  const upsertProjectSettings = workspaceShellActions.upsertProjectSettings;
  const initialCached = activeProjectId ? getProjectWorkspaceDrafts(activeProjectId) : undefined;
  const [customEmbedDrafts, setCustomEmbedDrafts] = useState<CustomEmbedDraft[]>(() => {
    if (initialCached)
      return syncCustomEmbedDrafts(initialCached.customEmbedDrafts, projectSettings);
    return createCustomEmbedDrafts(projectSettings);
  });
  const [serverProcessDrafts, setServerProcessDrafts] = useState<ServerProcessDraft[]>(() => {
    if (initialCached)
      return syncTerminalProcessDrafts(initialCached.serverProcessDrafts, projectSettings);
    return createTerminalProcessDrafts(projectSettings);
  });

  const [browserDefaultUrlDraft, setBrowserDefaultUrlDraft] = useState<string>(
    () => initialCached?.browserDefaultUrlDraft ?? projectSettings?.browser?.defaultUrl ?? "",
  );
  const [resumeLastVisitedPageDraft, setResumeLastVisitedPageDraft] = useState<boolean>(
    () =>
      initialCached?.resumeLastVisitedPageDraft ??
      projectSettings?.browser?.resumeLastVisitedPage ??
      true,
  );
  const [browserPartitionModeDraft, setBrowserPartitionModeDraft] = useState<BrowserPartitionMode>(
    () =>
      initialCached?.browserPartitionModeDraft ??
      projectSettings?.browser?.partitionMode ??
      "shared",
  );
  const [browserPartitionProfileDraft, setBrowserPartitionProfileDraft] = useState<string>(
    () =>
      initialCached?.browserPartitionProfileDraft ??
      projectSettings?.browser?.partitionProfile ??
      "",
  );

  const [alwaysMinAgents, setAlwaysMinAgents] = useState<boolean>(() => {
    try {
      return window.localStorage?.getItem("tabs.alwaysMinimizeAgentsSidebar") === "true";
    } catch {
      return false;
    }
  });

  const [alwaysMinGit, setAlwaysMinGit] = useState<boolean>(() => {
    try {
      return window.localStorage?.getItem("tabs.alwaysMinimizeGitSidebar") === "true";
    } catch {
      return false;
    }
  });

  const handleToggleAlwaysMinAgents = (checked: boolean) => {
    setAlwaysMinAgents(checked);
    try {
      window.localStorage?.setItem("tabs.alwaysMinimizeAgentsSidebar", String(checked));
    } catch {}
  };

  const handleToggleAlwaysMinGit = (checked: boolean) => {
    setAlwaysMinGit(checked);
    try {
      window.localStorage?.setItem("tabs.alwaysMinimizeGitSidebar", String(checked));
    } catch {}
  };

  const isBrowserDefaultUrlDirty = projectSettings
    ? browserDefaultUrlDraft !== (projectSettings.browser?.defaultUrl ?? "")
    : false;
  const isResumeLastVisitedPageDirty = projectSettings
    ? resumeLastVisitedPageDraft !== (projectSettings.browser?.resumeLastVisitedPage ?? true)
    : false;
  const isBrowserPartitionModeDirty = projectSettings
    ? browserPartitionModeDraft !== (projectSettings.browser?.partitionMode ?? "shared")
    : false;
  const isBrowserPartitionProfileDirty = projectSettings
    ? browserPartitionProfileDraft !== (projectSettings.browser?.partitionProfile ?? "")
    : false;

  const isBrowserSettingsDirty =
    isBrowserDefaultUrlDirty ||
    isResumeLastVisitedPageDirty ||
    isBrowserPartitionModeDirty ||
    isBrowserPartitionProfileDirty;

  const [serverPresetDrafts, setServerPresetDrafts] = useState<ServerProcessDraft[]>(() => {
    if (initialCached)
      return syncServerPresetDrafts(initialCached.serverPresetDrafts, projectSettings);
    return createServerPresetDrafts(projectSettings);
  });
  const [settingsViewState, updateSettingsViewState] = useSettingsViewState();
  const projectIdKey = activeProjectId ?? "default";
  const projectMasterDetail = settingsViewState.projectWorkspaceMasterDetail[projectIdKey] ?? {
    activeSection: "tools",
    activeCustomEmbedId: null,
    activeServerProcessId: null,
    activeServerPresetId: null,
  };
  const activeCustomEmbedId = projectMasterDetail.activeCustomEmbedId;
  const setActiveCustomEmbedId = (id: string | null) => {
    updateSettingsViewState((prev) => ({
      projectWorkspaceMasterDetail: {
        ...prev.projectWorkspaceMasterDetail,
        [projectIdKey]: {
          ...(prev.projectWorkspaceMasterDetail[projectIdKey] ?? {
            activeSection: "tools",
            activeCustomEmbedId: null,
            activeServerProcessId: null,
            activeServerPresetId: null,
          }),
          activeCustomEmbedId: id,
        },
      },
    }));
  };
  const activeServerProcessId = projectMasterDetail.activeServerProcessId;
  const setActiveServerProcessId = (id: string | null) => {
    updateSettingsViewState((prev) => ({
      projectWorkspaceMasterDetail: {
        ...prev.projectWorkspaceMasterDetail,
        [projectIdKey]: {
          ...(prev.projectWorkspaceMasterDetail[projectIdKey] ?? {
            activeSection: "tools",
            activeCustomEmbedId: null,
            activeServerProcessId: null,
            activeServerPresetId: null,
          }),
          activeServerProcessId: id,
        },
      },
    }));
  };
  const activeServerPresetId = projectMasterDetail.activeServerPresetId;
  const setActiveServerPresetId = (id: string | null) => {
    updateSettingsViewState((prev) => ({
      projectWorkspaceMasterDetail: {
        ...prev.projectWorkspaceMasterDetail,
        [projectIdKey]: {
          ...(prev.projectWorkspaceMasterDetail[projectIdKey] ?? {
            activeSection: "tools",
            activeCustomEmbedId: null,
            activeServerProcessId: null,
            activeServerPresetId: null,
          }),
          activeServerPresetId: id,
        },
      },
    }));
  };

  const hasInternalBrowserOverride = serverPresetDrafts.some(
    (preset) =>
      preset.previewUrl && (!preset.previewOpenTarget || preset.previewOpenTarget === "in-app"),
  );

  const [pendingToggle, setPendingToggle] = useState<{
    toolId: string;
    toolLabel: string;
    toolKind: string;
    nextVisible: boolean;
  } | null>(null);

  const [tabToDeleteId, setTabToDeleteId] = useState<string | null>(null);
  const [terminalToDeleteId, setTerminalToDeleteId] = useState<string | null>(null);
  const [presetToDeleteId, setPresetToDeleteId] = useState<string | null>(null);

  const confirmToggle = useCallback(async () => {
    if (!pendingToggle || !activeProjectId) return;
    const { toolId, toolKind, nextVisible } = pendingToggle;
    if (toolKind === "extension") {
      const tool = mergeExtensionToolbarTools([], installedExtensions, activeProjectId, true).find(
        (entry) => entry.id === toolId,
      );
      const extension = installedExtensions.find((entry) => entry.id === tool?.extensionId);
      const bridge = window.desktopBridge;
      if (!extension || !bridge || extension.disabled || extension.revoked) return;
      setExtensionToggleBusy(true);
      try {
        const assignment = extension.assignment;
        await bridge.setExtensionAssignment(extension.id, {
          ...assignment,
          enabledProjectIds: nextVisible
            ? [...new Set([...assignment.enabledProjectIds, activeProjectId])]
            : assignment.enabledProjectIds.filter((id) => id !== activeProjectId),
          disabledProjectIds: nextVisible
            ? assignment.disabledProjectIds.filter((id) => id !== activeProjectId)
            : [...new Set([...assignment.disabledProjectIds, activeProjectId])],
        });
        upsertProjectSettings(activeProjectId, (current) => ({
          ...current,
          tools: preserveUnavailableExtensionTools(
            current.tools,
            mergeExtensionToolbarTools(
              current.tools,
              installedExtensions,
              activeProjectId,
              true,
            ).map((entry) =>
              entry.kind === "extension"
                ? {
                    ...entry,
                    visible:
                      entry.extensionId === extension.id
                        ? true
                        : (current.tools.find((saved) => saved.id === entry.id)?.visible ?? true),
                  }
                : entry,
            ),
          ),
        }));
        await refreshExtensions();
        setPendingToggle(null);
      } catch (error) {
        toastManager.add({
          title: "Could not update extension",
          description: error instanceof Error ? error.message : String(error),
          type: "error",
        });
      } finally {
        setExtensionToggleBusy(false);
      }
      return;
    }
    if (toolKind === "custom_embed") {
      setCustomEmbedDrafts((current) =>
        current.map((entry) =>
          createCustomEmbedToolId(entry.id) === toolId
            ? { ...entry, visible: nextVisible, originalVisible: nextVisible }
            : entry,
        ),
      );
    } else if (toolKind === "custom_process") {
      setServerProcessDrafts((current) =>
        current.map((entry) =>
          createServerProcessToolId(entry.id) === toolId
            ? { ...entry, visible: nextVisible, originalVisible: nextVisible }
            : entry,
        ),
      );
    }
    upsertProjectSettings(activeProjectId, (current) => ({
      ...current,
      tools: (current.tools ?? []).map((entry) =>
        entry.id === toolId ? { ...entry, visible: true } : entry,
      ),
    }));
    setPendingToggle(null);
  }, [activeProjectId, pendingToggle, upsertProjectSettings, installedExtensions]);

  const draftsRef = useRef<ProjectWorkspaceDraftSnapshot>({
    customEmbedDrafts,
    serverProcessDrafts,
    serverPresetDrafts,
    browserDefaultUrlDraft,
    resumeLastVisitedPageDraft,
    browserPartitionModeDraft,
    browserPartitionProfileDraft,
  });
  draftsRef.current = {
    customEmbedDrafts,
    serverProcessDrafts,
    serverPresetDrafts,
    browserDefaultUrlDraft,
    resumeLastVisitedPageDraft,
    browserPartitionModeDraft,
    browserPartitionProfileDraft,
  };

  const projectSettingsRef = useRef(projectSettings);
  projectSettingsRef.current = projectSettings;

  // Persist dirty drafts to cache upon unmount and ensure settings draft source reflects dirty state
  useEffect(() => {
    return () => {
      if (activeProjectId && projectSettingsRef.current) {
        const snapshot = draftsRef.current;
        if (isProjectWorkspaceSnapshotDirty(snapshot, projectSettingsRef.current)) {
          setProjectWorkspaceDrafts(activeProjectId, snapshot);
          registerDraftSource({ sourceId: "workspace", isDirty: true, label: "Workspace" });
        } else {
          clearProjectWorkspaceDrafts(activeProjectId);
        }
      }
    };
  }, [activeProjectId]);

  const prevProjectIdRef = useRef<string | null>(activeProjectId);

  useEffect(() => {
    if (!projectSettings || !activeProjectId) {
      prevProjectIdRef.current = activeProjectId;
      setCustomEmbedDrafts([]);
      setServerProcessDrafts([]);
      setServerPresetDrafts([]);
      return;
    }

    if (activeProjectId !== prevProjectIdRef.current) {
      if (prevProjectIdRef.current && projectSettingsRef.current) {
        const outgoingSnapshot = draftsRef.current;
        if (isProjectWorkspaceSnapshotDirty(outgoingSnapshot, projectSettingsRef.current)) {
          setProjectWorkspaceDrafts(prevProjectIdRef.current, outgoingSnapshot);
        } else {
          clearProjectWorkspaceDrafts(prevProjectIdRef.current);
        }
      }
      prevProjectIdRef.current = activeProjectId;

      const cached = getProjectWorkspaceDrafts(activeProjectId);
      if (cached) {
        setCustomEmbedDrafts(syncCustomEmbedDrafts(cached.customEmbedDrafts, projectSettings));
        setServerProcessDrafts(
          syncTerminalProcessDrafts(cached.serverProcessDrafts, projectSettings),
        );
        setServerPresetDrafts(syncServerPresetDrafts(cached.serverPresetDrafts, projectSettings));
        setBrowserDefaultUrlDraft(cached.browserDefaultUrlDraft);
        setResumeLastVisitedPageDraft(cached.resumeLastVisitedPageDraft);
        setBrowserPartitionModeDraft(cached.browserPartitionModeDraft);
        setBrowserPartitionProfileDraft(cached.browserPartitionProfileDraft);
      } else {
        setCustomEmbedDrafts(createCustomEmbedDrafts(projectSettings));
        setServerProcessDrafts(createTerminalProcessDrafts(projectSettings));
        setServerPresetDrafts(createServerPresetDrafts(projectSettings));
        setBrowserDefaultUrlDraft(projectSettings.browser?.defaultUrl ?? "");
        setResumeLastVisitedPageDraft(projectSettings.browser?.resumeLastVisitedPage ?? true);
        setBrowserPartitionModeDraft(projectSettings.browser?.partitionMode ?? "shared");
        setBrowserPartitionProfileDraft(projectSettings.browser?.partitionProfile ?? "");
      }
      return;
    }

    // Same project: sync external updates without clobbering dirty drafts
    if (!isBrowserDefaultUrlDirty) {
      setBrowserDefaultUrlDraft(projectSettings.browser?.defaultUrl ?? "");
    }
    if (!isResumeLastVisitedPageDirty) {
      setResumeLastVisitedPageDraft(projectSettings.browser?.resumeLastVisitedPage ?? true);
    }
    if (!isBrowserPartitionModeDirty) {
      setBrowserPartitionModeDraft(projectSettings.browser?.partitionMode ?? "shared");
    }
    if (!isBrowserPartitionProfileDirty) {
      setBrowserPartitionProfileDraft(projectSettings.browser?.partitionProfile ?? "");
    }
    setCustomEmbedDrafts((current) => syncCustomEmbedDrafts(current, projectSettings));
    setServerProcessDrafts((current) => syncTerminalProcessDrafts(current, projectSettings));
    setServerPresetDrafts((current) => syncServerPresetDrafts(current, projectSettings));
  }, [
    projectSettings,
    activeProjectId,
    isBrowserDefaultUrlDirty,
    isResumeLastVisitedPageDirty,
    isBrowserPartitionModeDirty,
    isBrowserPartitionProfileDirty,
  ]);

  const customEmbedsDirty = useMemo(
    () =>
      customEmbedDrafts.some(isCustomEmbedDraftDirty) ||
      customEmbedDrafts.length !== (projectSettings?.customEmbeds?.length ?? 0),
    [customEmbedDrafts, projectSettings?.customEmbeds],
  );

  const serverPresetsDirty = useMemo(
    () =>
      serverPresetDrafts.some(isServerProcessDraftDirty) ||
      serverPresetDrafts.length !== (projectSettings?.serverPresets?.length ?? 0),
    [serverPresetDrafts, projectSettings?.serverPresets],
  );

  const serverProcessesDirty = useMemo(
    () =>
      serverProcessDrafts.some(isServerProcessDraftDirty) ||
      serverProcessDrafts.length !== (projectSettings?.terminalProcesses?.length ?? 0),
    [serverProcessDrafts, projectSettings?.terminalProcesses],
  );

  const isWorkspaceDirty =
    isBrowserSettingsDirty || customEmbedsDirty || serverPresetsDirty || serverProcessesDirty;

  useSettingsDraftSource("workspace", isWorkspaceDirty, "Workspace");

  const toolbarPreviewTools = useMemo(() => {
    return mergeExtensionToolbarTools(
      projectSettings?.tools ?? [],
      installedExtensions,
      activeProjectId ?? "",
      true,
    ).filter((tool) => {
      if (tool.kind === "custom_embed") {
        return customEmbedDrafts.some((draft) => createCustomEmbedToolId(draft.id) === tool.id);
      }
      if (tool.kind === "custom_process") {
        return serverProcessDrafts.some((draft) => createServerProcessToolId(draft.id) === tool.id);
      }
      return true;
    });
  }, [
    projectSettings?.tools,
    customEmbedDrafts,
    serverProcessDrafts,
    installedExtensions,
    activeProjectId,
  ]);

  const visibleToolsCount = useMemo(
    () => toolbarPreviewTools.filter((tool) => tool.visible).length,
    [toolbarPreviewTools],
  );
  const dndSensors = useSensors(
    // Require a small drag distance so taps/clicks on the row still work.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const updatePresetRow = useCallback(
    (id: string, updater: (current: ServerProcessDraft) => ServerProcessDraft) => {
      setServerPresetDrafts((current) =>
        current.map((entry) => (entry.id === id ? updater(entry) : entry)),
      );
    },
    [],
  );

  const addCommandStep = useCallback((id: string) => {
    setServerPresetDrafts((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, commands: [...entry.commands, ""] } : entry,
      ),
    );
  }, []);

  const updateCommandStep = useCallback((id: string, commandIndex: number, command: string) => {
    setServerPresetDrafts((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              commands: entry.commands.map((step, stepIndex) =>
                stepIndex === commandIndex ? command : step,
              ),
            }
          : entry,
      ),
    );
  }, []);

  const moveCommandStep = useCallback((id: string, commandIndex: number, direction: -1 | 1) => {
    setServerPresetDrafts((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        const targetIndex = commandIndex + direction;
        if (targetIndex < 0 || targetIndex >= entry.commands.length) return entry;
        const nextCommands = [...entry.commands];
        const temp = nextCommands[commandIndex]!;
        nextCommands[commandIndex] = nextCommands[targetIndex]!;
        nextCommands[targetIndex] = temp;
        return { ...entry, commands: nextCommands };
      }),
    );
  }, []);

  const removeCommandStep = useCallback((id: string, commandIndex: number) => {
    setServerPresetDrafts((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              commands: entry.commands.filter((_, stepIndex) => stepIndex !== commandIndex),
            }
          : entry,
      ),
    );
  }, []);

  const showProjectTabIcons = useWorkspaceAppearanceStore((s) => s.showProjectTabIcons);
  const setShowProjectTabIcons = useWorkspaceAppearanceStore((s) => s.setShowProjectTabIcons);
  const projectTabIconOverrides = useWorkspaceAppearanceStore((s) => s.projectTabIconOverrides);
  const setProjectTabIconOverride = useWorkspaceAppearanceStore((s) => s.setProjectTabIconOverride);

  if (!activeProjectId || !activeProject || !projectSettings) {
    return (
      <section className="space-y-3">
        <SettingsSectionHeader
          title="Workspace"
          description="Configure tools and settings for your project."
        />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-sm font-semibold">Project Icons in Window Tabs</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Display project logos and icons next to project names in the top titlebar tabs by
                default across all projects (off by default).
              </CardDescription>
            </div>
            <Switch
              checked={showProjectTabIcons}
              onCheckedChange={setShowProjectTabIcons}
              aria-label="Toggle project icons in window tabs"
            />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>No active project</CardTitle>
            <CardDescription>
              Open or select a project tab first. These settings are persisted per project.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  const projectId = activeProjectId;
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const hasProjectIconOverride = projectTabIconOverrides[activeProject.id] !== undefined;
  const isProjectIconVisibleInTabs = hasProjectIconOverride
    ? projectTabIconOverrides[activeProject.id]!
    : showProjectTabIcons;

  const handleSelectIcon = async (icon: ProjectIconOverride) => {
    try {
      const api = ensureNativeApi();
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: activeProject.id,
        projectIcon: icon,
        faviconPath: null,
      });
      toastManager.add({
        title: "Project icon updated",
        type: "success",
      });
    } catch (err) {
      toastManager.add({
        title: "Failed to update project icon",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    }
  };

  const handleResetIcon = async () => {
    try {
      const api = ensureNativeApi();
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: activeProject.id,
        projectIcon: null,
        faviconPath: null,
      });
      toastManager.add({
        title: "Project icon reset to automatic",
        type: "success",
      });
    } catch (err) {
      toastManager.add({
        title: "Failed to reset project icon",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    }
  };

  // Drag-to-reorder the toolbar tools. The preview list is a merge of saved
  // tools and (when edited) draft custom tabs/terminals, so persist the new
  // order to both the saved tool list and the draft arrays by rank.
  const handleReorderTools = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = toolbarPreviewTools.map((tool) => tool.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const rank = new Map(arrayMove(ids, from, to).map((id, position) => [id, position]));
    const rankOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
    upsertProjectSettings(projectId, (current) => ({
      ...current,
      tools: preserveUnavailableExtensionTools(
        current.tools,
        toolbarPreviewTools.map((tool) =>
          tool.kind === "extension"
            ? {
                ...tool,
                visible: current.tools.find((saved) => saved.id === tool.id)?.visible ?? true,
              }
            : tool,
        ),
      ).sort((a, b) => rankOf(a.id) - rankOf(b.id)),
    }));
    setCustomEmbedDrafts((current) =>
      [...current].sort(
        (a, b) => rankOf(createCustomEmbedToolId(a.id)) - rankOf(createCustomEmbedToolId(b.id)),
      ),
    );
    setServerProcessDrafts((current) =>
      [...current].sort(
        (a, b) => rankOf(createServerProcessToolId(a.id)) - rankOf(createServerProcessToolId(b.id)),
      ),
    );
  };

  const saveCustomEmbedPartition = (
    embedId: string,
    partitionMode: BrowserPartitionMode,
    partitionProfile?: string,
  ) => {
    if (!activeProjectId) return;
    const resolvedProfile = partitionMode === "profile" ? (partitionProfile ?? "").trim() : "";
    upsertProjectSettings(activeProjectId, (current) =>
      updatePersistedEmbedPartition(current, embedId, partitionMode, resolvedProfile),
    );
    setCustomEmbedDrafts((current) =>
      updateEmbedDraftPartition(current, embedId, partitionMode, resolvedProfile),
    );
    toastManager.add({
      type: "success",
      title: "Browser session assignment saved",
      description:
        partitionMode === "profile"
          ? `This tab now uses the "${resolvedProfile || "default"}" profile.`
          : partitionMode === "isolated"
            ? "This tab now uses its own isolated session."
            : "This tab now shares the project's browser session.",
    });
  };

  const saveSingleCustomEmbed = (embedId: string) => {
    if (!activeProjectId) return;
    const draft = customEmbedDrafts.find((d) => d.id === embedId);
    if (!draft) return;
    upsertProjectSettings(activeProjectId, (current) => savePersistedCustomEmbed(current, draft));
    setCustomEmbedDrafts((current) => commitSingleCustomEmbedDraft(current, embedId));
  };

  const resetSingleCustomEmbed = (embedId: string) => {
    setCustomEmbedDrafts((current) =>
      resetSingleCustomEmbedDraft(current, embedId, projectSettings),
    );
  };

  const saveSingleServerProcess = (processId: string) => {
    if (!activeProjectId) return;
    const draft = serverProcessDrafts.find((d) => d.id === processId);
    if (!draft) return;
    upsertProjectSettings(activeProjectId, (current) => savePersistedServerProcess(current, draft));
    setServerProcessDrafts((current) => commitSingleServerProcessDraft(current, processId));
  };

  const resetSingleServerProcess = (processId: string) => {
    setServerProcessDrafts((current) =>
      resetSingleServerProcessDraft(current, processId, projectSettings),
    );
  };

  const saveSingleServerPreset = (presetId: string) => {
    if (!activeProjectId) return;
    const draft = serverPresetDrafts.find((d) => d.id === presetId);
    if (!draft) return;
    upsertProjectSettings(activeProjectId, (current) => savePersistedServerPreset(current, draft));
    setServerPresetDrafts((current) => commitSingleServerPresetDraft(current, presetId));
  };

  const resetSingleServerPreset = (presetId: string) => {
    setServerPresetDrafts((current) =>
      resetSingleServerPresetDraft(current, presetId, projectSettings),
    );
  };

  return (
    <>
      {confirmDialog}
      <section className="space-y-6">
        <SettingsSectionHeader
          title="Workspace"
          description={`Configure tools, browser tabs, and terminals for ${activeProject.name || "this project"}.`}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Active Project</CardTitle>
            <CardDescription>Current workspace folder and project identity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ProjectFavicon
                    project={{
                      workspaceRoot: activeProject.cwd,
                      title: activeProject.name,
                      faviconPath: activeProject.faviconPath,
                      projectIcon: activeProject.projectIcon,
                      environmentId: activeProject.environmentId,
                    }}
                    className="size-6"
                  />
                  <div className="text-lg font-semibold text-foreground tracking-tight truncate">
                    {activeProject.name}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {activeProject.projectIcon || activeProject.faviconPath ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={handleResetIcon}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Reset icon
                    </Button>
                  ) : null}
                  <Button size="xs" variant="outline" onClick={() => setIconPickerOpen(true)}>
                    Change icon
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-mono bg-muted/40 px-2.5 py-1.5 rounded-md w-fit break-all border border-border/50">
                {activeProject.cwd}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Project Icons in Window Tabs</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Configure whether project logos and icons appear next to project names in the top
              titlebar tabs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {/* Toggle 1: Global default for all projects */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2.5">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    All projects by default
                  </span>
                  <Badge
                    variant={showProjectTabIcons ? "default" : "secondary"}
                    className="text-[10px] h-4.5 px-1.5 font-normal"
                  >
                    {showProjectTabIcons ? "On" : "Off by default"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Default setting applied across all workspace projects unless customized below.
                </p>
              </div>
              <Switch
                checked={showProjectTabIcons}
                onCheckedChange={setShowProjectTabIcons}
                aria-label="Toggle project icons for all projects by default"
              />
            </div>

            {/* Toggle 2: Current project override */}
            {activeProject && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2.5">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">
                      This project ({activeProject.name})
                    </span>
                    {hasProjectIconOverride ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4.5 px-1.5 font-normal text-muted-foreground border-border/70"
                      >
                        Project override
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/70 font-mono">
                        (Inheriting global: {showProjectTabIcons ? "visible" : "hidden"})
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {hasProjectIconOverride
                      ? `Custom setting for ${activeProject.name}. Click Reset to inherit global default.`
                      : `Display or hide project icon specifically for ${activeProject.name}.`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hasProjectIconOverride && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setProjectTabIconOverride(activeProject.id, null)}
                    >
                      Reset to default
                    </Button>
                  )}
                  <Switch
                    checked={isProjectIconVisibleInTabs}
                    onCheckedChange={(checked) =>
                      setProjectTabIconOverride(activeProject.id, checked)
                    }
                    aria-label={`Toggle project icon for ${activeProject.name}`}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Toolbar Tools</CardTitle>
              <CardDescription>
                Toggle and reorder the tools shown in the project toolbar.
              </CardDescription>
            </div>
            {visibleToolsCount <= 1 ? (
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                <LockIcon className="size-3 text-muted-foreground/70" />
                <span>Min. 1 tool required</span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <DndContext
                sensors={dndSensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={handleReorderTools}
              >
                <SortableContext
                  items={toolbarPreviewTools.map((toolItem) => toolItem.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {toolbarPreviewTools.map((tool) => {
                    const isLastToolLocked = visibleToolsCount <= 1 && tool.visible;
                    const extension =
                      tool.kind === "extension"
                        ? installedExtensions.find((entry) => entry.id === tool.extensionId)
                        : undefined;
                    const extensionUnavailable = Boolean(extension?.disabled || extension?.revoked);

                    return (
                      <SortableToolRow key={tool.id} id={tool.id}>
                        {({ attributes, listeners }) => (
                          <div className="rounded-xl border border-border/70 px-3 py-2">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                aria-label={`Drag to reorder ${tool.label}`}
                                className="-ms-1 shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
                                {...attributes}
                                {...listeners}
                              >
                                <GripVerticalIcon className="size-4" />
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  {extension ? (
                                    <InstalledExtensionToolIcon extension={extension} />
                                  ) : null}
                                  <span>{tool.label}</span>
                                  {tool.kind === "testing" ? (
                                    <Tooltip>
                                      <TooltipTrigger
                                        className="rounded border border-border/60 px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
                                        aria-label="Testing early access information"
                                      >
                                        Early access
                                      </TooltipTrigger>
                                      <TooltipPopup>
                                        Testing is in development. You may encounter errors.
                                        Disabled by default.
                                      </TooltipPopup>
                                    </Tooltip>
                                  ) : null}
                                  {isLastToolLocked ? (
                                    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground font-normal">
                                      <LockIcon className="size-2.5 text-muted-foreground/80" />
                                      <span>Required</span>
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {extension
                                    ? extension.revoked
                                      ? "Revoked · unavailable"
                                      : extension.disabled
                                        ? "Disabled in Extensions settings"
                                        : "Extension · available in this project when enabled"
                                    : describeToolKind(tool.kind)}
                                </div>
                              </div>
                              {isLastToolLocked ? (
                                <Tooltip>
                                  <TooltipTrigger className="inline-flex items-center cursor-not-allowed">
                                    <Switch
                                      checked={tool.visible}
                                      disabled={true}
                                      aria-label={`Toggle ${tool.label}`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipPopup side="left">
                                    At least one tool must stay enabled in your project toolbar.
                                  </TooltipPopup>
                                </Tooltip>
                              ) : (
                                <Switch
                                  checked={tool.visible}
                                  disabled={extensionUnavailable || extensionToggleBusy}
                                  onCheckedChange={(checked) => {
                                    const nextVisible = Boolean(checked);
                                    setPendingToggle({
                                      toolId: tool.id,
                                      toolLabel: tool.label,
                                      toolKind: tool.kind,
                                      nextVisible,
                                    });
                                  }}
                                  aria-label={`Toggle ${tool.label}`}
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </SortableToolRow>
                    );
                  })}
                </SortableContext>
              </DndContext>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Browser Default URL</CardTitle>
            <CardDescription>
              The Browser tool loads this URL by default for the active project. Note: If you run a
              Dock Preset that has a Preview URL configured, it will automatically override this
              default and navigate to the preset's preview.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={browserDefaultUrlDraft}
                    onChange={(event) => setBrowserDefaultUrlDraft(event.target.value)}
                    placeholder="http://localhost:3000"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      if (activeProjectId) {
                        upsertProjectSettings(activeProjectId, (current) => ({
                          ...current,
                          browser: {
                            ...current.browser,
                            defaultUrl: browserDefaultUrlDraft,
                            resumeLastVisitedPage: resumeLastVisitedPageDraft,
                            partitionMode: browserPartitionModeDraft,
                            ...(browserPartitionModeDraft === "profile" &&
                            browserPartitionProfileDraft.trim().length > 0
                              ? { partitionProfile: browserPartitionProfileDraft.trim() }
                              : {}),
                          },
                        }));
                      }
                    }}
                    disabled={!isBrowserSettingsDirty}
                  >
                    Save
                  </Button>
                </div>
                {hasInternalBrowserOverride && (
                  <Alert variant="default" className="bg-muted/50 py-3">
                    <InfoIcon className="size-4 mt-0" />
                    <AlertDescription className="text-muted-foreground ml-2">
                      A Dock Preset is configured to open a preview in the Internal Browser. When
                      you run that preset, its preview URL will override this default.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium">Resume last visited page on startup</div>
                  <div className="text-xs text-muted-foreground">
                    When the browser is reopened, load the page you were last on instead of the
                    default URL above.
                  </div>
                </div>
                <Switch
                  checked={resumeLastVisitedPageDraft}
                  onCheckedChange={(checked) => setResumeLastVisitedPageDraft(checked)}
                />
              </div>

              <Separator />

              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <div className="text-sm font-medium">Session & Account Isolation</div>
                    <div className="text-xs text-muted-foreground">
                      Choose whether the browser shares cookies and logins across this project, runs
                      in an isolated sandbox, or connects to a named profile.
                    </div>
                  </div>
                  <OrbitGroup
                    className="tabs-segmented inline-flex items-center shrink-0 self-start sm:self-auto rounded-full w-fit"
                    role="group"
                    aria-label="Project browser session isolation"
                  >
                    <button
                      type="button"
                      onClick={() => setBrowserPartitionModeDraft("shared")}
                      aria-pressed={browserPartitionModeDraft === "shared"}
                      className={cn(
                        "text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors cursor-pointer",
                        browserPartitionModeDraft === "shared"
                          ? "font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Shared (Project)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBrowserPartitionModeDraft("isolated")}
                      aria-pressed={browserPartitionModeDraft === "isolated"}
                      className={cn(
                        "text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors cursor-pointer",
                        browserPartitionModeDraft === "isolated"
                          ? "font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Isolated
                    </button>
                    <button
                      type="button"
                      onClick={() => setBrowserPartitionModeDraft("profile")}
                      aria-pressed={browserPartitionModeDraft === "profile"}
                      className={cn(
                        "text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer",
                        browserPartitionModeDraft === "profile"
                          ? "font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Named Profile
                    </button>
                  </OrbitGroup>
                </div>
                {browserPartitionModeDraft === "profile" && (
                  <BrowserProfileSelector
                    value={browserPartitionProfileDraft}
                    onChange={setBrowserPartitionProfileDraft}
                  />
                )}
                {browserPartitionModeDraft !== "isolated" && <BrowserGoogleSignInGuidance />}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sidebar Defaults</CardTitle>
            <CardDescription>Set initial collapse state when opening a workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-medium">Minimize Agents sidebar</div>
                <div className="text-xs text-muted-foreground/70">
                  Start thread sidebar collapsed by default.
                </div>
              </div>
              <Switch checked={alwaysMinAgents} onCheckedChange={handleToggleAlwaysMinAgents} />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-medium">Minimize Git panel</div>
                <div className="text-xs text-muted-foreground/70">
                  Start Git panel collapsed by default.
                </div>
              </div>
              <Switch checked={alwaysMinGit} onCheckedChange={handleToggleAlwaysMinGit} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project Tools</CardTitle>
            <CardDescription>
              Manage your project-specific browser tabs, background terminals, or Dock presets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="browser">
              <TabsList className="mb-4">
                <TabsTrigger value="browser">Browser Tabs</TabsTrigger>
                <TabsTrigger value="terminal">Terminal Tabs</TabsTrigger>
                <TabsTrigger value="preset">Dock Presets</TabsTrigger>
              </TabsList>

              <TabsContent value="browser" className="mt-0">
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Add project-specific URLs like Figma, Linear, Notion, or internal tools. Save to
                    add them into the toolbar, then fine-tune placement above in Toolbar Tools.
                  </div>
                  <MasterDetail>
                    <MasterDetailSidebar>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => {
                          const newId = createCustomEmbedId();
                          setCustomEmbedDrafts((current) => [
                            {
                              id: newId,
                              label: "",
                              url: "",
                              visible: true,
                              resumeLastVisitedPage: true,
                              partitionMode: "shared",
                              partitionProfile: "",
                              isNew: true,
                              originalLabel: "",
                              originalUrl: "",
                              originalVisible: true,
                              originalResumeLastVisitedPage: true,
                              originalPartitionMode: "shared",
                              originalPartitionProfile: "",
                            },
                            ...current,
                          ]);
                          setActiveCustomEmbedId(newId);
                        }}
                      >
                        <PlusIcon className="mr-2 size-3.5" />
                        Add Tab
                      </Button>
                      <MasterDetailList>
                        {customEmbedDrafts.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No tabs
                          </div>
                        ) : (
                          customEmbedDrafts.map((draft) => (
                            <MasterDetailItem
                              key={draft.id}
                              label={draft.label.trim() || "Untitled"}
                              isActive={activeCustomEmbedId === draft.id}
                              isUnsaved={isCustomEmbedDraftDirty(draft)}
                              onSelect={() => setActiveCustomEmbedId(draft.id)}
                            />
                          ))
                        )}
                      </MasterDetailList>
                    </MasterDetailSidebar>
                    <MasterDetailContent>
                      {(() => {
                        const activeDraft =
                          customEmbedDrafts.find((d) => d.id === activeCustomEmbedId) ||
                          customEmbedDrafts[0];
                        if (!activeDraft)
                          return (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                              Select a tab or create a new one.
                            </div>
                          );
                        const isDirty = isCustomEmbedDraftDirty(activeDraft);
                        return (
                          <div className="space-y-4 flex flex-col h-full min-h-0 justify-between">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">
                                  {activeDraft.label || "Untitled"}
                                </h3>
                                {isDirty && (
                                  <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Unsaved
                                  </span>
                                )}
                              </div>
                              <div className="space-y-4">
                                <div>
                                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                    Label
                                  </div>
                                  <Input
                                    value={activeDraft.label}
                                    onChange={(event) =>
                                      setCustomEmbedDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, label: event.target.value }
                                            : entry,
                                        ),
                                      )
                                    }
                                    placeholder="Figma"
                                  />
                                </div>
                                <div>
                                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                    Custom URL
                                  </div>
                                  <Input
                                    value={activeDraft.url}
                                    onChange={(event) =>
                                      setCustomEmbedDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, url: event.target.value }
                                            : entry,
                                        ),
                                      )
                                    }
                                    placeholder="https://www.figma.com/file/..."
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs text-muted-foreground">
                                    Show this browser tab in the toolbar once you save it.
                                  </div>
                                  <Switch
                                    checked={activeDraft.visible}
                                    onCheckedChange={(checked) =>
                                      setCustomEmbedDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, visible: Boolean(checked) }
                                            : entry,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/40">
                                  <div className="text-xs text-muted-foreground">
                                    <div className="mb-0.5 font-medium text-foreground">
                                      Resume last visited page
                                    </div>
                                    When this tab is reopened, load the page you were last on
                                    instead of the custom URL above.
                                  </div>
                                  <Switch
                                    checked={activeDraft.resumeLastVisitedPage}
                                    onCheckedChange={(checked) =>
                                      setCustomEmbedDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, resumeLastVisitedPage: Boolean(checked) }
                                            : entry,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                                <div className="flex flex-col gap-3 pt-4 border-t border-border/40">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="flex flex-col gap-0.5">
                                      <div className="text-xs font-medium text-foreground">
                                        Session & Account Isolation
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Choose whether this tab shares cookies and logins with this
                                        project, stays isolated, or links to a named profile.
                                      </div>
                                    </div>
                                    <OrbitGroup
                                      className="tabs-segmented inline-flex items-center shrink-0 self-start sm:self-auto rounded-full w-fit"
                                      role="group"
                                      aria-label="Tab browser session isolation"
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          saveCustomEmbedPartition(activeDraft.id, "shared")
                                        }
                                        aria-pressed={
                                          (activeDraft.partitionMode ?? "shared") === "shared"
                                        }
                                        className={cn(
                                          "text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer",
                                          (activeDraft.partitionMode ?? "shared") === "shared"
                                            ? "font-semibold"
                                            : "text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        Shared (Project)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          saveCustomEmbedPartition(activeDraft.id, "isolated")
                                        }
                                        aria-pressed={activeDraft.partitionMode === "isolated"}
                                        className={cn(
                                          "text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer",
                                          activeDraft.partitionMode === "isolated"
                                            ? "font-semibold"
                                            : "text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        Isolated
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          saveCustomEmbedPartition(activeDraft.id, "profile")
                                        }
                                        aria-pressed={activeDraft.partitionMode === "profile"}
                                        className={cn(
                                          "text-xs px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer",
                                          activeDraft.partitionMode === "profile"
                                            ? "font-semibold"
                                            : "text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        Named Profile
                                      </button>
                                    </OrbitGroup>
                                  </div>
                                  {activeDraft.partitionMode === "profile" && (
                                    <BrowserProfileSelector
                                      value={activeDraft.partitionProfile}
                                      onChange={(val) =>
                                        saveCustomEmbedPartition(activeDraft.id, "profile", val)
                                      }
                                    />
                                  )}
                                  {activeDraft.partitionMode !== "isolated" && (
                                    <BrowserGoogleSignInGuidance />
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="pt-6 flex items-center justify-between border-t border-border/40 mt-6">
                              <Button
                                type="button"
                                variant="destructive-outline"
                                onClick={() => {
                                  setTabToDeleteId(activeDraft.id);
                                }}
                              >
                                <Trash2Icon className="mr-2 size-3.5" />
                                Delete Tab
                              </Button>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => resetSingleCustomEmbed(activeDraft.id)}
                                  disabled={!isDirty}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => saveSingleCustomEmbed(activeDraft.id)}
                                  disabled={!isDirty}
                                >
                                  Save Changes
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </MasterDetailContent>
                  </MasterDetail>
                </div>
              </TabsContent>

              <TabsContent value="terminal" className="mt-0">
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Add project-specific terminal tools that auto-run predefined commands when the
                    tab opens. Save to add them into the toolbar, then reorder them above if needed.
                  </div>
                  <MasterDetail>
                    <MasterDetailSidebar>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => {
                          const newId = createServerProcessId();
                          setServerProcessDrafts((current) => [
                            {
                              id: newId,
                              label: "",
                              commands: [""],
                              cwd: activeProject.cwd,
                              autoStart: false,
                              visible: true,
                              isNew: true,
                              originalLabel: "",
                              originalCommands: [""],
                              originalCwd: activeProject.cwd,
                              originalAutoStart: false,
                              originalVisible: true,
                            },
                            ...current,
                          ]);
                          setActiveServerProcessId(newId);
                        }}
                      >
                        <PlusIcon className="mr-2 size-3.5" />
                        Add Terminal
                      </Button>
                      <MasterDetailList>
                        {serverProcessDrafts.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No terminals
                          </div>
                        ) : (
                          serverProcessDrafts.map((draft) => (
                            <MasterDetailItem
                              key={draft.id}
                              label={draft.label.trim() || "Untitled"}
                              isActive={activeServerProcessId === draft.id}
                              isUnsaved={isServerProcessDraftDirty(draft)}
                              onSelect={() => setActiveServerProcessId(draft.id)}
                            />
                          ))
                        )}
                      </MasterDetailList>
                    </MasterDetailSidebar>
                    <MasterDetailContent>
                      {(() => {
                        const activeDraft =
                          serverProcessDrafts.find((d) => d.id === activeServerProcessId) ||
                          serverProcessDrafts[0];
                        if (!activeDraft)
                          return (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                              Select a terminal or create a new one.
                            </div>
                          );
                        const isDirty = isServerProcessDraftDirty(activeDraft);
                        return (
                          <div className="space-y-4 flex flex-col h-full min-h-0 justify-between">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">
                                  {activeDraft.label || "Untitled"}
                                </h3>
                                {isDirty && (
                                  <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Unsaved
                                  </span>
                                )}
                              </div>
                              <div className="space-y-4">
                                <div>
                                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                    Label
                                  </div>
                                  <Input
                                    value={activeDraft.label}
                                    onChange={(event) =>
                                      setServerProcessDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, label: event.target.value }
                                            : entry,
                                        ),
                                      )
                                    }
                                    placeholder="OpenCore"
                                  />
                                </div>
                                <div>
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                      Commands
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        setServerProcessDrafts((current) =>
                                          current.map((entry) =>
                                            entry.id === activeDraft.id
                                              ? { ...entry, commands: [...entry.commands, ""] }
                                              : entry,
                                          ),
                                        )
                                      }
                                    >
                                      <PlusIcon className="size-3.5 mr-2" />
                                      Add Step
                                    </Button>
                                  </div>
                                  <div className="space-y-2">
                                    {activeDraft.commands.map((command, commandIndex) => (
                                      <div
                                        key={`${activeDraft.id}-step-${commandIndex}`}
                                        className="flex gap-2"
                                      >
                                        <Input
                                          value={command}
                                          onChange={(event) =>
                                            setServerProcessDrafts((current) =>
                                              current.map((entry) =>
                                                entry.id === activeDraft.id
                                                  ? {
                                                      ...entry,
                                                      commands: entry.commands.map(
                                                        (step, stepIndex) =>
                                                          stepIndex === commandIndex
                                                            ? event.target.value
                                                            : step,
                                                      ),
                                                    }
                                                  : entry,
                                              ),
                                            )
                                          }
                                          placeholder={
                                            commandIndex === 0 ? "npm install" : "npm run dev"
                                          }
                                        />
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="outline"
                                          disabled={activeDraft.commands.length === 1}
                                          onClick={() =>
                                            setServerProcessDrafts((current) =>
                                              current.map((entry) =>
                                                entry.id === activeDraft.id
                                                  ? {
                                                      ...entry,
                                                      commands: entry.commands.filter(
                                                        (_, stepIndex) =>
                                                          stepIndex !== commandIndex,
                                                      ),
                                                    }
                                                  : entry,
                                              ),
                                            )
                                          }
                                        >
                                          <Trash2Icon className="size-3.5" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                    Working Directory
                                  </div>
                                  <Input
                                    value={activeDraft.cwd}
                                    onChange={(event) =>
                                      setServerProcessDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, cwd: event.target.value }
                                            : entry,
                                        ),
                                      )
                                    }
                                    placeholder={activeProject.cwd}
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs text-muted-foreground">
                                    Show this terminal in the toolbar once you save it.
                                  </div>
                                  <Switch
                                    checked={activeDraft.visible}
                                    onCheckedChange={(checked) =>
                                      setServerProcessDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, visible: Boolean(checked) }
                                            : entry,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs text-muted-foreground">
                                    Auto-start this terminal when its tab or the Server tool is
                                    first opened.
                                  </div>
                                  <Switch
                                    checked={activeDraft.autoStart}
                                    onCheckedChange={(checked) =>
                                      setServerProcessDrafts((current) =>
                                        current.map((entry) =>
                                          entry.id === activeDraft.id
                                            ? { ...entry, autoStart: Boolean(checked) }
                                            : entry,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="pt-6 flex items-center justify-between border-t border-border/40 mt-6">
                              <Button
                                type="button"
                                variant="destructive-outline"
                                onClick={() => {
                                  setTerminalToDeleteId(activeDraft.id);
                                }}
                              >
                                <Trash2Icon className="mr-2 size-3.5" />
                                Delete Terminal
                              </Button>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => resetSingleServerProcess(activeDraft.id)}
                                  disabled={!isDirty}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => saveSingleServerProcess(activeDraft.id)}
                                  disabled={!isDirty}
                                >
                                  Save Changes
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </MasterDetailContent>
                  </MasterDetail>
                </div>
              </TabsContent>

              <TabsContent value="preset" className="mt-0">
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Create and manage one-click presets like `Frontend` or `Backend`, each with
                    ordered command steps.
                  </div>
                  <MasterDetail>
                    <MasterDetailSidebar>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => {
                          const newId = createServerProcessId();
                          setServerPresetDrafts((current) => [
                            {
                              id: newId,
                              label: "",
                              commands: [""],
                              cwd: activeProject.cwd,
                              autoStart: false,
                              visible: true,
                              isNew: true,
                              originalLabel: "",
                              originalCommands: [""],
                              originalCwd: activeProject.cwd,
                              originalAutoStart: false,
                              originalVisible: true,
                            },
                            ...current,
                          ]);
                          setActiveServerPresetId(newId);
                        }}
                      >
                        <PlusIcon className="mr-2 size-3.5" />
                        Add Preset
                      </Button>
                      <MasterDetailList>
                        {serverPresetDrafts.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No presets
                          </div>
                        ) : (
                          serverPresetDrafts.map((draft) => (
                            <MasterDetailItem
                              key={draft.id}
                              label={draft.label.trim() || "Untitled"}
                              icon={resolvePresetIconElement(draft, "size-4")}
                              isActive={activeServerPresetId === draft.id}
                              isUnsaved={isServerProcessDraftDirty(draft)}
                              onSelect={() => setActiveServerPresetId(draft.id)}
                            />
                          ))
                        )}
                      </MasterDetailList>
                    </MasterDetailSidebar>
                    <MasterDetailContent>
                      {(() => {
                        const activeDraft =
                          serverPresetDrafts.find((d) => d.id === activeServerPresetId) ||
                          serverPresetDrafts[0];
                        if (!activeDraft)
                          return (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                              Select a preset or create a new one.
                            </div>
                          );
                        const isDirty = isServerProcessDraftDirty(activeDraft);
                        return (
                          <div className="space-y-4 flex flex-col h-full min-h-0 justify-between">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">
                                  {activeDraft.label || "Untitled"}
                                </h3>
                                {isDirty && (
                                  <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Unsaved
                                  </span>
                                )}
                              </div>
                              <ServerPresetFormFields
                                preset={activeDraft}
                                presetDrafts={serverPresetDrafts}
                                projectCwd={activeProject.cwd}
                                variant="plain"
                                updatePresetRow={updatePresetRow}
                                addCommandStep={addCommandStep}
                                updateCommandStep={updateCommandStep}
                                moveCommandStep={moveCommandStep}
                                removeCommandStep={removeCommandStep}
                              />
                            </div>
                            <div className="pt-6 flex items-center justify-between border-t border-border/40 mt-6">
                              <Button
                                type="button"
                                variant="destructive-outline"
                                onClick={() => {
                                  setPresetToDeleteId(activeDraft.id);
                                }}
                              >
                                <Trash2Icon className="mr-2 size-3.5" />
                                Delete Preset
                              </Button>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => resetSingleServerPreset(activeDraft.id)}
                                  disabled={!isDirty}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => saveSingleServerPreset(activeDraft.id)}
                                  disabled={!isDirty}
                                >
                                  Save Changes
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </MasterDetailContent>
                  </MasterDetail>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={pendingToggle !== null}
        onOpenChange={(open) => {
          if (!open) setPendingToggle(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingToggle?.nextVisible ? "Show" : "Hide"} {pendingToggle?.toolLabel ?? "tool"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingToggle?.nextVisible
                ? `This will show "${pendingToggle?.toolLabel}" in your project toolbar.`
                : `This will hide "${pendingToggle?.toolLabel}" from your project toolbar. You can restore it in Settings.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" onClick={() => setPendingToggle(null)}>
                  Cancel
                </Button>
              }
            />
            <Button
              disabled={extensionToggleBusy}
              onClick={() => {
                void confirmToggle();
              }}
            >
              {pendingToggle?.nextVisible ? "Show" : "Hide"} {pendingToggle?.toolLabel ?? "tool"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={tabToDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setTabToDeleteId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this tab?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" onClick={() => setTabToDeleteId(null)}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              onClick={() => {
                if (tabToDeleteId && activeProjectId) {
                  upsertProjectSettings(activeProjectId, (current) =>
                    deletePersistedCustomEmbed(current, tabToDeleteId),
                  );
                  setCustomEmbedDrafts((current) => deleteCustomEmbedDraft(current, tabToDeleteId));
                  if (activeCustomEmbedId === tabToDeleteId) setActiveCustomEmbedId(null);
                }
                setTabToDeleteId(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={terminalToDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setTerminalToDeleteId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this terminal?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" onClick={() => setTerminalToDeleteId(null)}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              onClick={() => {
                if (terminalToDeleteId && activeProjectId) {
                  upsertProjectSettings(activeProjectId, (current) =>
                    deletePersistedServerProcess(current, terminalToDeleteId),
                  );
                  setServerProcessDrafts((current) =>
                    deleteServerProcessDraft(current, terminalToDeleteId),
                  );
                  if (activeServerProcessId === terminalToDeleteId) setActiveServerProcessId(null);
                }
                setTerminalToDeleteId(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={presetToDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPresetToDeleteId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this preset?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" onClick={() => setPresetToDeleteId(null)}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              onClick={() => {
                if (presetToDeleteId && activeProjectId) {
                  upsertProjectSettings(activeProjectId, (current) =>
                    deletePersistedServerPreset(current, presetToDeleteId),
                  );
                  setServerPresetDrafts((current) =>
                    deleteServerPresetDraft(current, presetToDeleteId),
                  );
                  if (activeServerPresetId === presetToDeleteId) setActiveServerPresetId(null);
                }
                setPresetToDeleteId(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <ProjectIconPickerDialog
        current={activeProject.projectIcon ?? null}
        open={iconPickerOpen}
        onOpenChange={setIconPickerOpen}
        onSelect={handleSelectIcon}
      />
    </>
  );
}

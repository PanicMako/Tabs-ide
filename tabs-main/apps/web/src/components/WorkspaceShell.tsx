import { BrowserToolbar } from "./browser/BrowserToolbar";
import { ExtensionToolSurface } from "./ExtensionToolSurface";
import { useInstalledExtensions } from "../state/extensions";
import { isExtensionEnabledForProject, extensionProfileForProject } from "@tabs/shared/extensions";
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import { createPortal } from "react-dom";
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  CommandId,
  type DesktopBrowserHostState,
  type DesktopBrowserSessionState,
  type DesktopCodeHostState,
  type GitApplyHunkMode,
  type ProjectId,
  type PreviewAnnotationPayload,
  EnvironmentId,
  ThreadId,
  type GitBranch,
  type GitStatusFile,
  type ModelSelection,
  type ModelSlug,
  DEFAULT_MODEL,
} from "@tabs/contracts";
import { makeAppModelSelection } from "../modelSelection";
import { TestingTool } from "./testing/TestingTool";
import {
  isNativeBrowserRecordingActive,
  startNativeBrowserRecording,
  stopNativeBrowserRecording,
} from "./NativePreviewAutomationHost";
import { PreviewAnnotationEditor } from "./PreviewAnnotationEditor";
import { BrowserComparisonView } from "./browser/BrowserComparisonView";
import { RecordIssueDialog } from "./browser/RecordIssueDialog";
import { ServerReadinessBadge } from "./browser/ServerReadinessBadge";
import {
  type ProjectToolKind,
  type ProjectToolDefinition,
  type ProjectWorkspaceSettings,
  type BrowserPartitionMode,
  resolveBrowserPartition,
} from "@tabs/contracts/settings";
import {
  useProjectAgentsState,
  useProjectServerState,
  useProjectBrowserState,
  projectUiStateKey,
} from "~/state/scopedStateStore";
import { agentsLayoutActions } from "../state/agentsLayout";
import {
  AGENT_THREAD_DRAG_MIME,
  PINNED_THREAD_DRAG_MIME,
  serializeAgentThreadDrag,
  setActiveAgentDrag,
  clearActiveAgentDrag,
} from "./agents/agentDragPayload";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  activateProjectSurface,
  getInFlightSurfaceActivation,
  isPathAlignedWithSurfaceActivation,
  isPathTargetingThread,
} from "../lib/projectSurfaceCoordinator";
import { markStartupStage } from "../lib/startupReadiness";
import { PageLoadingState } from "./PageLoadingState";

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArchiveIcon,
  CheckIcon,
  ArchiveRestoreIcon,
  BellIcon,
  BugIcon,
  CameraIcon,
  Columns2Icon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  FolderSearchIcon,
  GitBranchIcon,
  GlobeIcon,
  HelpCircleIcon,
  HistoryIcon,
  Maximize2Icon,
  MinusIcon,
  Minimize2Icon,
  MoreHorizontalIcon,
  MonitorIcon,
  MousePointer2Icon,
  PlayIcon,
  PuzzleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RadioIcon,
  RocketIcon,
  RotateCwIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  TabletIcon,
  Trash2Icon,
  PanelTopCloseIcon,
  PanelTopOpenIcon,
  MessageSquareIcon,
  TerminalSquareIcon,
  WorkflowIcon,
  XIcon,
  PanelLeftIcon,
  PanelLeftCloseIcon,
  PinIcon,
  PictureInPicture2Icon,
  ShieldAlertIcon,
  Clock3Icon,
  CircleCheckIcon,
  SquareIcon,
  TriangleAlertIcon,
  Volume2Icon,
  VolumeXIcon,
  WrenchIcon,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDesktopIconThemeSync } from "../hooks/useDesktopIconTheme";
import { useBrowserHistoryStore } from "../browserHistoryStore";
import { BrowserViewportResizeFrame } from "./browser/BrowserViewportResizeFrame";
import {
  NATIVE_SURFACE_BLOCKING_OVERLAY_SELECTOR,
  shouldSuspendNativeSurfaceForOverlay,
  useNativeSurfaceOverlaySuspension,
} from "../nativeSurfaceOverlay";
import {
  PREVIEW_ANNOTATION_PICKED_EVENT,
  type PreviewAnnotationPickedDetail,
} from "../lib/previewAnnotation";
import { useAutoRefreshModelsOnStartup } from "../hooks/useAutoRefreshModelsOnStartup";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { composerDraftActions } from "../state/composerDrafts";
import { useUnreadNotificationCount } from "../stores/notificationStore";
import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { useAppClosing } from "../hooks/useAppClosing";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { isElectron } from "../env";
import { useOpenAddProjectCommandPalette } from "../commandPaletteContext";
import { toGitUserFacingErrorMessage } from "../lib/gitErrorMessages";
import { clipTestingPreviewBounds } from "../lib/testingPreviewBounds";
import {
  gitBranchesQueryOptions,
  gitConflictSnapshotQueryOptions,
  gitDiffQueryOptions,
  gitEnvironmentQueryOptions,
  gitHistoryQueryOptions,
  gitInitMutationOptions,
  gitStashListQueryOptions,
  gitStatusQueryOptions,
} from "../lib/gitReactQuery";
import { GitAccountMenu } from "./git/GitAccountMenu";
import { GitEnvironmentGate } from "./git/GitEnvironmentGate";
import { ToolErrorBoundary } from "./ToolErrorBoundary";
import { GitToolV2 } from "./GitToolV2";
import { BrowserSecurityBadge } from "./BrowserSecurityBadge";
import {
  buildSingleHunkPatch,
  getRenderablePatch,
  resolveFileDiffPath as resolvePatchFilePath,
} from "../lib/patchParsing";
import {
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
} from "../lib/projectReactQuery";
import {
  cn,
  isWindowsPlatform,
  newCommandId,
  newProjectId,
  randomUUID,
  newThreadId,
} from "../lib/utils";
import { APP_VERSION } from "../branding";
import { environmentApi, isPrimaryEnvironment } from "../connection/environmentApiRegistry";

// On Windows the native title bar is hidden and the caption buttons are overlaid
// (Window Controls Overlay) at the top-right, so the top bar reserves space on
// the right instead of the macOS traffic-light space on the left.
const isWindowsDesktop =
  isElectron && typeof navigator !== "undefined" && isWindowsPlatform(navigator.platform);
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import { openInPreferredEditor } from "../editorPreferences";
import { ServerPresetFormFields } from "./ServerPresetFormFields";
import {
  AntigravityIcon,
  ClaudeAI,
  OpenAI,
  GrokIcon,
  OpenCodeIcon,
  KiloIcon,
  CursorIcon,
  CopilotIcon,
  type Icon,
} from "./Icons";
import GitCommitComposer from "./GitCommitComposer";
import { FusedModelPicker } from "./chat/FusedModelPicker";
import type { ProviderPickerKind } from "../session-logic";
import { useServerConfig } from "../state/settings";
import { Badge } from "./ui/badge";
import { initializeZoom, resetZoom, zoomIn, zoomOut } from "../state/zoom";
import { Button } from "./ui/button";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { getGitWorkspaceLayoutSection } from "./GitToolLayout.logic";
import type { GitWorkspaceMode, GitWorkspaceSwitchReason } from "./GitToolLayout.logic";
import { useConfirm } from "~/hooks/useConfirm";
import {
  browserSessionStateKey,
  EMPTY_PROJECT_CODE_TOOL_STATE,
  EMPTY_PROJECT_GIT_TOOL_STATE,
  resolveProjectTools,
  useWorkspaceShellStore,
} from "../workspaceShellStore";
import {
  DEFAULT_THREAD_TERMINAL_ID,
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";
import { type ProjectBrowserToolState } from "../workspaceShellStore";
import {
  workspaceShellActions,
  workspaceShellAtom,
  useProjectWorkspaceSettings,
  useWorkspaceShellState,
} from "../state/workspaceShell";
import { selectThreadTerminalState } from "../state/terminalTransitions";
import { getThreadTerminalState, terminalActions, useThreadTerminalState } from "../state/terminal";
import { projectScriptRuntimeEnv } from "../projectScripts";
import { PatchViewer } from "./PatchViewer";
import { MercuryChromeLoader } from "./MercuryChromeLoader";
import { Spinner } from "./ui/spinner";
import { NotificationHistoryPanel } from "./NotificationHistoryPanel";
import { resolveTabActivityIndicator } from "../lib/tabActivityIndicator";
import { isSnoozed, isSettled } from "../state/threadLifecycle";
import { resolveSnoozePresets } from "../state/snoozePresets";
import { planPinnedMove, planPinnedReorder, sortPinnedThreads } from "../state/pinnedThreadOrder";
// Lazy: ChatView pulls in heavy markdown/syntax-highlight deps (react-markdown,
// @pierre/diffs). It is only needed when the Agents tab or the Code-tab AI side
// chat is actually opened, so keep it out of the always-loaded shell bundle.
const ChatView = lazy(() => import("./ChatView"));
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { getCodeHostUnavailableMessage } from "./codeHost.logic";
import { CodeActivityRail } from "./code/CodeActivityRail";
import { CodeHeaderBar } from "./code/CodeHeaderBar";
import {
  CODE_ACTIVITY_ITEMS,
  CODE_CHROME_COMMANDS,
  DEFAULT_CODE_CHROME_STATE,
  type CodeChromeState,
} from "@tabs/shared/codeChrome";
import { resolveShortcutCommand } from "../keybindings";
import { useKeybindings } from "../state/settings";
import { projectsAtom, threadsAtom, threadsHydratedAtom } from "../state/threads";
import { isTerminalFocused } from "../lib/terminalFocus";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";

const BROWSER_DEVICE_PRESETS = [
  { id: "project-default", label: "Project", width: null, height: null },
  { id: "mobile-s", label: "iPhone 14 Pro", width: 393, height: 852 },
  { id: "mobile-l", label: "iPhone 14 Pro Max", width: 430, height: 932 },
  { id: "tablet", label: "iPad Air", width: 820, height: 1180 },
  { id: "desktop", label: "Laptop 13", width: 1280, height: 800 },
  { id: "wide", label: "Large Desktop", width: 1600, height: 960 },
  { id: "custom", label: "Custom size", width: null, height: null },
] as const;

const GIT_WORKSPACE_MODE_STORAGE_KEY = "tabs:git-workspace-mode";

function formatBrowserViewportLabel(browserState: ProjectBrowserToolState): string {
  const selectedPreset =
    BROWSER_DEVICE_PRESETS.find((preset) => preset.id === browserState.devicePreset) ??
    BROWSER_DEVICE_PRESETS[0]!;
  if (selectedPreset.id !== "custom") {
    return selectedPreset.label;
  }
  if (browserState.customWidth && browserState.customHeight) {
    return `${selectedPreset.label} ${browserState.customWidth} x ${browserState.customHeight}`;
  }
  return selectedPreset.label;
}

function BrowserViewportSelector(props: {
  browserState: ProjectBrowserToolState;
  projectId: ProjectId;
  sessionId?: string | undefined;
  setBrowserViewport: (
    projectId: ProjectId,
    input: {
      devicePreset: ProjectBrowserToolState["devicePreset"];
      customWidth?: number | null | undefined;
      customHeight?: number | null | undefined;
      landscape?: boolean | undefined;
    },
    sessionId?: string | undefined,
  ) => void;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const selectedPreset =
    BROWSER_DEVICE_PRESETS.find((preset) => preset.id === props.browserState.devicePreset) ??
    BROWSER_DEVICE_PRESETS[0]!;
  const [customWidthDraft, setCustomWidthDraft] = useState(
    String(props.browserState.customWidth ?? ""),
  );
  const [customHeightDraft, setCustomHeightDraft] = useState(
    String(props.browserState.customHeight ?? ""),
  );

  useEffect(() => {
    if (props.browserState.devicePreset !== "custom") {
      setCustomWidthDraft("");
      setCustomHeightDraft("");
      return;
    }
    setCustomWidthDraft(String(props.browserState.customWidth ?? ""));
    setCustomHeightDraft(String(props.browserState.customHeight ?? ""));
  }, [props.browserState.devicePreset]);

  const updateCustomWidth = (value: string) => {
    setCustomWidthDraft(value);
    const parsedWidth = Number.parseInt(value, 10);
    props.setBrowserViewport(
      props.projectId,
      {
        devicePreset: "custom",
        customWidth: value.trim().length === 0 || Number.isNaN(parsedWidth) ? null : parsedWidth,
      },
      props.sessionId,
    );
  };

  const updateCustomHeight = (value: string) => {
    setCustomHeightDraft(value);
    const parsedHeight = Number.parseInt(value, 10);
    props.setBrowserViewport(
      props.projectId,
      {
        devicePreset: "custom",
        customHeight: value.trim().length === 0 || Number.isNaN(parsedHeight) ? null : parsedHeight,
      },
      props.sessionId,
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={props.browserState.devicePreset}
        onValueChange={(devicePreset) =>
          props.setBrowserViewport(
            props.projectId,
            {
              devicePreset: devicePreset as ProjectBrowserToolState["devicePreset"],
            },
            props.sessionId,
          )
        }
        onOpenChange={props.onOpenChange}
      >
        <SelectTrigger
          size="xs"
          className="min-w-[10rem] rounded-full border-border/70 bg-card/70 px-3 text-xs font-medium text-foreground shadow-none hover:bg-accent/50"
        >
          {formatBrowserViewportLabel(props.browserState)}
        </SelectTrigger>
        <SelectPopup align="end" className="w-56">
          {BROWSER_DEVICE_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{preset.label}</span>
                {preset.width && preset.height ? (
                  <span className="truncate text-[10px] text-muted-foreground/60">
                    {preset.width} x {preset.height}
                  </span>
                ) : null}
              </div>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {selectedPreset.id === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-7 w-20"
            inputMode="numeric"
            value={customWidthDraft}
            onChange={(event) => updateCustomWidth(event.target.value)}
            placeholder="Width"
          />
          <Input
            className="h-7 w-20"
            inputMode="numeric"
            value={customHeightDraft}
            onChange={(event) => updateCustomHeight(event.target.value)}
            placeholder="Height"
          />
        </div>
      ) : null}
    </div>
  );
}

function BrowserViewportHiddenNotice(props?: {
  title?: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-5 z-40 w-[min(38rem,calc(100%-1.5rem))] -translate-x-1/2 px-3">
      <div className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/95 px-4 py-3 shadow-2xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-xl animate-in fade-in duration-150">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-500/12 text-sky-300">
          {props?.icon ?? <GlobeIcon className="size-4.5" />}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {props?.title ?? "Preview hidden for screen sizing"}
          </div>
          <div className="mt-0.5 text-sm leading-5 text-muted-foreground">
            {props?.description ??
              "Close the screen-size menu and the preview will return automatically."}
          </div>
        </div>
      </div>
    </div>
  );
}

const EMBED_LOAD_TIMEOUT_MS = 5000;
const DEFAULT_DESKTOP_CODE_HOST_STATE: DesktopCodeHostState = {
  available: false,
  mode: "external",
  entry: null,
  reason: null,
};
const DEFAULT_DESKTOP_BROWSER_HOST_STATE: DesktopBrowserHostState = {
  available: false,
  reason: null,
};
const CODE_HOST_OVERLAY_SELECTOR = NATIVE_SURFACE_BLOCKING_OVERLAY_SELECTOR;

type EmbeddedWorkspaceMode = {
  enabled: boolean;
  workspaceRoot: string | null;
  tool: "agents" | "server" | "browser" | "code" | "git";
};

function resolveEmbeddedWorkspaceMode(): EmbeddedWorkspaceMode {
  if (typeof window === "undefined") {
    return { enabled: false, workspaceRoot: null, tool: "agents" };
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") !== "1") {
      return { enabled: false, workspaceRoot: null, tool: "agents" };
    }

    const workspaceRoot = params.get("workspaceRoot")?.trim() || null;
    const requestedTool = params.get("tool")?.trim() || "agents";
    const tool =
      requestedTool === "server" ||
      requestedTool === "browser" ||
      requestedTool === "code" ||
      requestedTool === "git"
        ? requestedTool
        : "agents";

    return {
      enabled: true,
      workspaceRoot,
      tool,
    };
  } catch {
    return { enabled: false, workspaceRoot: null, tool: "agents" };
  }
}

function toolIcon(tool: ProjectToolKind) {
  switch (tool) {
    case "code":
      return <WorkflowIcon className="size-3.5" />;
    case "agents":
      return <BotIcon className="size-3.5" />;
    case "server":
      return <ServerIcon className="size-3.5" />;
    case "git":
      return <GitBranchIcon className="size-3.5" />;
    case "browser":
    case "custom_embed":
      return <GlobeIcon className="size-3.5" />;
    case "testing":
      return <FlaskConicalIcon aria-hidden="true" className="size-3.5" />;
    case "custom_process":
      return <TerminalSquareIcon className="size-3.5" />;
    case "extension":
      return <PuzzleIcon className="size-3.5" />;
  }
}

function basenameOfPath(input: string): string {
  const parts = input.split(/[/\\]/g).filter(Boolean);
  return parts[parts.length - 1] ?? input;
}

function dirnameOfPath(input: string): string | null {
  const normalized = input.replace(/[/\\]+$/, "");
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSeparator <= 0) {
    return null;
  }
  return normalized.slice(0, lastSeparator);
}

function relativePathFromParent(parent: string, target: string): string | null {
  const normalizedParent = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedTarget = target.replace(/\\/g, "/");
  const prefix = `${normalizedParent}/`;
  if (!normalizedTarget.startsWith(prefix)) {
    return null;
  }
  const relative = normalizedTarget.slice(prefix.length);
  return relative.length > 0 ? relative : null;
}

function createEmptyBrowserSessionState(
  projectId: ProjectId,
  sessionId = "browser",
): DesktopBrowserSessionState {
  return {
    projectId,
    sessionId,
    currentUrl: null,
    pageTitle: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devToolsOpen: false,
    zoomFactor: 1,
    audioMuted: false,
    pictureInPicture: false,
    colorScheme: "system",
    lastError: null,
    transientError: null,
  };
}

function deriveRemoteSelectionParts(branch: GitBranch): {
  remoteName: string;
  remoteBranch: string;
} | null {
  if (!branch.isRemote) return null;
  if (branch.remoteName && branch.name.startsWith(`${branch.remoteName}/`)) {
    return {
      remoteName: branch.remoteName,
      remoteBranch: branch.name.slice(branch.remoteName.length + 1),
    };
  }
  const separatorIndex = branch.name.indexOf("/");
  if (separatorIndex <= 0) return null;
  return {
    remoteName: branch.name.slice(0, separatorIndex),
    remoteBranch: branch.name.slice(separatorIndex + 1),
  };
}

type GitConflictResolverMode = "manual" | "ai";

type GitAiConflictState =
  | {
      status: "idle";
      userMessageId: string | null;
      sourceMessageId: string | null;
      proposal: string | null;
      error: string | null;
    }
  | {
      status: "sending" | "waiting" | "ready" | "error";
      userMessageId: string;
      sourceMessageId: string | null;
      proposal: string | null;
      error: string | null;
    };

function buildPreviewPatch(relativePath: string, previousContents: string, nextContents: string) {
  if (previousContents === nextContents) {
    return "";
  }

  const previousLines = previousContents.split("\n");
  const nextLines = nextContents.split("\n");
  const maxLines = Math.max(previousLines.length, nextLines.length);
  const patchLines = [`--- a/${relativePath}`, `+++ b/${relativePath}`];
  patchLines.push(`@@ -1,${previousLines.length} +1,${nextLines.length} @@`);

  for (let index = 0; index < maxLines; index += 1) {
    const previousLine = previousLines[index];
    const nextLine = nextLines[index];

    if (previousLine === nextLine) {
      if (previousLine !== undefined) {
        patchLines.push(` ${previousLine}`);
      }
      continue;
    }

    if (previousLine !== undefined) {
      patchLines.push(`-${previousLine}`);
    }
    if (nextLine !== undefined) {
      patchLines.push(`+${nextLine}`);
    }
  }

  return `${patchLines.join("\n")}\n`;
}

function extractFirstCodeFence(text: string): string | null {
  const match = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  return match?.[1]?.replace(/\n$/, "") ?? null;
}

function buildConflictFixPrompt(input: {
  projectPath: string;
  relativePath: string;
  contents: string;
}) {
  return [
    `Resolve the Git merge conflict in \`${input.relativePath}\` inside the project \`${input.projectPath}\`.`,
    "",
    "Requirements:",
    "- Return the fully resolved file contents only.",
    "- Preserve valid code and remove all conflict markers.",
    "- Do not include explanation.",
    "- Put the final file contents inside one fenced code block.",
    "",
    "Current conflicted file:",
    "```",
    input.contents,
    "```",
  ].join("\n");
}

function classifyGitHistoryRef(ref: string) {
  if (ref === "HEAD" || ref.startsWith("HEAD -> ")) {
    return { label: ref, variant: "secondary" as const };
  }
  if (ref.startsWith("origin/") || ref.includes("/")) {
    return { label: ref, variant: "info" as const };
  }
  if (ref.startsWith("tag: ")) {
    return { label: ref, variant: "success" as const };
  }
  return { label: ref, variant: "outline" as const };
}

function resolveSelectedPatchFile(
  patch: string | null | undefined,
  selectedPath: string | null,
  cacheScope: string,
): FileDiffMetadata | null {
  if (!patch || !selectedPath) return null;
  const renderablePatch = getRenderablePatch(patch, cacheScope);
  if (!renderablePatch || renderablePatch.kind !== "files") {
    return null;
  }
  return (
    renderablePatch.files.find((fileDiff) => resolvePatchFilePath(fileDiff) === selectedPath) ??
    renderablePatch.files[0] ??
    null
  );
}

function resolveGitHunkActionModes(file: GitStatusFile | null): {
  modes: ReadonlyArray<GitApplyHunkMode>;
  unavailableReason: string | null;
} {
  if (!file) {
    return {
      modes: [],
      unavailableReason: "Select a changed file to review its hunks.",
    };
  }
  if (file.conflicted) {
    return {
      modes: [],
      unavailableReason:
        "Resolve conflicts first. Hunk actions are unavailable for conflicted files.",
    };
  }
  if (file.untracked) {
    return {
      modes: [],
      unavailableReason:
        "Stage or discard the full untracked file first. Hunk actions are unavailable here.",
    };
  }
  if (file.staged && file.unstaged) {
    return {
      modes: [],
      unavailableReason:
        "This file has both staged and unstaged changes. Use whole-file actions first, then return to hunk actions.",
    };
  }
  if (file.staged) {
    return { modes: ["unstage"], unavailableReason: null };
  }
  if (file.unstaged) {
    return { modes: ["stage", "discard"], unavailableReason: null };
  }
  return {
    modes: [],
    unavailableReason: "No hunk actions are available for this file yet.",
  };
}

type ServerPresetRuntimeStatus = "idle" | "stopped" | "running";

function moveListItem<T>(items: ReadonlyArray<T>, fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) {
    return next;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

function resolveServerPresetRuntimeStatus(input: {
  processId: string;
  runningProcessIds: ReadonlySet<string>;
  terminalIds: ReadonlySet<string>;
}): ServerPresetRuntimeStatus {
  if (input.runningProcessIds.has(input.processId)) {
    return "running";
  }
  if (input.terminalIds.has(input.processId)) {
    return "stopped";
  }
  return "idle";
}

function sortProjectThreads(threads: ReadonlyArray<Thread>): Thread[] {
  return threads.toSorted((left, right) => {
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
    if (!Number.isNaN(rightTime) && !Number.isNaN(leftTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function resolveProjectDefaultBrowserUrl(
  _project: Project,
  settings: ProjectWorkspaceSettings,
): string {
  const custom = settings.browser.defaultUrl.trim();
  if (custom.length > 0) {
    return custom;
  }
  return "https://www.google.com";
}

function normalizeBrowserUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function isSameWebUrl(urlA: string | null | undefined, urlB: string | null | undefined): boolean {
  if (!urlA || !urlB) return false;
  const normA = normalizeBrowserUrl(urlA).replace(/\/+$/, "");
  const normB = normalizeBrowserUrl(urlB).replace(/\/+$/, "");
  if (normA === normB) return true;
  try {
    const parsedA = new URL(normA);
    const parsedB = new URL(normB);
    return (
      parsedA.hostname.toLowerCase() === parsedB.hostname.toLowerCase() &&
      parsedA.pathname.replace(/\/+$/, "") === parsedB.pathname.replace(/\/+$/, "") &&
      parsedA.search === parsedB.search &&
      parsedA.port === parsedB.port
    );
  } catch {
    return false;
  }
}

function resolveProjectById(
  projects: ReadonlyArray<Project>,
  projectId: ProjectId | null,
): Project | null {
  return projectId ? (projects.find((project) => project.id === projectId) ?? null) : null;
}

function resolveMostRecentThreadForProject(
  projectId: ProjectId,
  threads: ReadonlyArray<Thread>,
): Thread | null {
  return sortProjectThreads(threads.filter((thread) => thread.projectId === projectId))[0] ?? null;
}

function resolveProjectAgentThread(
  projectId: ProjectId,
  threads: ReadonlyArray<Thread>,
  rememberedThreadId: ThreadId | null,
): Thread | null {
  // Archived threads are never auto-opened as a project's default thread.
  const activeThreads = threads.filter((thread) => thread.archivedAt === null);
  const rememberedThread = rememberedThreadId
    ? activeThreads.find(
        (thread) => thread.id === rememberedThreadId && thread.projectId === projectId,
      )
    : null;
  return rememberedThread ?? resolveMostRecentThreadForProject(projectId, activeThreads);
}

function resolveProjectAgentThreadId(
  projectId: ProjectId,
  threads: ReadonlyArray<Thread>,
  rememberedThreadId: ThreadId | null,
): ThreadId | null {
  if (rememberedThreadId) {
    const draft = composerDraftActions.getDraftThread(rememberedThreadId);
    if (draft && draft.projectId === projectId) {
      return rememberedThreadId;
    }
  }
  const projectDraft = composerDraftActions.getDraftThreadByProjectId(projectId);
  if (projectDraft) {
    return projectDraft.threadId;
  }
  const resolved = resolveProjectAgentThread(projectId, threads, rememberedThreadId);
  return resolved?.id ?? null;
}

function TitlebarNotificationBell({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <NotificationHistoryPanel variant="titlebar" {...(onOpenSettings ? { onOpenSettings } : {})} />
  );
}

function ProjectTabs(props: {
  projects: ReadonlyArray<Project>;
  openProjects: ReadonlyArray<Project>;
  activeProjectId: ProjectId | null;
  pendingTabIds: ReadonlyArray<string>;
  activePendingTabId: string | null;
  threads?: ReadonlyArray<Thread>;
  onActivateProject: (projectId: ProjectId) => void;
  onCloseProject: (projectId: ProjectId) => void;
  onNewTab: () => void;
  onActivatePendingTab: (pendingId: string) => void;
  onClosePendingTab: (pendingId: string) => void;
  showSettings?: boolean;
  onOpenSettings?: () => void;
}) {
  // Merge real + pending tabs in a stable order: real projects first (as ordered
  // in openProjects), then pending slots appended at the end.
  type TabEntry = { kind: "project"; project: Project } | { kind: "pending"; pendingId: string };

  const tabs: TabEntry[] = [
    ...props.openProjects.map(
      (project): TabEntry => ({
        kind: "project",
        project,
      }),
    ),
    ...(props.pendingTabIds ?? []).map(
      (pendingId): TabEntry => ({
        kind: "pending",
        pendingId,
      }),
    ),
  ];

  return (
    <div
      className={cn(
        "drag-region flex items-end justify-between gap-2 overflow-x-auto border-b px-3 pt-2 select-none backdrop-blur-md transition-colors duration-200",
        "border-border/80 bg-background/95 text-foreground",
        // Reserve space for the OS window controls: traffic lights (left) on
        // macOS/Linux, the overlaid caption buttons (right) on Windows.
        isElectron && (isWindowsDesktop ? "pr-[140px]" : "pl-[92px]"),
      )}
    >
      <div className="flex min-w-0 flex-1 items-end gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((entry) => {
          if (entry.kind === "project") {
            const { project } = entry;
            const active = project.id === props.activeProjectId && !props.activePendingTabId;
            const projectThreads = (props.threads ?? []).filter((t) => t.projectId === project.id);
            const activityIndicator = !active ? resolveTabActivityIndicator(projectThreads) : null;
            return (
              <div
                key={project.id}
                data-active={active ? "true" : undefined}
                className={cn(
                  "drag-region group relative inline-flex min-w-[9.5rem] max-w-[15rem] items-center gap-2 rounded-t-xl border px-3.5 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer select-none",
                  active
                    ? "relative -mb-px border-border border-b-card bg-card text-card-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
                onClick={() => props.onActivateProject(project.id)}
              >
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate text-left leading-normal pb-0.5 tracking-tight",
                    active
                      ? "font-semibold text-card-foreground"
                      : "font-medium text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {project.name}
                </button>
                {activityIndicator && (
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full transition-all",
                      activityIndicator.dotClass,
                      activityIndicator.pulse && "animate-pulse",
                    )}
                    title={activityIndicator.label}
                    aria-label={activityIndicator.label}
                  />
                )}
                <button
                  type="button"
                  className={cn(
                    "no-drag shrink-0 rounded-md p-1 transition-all duration-150 cursor-pointer",
                    active
                      ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                      : "text-muted-foreground/60 opacity-60 group-hover:opacity-100 hover:bg-muted/80 hover:text-foreground",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCloseProject(project.id);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            );
          }

          // Pending tab chip
          const { pendingId } = entry;
          const active = props.activePendingTabId === pendingId;
          return (
            <div
              key={pendingId}
              data-active={active ? "true" : undefined}
              className={cn(
                "drag-region group relative inline-flex min-w-[9.5rem] max-w-[15rem] items-center gap-2 rounded-t-xl border px-3.5 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer select-none",
                active
                  ? "relative -mb-px border-border border-b-card bg-card text-card-foreground shadow-sm ring-1 ring-border/50"
                  : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
              onClick={() => props.onActivatePendingTab(pendingId)}
            >
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 truncate text-left leading-normal pb-0.5 tracking-tight",
                  active
                    ? "font-semibold text-card-foreground"
                    : "font-medium text-muted-foreground group-hover:text-foreground",
                )}
              >
                New Tab
              </button>
              <button
                type="button"
                className={cn(
                  "no-drag shrink-0 rounded-md p-1 transition-all duration-150 cursor-pointer",
                  active
                    ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                    : "text-muted-foreground/60 opacity-60 group-hover:opacity-100 hover:bg-muted/80 hover:text-foreground",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClosePendingTab(pendingId);
                }}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}

        {/* Integrated "+" button */}
        <button
          type="button"
          className="no-drag mb-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-muted/80 hover:text-foreground cursor-pointer"
          aria-label="New tab"
          onClick={props.onNewTab}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      {props.showSettings ? (
        <div className="no-drag mb-1 flex shrink-0 items-center gap-1">
          <div id="project-toolbar-extra-controls" className="flex items-center empty:hidden" />
          <TitlebarNotificationBell
            {...(props.onOpenSettings ? { onOpenSettings: props.onOpenSettings } : {})}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 rounded-full text-muted-foreground hover:text-foreground text-xs h-7 px-2.5"
            onClick={props.onOpenSettings}
          >
            <SettingsIcon className="size-3.5" />
            Settings
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectToolBar(props: {
  activeToolId: string;
  availableTools: ReadonlyArray<{
    id: string;
    kind: ProjectToolKind;
    label: string;
  }>;
  threads?: ReadonlyArray<Thread>;
  activeProjectId?: ProjectId | null;
  onSelectTool: (toolId: string) => void;
  onOpenSettings: () => void;
}) {
  const { toolbarStyle } = useSettings();
  const activeIndex = props.availableTools.findIndex((t) => t.id === props.activeToolId);
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  const focusAdjacentTool = (direction: -1 | 1) => {
    const tabs = trackRef.current?.querySelectorAll<HTMLButtonElement>(".nav-tab");
    if (!tabs?.length) return;
    const focusedIndex = [...tabs].findIndex((tab) => tab === document.activeElement);
    const nextIndex = (Math.max(focusedIndex, activeIndex) + direction + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
  };

  useEffect(() => {
    if (!trackRef.current || !pillRef.current || activeIndex === -1) return;

    // Delay slightly to ensure layout is calculated properly
    const timeoutId = setTimeout(() => {
      const tabs = trackRef.current?.querySelectorAll<HTMLButtonElement>(".nav-tab");
      if (!tabs) return;
      const targetTab = tabs[activeIndex];
      if (!targetTab) return;

      const targetLeft = targetTab.offsetLeft;
      const targetWidth = targetTab.offsetWidth;

      if (pillRef.current) {
        pillRef.current.style.transform = `translateX(${targetLeft}px)`;
        pillRef.current.style.width = `${targetWidth}px`;
      }
    }, 10);
    return () => clearTimeout(timeoutId);
  }, [activeIndex, props.availableTools, toolbarStyle]);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-card/85 px-3 py-2">
      <div
        ref={trackRef}
        role="tablist"
        aria-label="Project tools"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          focusAdjacentTool(event.key === "ArrowLeft" ? -1 : 1);
        }}
        className={cn(
          "nav-track",
          `design-${toolbarStyle ?? "solid"}`,
          "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        <div ref={pillRef} className="active-pill" />
        {props.availableTools.map((tool) => {
          const active = tool.id === props.activeToolId;
          const isAgentsTool = tool.kind === "agents";
          const activeProjectThreads =
            isAgentsTool && !active && props.activeProjectId
              ? (props.threads ?? []).filter((t) => t.projectId === props.activeProjectId)
              : [];
          const toolActivityIndicator =
            isAgentsTool && !active ? resolveTabActivityIndicator(activeProjectThreads) : null;
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => props.onSelectTool(tool.id)}
              className={cn("nav-tab", active && "active")}
            >
              {toolIcon(tool.kind)}
              <span>{tool.label}</span>
              {toolActivityIndicator && (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full ml-1",
                    toolActivityIndicator.dotClass,
                    toolActivityIndicator.pulse && "animate-pulse",
                  )}
                  title={toolActivityIndicator.label}
                  aria-label={toolActivityIndicator.label}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <div id="project-toolbar-extra-controls" className="flex items-center empty:hidden" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={props.onOpenSettings}
        >
          <SettingsIcon className="size-4" />
          Settings
        </Button>
      </div>
    </div>
  );
}

const AGENTS_SIDEBAR_COLLAPSED_KEY = "tabs.agentsSidebarCollapsed";

/** Maps provider instanceId → brand color */
const PROVIDER_COLOR_MAP: Record<string, string> = {
  opencode: "#38bdf8",
  claudeAgent: "#f97316",
  claude: "#f97316",
  codex: "#10b981",
  openai: "#10b981",
  cursor: "#8b5cf6",
  grok: "#ec4899",
};

/** Maps provider instanceId → SVG icon component */
const PROVIDER_ICON_MAP: Record<string, Icon> = {
  antigravity: AntigravityIcon,
  claudeAgent: ClaudeAI,
  claude: ClaudeAI,
  codex: OpenAI,
  openai: OpenAI,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  cursor: CursorIcon,
};

function ProviderIcon({
  instanceId,
  provider,
  className,
}: {
  instanceId: string;
  provider?: string | undefined;
  className?: string;
}) {
  const normalizedKey = `${instanceId ?? ""} ${provider ?? ""}`.toLowerCase();
  const IconComp =
    PROVIDER_ICON_MAP[instanceId] ??
    PROVIDER_ICON_MAP[normalizedKey] ??
    (normalizedKey.includes("cursor")
      ? CursorIcon
      : normalizedKey.includes("antigravity") || normalizedKey.includes("gemini")
        ? AntigravityIcon
        : normalizedKey.includes("copilot")
          ? CopilotIcon
          : normalizedKey.includes("opencode")
            ? OpenCodeIcon
            : normalizedKey.includes("claude")
              ? ClaudeAI
              : normalizedKey.includes("codex") ||
                  normalizedKey.includes("openai") ||
                  normalizedKey.includes("gpt")
                ? OpenAI
                : normalizedKey.includes("grok")
                  ? GrokIcon
                  : BotIcon);

  // Monotone icon style matching prototype design system
  return <IconComp className={className} />;
}

/** Derive what attention badge (if any) to show on a thread's icon in the sidebar rail. */
function deriveThreadAttention(thread: Thread): {
  tone: "amber" | "red" | "pulse";
  spin: boolean;
} | null {
  const state = thread.latestTurn?.state;
  const sessionStatus = thread.session?.status;

  if (state === "running" || sessionStatus === "running") {
    return { tone: "pulse", spin: true };
  }
  if (state === "error" || sessionStatus === "error") {
    return { tone: "red", spin: false };
  }
  if (state === "interrupted") {
    return { tone: "amber", spin: false };
  }
  // Completed threads do NOT show a permanent green dot
  return null;
}

function AgentsThreadList(props: {
  project: Project;
  threads: ReadonlyArray<Thread>;
  activeThreadId: ThreadId | null;
  onSelectThread: (threadId: ThreadId) => void;
  onOpenThreadToSide?: (threadId: ThreadId) => void;
  onCreateThread: () => void;
  onDeleteThread: (thread: Thread) => void | Promise<void>;
  onArchiveThread: (thread: Thread) => void | Promise<void>;
  onUnarchiveThread: (thread: Thread) => void | Promise<void>;
  children: ReactNode;
}) {
  const [threadPendingDelete, setThreadPendingDelete] = useState<Thread | null>(null);
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  const [showSettledView, setShowSettledView] = useState(false);
  const [showSnoozedView, setShowSnoozedView] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [openThreadMenuId, setOpenThreadMenuId] = useState<ThreadId | null>(null);
  const [draggedPinnedThreadId, setDraggedPinnedThreadId] = useState<ThreadId | null>(null);
  const projectGitStatusQuery = useQuery(
    gitStatusQueryOptions(props.project.cwd, props.project.environmentId),
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLifecycleNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const dispatchLifecycle = useCallback(
    async (thread: Thread, action: "pin" | "settle" | "snooze", snoozedUntil?: string) => {
      const api = await environmentApi(thread.environmentId);
      const commandId = newCommandId();
      if (action === "pin") {
        await api.orchestration.dispatchCommand(
          thread.pinnedAt
            ? { type: "thread.unpin", commandId, threadId: thread.id }
            : { type: "thread.pin", commandId, threadId: thread.id },
        );
      } else if (action === "settle") {
        if (
          !thread.settledAt &&
          (thread.session?.status === "running" || thread.latestTurn?.state === "running")
        ) {
          try {
            await api.orchestration.dispatchCommand({
              type: "thread.session.stop",
              commandId: newCommandId(),
              threadId: thread.id,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // best-effort session stop
          }
        }
        await api.orchestration.dispatchCommand(
          thread.settledAt
            ? {
                type: "thread.unsettle",
                commandId,
                threadId: thread.id,
                reason: "user",
              }
            : { type: "thread.settle", commandId, threadId: thread.id },
        );
      } else {
        await api.orchestration.dispatchCommand(
          isSnoozed(thread)
            ? {
                type: "thread.unsnooze",
                commandId,
                threadId: thread.id,
                reason: "user",
              }
            : {
                type: "thread.snooze",
                commandId,
                threadId: thread.id,
                snoozedUntil: snoozedUntil ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              },
        );
      }
    },
    [],
  );
  const movePinnedThread = useCallback(
    async (thread: Thread, direction: "up" | "down") => {
      const ordered = sortPinnedThreads(props.threads.filter((candidate) => candidate.pinnedAt));
      const assignments = planPinnedMove({
        orderedIds: ordered.map((candidate) => candidate.id),
        keysById: new Map(ordered.map((candidate) => [candidate.id, candidate.pinOrderKey])),
        movedId: thread.id,
        direction,
      });
      if (assignments === null) return;
      for (const assignment of assignments) {
        const assignedThread = props.threads.find((candidate) => candidate.id === assignment.id);
        if (!assignedThread) continue;
        const api = await environmentApi(assignedThread.environmentId);
        await api.orchestration.dispatchCommand({
          type: "thread.pin.reorder",
          commandId: newCommandId(),
          threadId: ThreadId.makeUnsafe(assignment.id),
          orderKey: assignment.orderKey,
        });
      }
    },
    [props.threads],
  );
  const dropPinnedThread = useCallback(
    async (targetId: ThreadId) => {
      const movedId = draggedPinnedThreadId;
      setDraggedPinnedThreadId(null);
      if (movedId === null || movedId === targetId) return;
      const ordered = sortPinnedThreads(props.threads.filter((candidate) => candidate.pinnedAt));
      const desired = ordered.map((candidate) => candidate.id);
      const from = desired.indexOf(movedId);
      const to = desired.indexOf(targetId);
      if (from < 0 || to < 0) return;
      desired.splice(from, 1);
      desired.splice(to, 0, movedId);
      const assignments = planPinnedReorder({
        orderedIds: desired,
        keysById: new Map(ordered.map((candidate) => [candidate.id, candidate.pinOrderKey])),
        movedId,
      });
      for (const assignment of assignments) {
        const assignedThread = props.threads.find((candidate) => candidate.id === assignment.id);
        if (!assignedThread) continue;
        const api = await environmentApi(assignedThread.environmentId);
        await api.orchestration.dispatchCommand({
          type: "thread.pin.reorder",
          commandId: newCommandId(),
          threadId: ThreadId.makeUnsafe(assignment.id),
          orderKey: assignment.orderKey,
        });
      }
    },
    [draggedPinnedThreadId, props.threads],
  );
  const [agentsState, setAgentsState] = useProjectAgentsState(
    projectUiStateKey(props.project.environmentId, props.project.id),
  );
  const view = agentsState.threadListView;
  const setView = useCallback(
    (v: "current" | "archived" | ((prev: "current" | "archived") => "current" | "archived")) => {
      setAgentsState((prev) => ({
        threadListView: typeof v === "function" ? v(prev.threadListView) : v,
      }));
    },
    [setAgentsState],
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

  // Persistent collapse state
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      if (window.localStorage?.getItem("tabs.alwaysMinimizeAgentsSidebar") === "true") {
        return true;
      }
      return window.localStorage?.getItem(AGENTS_SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage?.setItem(AGENTS_SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const activeThreads = props.threads.filter((thread) => thread.archivedAt === null);
  const archivedThreads = props.threads.filter((thread) => thread.archivedAt !== null);
  const normalizedThreadSearch = threadSearch.trim().toLocaleLowerCase();
  const matchesThreadSearch = (thread: Thread): boolean => {
    if (!normalizedThreadSearch) return true;
    return [
      thread.title,
      thread.branch,
      thread.worktreePath,
      thread.modelSelection.instanceId,
      thread.modelSelection.model,
      thread.session?.provider,
      thread.runtimeMode,
      props.project.name,
      props.project.cwd,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedThreadSearch));
  };
  const searchedActiveThreads = activeThreads.filter(matchesThreadSearch);
  const searchedArchivedThreads = archivedThreads.filter(matchesThreadSearch);
  const threadSections = useMemo(() => {
    if (view === "archived") {
      return [{ name: "archived" as const, threads: searchedArchivedThreads }];
    }

    const pinned: Thread[] = [];
    const active: Thread[] = [];
    const snoozed: Thread[] = [];
    const settled: Thread[] = [];
    for (const thread of searchedActiveThreads) {
      const entry = thread;
      if (isSnoozed(entry, lifecycleNow)) {
        snoozed.push(thread);
      } else if (isSettled(entry, thread.updatedAt ?? thread.createdAt)) {
        settled.push(thread);
      } else if (entry.pinnedAt !== null) {
        pinned.push(thread);
      } else {
        active.push(thread);
      }
    }
    const eventTime = (thread: Thread): number =>
      Math.max(
        ...[
          thread.pinnedAt,
          thread.settledAt,
          thread.snoozedAt,
          thread.unsettledAt,
          thread.updatedAt,
          thread.createdAt,
        ]
          .filter((value): value is string => typeof value === "string")
          .map(Date.parse),
      );
    const byAttentionThenEvent = (left: Thread, right: Thread): number => {
      const leftAttention = deriveThreadAttention(left) !== null ? 1 : 0;
      const rightAttention = deriveThreadAttention(right) !== null ? 1 : 0;
      return rightAttention - leftAttention || eventTime(right) - eventTime(left);
    };
    pinned.splice(0, pinned.length, ...sortPinnedThreads(pinned));
    active.sort(byAttentionThenEvent);
    snoozed.sort((left, right) => {
      const leftWake = Date.parse(left.snoozedUntil ?? "");
      const rightWake = Date.parse(right.snoozedUntil ?? "");
      return leftWake - rightWake;
    });
    settled.sort((left, right) => eventTime(right) - eventTime(left));
    if (showSnoozedView) {
      return [{ name: "snoozed" as const, threads: snoozed }];
    }
    if (showSettledView) {
      return [{ name: "settled" as const, threads: settled }];
    }
    return [
      { name: "pinned" as const, threads: pinned },
      { name: "active" as const, threads: active },
    ];
  }, [
    lifecycleNow,
    searchedActiveThreads,
    searchedArchivedThreads,
    showSettledView,
    showSnoozedView,
    view,
  ]);
  const visibleThreads = threadSections.flatMap((section) =>
    section.threads.map((thread, index) => ({
      thread,
      section: section.name,
      first: index === 0,
    })),
  );
  const settledCount = activeThreads.filter((thread) =>
    isSettled(thread, thread.updatedAt ?? thread.createdAt),
  ).length;
  const snoozedCount = activeThreads.filter((thread) => isSnoozed(thread, lifecycleNow)).length;
  const actionableCount = activeThreads.length - settledCount - snoozedCount;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      {/* ── Sidebar ── */}
      <div
        className={cn(
          "agents-tab flex shrink-0 flex-col border-r border-border/60 bg-card/30 transition-[width] duration-200 ease-in-out",
          collapsed ? "w-12" : "w-72",
        )}
        data-collapsed={collapsed ? "true" : "false"}
      >
        {/* ── Header ── */}
        {collapsed ? (
          // Collapsed: Bot icon that crossfades to ChevronRight on hover = expand button
          <div className="flex shrink-0 flex-col items-center gap-2 border-b border-border/40 py-3">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Expand sidebar"
                    onClick={toggleCollapsed}
                    className="group relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  />
                }
              >
                <BotIcon className="size-4 transition-opacity duration-150 group-hover:opacity-0" />
                <ChevronRightIcon className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
              </TooltipTrigger>
              <TooltipPopup side="right" align="center">
                <span className="font-medium">{props.project.name}</span>
                <span className="ml-1.5 text-muted-foreground">Expand sidebar</span>
              </TooltipPopup>
            </Tooltip>
            {/* New thread icon */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="New thread"
                    onClick={props.onCreateThread}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/20 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  />
                }
              >
                <PlusIcon className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="right" align="center">
                New thread
              </TooltipPopup>
            </Tooltip>
          </div>
        ) : (
          // Expanded header
          <div className="shrink-0 px-3 pb-2 pt-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  AGENTS
                </div>
                <div
                  className="truncate text-sm font-semibold tracking-tight text-foreground"
                  title={props.project.name}
                >
                  {props.project.name.toLowerCase().includes("tabs")
                    ? "Tabs IDE"
                    : props.project.name}
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Collapse sidebar"
                      onClick={toggleCollapsed}
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/20 text-muted-foreground/70 transition-all hover:border-border/70 hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <PanelLeftCloseIcon className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="bottom" align="center">
                  Collapse sidebar
                </TooltipPopup>
              </Tooltip>
            </div>

            {/* Prominent full-width New Thread button */}
            <button
              type="button"
              onClick={props.onCreateThread}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-accent/60 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-all hover:border-border hover:bg-accent hover:shadow"
            >
              <PlusIcon className="size-4 text-foreground/80" />
              New Thread
            </button>

            {/* Lifecycle is the primary navigation; archive remains secondary history. */}
            <div
              className="tabs-segmented mt-2.5 flex items-center"
              role="group"
              aria-label="Task view"
            >
              <button
                type="button"
                onClick={() => {
                  setView("current");
                  setShowSettledView(false);
                  setShowSnoozedView(false);
                }}
                aria-pressed={view === "current" && !showSettledView && !showSnoozedView}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-sans font-medium transition-all",
                  view === "current" && !showSettledView && !showSnoozedView
                    ? "bg-background text-foreground font-semibold shadow-sm border border-border/40"
                    : "text-muted-foreground/70 hover:text-foreground hover:bg-background/40",
                )}
              >
                Active <span className="font-normal opacity-60">{actionableCount}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("current");
                  setShowSettledView(true);
                  setShowSnoozedView(false);
                }}
                aria-pressed={view === "current" && showSettledView}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-sans font-medium transition-all",
                  view === "current" && showSettledView
                    ? "bg-background text-foreground font-semibold shadow-sm border border-border/40"
                    : "text-muted-foreground/70 hover:text-foreground hover:bg-background/40",
                )}
              >
                Settled <span className="font-normal opacity-60">{settledCount}</span>
              </button>
            </div>
            {archivedThreads.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setView(view === "archived" ? "current" : "archived");
                  setShowSnoozedView(false);
                }}
                className={cn(
                  "mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1 text-[11px] transition-colors",
                  view === "archived"
                    ? "bg-accent/50 text-foreground"
                    : "text-muted-foreground/55 hover:bg-accent/30 hover:text-foreground",
                )}
              >
                <ArchiveIcon aria-hidden="true" className="size-3" />
                {view === "archived" ? "Return to threads" : `Archive (${archivedThreads.length})`}
              </button>
            )}
            <div className="relative mt-2">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground z-10"
              />
              <input
                type="search"
                value={threadSearch}
                onChange={(event) => setThreadSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setThreadSearch("");
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Search tasks"
                placeholder="Search tasks, branches, models…"
                className="h-8 w-full rounded-lg border border-border/50 bg-background/55 pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
              {threadSearch && (
                <button
                  type="button"
                  aria-label="Clear task search"
                  onClick={() => setThreadSearch("")}
                  className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon aria-hidden="true" className="size-3" />
                </button>
              )}
              <span className="sr-only" aria-live="polite">
                {normalizedThreadSearch
                  ? `${visibleThreads.length} matching task${visibleThreads.length === 1 ? "" : "s"}`
                  : ""}
              </span>
            </div>
          </div>
        )}

        {/* ── Thread list ── */}
        <ScrollArea hideScrollbars className="min-h-0 flex-1">
          <div className={cn("space-y-0.5", collapsed ? "p-1.5" : "px-2 pb-2")}>
            {showSnoozedView && !collapsed && (
              <div className="mb-2 flex items-center justify-between border-b border-border/50 px-1 pb-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowSnoozedView(false)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
                  Back to active
                </button>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {snoozedCount}
                </span>
              </div>
            )}
            {normalizedThreadSearch && visibleThreads.length === 0 && !collapsed && (
              <div className="rounded-xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground/65">
                No tasks match “{threadSearch.trim()}”.
              </div>
            )}
            {(view === "archived"
              ? archivedThreads.length === 0
              : showSnoozedView
                ? snoozedCount === 0
                : showSettledView
                  ? settledCount === 0
                  : actionableCount === 0) &&
              !normalizedThreadSearch &&
              !collapsed && (
                <div className="rounded-xl border border-dashed border-border/60 p-4 text-xs text-muted-foreground/60">
                  {view === "archived"
                    ? "No archived threads."
                    : showSnoozedView
                      ? "No snoozed threads."
                      : showSettledView
                        ? "No settled threads yet."
                        : "No active threads. Create a new one above."}
                </div>
              )}

            {visibleThreads.map(({ thread, section, first }) => {
              const active = props.activeThreadId === thread.id;
              const isArchived = thread.archivedAt !== null;
              const lifecycleEntry = thread;
              const threadIsSnoozed = isSnoozed(lifecycleEntry, lifecycleNow);
              const attention = deriveThreadAttention(thread);
              const wakeLabel =
                lifecycleEntry.snoozedUntil == null
                  ? null
                  : new Intl.DateTimeFormat(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(lifecycleEntry.snoozedUntil));
              const lastWorkedDate = new Date(thread.updatedAt ?? thread.createdAt);
              const lastWorkedLabel = Number.isNaN(lastWorkedDate.getTime())
                ? "Unknown"
                : new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(lastWorkedDate);
              const accessibleState =
                section === "settled"
                  ? "settled"
                  : section === "snoozed"
                    ? `snoozed until ${wakeLabel ?? "later"}`
                    : attention?.spin
                      ? "working"
                      : attention
                        ? "needs attention"
                        : section === "pinned"
                          ? "pinned"
                          : "active";
              const threadInspector = (
                <div className="space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-foreground shadow-sm">
                        <ProviderIcon
                          instanceId={thread.modelSelection.instanceId}
                          provider={thread.session?.provider}
                          className="size-4"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold leading-5 text-foreground">
                          {thread.title}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground/70">
                          {thread.modelSelection.instanceId} · {thread.modelSelection.model}
                        </span>
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                      {accessibleState}
                    </span>
                  </div>
                  {thread.branch && projectGitStatusQuery.data?.branch && (
                    <p
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2.5 font-medium",
                        thread.branch === projectGitStatusQuery.data.branch
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {thread.branch === projectGitStatusQuery.data.branch ? (
                        <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      ) : (
                        <TriangleAlertIcon
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0"
                        />
                      )}
                      <span>
                        {thread.branch === projectGitStatusQuery.data.branch
                          ? `Checked out on this task’s branch: ${thread.branch}`
                          : `Checked out on ${projectGitStatusQuery.data.branch}; this task uses ${thread.branch}.`}
                      </span>
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <FolderSearchIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{props.project.name}</span>
                  </p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <HistoryIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">Last worked {lastWorkedLabel}</span>
                  </p>
                  {thread.branch && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">Thread branch: {thread.branch}</span>
                    </p>
                  )}
                  {projectGitStatusQuery.data?.branch && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">
                        Checked out: {projectGitStatusQuery.data.branch}
                      </span>
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MonitorIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{thread.worktreePath ?? props.project.cwd}</span>
                  </p>
                  <p className="text-muted-foreground/70">Local workspace · {thread.runtimeMode}</p>
                  {section === "snoozed" && wakeLabel && (
                    <p className="flex items-center gap-2 rounded-md bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
                      <Clock3Icon aria-hidden="true" className="size-3.5 shrink-0" />
                      Wakes automatically at {wakeLabel}
                    </p>
                  )}
                </div>
              );

              return (
                <Fragment key={`${section}:${thread.id}`}>
                  {!collapsed && first && section === "pinned" && (
                    <div className="flex items-center gap-2 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/55">
                      <PinIcon aria-hidden="true" className="size-3" />
                      Pinned
                    </div>
                  )}
                  {!collapsed && first && section === "snoozed" && (
                    <div className="mt-2 flex w-full items-center gap-2 border-t border-border/40 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/55">
                      <Clock3Icon aria-hidden="true" className="size-3.5" />
                      <span>Snoozed</span>
                      <span className="text-muted-foreground/45">{snoozedCount}</span>
                    </div>
                  )}
                  <div
                    draggable={true}
                    onDragStart={(event) => {
                      if (section === "pinned") {
                        setDraggedPinnedThreadId(thread.id);
                        event.dataTransfer.setData(PINNED_THREAD_DRAG_MIME, thread.id);
                      }
                      const envId =
                        thread.environmentId ??
                        props.project.environmentId ??
                        EnvironmentId.makeUnsafe("primary");
                      const payload = {
                        type: "tabs:agent-thread" as const,
                        environmentId: envId,
                        projectId: thread.projectId,
                        threadId: thread.id,
                      };
                      event.dataTransfer.setData(
                        AGENT_THREAD_DRAG_MIME,
                        serializeAgentThreadDrag(payload),
                      );
                      event.dataTransfer.effectAllowed = "copyMove";
                      setActiveAgentDrag(payload);
                    }}
                    onDragEnd={() => {
                      setDraggedPinnedThreadId(null);
                      clearActiveAgentDrag();
                    }}
                    onDragOver={(event) => {
                      if (section === "pinned" && draggedPinnedThreadId !== null)
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      if (section !== "pinned" || draggedPinnedThreadId === null) return;
                      event.preventDefault();
                      void dropPinnedThread(thread.id);
                    }}
                    className={cn(
                      "group relative flex items-center rounded-lg transition-all duration-150",
                      collapsed ? "justify-center" : "",
                      "bg-transparent hover:bg-accent/30",
                      !collapsed && section === "settled" && "opacity-75",
                    )}
                  >
                    {/* Single tall left accent line for active thread (expanded) */}
                    {active && !collapsed && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-foreground" />
                    )}
                    {collapsed ? (
                      // ── Icon-rail: provider logo chip + tooltip matching prototype ──
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`${thread.title}, ${accessibleState}, ${props.project.name}`}
                              onClick={(event) => {
                                if (event.altKey || event.metaKey || event.ctrlKey) {
                                  props.onOpenThreadToSide?.(thread.id);
                                  return;
                                }
                                props.onSelectThread(thread.id);
                              }}
                              className={cn(
                                "relative flex size-9 items-center justify-center rounded-lg transition-colors",
                                active
                                  ? "text-foreground"
                                  : "text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground",
                              )}
                            />
                          }
                        >
                          {/* Single tall left accent line for active thread (collapsed) */}
                          {active && (
                            <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-full bg-foreground" />
                          )}
                          <span
                            aria-hidden="true"
                            className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-muted/35 text-muted-foreground"
                          >
                            <ProviderIcon
                              instanceId={thread.modelSelection.instanceId}
                              provider={thread.session?.provider}
                              className="size-4"
                            />
                          </span>
                          {/* ── Status dot badge (only for active attention like running/error/interrupted) ── */}
                          {(() => {
                            const attn = deriveThreadAttention(thread);
                            if (!attn) return null;
                            return (
                              <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-background border border-border/40">
                                {attn.spin ? (
                                  <Spinner className="size-2.5 text-primary" />
                                ) : (
                                  <span
                                    className={cn(
                                      "size-2 rounded-full",
                                      attn.tone === "red"
                                        ? "bg-red-400"
                                        : attn.tone === "amber"
                                          ? "bg-amber-400"
                                          : "bg-primary",
                                    )}
                                  />
                                )}
                              </span>
                            );
                          })()}
                        </TooltipTrigger>
                        <TooltipPopup side="right" align="start" className="w-72 p-3">
                          {threadInspector}
                        </TooltipPopup>
                      </Tooltip>
                    ) : (
                      // ── Full expanded row matching prototype ──
                      <>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                onClick={(event) => {
                                  if (event.altKey || event.metaKey || event.ctrlKey) {
                                    props.onOpenThreadToSide?.(thread.id);
                                    return;
                                  }
                                  props.onSelectThread(thread.id);
                                }}
                                className={cn(
                                  "min-w-0 flex-1 text-left",
                                  section === "settled" ? "px-2.5 py-1.5" : "px-2.5 py-2",
                                )}
                                aria-label={`${thread.title}, ${accessibleState}, ${props.project.name}`}
                              />
                            }
                          >
                            <div className="flex items-center gap-2">
                              {section === "pinned" && (
                                <PinIcon
                                  aria-hidden="true"
                                  className="size-3.5 shrink-0 text-muted-foreground/55"
                                />
                              )}
                              {(section === "settled" || section === "snoozed") && (
                                <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
                              )}
                              {/* Status dot or spinner for active attention */}
                              {(() => {
                                const attn = deriveThreadAttention(thread);
                                if (!attn) return null;
                                if (attn.spin) {
                                  return <Spinner className="size-3 shrink-0 text-primary" />;
                                }
                                return (
                                  <span
                                    className={cn(
                                      "size-1.5 shrink-0 rounded-full",
                                      attn.tone === "red"
                                        ? "bg-red-400"
                                        : attn.tone === "amber"
                                          ? "bg-amber-400"
                                          : "bg-primary",
                                    )}
                                  />
                                );
                              })()}
                              <div
                                className={cn(
                                  "truncate text-sm font-semibold tracking-tight transition-colors flex-1",
                                  active
                                    ? "text-foreground font-semibold"
                                    : isArchived
                                      ? "text-muted-foreground/40"
                                      : "text-muted-foreground/60 group-hover:text-foreground",
                                )}
                              >
                                {thread.title}
                              </div>
                              {section === "settled" && (
                                <span className="shrink-0 text-[11px] font-normal text-muted-foreground/45 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                                  {(() => {
                                    const age =
                                      Date.now() -
                                      new Date(thread.updatedAt ?? thread.createdAt).getTime();
                                    const days = Math.floor(age / 86_400_000);
                                    if (days > 0) return `${days}d`;
                                    const hours = Math.floor(age / 3_600_000);
                                    if (hours > 0) return `${hours}h`;
                                    return `${Math.max(1, Math.floor(age / 60_000))}m`;
                                  })()}
                                </span>
                              )}
                            </div>
                            {section !== "settled" && (
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/55">
                                {section === "snoozed" ? (
                                  <Clock3Icon className="size-3 shrink-0 text-muted-foreground/60" />
                                ) : thread.branch ? (
                                  <GitBranchIcon className="size-3 shrink-0 text-muted-foreground/60 group-hover:text-foreground/75" />
                                ) : (
                                  <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground/60 group-hover:text-foreground/75" />
                                )}
                                <span className="truncate">
                                  {section === "snoozed"
                                    ? `Wakes at ${wakeLabel ?? "the scheduled time"}`
                                    : (thread.branch ??
                                      (deriveThreadAttention(thread)?.spin
                                        ? "Working"
                                        : thread.error
                                          ? "Needs attention"
                                          : threadIsSnoozed
                                            ? "Snoozed"
                                            : lifecycleEntry.pinnedAt
                                              ? "Pinned"
                                              : "Active"))}
                                </span>
                              </div>
                            )}
                          </TooltipTrigger>
                          <TooltipPopup side="right" align="start" className="w-72 p-3">
                            {threadInspector}
                            <div className="hidden space-y-2 text-xs">
                              <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-2">
                                <p className="font-semibold leading-5 text-foreground">
                                  {thread.title}
                                </p>
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                                  {accessibleState}
                                </span>
                              </div>
                              <p className="flex items-center gap-2 text-muted-foreground">
                                <FolderSearchIcon aria-hidden="true" className="size-3.5" />
                                <span className="truncate">{props.project.name}</span>
                              </p>
                              {thread.branch && (
                                <p className="flex items-center gap-2 text-muted-foreground">
                                  <GitBranchIcon aria-hidden="true" className="size-3.5" />
                                  <span className="truncate">Thread branch: {thread.branch}</span>
                                </p>
                              )}
                              {projectGitStatusQuery.data?.branch && (
                                <p className="flex items-center gap-2 text-muted-foreground">
                                  <GitBranchIcon aria-hidden="true" className="size-3.5" />
                                  <span className="truncate">
                                    Checked out: {projectGitStatusQuery.data.branch}
                                  </span>
                                </p>
                              )}
                              {thread.branch &&
                                projectGitStatusQuery.data?.branch &&
                                thread.branch !== projectGitStatusQuery.data.branch && (
                                  <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-amber-500">
                                    <TriangleAlertIcon
                                      aria-hidden="true"
                                      className="mt-0.5 size-3.5 shrink-0"
                                    />
                                    <span>You are currently checked out on another branch.</span>
                                  </p>
                                )}
                              <p className="flex items-center gap-2 text-muted-foreground">
                                <MonitorIcon aria-hidden="true" className="size-3.5" />
                                <span className="truncate">
                                  {thread.worktreePath ?? props.project.cwd}
                                </span>
                              </p>
                              <p className="flex items-center gap-2 text-muted-foreground">
                                <ProviderIcon
                                  instanceId={thread.modelSelection.instanceId}
                                  provider={thread.session?.provider}
                                  className="size-3.5"
                                />
                                {thread.modelSelection.instanceId} · {thread.modelSelection.model}
                              </p>
                              <p className="text-muted-foreground/70">
                                Local workspace · {thread.runtimeMode}
                              </p>
                              <p className="text-muted-foreground/70">
                                {section === "settled"
                                  ? "Settled"
                                  : threadIsSnoozed
                                    ? "Snoozed"
                                    : lifecycleEntry.pinnedAt
                                      ? "Pinned"
                                      : "Active"}
                              </p>
                              {section === "snoozed" && wakeLabel && (
                                <p className="flex items-center gap-2 rounded-md bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
                                  <Clock3Icon aria-hidden="true" className="size-3.5 shrink-0" />
                                  Wakes automatically at {wakeLabel}
                                </p>
                              )}
                            </div>
                          </TooltipPopup>
                        </Tooltip>
                        {!isArchived && (
                          <div className="pointer-events-none absolute right-7 top-1/2 z-10 flex h-7 -translate-y-1/2 items-center gap-0.5 rounded-l-xl border border-r-0 border-border/80 bg-card px-1 opacity-0 shadow-lg shadow-black/25 transition-[opacity,background-color] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-zinc-700/80 dark:bg-zinc-800 dark:shadow-black/60">
                            {/* Left subtle gradient fade so thread title blends out gracefully */}
                            <div className="pointer-events-none absolute -left-5 top-0 bottom-0 w-5 bg-gradient-to-r from-transparent to-card dark:to-zinc-800" />
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label={
                                      lifecycleEntry.pinnedAt ? "Unpin thread" : "Pin thread"
                                    }
                                    aria-pressed={lifecycleEntry.pinnedAt !== null}
                                    className={cn(
                                      "flex size-6 items-center justify-center rounded-lg text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors",
                                      lifecycleEntry.pinnedAt &&
                                        "bg-primary/15 text-primary hover:text-primary",
                                    )}
                                    onClick={() => void dispatchLifecycle(thread, "pin")}
                                  />
                                }
                              >
                                <PinIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">
                                {lifecycleEntry.pinnedAt ? "Unpin thread" : "Pin thread"}
                              </TooltipPopup>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label={
                                      section === "settled"
                                        ? "Return thread to active"
                                        : "Settle thread"
                                    }
                                    className="flex h-6 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-foreground/90 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                                    onClick={() => void dispatchLifecycle(thread, "settle")}
                                  />
                                }
                              >
                                <CircleCheckIcon className="size-3.5 shrink-0" />
                                <span>{section === "settled" ? "Unsettle" : "Settle"}</span>
                              </TooltipTrigger>
                              <TooltipPopup side="top">
                                {section === "settled" ? "Return to active" : "Settle thread"}
                              </TooltipPopup>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label={
                                      threadIsSnoozed ? "Wake thread now" : "Snooze thread"
                                    }
                                    className="flex size-6 items-center justify-center rounded-lg text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                                    onClick={() => void dispatchLifecycle(thread, "snooze")}
                                  />
                                }
                              >
                                <Clock3Icon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">
                                {threadIsSnoozed ? "Wake now" : "Snooze for 1 hour"}
                              </TooltipPopup>
                            </Tooltip>
                          </div>
                        )}
                        <Menu
                          open={openThreadMenuId === thread.id}
                          onOpenChange={(open) => setOpenThreadMenuId(open ? thread.id : null)}
                        >
                          <MenuTrigger
                            render={
                              <button
                                type="button"
                                aria-label={`Thread actions for ${thread.title}`}
                                className="pointer-events-none absolute right-1 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-l-none rounded-r-xl border border-border/80 bg-card text-foreground/80 opacity-0 shadow-lg shadow-black/25 transition-[opacity,background-color] hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 data-[popup-open]:pointer-events-auto data-[popup-open]:bg-accent data-[popup-open]:text-foreground data-[popup-open]:opacity-100 dark:border-zinc-700/80 dark:bg-zinc-800 dark:shadow-black/60"
                              />
                            }
                          >
                            <MoreHorizontalIcon className="size-4" />
                          </MenuTrigger>
                          <MenuPopup
                            align="end"
                            side="bottom"
                            onPointerLeave={(event) => {
                              if (event.pointerType !== "mouse") return;
                              setOpenThreadMenuId(null);
                              if (document.activeElement instanceof HTMLElement) {
                                document.activeElement.blur();
                              }
                            }}
                            className="min-w-48 rounded-xl border border-white/20 bg-popover/75 p-1.5 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.55)] ring-1 ring-black/5 backdrop-blur-2xl supports-[backdrop-filter]:bg-popover/65 dark:border-white/10 dark:ring-white/5"
                          >
                            {!isArchived && (
                              <>
                                <MenuItem onClick={() => props.onOpenThreadToSide?.(thread.id)}>
                                  <Columns2Icon className="size-3.5" />
                                  Open to the side
                                </MenuItem>
                                <MenuItem onClick={() => void dispatchLifecycle(thread, "pin")}>
                                  <PinIcon className="size-3.5" />
                                  {lifecycleEntry.pinnedAt ? "Unpin thread" : "Pin thread"}
                                </MenuItem>
                                {lifecycleEntry.pinnedAt && (
                                  <>
                                    <MenuItem onClick={() => void movePinnedThread(thread, "up")}>
                                      <ArrowUpIcon className="size-3.5" />
                                      Move pinned thread up
                                    </MenuItem>
                                    <MenuItem onClick={() => void movePinnedThread(thread, "down")}>
                                      <ArrowDownIcon className="size-3.5" />
                                      Move pinned thread down
                                    </MenuItem>
                                  </>
                                )}
                                {section === "settled" ? (
                                  <MenuItem
                                    onClick={() => void dispatchLifecycle(thread, "settle")}
                                  >
                                    <CircleCheckIcon className="size-3.5" />
                                    Return to active
                                  </MenuItem>
                                ) : (
                                  <MenuItem
                                    onClick={() => void dispatchLifecycle(thread, "settle")}
                                  >
                                    <CircleCheckIcon className="size-3.5" />
                                    Settle thread
                                  </MenuItem>
                                )}
                                {threadIsSnoozed ? (
                                  <MenuItem
                                    onClick={() => void dispatchLifecycle(thread, "snooze")}
                                  >
                                    <Clock3Icon className="size-3.5" />
                                    Wake now
                                  </MenuItem>
                                ) : (
                                  <MenuSub>
                                    <MenuSubTrigger>
                                      <Clock3Icon className="size-3.5" />
                                      Snooze
                                    </MenuSubTrigger>
                                    <MenuSubPopup>
                                      {resolveSnoozePresets().map((preset) => (
                                        <MenuItem
                                          key={preset.id}
                                          onClick={() =>
                                            void dispatchLifecycle(
                                              thread,
                                              "snooze",
                                              preset.snoozedUntil,
                                            )
                                          }
                                        >
                                          {preset.label} ({preset.whenLabel})
                                        </MenuItem>
                                      ))}
                                    </MenuSubPopup>
                                  </MenuSub>
                                )}
                                <MenuSeparator />
                              </>
                            )}
                            {isArchived ? (
                              <MenuItem onClick={() => void props.onUnarchiveThread(thread)}>
                                <ArchiveRestoreIcon className="size-3.5" />
                                Unarchive thread
                              </MenuItem>
                            ) : (
                              <MenuItem onClick={() => void props.onArchiveThread(thread)}>
                                <ArchiveIcon className="size-3.5" />
                                Archive thread
                              </MenuItem>
                            )}
                            <MenuItem
                              variant="destructive"
                              onClick={() => setThreadPendingDelete(thread)}
                            >
                              <Trash2Icon className="size-3.5" />
                              Delete thread
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </ScrollArea>
        {view === "current" && !showSettledView && !showSnoozedView && snoozedCount > 0 && (
          <div className={cn("shrink-0 border-t border-border/50", collapsed ? "p-1.5" : "p-2")}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Open ${snoozedCount} snoozed thread${snoozedCount === 1 ? "" : "s"}`}
                    onClick={() => setShowSnoozedView(true)}
                    className={cn(
                      "flex items-center rounded-xl border border-border/50 bg-muted/25 text-muted-foreground transition-all hover:border-border hover:bg-accent/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      collapsed
                        ? "size-9 justify-center"
                        : "w-full justify-between px-3 py-2.5 shadow-sm",
                    )}
                  />
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Clock3Icon aria-hidden="true" className="size-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="text-xs font-semibold">Snoozed</span>
                      <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold">
                        {snoozedCount}
                      </span>
                    </>
                  )}
                </span>
                {!collapsed && <ChevronUpIcon aria-hidden="true" className="size-3.5" />}
              </TooltipTrigger>
              <TooltipPopup side={collapsed ? "right" : "top"}>Open snoozed threads</TooltipPopup>
            </Tooltip>
          </div>
        )}
        {collapsed && view === "current" && showSnoozedView && (
          <div className="shrink-0 border-t border-border/50 p-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Back to active threads"
                    onClick={() => setShowSnoozedView(false)}
                    className="flex size-9 items-center justify-center rounded-xl border border-border/50 bg-muted/25 text-muted-foreground transition-colors hover:bg-accent/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                }
              >
                <ArrowLeftIcon aria-hidden="true" className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="right">Back to active threads</TooltipPopup>
            </Tooltip>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {props.children}
      </div>

      {/* ── Delete confirmation dialog ── */}
      <AlertDialog
        open={threadPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setThreadPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete thread?</AlertDialogTitle>
            <AlertDialogDescription>
              {threadPendingDelete
                ? `"${threadPendingDelete.title}" will be removed and its conversation history permanently cleared.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const target = threadPendingDelete;
                setThreadPendingDelete(null);
                if (target) void props.onDeleteThread(target);
              }}
            >
              Delete thread
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function FallbackCodeTool(props: { project: Project }) {
  const [api, setEnvironmentApi] = useState<Awaited<ReturnType<typeof environmentApi>> | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void environmentApi(props.project.environmentId).then((next) => {
      if (active) setEnvironmentApi(next);
    });
    return () => {
      active = false;
    };
  }, [props.project.environmentId]);
  const { resolvedTheme } = useTheme();
  const [query, setQuery] = useState("");
  const setCodeFocusedPath = workspaceShellActions.setCodeFocusedPath;
  const codeState = useAtomValue(
    workspaceShellAtom,
    (state) => state.codeStateByProjectId[props.project.id] ?? EMPTY_PROJECT_CODE_TOOL_STATE,
  );
  const trimmedQuery = query.trim();
  const focusedRelativePath = codeState.lastFocusedPath;
  const searchEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: props.project.environmentId,
      cwd: props.project.cwd,
      query,
      enabled: trimmedQuery.length > 0,
    }),
  );
  const focusedFileQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId: props.project.environmentId,
      cwd: props.project.cwd,
      relativePath: focusedRelativePath,
      enabled: focusedRelativePath !== null,
    }),
  );

  const focusFilePath = useCallback(
    (relativePath: string | null) => {
      setCodeFocusedPath(props.project.id, relativePath);
    },
    [props.project.id, setCodeFocusedPath],
  );

  const openProjectInEditor = useCallback(async () => {
    if (!api) return;
    await openInPreferredEditor(api, props.project.cwd);
  }, [api, props.project.cwd]);

  const openFileInEditor = useCallback(
    async (relativePath: string) => {
      if (!api) return;
      const targetPath = `${props.project.cwd}/${relativePath}`;
      focusFilePath(relativePath);
      await openInPreferredEditor(api, targetPath);
    },
    [api, focusFilePath, props.project.cwd],
  );

  const previewLines = useMemo(
    () => (focusedFileQuery.data?.contents ?? "").split("\n"),
    [focusedFileQuery.data?.contents],
  );
  const previewMetadata = useMemo(() => {
    const contents = focusedFileQuery.data?.contents ?? "";
    return {
      lineCount: previewLines.length,
      charCount: contents.length,
    };
  }, [focusedFileQuery.data?.contents, previewLines.length]);
  const previewRows = useMemo(
    () =>
      previewLines.map((line, lineIndex) => ({
        id: `${focusedRelativePath ?? "preview"}:${lineIndex + 1}:${line}`,
        number: lineIndex + 1,
        line,
      })),
    [focusedRelativePath, previewLines],
  );
  const previewUnavailable = focusedRelativePath === null;
  const previewErrored = focusedFileQuery.isError;

  return (
    <div className="grid h-full min-h-0 min-w-0 gap-4 p-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Card className="min-h-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Code Workspace</CardTitle>
          <CardDescription>
            The shell is already persisting file handoff and project-root launch state here. A
            future Code-OSS mount can plug into this same surface without changing the workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" size="sm" onClick={() => void openProjectInEditor()}>
              <FolderSearchIcon className="size-3.5" />
              Open Project
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!focusedRelativePath}
              onClick={() => {
                if (!focusedRelativePath) return;
                void openFileInEditor(focusedRelativePath);
              }}
            >
              <ExternalLinkIcon className="size-3.5" />
              Open Focused File
            </Button>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/70 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">Workspace Root</div>
                <div className="mt-1 break-all text-muted-foreground">{props.project.cwd}</div>
              </div>
              <Badge variant="outline">Nonce {codeState.navigationNonce}</Badge>
            </div>
            <div className="mt-4 rounded-xl border border-border/60 bg-background/80 p-3">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Current Handoff
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                {focusedRelativePath ?? "Waiting for Git or Agents to hand off a file path."}
              </div>
            </div>
          </div>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Search files and folders in this project"
            />
          </div>
          <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border/70">
            <div className="space-y-1 p-2">
              {trimmedQuery.length === 0 ? (
                focusedRelativePath ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-2">
                    <div className="px-2 pb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Last Focused File
                    </div>
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2">
                      <VscodeEntryIcon
                        pathValue={focusedRelativePath}
                        kind="file"
                        theme={resolvedTheme}
                      />
                      <button
                        type="button"
                        onClick={() => focusFilePath(focusedRelativePath)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium text-foreground">
                          {basenameOfPath(focusedRelativePath)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {focusedRelativePath}
                        </div>
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void openFileInEditor(focusedRelativePath)}
                      >
                        <ExternalLinkIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">
                    Start typing to search the project tree. When Git or Agents hands a file off to
                    Code, it will appear here too.
                  </div>
                )
              ) : searchEntriesQuery.isLoading ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">Searching...</div>
              ) : searchEntriesQuery.data?.entries.length ? (
                searchEntriesQuery.data.entries.map((entry) => (
                  <div
                    key={entry.path}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border border-transparent px-2 py-2 transition-colors",
                      focusedRelativePath === entry.path && entry.kind === "file"
                        ? "border-primary/40 bg-primary/10"
                        : "hover:border-border/70 hover:bg-accent/50",
                    )}
                  >
                    <VscodeEntryIcon
                      pathValue={entry.path}
                      kind={entry.kind}
                      theme={resolvedTheme}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (entry.kind === "file") {
                          focusFilePath(entry.path);
                        }
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-foreground">
                        {basenameOfPath(entry.path)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{entry.path}</div>
                    </button>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {entry.kind}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void openFileInEditor(entry.path)}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No files matched this query.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="border-b border-border/70">
          {focusedRelativePath ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate">{basenameOfPath(focusedRelativePath)}</CardTitle>
                <CardDescription className="mt-1 truncate">{focusedRelativePath}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{previewMetadata.lineCount} lines</Badge>
                <Badge variant="outline">{previewMetadata.charCount} chars</Badge>
              </div>
            </div>
          ) : (
            <>
              <CardTitle>Editor Host Ready</CardTitle>
              <CardDescription>
                Open the project in your preferred editor, or hand a file off here from Git and
                Agents. This is the shell surface Code-OSS will later replace.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-col p-0">
          {previewUnavailable ? (
            <div className="flex h-full min-h-0 flex-col items-start justify-center gap-4 px-8 py-10">
              <Badge variant="outline" className="gap-1.5">
                <WorkflowIcon className="size-3.5" />
                Code Host
              </Badge>
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold text-foreground">
                  Open a file or hand one off
                </h3>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Search the project tree on the left, open the whole repo in your preferred editor,
                  or let Git and Agents target this Code workspace with a persisted file path.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void openProjectInEditor()}>
                  <FolderSearchIcon className="size-3.5" />
                  Open Project
                </Button>
                <Button type="button" variant="outline" onClick={() => setQuery("src")}>
                  <SearchIcon className="size-3.5" />
                  Search Workspace
                </Button>
              </div>
            </div>
          ) : focusedFileQuery.isLoading ? (
            <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
              Loading file preview...
            </div>
          ) : previewErrored ? (
            <div className="flex h-full min-h-0 items-center justify-center px-8 text-sm text-muted-foreground">
              Unable to preview this file here. You can still open it in your preferred editor.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
                <span>Read-only preview</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (!focusedRelativePath) return;
                    void openFileInEditor(focusedRelativePath);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                  Open in Editor
                </Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="font-mono text-xs">
                  {previewRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[4rem_minmax(0,1fr)] border-b border-border/30 last:border-b-0"
                    >
                      <div className="select-none border-r border-border/40 px-3 py-1.5 text-right text-muted-foreground">
                        {row.number}
                      </div>
                      <pre className="overflow-x-auto px-4 py-1.5 whitespace-pre-wrap break-words text-foreground">
                        {row.line.length > 0 ? row.line : " "}
                      </pre>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

let cachedDesktopCodeHostState: DesktopCodeHostState | null = null;

function DesktopCodeTool(props: { project: Project }) {
  const aiProvider = useSettings((s) => s.aiProvider ?? "copilot");
  const api = readNativeApi();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scheduleBoundsRef = useRef<(() => void) | null>(null);
  const [codeHostState, setCodeHostState] = useState<DesktopCodeHostState | null>(
    cachedDesktopCodeHostState,
  );
  const [hostReady, setHostReady] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const [menuBackdrop, setMenuBackdrop] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const codeState = useAtomValue(
    workspaceShellAtom,
    (state) => state.codeStateByProjectId[props.project.id] ?? EMPTY_PROJECT_CODE_TOOL_STATE,
  );
  // Native-chrome state pushed from the embedded workbench through the desktop
  // bridge (the integration extension reports view/panel/scm state over the
  // loopback control channel). Clicks forward allowlisted workbench commands.
  const chromeState = useAtomValue(
    workspaceShellAtom,
    (state) => state.codeChromeStateByProjectId?.[props.project.id] ?? DEFAULT_CODE_CHROME_STATE,
  );
  const projectId = props.project.id;
  // Native AI side chat (Antigravity-style): a compact embed of the project's
  // Agents chat docked to the right of the editor, toggled from the header. It
  // replaces VS Code's secondary sidebar / GitHub Copilot panel (which is hidden
  // in the embed). A lightweight quick-chat — its own resizable width, a thread
  // history switcher and a new-thread button; the full Agents tab stays the place
  // for everything else.
  // Side chat open-state + selected thread are persisted per project in the
  // workspace store (not local component state), so switching tools/projects —
  // which unmounts this Code tool — keeps the side chat open on the same running
  // thread instead of resetting and "losing" the in-flight task. The thread is
  // an override so switching/creating from the side chat doesn't navigate the
  // whole app (the full Agents tab is route-driven; this isn't).
  const sideChatOpen = codeState.sideChatOpen;
  const sideChatThreadIdOverride = codeState.sideChatThreadId;
  const setSideChatOpenStore = workspaceShellActions.setSideChatOpen;
  const setSideChatThreadStore = workspaceShellActions.setSideChatThread;
  const setSideChatOpen = useCallback(
    (open: boolean) => setSideChatOpenStore(projectId, open),
    [projectId, setSideChatOpenStore],
  );
  const setSideChatThreadIdOverride = useCallback(
    (threadId: ThreadId | null) => setSideChatThreadStore(projectId, threadId),
    [projectId, setSideChatThreadStore],
  );
  const [sideChatWidth, setSideChatWidth] = useState(() => {
    const saved = Number(window.localStorage?.getItem("tabs.sideChatWidth"));
    return Number.isFinite(saved) && saved >= 300 ? Math.min(saved, 760) : 380;
  });
  const sideChatWidthRef = useRef(sideChatWidth);
  sideChatWidthRef.current = sideChatWidth;
  const [isResizingSideChat, setIsResizingSideChat] = useState(false);
  const rememberedThreadId = useAtomValue(
    workspaceShellAtom,
    (state) => state.session.rememberedThreadIdByProjectId[projectId] ?? null,
  );
  // Select the stable threads array, then derive the sorted project list in a
  // memo. Deriving INSIDE the selector would return a new array on every
  // getSnapshot, which makes useSyncExternalStore re-render infinitely
  // ("Maximum update depth exceeded").
  const allThreads = useAtomValue(threadsAtom);
  const projectThreads = useMemo(
    () => sortProjectThreads(allThreads.filter((thread) => thread.projectId === projectId)),
    [allThreads, projectId],
  );
  const defaultSideChatThread = useMemo(
    () => resolveProjectAgentThread(projectId, allThreads, rememberedThreadId),
    [allThreads, projectId, rememberedThreadId],
  );
  const [showSideChatHistory, setShowSideChatHistory] = useState(false);
  // The thread the side chat renders: the user's explicit pick (which may be a
  // brand-new DRAFT thread not yet in `projectThreads`) else the project default.
  // Render by id directly so a freshly created draft shows immediately (the "+").
  const sideChatThreadId = sideChatThreadIdOverride ?? defaultSideChatThread?.id ?? null;
  const sideChatThreadTitle =
    projectThreads.find((thread) => thread.id === sideChatThreadId)?.title ||
    (sideChatThreadId ? "New chat" : "Chat");

  // Fix 1: Auto-create a thread when side chat opens with no thread
  useEffect(() => {
    if (!sideChatOpen) return;
    if (sideChatThreadId) return; // already has a thread

    const { getDraftThreadByProjectId, setProjectDraftThreadId } = composerDraftActions;

    // Get existing draft thread for this project, or create one
    const existingDraft = getDraftThreadByProjectId(projectId);
    if (existingDraft) {
      setSideChatThreadIdOverride(existingDraft.threadId);
    } else {
      const nextThreadId = newThreadId();
      setProjectDraftThreadId(projectId, nextThreadId, {
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
      });
      setSideChatThreadIdOverride(nextThreadId);
    }
  }, [sideChatOpen, sideChatThreadId, projectId, setSideChatThreadIdOverride]);

  // Fix 3: Bounds update when side chat opens/closes/resizes
  useEffect(() => {
    scheduleBoundsRef.current?.();
  }, [sideChatOpen, sideChatWidth]);

  // Drag-to-resize the side chat from its left edge (BrowserView follows via the
  // bounds ResizeObserver). Persist the chosen width across sessions.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
    };
  }, []);

  const startSideChatResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sideChatWidthRef.current;
    // Mount the resize overlay → the BrowserView hides → pointer events flow to
    // the window even as the cursor crosses the editor area while widening.
    setIsResizingSideChat(true);

    if (dragCleanupRef.current) {
      dragCleanupRef.current();
    }

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(760, Math.max(300, startWidth + (startX - moveEvent.clientX)));
      setSideChatWidth(next);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragCleanupRef.current === cleanup) {
        dragCleanupRef.current = null;
      }
    };

    const onUp = () => {
      cleanup();
      window.localStorage?.setItem("tabs.sideChatWidth", String(sideChatWidthRef.current));
      setIsResizingSideChat(false);
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);
  const onNewSideChatThread = useCallback(() => {
    const { setProjectDraftThreadId } = composerDraftActions;
    const nextThreadId = newThreadId();
    setProjectDraftThreadId(projectId, nextThreadId, {
      createdAt: new Date().toISOString(),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
    });
    setSideChatThreadIdOverride(nextThreadId);
    setShowSideChatHistory(false);
  }, [projectId, setSideChatThreadIdOverride]);
  const runCodeCommand = useCallback(
    (commandId: string) => {
      const targetItem = CODE_ACTIVITY_ITEMS.find((item) => item.commandId === commandId);
      const targetCustomItem = chromeState.activityBarItems?.find(
        (item) => item.commandId === commandId,
      );
      const matchedViewId = targetItem?.id ?? targetCustomItem?.id ?? null;
      if (matchedViewId) {
        workspaceShellActions.setCodeChromeState(projectId, (curr: CodeChromeState) => ({
          ...curr,
          activeViewId: matchedViewId,
        }));
      }
      void window.desktopBridge?.runCodeCommand(projectId, commandId).catch(() => undefined);
    },
    [projectId, chromeState.activityBarItems],
  );
  useEffect(() => {
    if (aiProvider === "copilot") {
      setSideChatOpen(false);
    }
  }, [aiProvider, projectId, setSideChatOpen]);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getCodeChromeState) {
      return;
    }
    let cancelled = false;
    void bridge
      .getCodeChromeState({ projectId })
      .then((state) => {
        if (!cancelled && state) {
          workspaceShellActions.setCodeChromeState(projectId, state);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const openProjectInEditor = useCallback(async () => {
    if (!api) return;
    await openInPreferredEditor(api, props.project.cwd);
  }, [api, props.project.cwd]);
  const shouldUseFallbackTool =
    codeHostState !== null && (!codeHostState.available || hostError !== null);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      setCodeHostState(DEFAULT_DESKTOP_CODE_HOST_STATE);
      return;
    }
    let cancelled = false;
    void bridge
      .getCodeHostState()
      .then((state) => {
        cachedDesktopCodeHostState = state;
        if (!cancelled) {
          setCodeHostState(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCodeHostState(DEFAULT_DESKTOP_CODE_HOST_STATE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !codeHostState?.available) {
      setHostReady(false);
      return;
    }

    let cancelled = false;
    setHostReady(false);
    setHostError(null);
    void bridge
      .ensureCodeSession({
        projectId: props.project.id,
        workspaceRoot: props.project.cwd,
      })
      .then(async () => {
        let hostNode = hostRef.current;
        if (!hostNode) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          hostNode = hostRef.current;
        }
        if (!hostNode) {
          throw new Error("The Code workbench host is unavailable.");
        }
        const cssZoom = parseFloat(document.documentElement.style.zoom) || 1;
        const rect = hostNode.getBoundingClientRect();
        await bridge.setCodeBounds({
          projectId: props.project.id,
          x: rect.x * cssZoom,
          y: rect.y * cssZoom,
          width: rect.width * cssZoom,
          height: rect.height * cssZoom,
          visible: rect.width > 0 && rect.height > 0,
        });
        await bridge.activateCodeSession({
          projectId: props.project.id,
        });
      })
      .then(() => {
        if (!cancelled) {
          setHostReady(true);
          // The desktop bridge guarantees only that the host session is ready.
          // Workbench, integration-extension, and optional-extension readiness
          // require distinct native signals and must not be fabricated here.
          markStartupStage("code-host-session-ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHostReady(false);
          setHostError(
            error instanceof Error
              ? error.message
              : "Failed to start the local Code-OSS runtime for this project.",
          );
        }
      });

    return () => {
      cancelled = true;
      // Do not hide here. React Strict Mode and Fast Refresh run effect cleanup
      // while the Code tool is still active; hiding aborts the custom-protocol
      // navigation and leaves an empty workbench. WorkspaceShell's active-tool
      // effect is the single owner of hiding when the user truly leaves Code.
    };
  }, [codeHostState?.available, props.project.cwd, props.project.id, retryNonce]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !codeHostState?.available || !codeState.lastFocusedPath) {
      return;
    }
    void bridge
      .openCodeFile({
        projectId: props.project.id,
        relativePath: codeState.lastFocusedPath,
        navigationNonce: codeState.navigationNonce,
        ...(typeof codeState.lastFocusedLineNumber === "number" &&
        codeState.lastFocusedLineNumber > 0
          ? { lineNumber: codeState.lastFocusedLineNumber }
          : {}),
      })
      .catch(() => undefined);
  }, [
    codeHostState?.available,
    codeState.lastFocusedPath,
    codeState.lastFocusedLineNumber,
    codeState.navigationNonce,
    props.project.id,
  ]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    const hostNode = hostRef.current;
    if (!bridge || !codeHostState?.available || !hostNode) {
      return;
    }

    let frameId = 0;
    let lastSignature = "";
    const publishBounds = () => {
      frameId = 0;
      const cssZoom =
        (typeof document !== "undefined" && parseFloat(document.documentElement.style.zoom)) || 1.0;
      const rect = hostNode.getBoundingClientRect();
      const nextBounds = {
        projectId: props.project.id,
        x: rect.x * cssZoom,
        y: rect.y * cssZoom,
        width: rect.width * cssZoom,
        height: rect.height * cssZoom,
        visible: rect.width > 0 && rect.height > 0,
      };
      const signature = [
        nextBounds.projectId,
        Math.round(nextBounds.x),
        Math.round(nextBounds.y),
        Math.round(nextBounds.width),
        Math.round(nextBounds.height),
        nextBounds.visible ? "1" : "0",
      ].join(":");
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      void bridge.setCodeBounds(nextBounds).catch(() => undefined);
    };
    const scheduleBounds = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(publishBounds);
    };

    scheduleBoundsRef.current = scheduleBounds;

    const resizeObserver = new ResizeObserver(() => {
      scheduleBounds();
    });
    resizeObserver.observe(hostNode);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("tabs-zoom-change", scheduleBounds);
    scheduleBounds();

    return () => {
      scheduleBoundsRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("tabs-zoom-change", scheduleBounds);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
      void bridge
        .setCodeBounds({
          projectId: props.project.id,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false,
        })
        .catch(() => undefined);
    };
  }, [codeHostState?.available, props.project.id]);

  useNativeSurfaceOverlaySuspension({
    enabled: Boolean(window.desktopBridge && codeHostState?.available),
    surfaceReady: hostReady,
    onSuspend: () => {
      void window.desktopBridge?.hideCodeSession().catch(() => undefined);
    },
    onResume: () => {
      void window.desktopBridge
        ?.activateCodeSession({
          projectId: props.project.id,
        })
        .catch(() => undefined);
    },
  });

  if (shouldUseFallbackTool) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        <div className="border-b border-border/70 bg-card/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {hostError?.includes("project folder no longer exists")
                  ? "Project folder unavailable"
                  : "Embedded Code-OSS unavailable"}
              </div>
              <div className="text-xs text-muted-foreground">
                {getCodeHostUnavailableMessage(hostError ?? codeHostState?.reason ?? null)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setHostError(null);
                  setHostReady(false);
                  setRetryNonce((n) => n + 1);
                }}
              >
                <RefreshCwIcon className="mr-1.5 size-3.5" />
                Retry
              </Button>
              <Button type="button" size="sm" onClick={() => void openProjectInEditor()}>
                <FolderSearchIcon className="size-3.5" />
                Open In Editor
              </Button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <FallbackCodeTool project={props.project} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <CodeHeaderBar
        workspaceName={props.project.name}
        activeFilePath={
          chromeState.openTabs?.find((tab) => tab.active)?.filePath ?? codeState.lastFocusedPath
        }
        branch={chromeState.branch}
        panelMaximized={chromeState.panelMaximized}
        sideChatOpen={aiProvider === "tabs" ? sideChatOpen : undefined}
        sideChatLabel={
          aiProvider === "copilot" ? "Toggle GitHub Copilot chat" : "Toggle Tabs AI chat"
        }
        onToggleSideChat={() => {
          if (aiProvider === "copilot") {
            runCodeCommand(CODE_CHROME_COMMANDS.toggleAuxiliaryBar);
          } else {
            setSideChatOpen(!sideChatOpen);
          }
        }}
        onRunCommand={runCodeCommand}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <CodeActivityRail
          chromeState={chromeState}
          onApplicationMenuOpenChange={async (open) => {
            const bridge = window.desktopBridge;
            if (!bridge) return;
            if (open) {
              const snapshot = await bridge.captureCodeSession({ projectId }).catch(() => null);
              setMenuBackdrop(snapshot);
              await bridge.hideCodeSession().catch(() => undefined);
              return;
            }
            await bridge.activateCodeSession({ projectId }).catch(() => undefined);
            setMenuBackdrop(null);
          }}
          onRunCommand={runCodeCommand}
        />
        {/* Code-OSS owns the editor workbench inside this host region while Tabs
            owns the stable outer navigation and workspace toolbar. */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <div ref={hostRef} className="absolute inset-0 min-h-0 min-w-0 bg-background" />
          {menuBackdrop ? (
            <img
              src={menuBackdrop}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full select-none"
            />
          ) : null}
          {!hostReady ? (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/64 text-sm text-muted-foreground"
            >
              <div className="rounded-2xl border border-border/70 bg-background/86 px-5 py-4 shadow-lg backdrop-blur-sm">
                {hostError ?? "Attaching stock Code-OSS for this project…"}
              </div>
            </div>
          ) : null}
        </div>
        {sideChatOpen && aiProvider === "tabs" ? (
          <aside
            style={{ width: sideChatWidth }}
            className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border/70 bg-background text-foreground"
          >
            {/* Drag-to-resize handle on the chat's left edge. */}
            <div
              onPointerDown={startSideChatResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat"
              className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize hover:bg-primary/40"
            />
            {/* Compact header: current thread, a history toggle (opens a full
                in-panel thread list), and new thread. Threads are shared with the
                Agents tab (same store), so anything started here shows there too. */}
            <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 pl-3 pr-1.5">
              <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {showSideChatHistory ? "History" : sideChatThreadTitle}
              </span>
              <button
                type="button"
                aria-label="Thread history"
                aria-pressed={showSideChatHistory}
                onClick={() => setShowSideChatHistory((open) => !open)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  showSideChatHistory && "bg-accent text-foreground",
                )}
              >
                <HistoryIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="New chat thread"
                onClick={() => void onNewSideChatThread()}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PlusIcon className="size-4" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">
              {showSideChatHistory ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {(() => {
                    const sideChatThreads = projectThreads;
                    if (sideChatThreads.length === 0) {
                      return (
                        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                          No threads yet. Hit + to start one.
                        </div>
                      );
                    }
                    return sideChatThreads.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => {
                          setSideChatThreadIdOverride(thread.id);
                          setShowSideChatHistory(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                          thread.id === sideChatThreadId
                            ? "bg-accent/60 text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <MessageSquareIcon className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {thread.title || "Untitled"}
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              ) : sideChatThreadId ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <MercuryChromeLoader size={80} />
                    </div>
                  }
                >
                  <ChatView
                    key={sideChatThreadId}
                    {...(props.project.environmentId
                      ? { environmentId: props.project.environmentId }
                      : {})}
                    threadId={sideChatThreadId}
                    compact
                    onRequestThread={setSideChatThreadIdOverride}
                  />
                </Suspense>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <MessageSquareIcon className="size-6 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">No chat yet</div>
                  <div className="text-xs text-muted-foreground">
                    Hit + to start a thread, or open one from history.
                  </div>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
      {isResizingSideChat ? (
        <div data-slot="code-resize-overlay" className="fixed inset-0 z-50 cursor-col-resize" />
      ) : null}
    </div>
  );
}

function CodeTool(props: { project: Project }) {
  if (window.desktopBridge && isPrimaryEnvironment(props.project.environmentId)) {
    return <DesktopCodeTool project={props.project} />;
  }

  return <FallbackCodeTool project={props.project} />;
}

function readInitialGitWorkspaceMode(): GitWorkspaceMode {
  if (typeof window === "undefined") return "basic";
  const value = window.localStorage.getItem(GIT_WORKSPACE_MODE_STORAGE_KEY);
  return value === "advanced" ? "advanced" : "basic";
}

function emitGitWorkspaceTelemetry(
  event:
    | "git_mode_switched"
    | "git_mode_auto_switched"
    | "git_basic_primary_action_executed"
    | "git_advanced_action_executed"
    | "git_action_cancelled_confirm_dialog"
    | "git_advanced_drawer_opened"
    | "git_terminal_dock_toggled",
  detail?: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("tabs:git-telemetry", {
      detail: {
        event,
        ...detail,
      },
    }),
  );
}

function GitTool(props: {
  project: Project;
  activeThreadId: ThreadId | null;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onOpenAgents: () => void | Promise<void>;
  onCreateAgentsThread: () => void | Promise<void>;
  onRunGitHubLogin: () => void | Promise<void>;
  onOpenFileInCode: (relativePath: string) => void;
  onDispatchRelease: (version: string, branch: string) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const {
    project,
    activeThreadId,
    terminalAvailable,
    terminalOpen,
    onToggleTerminal,
    onOpenAgents,
    onCreateAgentsThread,
    onRunGitHubLogin,
    onOpenFileInCode,
    onDispatchRelease,
  } = props;
  const [api, setGitEnvironmentApi] = useState<Awaited<ReturnType<typeof environmentApi>> | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void environmentApi(project.environmentId).then((next) => {
      if (active) setGitEnvironmentApi(next);
    });
    return () => {
      active = false;
    };
  }, [project.environmentId]);
  const keybindings = useKeybindings();
  const queryClient = useQueryClient();
  const gitStatusQuery = useQuery(gitStatusQueryOptions(project.cwd, project.environmentId));
  const gitEnvironmentQuery = useQuery(
    gitEnvironmentQueryOptions(project.cwd, project.environmentId),
  );
  const branchesQuery = useQuery(gitBranchesQueryOptions(project.cwd, project.environmentId));
  const gitInitMutation = useMutation(
    gitInitMutationOptions({
      cwd: project.cwd,
      queryClient,
      environmentId: project.environmentId,
    }),
  );
  const historyQuery = useQuery(
    gitHistoryQueryOptions({
      cwd: project.cwd,
      limit: 40,
      environmentId: project.environmentId,
    }),
  );
  const stashQuery = useQuery(gitStashListQueryOptions(project.cwd, project.environmentId));
  const [branchDraft, setBranchDraft] = useState("");
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [createBranchName, setCreateBranchName] = useState("");
  const [commitToolSha, setCommitToolSha] = useState("");
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [releaseVersion, setReleaseVersion] = useState("");
  // The branch the release workflow runs from (release.yml `--ref`). Defaults to
  // the current branch when the dialog opens; editable so you can cut a release
  // from any local branch.
  const [releaseBranch, setReleaseBranch] = useState("");
  const [branchToolsTarget, setBranchToolsTarget] = useState("");
  const [branchToolsSearch, setBranchToolsSearch] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [operationBranch, setOperationBranch] = useState("");
  const [operationBranchSearch, setOperationBranchSearch] = useState("");
  const [upstreamSelection, setUpstreamSelection] = useState("");
  const [upstreamSearch, setUpstreamSearch] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [branchManagerOpen, setBranchManagerOpen] = useState(false);
  const [advancedActionsOpen, setAdvancedActionsOpen] = useState(false);
  const [stashPanelOpen, setStashPanelOpen] = useState(false);
  const [gitWorkspaceMode, setGitWorkspaceMode] = useState<GitWorkspaceMode>(() =>
    readInitialGitWorkspaceMode(),
  );
  const [gitTaskInFlight, setGitTaskInFlight] = useState<string | null>(null);
  const [discardAllConfirmOpen, setDiscardAllConfirmOpen] = useState(false);
  const [discardAllConfirmText, setDiscardAllConfirmText] = useState("");
  const [deleteBranchConfirmOpen, setDeleteBranchConfirmOpen] = useState(false);
  const [deleteBranchConfirmText, setDeleteBranchConfirmText] = useState("");
  const [resolverFilePath, setResolverFilePath] = useState<string | null>(null);
  const [resolverMode, setResolverMode] = useState<GitConflictResolverMode>("manual");
  const [resolverDraft, setResolverDraft] = useState("");
  const [resolverDirty, setResolverDirty] = useState(false);
  const [aiConflictState, setAiConflictState] = useState<GitAiConflictState>({
    status: "idle",
    userMessageId: null,
    sourceMessageId: null,
    proposal: null,
    error: null,
  });
  const gitToolState = useAtomValue(
    workspaceShellAtom,
    (state) => state.gitStateByProjectId[project.id] ?? EMPTY_PROJECT_GIT_TOOL_STATE,
  );
  const selectedPath = gitToolState.selectedPath;
  const selectedCommit = gitToolState.selectedCommit;
  const setSelectedPath = workspaceShellActions.setGitSelectedPath;
  const setSelectedCommit = workspaceShellActions.setGitSelectedCommit;
  const activeAgentsThread = useAtomValue(threadsAtom, (state) =>
    activeThreadId ? (state.find((thread) => thread.id === activeThreadId) ?? null) : null,
  );

  const allBranches = useMemo(
    () => branchesQuery.data?.branches ?? [],
    [branchesQuery.data?.branches],
  );
  const activeBranch = branchesQuery.data?.branches.find((branch) => branch.current) ?? null;
  const localBranches = useMemo(
    () => allBranches.filter((branch) => !branch.isRemote),
    [allBranches],
  );
  const remoteBranches = useMemo(
    () => allBranches.filter((branch) => branch.isRemote),
    [allBranches],
  );
  const branchToolOptions = localBranches.map((branch) => branch.name);
  const upstreamOptions = remoteBranches.filter((branch) => deriveRemoteSelectionParts(branch));
  const operationBranchOptions = useMemo(
    () => [
      ...localBranches
        .filter((branch) => !branch.current)
        .map((branch) => ({
          value: branch.name,
          label: branch.name,
          kind: "local" as const,
        })),
      ...remoteBranches
        .filter((branch) => {
          const remote = deriveRemoteSelectionParts(branch);
          return remote !== null && remote.remoteBranch !== "HEAD";
        })
        .map((branch) => ({
          value: branch.name,
          label: branch.name,
          kind: "remote" as const,
        })),
    ],
    [localBranches, remoteBranches],
  );
  const localOperationBranchOptions = operationBranchOptions.filter(
    (branch) => branch.kind === "local",
  );
  const remoteOperationBranchOptions = operationBranchOptions.filter(
    (branch) => branch.kind === "remote",
  );
  const branchToolsSearchQuery = branchToolsSearch.trim().toLowerCase();
  const upstreamSearchQuery = upstreamSearch.trim().toLowerCase();
  const operationBranchSearchQuery = operationBranchSearch.trim().toLowerCase();
  const filteredBranchToolOptions = useMemo(
    () =>
      branchToolOptions.filter((branchName) =>
        branchToolsSearchQuery.length === 0
          ? true
          : branchName.toLowerCase().includes(branchToolsSearchQuery),
      ),
    [branchToolOptions, branchToolsSearchQuery],
  );
  const filteredUpstreamOptions = useMemo(
    () =>
      upstreamOptions.filter((branch) =>
        upstreamSearchQuery.length === 0
          ? true
          : branch.name.toLowerCase().includes(upstreamSearchQuery),
      ),
    [upstreamOptions, upstreamSearchQuery],
  );
  const filteredLocalOperationBranchOptions = useMemo(
    () =>
      localOperationBranchOptions.filter((branch) =>
        operationBranchSearchQuery.length === 0
          ? true
          : branch.label.toLowerCase().includes(operationBranchSearchQuery),
      ),
    [localOperationBranchOptions, operationBranchSearchQuery],
  );
  const filteredRemoteOperationBranchOptions = useMemo(
    () =>
      remoteOperationBranchOptions.filter((branch) =>
        operationBranchSearchQuery.length === 0
          ? true
          : branch.label.toLowerCase().includes(operationBranchSearchQuery),
      ),
    [operationBranchSearchQuery, remoteOperationBranchOptions],
  );
  const changedFiles = gitStatusQuery.data?.workingTree.files ?? [];
  const stagedFiles = gitStatusQuery.data?.staged?.files ?? [];
  const conflictedFiles = useMemo(
    () => gitStatusQuery.data?.conflicted?.files ?? [],
    [gitStatusQuery.data?.conflicted?.files],
  );
  const untrackedFiles = gitStatusQuery.data?.untracked?.files ?? [];
  const unstagedFiles =
    gitStatusQuery.data?.unstaged?.files.filter((file) => !file.conflicted && !file.untracked) ??
    [];
  const branchHeadline = activeBranch?.name ?? gitStatusQuery.data?.branch ?? "Detached HEAD";
  const aheadCount = gitStatusQuery.data?.aheadCount ?? 0;
  const behindCount = gitStatusQuery.data?.behindCount ?? 0;
  const syncStatusLabel = !gitStatusQuery.data?.hasUpstream
    ? "No upstream — push to publish this branch"
    : aheadCount > 0 && behindCount > 0
      ? `${aheadCount} to push · ${behindCount} to pull`
      : aheadCount > 0
        ? `${aheadCount} commit${aheadCount === 1 ? "" : "s"} to push`
        : behindCount > 0
          ? `${behindCount} commit${behindCount === 1 ? "" : "s"} to pull`
          : "Up to date with remote";
  const currentOperation = gitStatusQuery.data?.operation ?? null;
  const historyCommits = historyQuery.data?.commits ?? [];
  const stashEntries = stashQuery.data?.entries ?? [];
  const activeHistoryCommit = selectedCommit
    ? (historyCommits.find((commit) => commit.sha === selectedCommit) ?? null)
    : null;
  const branchToolsBranch =
    localBranches.find((branch) => branch.name === branchToolsTarget) ?? activeBranch ?? null;
  const selectedUpstreamBranch =
    remoteBranches.find((branch) => branch.name === upstreamSelection) ?? null;
  const activeConflictedFile = resolverFilePath
    ? (conflictedFiles.find((file) => file.path === resolverFilePath) ?? null)
    : null;
  const activeConflictedFileIndex = activeConflictedFile
    ? conflictedFiles.findIndex((file) => file.path === activeConflictedFile.path)
    : -1;
  const totalConflictCount = conflictedFiles.length;
  const diffQuery = useQuery(
    gitDiffQueryOptions({
      environmentId: project.environmentId,
      cwd: project.cwd,
      path: selectedPath,
      commit: selectedPath ? null : (activeHistoryCommit?.sha ?? null),
    }),
  );
  const conflictSnapshotQuery = useQuery(
    gitConflictSnapshotQueryOptions({
      environmentId: project.environmentId,
      cwd: project.cwd,
      path: resolverFilePath,
      enabled: resolverFilePath !== null,
    }),
  );
  const conflictFileQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId: project.environmentId,
      cwd: project.cwd,
      relativePath: resolverFilePath,
      enabled: resolverFilePath !== null,
    }),
  );
  const resolverPatch =
    resolverMode === "ai" && resolverFilePath && aiConflictState.proposal
      ? buildPreviewPatch(
          resolverFilePath,
          conflictFileQuery.data?.contents ?? "",
          aiConflictState.proposal,
        )
      : resolverFilePath && resolverDirty
        ? buildPreviewPatch(resolverFilePath, conflictFileQuery.data?.contents ?? "", resolverDraft)
        : null;
  const selectedWorkingTreeFile = selectedPath
    ? (changedFiles.find((file) => file.path === selectedPath) ?? null)
    : null;
  const selectedPatchFile = useMemo(
    () => resolveSelectedPatchFile(diffQuery.data?.patch, selectedPath, `git-shell:${project.id}`),
    [diffQuery.data?.patch, project.id, selectedPath],
  );
  const selectedPatchHunks = selectedPatchFile?.hunks ?? [];
  const hunkActionState = useMemo(
    () => resolveGitHunkActionModes(selectedWorkingTreeFile),
    [selectedWorkingTreeFile],
  );

  useEffect(() => {
    if (operationBranchOptions.length === 0) {
      if (operationBranch.length > 0) {
        setOperationBranch("");
      }
      return;
    }
    if (!operationBranchOptions.some((branch) => branch.value === operationBranch)) {
      setOperationBranch(operationBranchOptions[0]?.value ?? "");
    }
  }, [operationBranch, operationBranchOptions]);

  useEffect(() => {
    if (branchToolOptions.length === 0) {
      if (branchToolsTarget.length > 0) {
        setBranchToolsTarget("");
      }
      return;
    }
    if (!branchToolOptions.includes(branchToolsTarget)) {
      setBranchToolsTarget(activeBranch?.name ?? branchToolOptions[0] ?? "");
    }
  }, [activeBranch?.name, branchToolOptions, branchToolsTarget]);

  useEffect(() => {
    setRenameDraft(branchToolsTarget);
  }, [branchToolsTarget]);

  useEffect(() => {
    if (upstreamOptions.length === 0) {
      if (upstreamSelection.length > 0) {
        setUpstreamSelection("");
      }
      return;
    }
    const targetLocalName = branchToolsTarget.trim();
    const matchingRemote =
      targetLocalName.length > 0
        ? upstreamOptions.find((branch) => {
            const remote = deriveRemoteSelectionParts(branch);
            return remote?.remoteBranch === targetLocalName;
          })
        : null;
    const preferredSelection = matchingRemote?.name ?? upstreamOptions[0]?.name ?? "";
    if (!upstreamOptions.some((branch) => branch.name === upstreamSelection)) {
      setUpstreamSelection(preferredSelection);
    }
  }, [branchToolsTarget, upstreamOptions, upstreamSelection]);

  useEffect(() => {
    if (!resolverFilePath) {
      setResolverDraft("");
      setResolverDirty(false);
      setAiConflictState({
        status: "idle",
        userMessageId: null,
        sourceMessageId: null,
        proposal: null,
        error: null,
      });
      return;
    }
    if (conflictFileQuery.data?.relativePath !== resolverFilePath) {
      return;
    }
    setResolverDraft(conflictFileQuery.data.contents);
    setResolverDirty(false);
  }, [conflictFileQuery.data, resolverFilePath]);

  useEffect(() => {
    if (
      resolverMode !== "ai" ||
      aiConflictState.status !== "waiting" ||
      !activeAgentsThread ||
      !aiConflictState.userMessageId
    ) {
      return;
    }

    const requestIndex = activeAgentsThread.messages.findIndex(
      (message) => message.id === aiConflictState.userMessageId,
    );
    if (requestIndex < 0) {
      return;
    }

    const proposalMessage =
      activeAgentsThread.messages
        .slice(requestIndex + 1)
        .find(
          (message) => message.role === "assistant" && !message.streaming && message.text.trim(),
        ) ?? null;
    if (!proposalMessage) {
      return;
    }

    const proposal = extractFirstCodeFence(proposalMessage.text) ?? proposalMessage.text.trim();
    setAiConflictState({
      status: "ready",
      userMessageId: aiConflictState.userMessageId,
      sourceMessageId: proposalMessage.id,
      proposal,
      error: null,
    });
  }, [activeAgentsThread, aiConflictState, resolverMode]);

  const branchCreateMutation = useMutation({
    mutationFn: async (branchName: string) => {
      if (!api) throw new Error("Git API unavailable.");
      await api.git.createBranch({ cwd: project.cwd, branch: branchName });
      return branchName;
    },
    onSuccess: async (branchName) => {
      setBranchDraft("");
      await queryClient.invalidateQueries({ queryKey: ["git"] });
      toastManager.add({
        type: "success",
        title: `Created branch "${branchName}"`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not create branch",
        description: toGitUserFacingErrorMessage(error),
      });
    },
  });

  const branchRenameMutation = useMutation({
    mutationFn: async (input: { oldBranch: string; newBranch: string }) => {
      if (!api) throw new Error("Git API unavailable.");
      return api.git.renameBranch({
        cwd: project.cwd,
        oldBranch: input.oldBranch,
        newBranch: input.newBranch,
      });
    },
    onSuccess: async (result, input) => {
      setBranchToolsTarget(result.branch);
      setRenameDraft(result.branch);
      await queryClient.invalidateQueries({ queryKey: ["git"] });
      toastManager.add({
        type: "success",
        title: `Renamed ${input.oldBranch} to ${result.branch}`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not rename branch",
        description: toGitUserFacingErrorMessage(error),
      });
    },
  });

  const branchDeleteMutation = useMutation({
    mutationFn: async (input: { branch: string; force?: boolean }) => {
      if (!api) throw new Error("Git API unavailable.");
      await api.git.deleteBranch({
        cwd: project.cwd,
        branch: input.branch,
        force: input.force,
      });
      return input.branch;
    },
    onSuccess: async (branchName) => {
      if (branchToolsTarget === branchName) {
        const fallbackBranch =
          localBranches.find((branch) => branch.current)?.name ??
          localBranches.find((branch) => branch.name !== branchName)?.name ??
          "";
        setBranchToolsTarget(fallbackBranch);
      }
      await queryClient.invalidateQueries({ queryKey: ["git"] });
      toastManager.add({
        type: "success",
        title: `Deleted ${branchName}`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not delete branch",
        description: toGitUserFacingErrorMessage(error),
      });
    },
  });

  const branchUpstreamMutation = useMutation({
    mutationFn: async (input: { branch: string; remoteName: string; remoteBranch: string }) => {
      if (!api) throw new Error("Git API unavailable.");
      await api.git.setBranchUpstream({
        cwd: project.cwd,
        branch: input.branch,
        remoteName: input.remoteName,
        remoteBranch: input.remoteBranch,
      });
      return input;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["git"] });
      toastManager.add({
        type: "success",
        title: `Tracking ${result.remoteName}/${result.remoteBranch}`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not set upstream",
        description: toGitUserFacingErrorMessage(error),
      });
    },
  });

  const invalidateGit = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["git"] });
  }, [queryClient]);

  const runGitTask = useCallback(
    async (input: {
      id: string;
      title: string;
      task: () => Promise<void>;
      successTitle?: string;
      onSuccess?: () => void;
      invalidateOnError?: boolean;
    }) => {
      setGitTaskInFlight(input.id);
      try {
        await input.task();
        await invalidateGit();
        input.onSuccess?.();
        if (input.successTitle) {
          toastManager.add({
            type: "success",
            title: input.successTitle,
          });
        }
      } catch (error) {
        if (input.invalidateOnError) {
          await invalidateGit();
        }
        toastManager.add({
          type: "error",
          title: input.title,
          description: toGitUserFacingErrorMessage(error),
        });
      } finally {
        setGitTaskInFlight(null);
      }
    },
    [invalidateGit],
  );

  const branchCheckoutMutation = useMutation({
    mutationFn: async (branchName: string) => {
      if (!api) throw new Error("Git API unavailable.");
      await api.git.checkout({ cwd: project.cwd, branch: branchName });
      return branchName;
    },
    onSuccess: async (branchName) => {
      await queryClient.invalidateQueries({ queryKey: ["git"] });
      toastManager.add({
        type: "success",
        title: `Checked out "${branchName}"`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not switch branch",
        description: toGitUserFacingErrorMessage(error),
      });
    },
  });

  const handleCreateAndCheckoutBranch = useCallback(async () => {
    const branch = createBranchName.trim();
    if (branch.length === 0) return;
    try {
      await branchCreateMutation.mutateAsync(branch);
      await branchCheckoutMutation.mutateAsync(branch);
      setCreateBranchOpen(false);
      setCreateBranchName("");
    } catch {
      // Errors surface via the mutations' own toasts.
    }
  }, [branchCheckoutMutation, branchCreateMutation, createBranchName]);

  const openFileInEditor = useCallback(
    (relativePath: string) => {
      // Hand the file off to the embedded Code tab instead of an external editor.
      onOpenFileInCode(relativePath);
    },
    [onOpenFileInCode],
  );

  const selectWorkingTreeFile = useCallback(
    (filePath: string) => {
      setResolverFilePath(null);
      setResolverDirty(false);
      setAiConflictState({
        status: "idle",
        userMessageId: null,
        sourceMessageId: null,
        proposal: null,
        error: null,
      });
      setSelectedCommit(project.id, null);
      setSelectedPath(project.id, selectedPath === filePath ? null : filePath);
    },
    [project.id, selectedPath, setSelectedCommit, setSelectedPath],
  );

  const openConflictResolver = useCallback(
    (filePath: string, mode: GitConflictResolverMode) => {
      setSelectedCommit(project.id, null);
      setSelectedPath(project.id, filePath);
      setResolverMode(mode);
      setResolverFilePath(filePath);
      setAiConflictState({
        status: "idle",
        userMessageId: null,
        sourceMessageId: null,
        proposal: null,
        error: null,
      });
    },
    [project.id, setSelectedCommit, setSelectedPath],
  );

  const closeConflictResolver = useCallback(() => {
    setResolverFilePath(null);
    setResolverDirty(false);
    setAiConflictState({
      status: "idle",
      userMessageId: null,
      sourceMessageId: null,
      proposal: null,
      error: null,
    });
  }, []);

  const navigateConflictResolver = useCallback(
    (direction: -1 | 1) => {
      if (conflictedFiles.length <= 1 || activeConflictedFileIndex < 0) return;
      const nextIndex =
        (activeConflictedFileIndex + direction + conflictedFiles.length) % conflictedFiles.length;
      const nextFile = conflictedFiles[nextIndex];
      if (!nextFile) return;
      openConflictResolver(nextFile.path, resolverMode);
    },
    [activeConflictedFileIndex, conflictedFiles, openConflictResolver, resolverMode],
  );

  const handleStageFile = useCallback(
    (file: GitStatusFile) => {
      if (!api) return;
      void runGitTask({
        id: `stage:${file.path}`,
        title: "Could not stage file",
        successTitle: `Staged ${basenameOfPath(file.path)}`,
        task: () => api.git.stageFiles({ cwd: project.cwd, paths: [file.path] }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleStageAll = useCallback(
    (files: ReadonlyArray<GitStatusFile>) => {
      if (!api) return;
      const paths = files.map((file) => file.path);
      if (paths.length === 0) return;
      void runGitTask({
        id: "stage-all",
        title: "Could not stage changes",
        successTitle: `Staged ${paths.length} file${paths.length === 1 ? "" : "s"}`,
        task: () => api.git.stageFiles({ cwd: project.cwd, paths }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleUnstageAll = useCallback(
    (files: ReadonlyArray<GitStatusFile>) => {
      if (!api) return;
      const paths = files.map((file) => file.path);
      if (paths.length === 0) return;
      void runGitTask({
        id: "unstage-all",
        title: "Could not unstage changes",
        successTitle: "Unstaged all files",
        task: () => api.git.unstageFiles({ cwd: project.cwd, paths }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleAmendCommit = useCallback(() => {
    if (!api) return;
    void runGitTask({
      id: "amend-commit",
      title: "Could not amend commit",
      successTitle: "Amended the last commit",
      task: () => api.git.amendCommit({ cwd: project.cwd }),
    });
  }, [api, project.cwd, runGitTask]);

  const handleUndoLastCommit = useCallback(() => {
    if (!api) return;
    void runGitTask({
      id: "undo-commit",
      title: "Could not undo commit",
      successTitle: "Undid the last commit — its changes are staged",
      task: () => api.git.undoLastCommit({ cwd: project.cwd }),
    });
  }, [api, project.cwd, runGitTask]);

  const handleRevertCommit = useCallback(
    (sha: string) => {
      if (!api) return;
      const trimmed = sha.trim();
      if (trimmed.length === 0) return;
      void runGitTask({
        id: `revert:${trimmed}`,
        title: "Could not revert commit",
        successTitle: `Reverted ${trimmed.slice(0, 7)}`,
        task: () => api.git.revertCommit({ cwd: project.cwd, sha: trimmed }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleCherryPick = useCallback(
    (sha: string) => {
      if (!api) return;
      const trimmed = sha.trim();
      if (trimmed.length === 0) return;
      void runGitTask({
        id: `cherry-pick:${trimmed}`,
        title: "Could not cherry-pick commit",
        successTitle: `Cherry-picked ${trimmed.slice(0, 7)}`,
        task: () => api.git.cherryPick({ cwd: project.cwd, sha: trimmed }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleCreateTag = useCallback(
    (name: string, sha?: string) => {
      if (!api) return;
      const trimmedName = name.trim();
      if (trimmedName.length === 0) return;
      const trimmedSha = sha?.trim();
      void runGitTask({
        id: `tag:${trimmedName}`,
        title: "Could not create tag",
        successTitle: `Created tag ${trimmedName}`,
        task: () =>
          api.git.createTag({
            cwd: project.cwd,
            name: trimmedName,
            ...(trimmedSha ? { sha: trimmedSha } : {}),
          }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleUnstageFile = useCallback(
    (file: GitStatusFile) => {
      if (!api) return;
      void runGitTask({
        id: `unstage:${file.path}`,
        title: "Could not unstage file",
        successTitle: `Unstaged ${basenameOfPath(file.path)}`,
        task: () => api.git.unstageFiles({ cwd: project.cwd, paths: [file.path] }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleDiscardFile = useCallback(
    async (file: GitStatusFile) => {
      if (!api) return;
      const confirmed = await confirm(`Discard changes for ${file.path}? This cannot be undone.`);
      if (!confirmed) return;
      void runGitTask({
        id: `discard:${file.path}`,
        title: "Could not discard file changes",
        successTitle: `Discarded changes in ${basenameOfPath(file.path)}`,
        onSuccess: () => {
          if (selectedPath === file.path) {
            setSelectedPath(project.id, null);
          }
        },
        task: () =>
          api.git.discardChanges({
            cwd: project.cwd,
            paths: [file.path],
            discardStaged: file.staged ?? false,
            discardUnstaged: file.unstaged ?? false,
            discardUntracked: file.untracked ?? false,
          }),
      });
    },
    [api, project.cwd, project.id, runGitTask, selectedPath, setSelectedPath],
  );

  const handleApplyHunk = useCallback(
    (hunk: Hunk, mode: GitApplyHunkMode) => {
      if (!api || !selectedPath || !selectedPatchFile) return;
      const patch = buildSingleHunkPatch(selectedPatchFile, hunk);
      const verb = mode === "stage" ? "Staged" : mode === "unstage" ? "Unstaged" : "Discarded";
      void runGitTask({
        id: `hunk:${mode}:${selectedPath}:${hunk.hunkSpecs ?? hunk.additionStart}`,
        title:
          mode === "stage"
            ? "Could not stage hunk"
            : mode === "unstage"
              ? "Could not unstage hunk"
              : "Could not discard hunk",
        successTitle: `${verb} hunk in ${basenameOfPath(selectedPath)}`,
        task: () =>
          api.git.applyHunk({
            cwd: project.cwd,
            path: selectedPath,
            patch,
            mode,
          }),
      });
    },
    [api, project.cwd, runGitTask, selectedPatchFile, selectedPath],
  );

  const executeDiscardAll = useCallback(() => {
    if (!api) return;
    emitGitWorkspaceTelemetry("git_advanced_action_executed", {
      action: "discard_all",
    });
    void runGitTask({
      id: "discard:all",
      title: "Could not discard all changes",
      successTitle: "Discarded all local changes",
      onSuccess: () => setSelectedPath(project.id, null),
      task: () =>
        api.git.discardChanges({
          cwd: project.cwd,
          discardStaged: true,
          discardUnstaged: true,
          discardUntracked: true,
        }),
    });
  }, [api, project.cwd, project.id, runGitTask, setSelectedPath]);

  const handleDiscardAll = useCallback(() => {
    setDiscardAllConfirmText("");
    setDiscardAllConfirmOpen(true);
  }, []);

  const handleFetchLatest = useCallback(() => {
    if (!api) return;
    void runGitTask({
      id: "fetch:latest",
      title: "Could not fetch latest changes",
      successTitle: "Fetched latest remote changes",
      task: () => api.git.fetch({ cwd: project.cwd }),
    });
  }, [api, project.cwd, runGitTask]);

  const handlePullLatest = useCallback(() => {
    if (!api) return;
    void runGitTask({
      id: "pull:latest",
      title: "Could not pull latest changes",
      successTitle: "Pulled latest changes",
      invalidateOnError: true,
      task: () => api.git.pull({ cwd: project.cwd }).then(() => undefined),
    });
  }, [api, project.cwd, runGitTask]);

  const handlePushCurrentBranch = useCallback(() => {
    if (!api) return;
    void runGitTask({
      id: "push:current",
      title: "Could not push branch",
      successTitle: `Pushed ${branchHeadline}`,
      invalidateOnError: true,
      task: () => api.git.push({ cwd: project.cwd }).then(() => undefined),
    });
  }, [api, branchHeadline, project.cwd, runGitTask]);

  const handleSaveStash = useCallback(() => {
    if (!api) return;
    emitGitWorkspaceTelemetry("git_advanced_action_executed", {
      action: "stash_save",
    });
    void runGitTask({
      id: "stash:save",
      title: "Could not create stash",
      successTitle: "Saved stash",
      onSuccess: () => setStashMessage(""),
      task: () =>
        api.git.saveStash({
          cwd: project.cwd,
          ...(stashMessage.trim().length > 0 ? { message: stashMessage.trim() } : {}),
          includeUntracked: true,
        }),
    });
  }, [api, project.cwd, runGitTask, stashMessage]);

  const handleRenameBranch = useCallback(() => {
    const oldBranch = branchToolsBranch?.name ?? "";
    const newBranch = renameDraft.trim();
    if (!oldBranch || !newBranch || oldBranch === newBranch) return;
    branchRenameMutation.mutate({ oldBranch, newBranch });
  }, [branchRenameMutation, branchToolsBranch?.name, renameDraft]);

  const executeDeleteBranch = useCallback(() => {
    if (!branchToolsBranch || branchToolsBranch.current) return;
    emitGitWorkspaceTelemetry("git_advanced_action_executed", {
      action: "delete_branch",
      branch: branchToolsBranch.name,
    });
    branchDeleteMutation.mutate({
      branch: branchToolsBranch.name,
      force: true,
    });
  }, [branchDeleteMutation, branchToolsBranch]);

  const handleDeleteBranch = useCallback(() => {
    if (!branchToolsBranch || branchToolsBranch.current) return;
    setDeleteBranchConfirmText("");
    setDeleteBranchConfirmOpen(true);
  }, [branchToolsBranch]);

  const handleSetUpstream = useCallback(() => {
    if (!branchToolsBranch || !selectedUpstreamBranch) return;
    const parts = deriveRemoteSelectionParts(selectedUpstreamBranch);
    if (!parts) return;
    branchUpstreamMutation.mutate({
      branch: branchToolsBranch.name,
      remoteName: parts.remoteName,
      remoteBranch: parts.remoteBranch,
    });
  }, [branchToolsBranch, branchUpstreamMutation, selectedUpstreamBranch]);

  const handleApplyStash = useCallback(
    (stashRef: string, pop: boolean) => {
      if (!api) return;
      void runGitTask({
        id: `${pop ? "stash:pop" : "stash:apply"}:${stashRef}`,
        title: pop ? "Could not pop stash" : "Could not apply stash",
        successTitle: pop ? `Popped ${stashRef}` : `Applied ${stashRef}`,
        task: () => api.git.applyStash({ cwd: project.cwd, stashRef, pop }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleDropStash = useCallback(
    async (stashRef: string) => {
      if (!api) return;
      const confirmed = await confirm(`Drop ${stashRef}? This cannot be undone.`);
      if (!confirmed) return;
      void runGitTask({
        id: `stash:drop:${stashRef}`,
        title: "Could not drop stash",
        successTitle: `Dropped ${stashRef}`,
        task: () => api.git.dropStash({ cwd: project.cwd, stashRef }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleResolveConflictSide = useCallback(
    async (file: GitStatusFile, side: "ours" | "theirs") => {
      if (!api) return;
      const confirmed = await confirm(
        `Use ${side} for ${file.path}? This will replace the conflicted file contents and mark it resolved.`,
      );
      if (!confirmed) return;
      void runGitTask({
        id: `conflict:${side}:${file.path}`,
        title: `Could not use ${side} version`,
        successTitle: `Resolved ${basenameOfPath(file.path)} with ${side}`,
        task: () =>
          api.git.resolveConflict({
            cwd: project.cwd,
            path: file.path,
            side,
          }),
      });
    },
    [api, project.cwd, runGitTask],
  );

  const handleResolveAllWithAi = useCallback(async () => {
    if (!api || conflictedFiles.length === 0) return;
    if (!activeAgentsThread) {
      toastManager.add({
        type: "error",
        title: "No Agents thread",
        description: "Open or create an Agents thread for this project, then try again.",
      });
      void onOpenAgents();
      return;
    }
    const fileList = conflictedFiles.map((file) => `- ${file.path}`).join("\n");
    const prompt = [
      `Resolve ALL of the following merge conflicts in the repository at ${project.cwd}.`,
      "",
      "For each file, edit it directly to a clean, correct, fully-merged state that keeps the",
      "intent of BOTH sides. Remove every conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`).",
      "Do not leave any file half-resolved. When done, briefly list what you changed.",
      "",
      "Conflicted files:",
      fileList,
    ].join("\n");

    const commandId = newCommandId();
    const messageId = MessageId.makeUnsafe(randomUUID());
    const createdAt = new Date().toISOString();
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId,
        threadId: activeAgentsThread.id,
        message: { messageId, role: "user", text: prompt, attachments: [] },
        modelSelection: activeAgentsThread.modelSelection,
        runtimeMode: activeAgentsThread.runtimeMode,
        interactionMode: activeAgentsThread.interactionMode,
        createdAt,
      });
      toastManager.add({
        type: "success",
        title: `Sent ${conflictedFiles.length} conflict${conflictedFiles.length === 1 ? "" : "s"} to your agent`,
        description:
          "Watch it resolve them in the Agents tab, then return here to review the diff.",
      });
      void onOpenAgents();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not start AI resolution",
        description: error instanceof Error ? error.message : "Failed to message the agent.",
      });
    }
  }, [api, activeAgentsThread, conflictedFiles, onOpenAgents, project.cwd]);

  const handleResolveAllConflicts = useCallback(
    async (side: "ours" | "theirs") => {
      if (!api || conflictedFiles.length === 0) return;
      const sideLabel = side === "ours" ? "your current branch's" : "the incoming";
      const confirmed = await confirm(
        `Resolve all ${conflictedFiles.length} conflicted file${conflictedFiles.length === 1 ? "" : "s"} using ${sideLabel} version? Each file is replaced and marked resolved.`,
      );
      if (!confirmed) return;
      const files = conflictedFiles;
      void runGitTask({
        id: `conflict-all:${side}`,
        title: `Could not resolve all with ${side}`,
        successTitle: `Resolved ${files.length} conflict${files.length === 1 ? "" : "s"} with ${side}`,
        task: async () => {
          for (const file of files) {
            await api.git.resolveConflict({
              cwd: project.cwd,
              path: file.path,
              side,
            });
          }
        },
      });
    },
    [api, conflictedFiles, project.cwd, runGitTask],
  );

  const handleSaveResolverDraft = useCallback(
    async (markResolved: boolean) => {
      if (!api || !resolverFilePath) return;
      const trimmedPath = resolverFilePath;
      void runGitTask({
        id: markResolved ? `resolver:save-stage:${trimmedPath}` : `resolver:save:${trimmedPath}`,
        title: markResolved ? "Could not save and mark resolved" : "Could not save conflict draft",
        successTitle: markResolved
          ? `Saved and marked ${basenameOfPath(trimmedPath)} resolved`
          : `Saved ${basenameOfPath(trimmedPath)}`,
        task: async () => {
          await api.projects.writeFile({
            cwd: project.cwd,
            relativePath: trimmedPath,
            contents: resolverDraft,
          });
          if (markResolved) {
            await api.git.stageFiles({
              cwd: project.cwd,
              paths: [trimmedPath],
            });
          }
        },
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: ["projects", "read-file", project.cwd, trimmedPath],
          });
          setResolverDirty(false);
          if (markResolved) {
            setResolverFilePath(null);
          }
        },
      });
    },
    [api, project.cwd, queryClient, resolverDraft, resolverFilePath, runGitTask],
  );

  const handleGenerateAiConflictFix = useCallback(async () => {
    if (!api || !resolverFilePath || !activeAgentsThread) {
      toastManager.add({
        type: "error",
        title: "AI conflict fix unavailable",
        description:
          "Open or create an Agents thread for this project before requesting an AI fix.",
      });
      return;
    }
    if (!conflictFileQuery.data) {
      toastManager.add({
        type: "error",
        title: "AI conflict fix unavailable",
        description: "The conflicted file is still loading.",
      });
      return;
    }

    const commandId = newCommandId();
    const messageId = MessageId.makeUnsafe(randomUUID());
    const createdAt = new Date().toISOString();
    const prompt = buildConflictFixPrompt({
      projectPath: project.cwd,
      relativePath: resolverFilePath,
      contents: conflictFileQuery.data.contents,
    });

    setAiConflictState({
      status: "sending",
      userMessageId: messageId,
      sourceMessageId: null,
      proposal: null,
      error: null,
    });

    try {
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId,
        threadId: activeAgentsThread.id,
        message: {
          messageId,
          role: "user",
          text: prompt,
          attachments: [],
        },
        modelSelection: activeAgentsThread.modelSelection,
        runtimeMode: activeAgentsThread.runtimeMode,
        interactionMode: activeAgentsThread.interactionMode,
        createdAt,
      });
      setAiConflictState({
        status: "waiting",
        userMessageId: messageId,
        sourceMessageId: null,
        proposal: null,
        error: null,
      });
      toastManager.add({
        type: "success",
        title: "Sent conflict to Agents",
        description: "Waiting for an AI resolution proposal.",
      });
    } catch (error) {
      setAiConflictState({
        status: "error",
        userMessageId: messageId,
        sourceMessageId: null,
        proposal: null,
        error: error instanceof Error ? error.message : String(error),
      });
      toastManager.add({
        type: "error",
        title: "Could not request AI conflict fix",
        description: toGitUserFacingErrorMessage(error),
      });
    }
  }, [activeAgentsThread, api, conflictFileQuery.data, project.cwd, resolverFilePath]);

  const handleAcceptAiConflictFix = useCallback(() => {
    if (!aiConflictState.proposal || !resolverFilePath) return;
    setResolverDraft(aiConflictState.proposal);
    setResolverDirty(true);
    setResolverMode("manual");
    toastManager.add({
      type: "success",
      title: "AI proposal loaded",
      description: "Review the proposed resolution, then save and mark it resolved.",
    });
  }, [aiConflictState.proposal, resolverFilePath]);

  const handleRejectAiConflictFix = useCallback(() => {
    setAiConflictState((current) => ({
      ...current,
      status: "idle",
      sourceMessageId: null,
      proposal: null,
      error: null,
    }));
  }, []);

  const handleStartMerge = useCallback(() => {
    if (!api || operationBranch.trim().length === 0) return;
    emitGitWorkspaceTelemetry("git_advanced_action_executed", {
      action: "start_merge",
      branch: operationBranch,
    });
    void runGitTask({
      id: `merge:${operationBranch}`,
      title: "Could not start merge",
      successTitle: `Merged ${operationBranch}`,
      invalidateOnError: true,
      task: () => api.git.merge({ cwd: project.cwd, branch: operationBranch }),
    });
  }, [api, operationBranch, project.cwd, runGitTask]);

  const handleStartRebase = useCallback(() => {
    if (!api || operationBranch.trim().length === 0) return;
    emitGitWorkspaceTelemetry("git_advanced_action_executed", {
      action: "start_rebase",
      branch: operationBranch,
    });
    void runGitTask({
      id: `rebase:${operationBranch}`,
      title: "Could not start rebase",
      successTitle: `Rebased onto ${operationBranch}`,
      invalidateOnError: true,
      task: () => api.git.rebase({ cwd: project.cwd, branch: operationBranch }),
    });
  }, [api, operationBranch, project.cwd, runGitTask]);

  const handleContinueOperation = useCallback(() => {
    if (!api || !currentOperation) return;
    void runGitTask({
      id: `continue:${currentOperation.kind}`,
      title: `Could not continue ${currentOperation.kind}`,
      successTitle: `Continued ${currentOperation.kind}`,
      invalidateOnError: true,
      task: () =>
        api.git.continueOperation({
          cwd: project.cwd,
          kind: currentOperation.kind,
        }),
    });
  }, [api, currentOperation, project.cwd, runGitTask]);

  const handleAbortOperation = useCallback(async () => {
    if (!api || !currentOperation) return;
    const confirmed = await confirm(
      `Abort the current ${currentOperation.kind}? Any in-progress merge/rebase state will be discarded.`,
    );
    if (!confirmed) return;
    void runGitTask({
      id: `abort:${currentOperation.kind}`,
      title: `Could not abort ${currentOperation.kind}`,
      successTitle: `Aborted ${currentOperation.kind}`,
      invalidateOnError: true,
      task: () =>
        api.git.abortOperation({
          cwd: project.cwd,
          kind: currentOperation.kind,
        }),
    });
  }, [api, currentOperation, project.cwd, runGitTask]);

  const handleSkipRebase = useCallback(() => {
    if (!api || currentOperation?.kind !== "rebase") return;
    void runGitTask({
      id: "rebase:skip",
      title: "Could not skip rebase step",
      successTitle: "Skipped current rebase step",
      invalidateOnError: true,
      task: () => api.git.skipRebase({ cwd: project.cwd }),
    });
  }, [api, currentOperation, project.cwd, runGitTask]);

  const branchToolsBusy =
    gitTaskInFlight !== null ||
    branchRenameMutation.isPending ||
    branchDeleteMutation.isPending ||
    branchUpstreamMutation.isPending;
  const syncActionsDisabled =
    gitTaskInFlight !== null || currentOperation !== null || conflictedFiles.length > 0;
  const hasWorkingTreeChanges = changedFiles.length > 0;
  const hasBlockingConflicts = conflictedFiles.length > 0;
  const hasDetachedHead = gitStatusQuery.data?.branch === null;
  const detachedHeadBlockedBasic =
    hasDetachedHead && stagedFiles.length === 0 && !hasWorkingTreeChanges;
  const blockingSwitchReason: GitWorkspaceSwitchReason | null =
    currentOperation !== null
      ? "active_operation"
      : hasBlockingConflicts
        ? "conflicts"
        : detachedHeadBlockedBasic
          ? "detached_head_blocked"
          : null;
  const branchesSection = getGitWorkspaceLayoutSection("branches");
  const advancedActionsSection = getGitWorkspaceLayoutSection("advanced-actions");
  const historySection = getGitWorkspaceLayoutSection("history");
  const stashesSection = getGitWorkspaceLayoutSection("stashes");
  const isBasicMode = gitWorkspaceMode === "basic";

  useEffect(() => {
    window.localStorage.setItem(GIT_WORKSPACE_MODE_STORAGE_KEY, gitWorkspaceMode);
  }, [gitWorkspaceMode]);

  useEffect(() => {
    if (gitWorkspaceMode !== "basic" || !blockingSwitchReason) return;
    setGitWorkspaceMode("advanced");
    emitGitWorkspaceTelemetry("git_mode_auto_switched", {
      reason: blockingSwitchReason,
    });
  }, [blockingSwitchReason, gitWorkspaceMode]);

  const handleWorkspaceModeChange = useCallback((mode: GitWorkspaceMode) => {
    setGitWorkspaceMode(mode);
    emitGitWorkspaceTelemetry("git_mode_switched", { mode });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: false },
      });

      if (command === "workspace.basicMode") {
        event.preventDefault();
        handleWorkspaceModeChange("basic");
        return;
      }
      if (command === "workspace.advancedMode") {
        event.preventDefault();
        handleWorkspaceModeChange("advanced");
        return;
      }
      if (!isBasicMode) return;

      if (command === "git.nextFile") {
        event.preventDefault();
        if (changedFiles.length === 0) return;
        const selectedIndex = changedFiles.findIndex((file) => file.path === selectedPath);
        const nextIndex = selectedIndex < 0 ? 0 : (selectedIndex + 1) % changedFiles.length;
        const next = changedFiles[nextIndex];
        if (next) {
          selectWorkingTreeFile(next.path);
        }
        return;
      }
      if (command === "git.prevFile") {
        event.preventDefault();
        if (changedFiles.length === 0) return;
        const selectedIndex = changedFiles.findIndex((file) => file.path === selectedPath);
        const nextIndex =
          selectedIndex < 0
            ? Math.max(0, changedFiles.length - 1)
            : (selectedIndex - 1 + changedFiles.length) % changedFiles.length;
        const next = changedFiles[nextIndex];
        if (next) {
          selectWorkingTreeFile(next.path);
        }
        return;
      }
      if (command === "git.stageFile" && selectedWorkingTreeFile?.unstaged) {
        event.preventDefault();
        handleStageFile(selectedWorkingTreeFile);
        return;
      }
      if (command === "git.unstageFile" && selectedWorkingTreeFile?.staged) {
        event.preventDefault();
        handleUnstageFile(selectedWorkingTreeFile);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    keybindings,
    changedFiles,
    handleStageFile,
    handleUnstageFile,
    handleWorkspaceModeChange,
    isBasicMode,
    selectWorkingTreeFile,
    selectedPath,
    selectedWorkingTreeFile,
  ]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <GitEnvironmentGate
        environment={gitEnvironmentQuery.data}
        isRepo={branchesQuery.data?.isRepo}
        isLoading={branchesQuery.isLoading}
        initPending={gitInitMutation.isPending}
        onInitRepo={() => gitInitMutation.mutate()}
      >
        <div className="grid h-full min-h-0 min-w-0 w-full grid-cols-1 content-start gap-6 overflow-x-hidden overflow-y-auto px-6 py-8 max-w-[1400px] mx-auto sm:px-10 lg:px-14">
          <div className="flex flex-col min-h-0 min-w-0 gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <GitBranchIcon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Source Control
                  </h1>
                  <p className="text-sm text-muted-foreground truncate">
                    Commit, branch, and sync — no terminal required.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <GitAccountMenu cwd={project.cwd} onSignIn={onRunGitHubLogin} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full gap-1.5"
                  onClick={() => {
                    // Suggest the next patch version (e.g. 1.2.15 → 1.2.16) so a
                    // release is one click; still editable for minor/major bumps.
                    const match = APP_VERSION.match(/^(\d+)\.(\d+)\.(\d+)$/);
                    setReleaseVersion(
                      match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "",
                    );
                    setReleaseBranch(activeBranch?.name ?? localBranches[0]?.name ?? "main");
                    setReleaseDialogOpen(true);
                  }}
                  title="Trigger the release workflow on GitHub Actions"
                >
                  <RocketIcon className="size-3.5" />
                  Release
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full gap-1.5"
                  onClick={() => {
                    emitGitWorkspaceTelemetry("git_terminal_dock_toggled", {
                      open: !terminalOpen,
                    });
                    onToggleTerminal();
                  }}
                  disabled={!terminalAvailable}
                >
                  {terminalOpen ? "Hide Terminal" : "Terminal"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={isBasicMode ? "outline" : "default"}
                  className="rounded-full"
                  onClick={() => {
                    const nextMode = isBasicMode ? "advanced" : "basic";
                    if (nextMode === "advanced") {
                      emitGitWorkspaceTelemetry("git_advanced_drawer_opened");
                    }
                    handleWorkspaceModeChange(nextMode);
                  }}
                >
                  {isBasicMode ? "Advanced" : "Close Advanced"}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-background/50 px-5 py-4 shadow-sm backdrop-blur-xl">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Menu highlightItemOnHover={false}>
                  <MenuTrigger
                    render={
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-full border border-border/50 bg-background/70 px-3 py-1.5 transition-colors hover:border-border hover:bg-background"
                      />
                    }
                  >
                    <GitBranchIcon className="size-4 shrink-0 text-primary" />
                    <span className="max-w-[220px] truncate text-sm font-semibold text-foreground">
                      {branchHeadline}
                    </span>
                    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </MenuTrigger>
                  <MenuPopup align="start" className="max-h-[60vh] min-w-[280px] overflow-y-auto">
                    <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Switch branch
                    </div>
                    {localBranches.length === 0 ? (
                      <div className="px-3 pb-2 text-sm text-muted-foreground">
                        No local branches.
                      </div>
                    ) : (
                      localBranches.map((branch) => (
                        <MenuItem
                          key={`switch:${branch.name}`}
                          className="flex items-center gap-2"
                          disabled={branch.current || branchCheckoutMutation.isPending}
                          onClick={() => {
                            if (!branch.current) branchCheckoutMutation.mutate(branch.name);
                          }}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center",
                              branch.current ? "text-primary" : "text-transparent",
                            )}
                          >
                            <CheckIcon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {branch.name}
                          </span>
                          {branch.isDefault ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              default
                            </span>
                          ) : null}
                        </MenuItem>
                      ))
                    )}
                    <MenuSeparator />
                    <MenuItem
                      className="flex items-center gap-2"
                      onClick={() => {
                        setCreateBranchName("");
                        setCreateBranchOpen(true);
                      }}
                    >
                      <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm">Create new branch…</span>
                    </MenuItem>
                  </MenuPopup>
                </Menu>
                {gitStatusQuery.data?.pr ? (
                  <Badge size="sm" variant="outline" className="shadow-none">
                    PR #{gitStatusQuery.data.pr.number}
                  </Badge>
                ) : null}
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {syncStatusLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full gap-1.5"
                  disabled={syncActionsDisabled}
                  onClick={handlePullLatest}
                  title="Download commits from the remote and merge them into your branch"
                >
                  <ArrowDownIcon className="size-3.5" />
                  Pull
                  {behindCount > 0 ? (
                    <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
                      {behindCount}
                    </span>
                  ) : null}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full gap-1.5"
                  disabled={syncActionsDisabled}
                  onClick={handlePushCurrentBranch}
                  title="Upload your local commits to the remote (e.g. GitHub)"
                >
                  <ArrowUpIcon className="size-3.5" />
                  Push
                  {aheadCount > 0 ? (
                    <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[11px] font-semibold">
                      {aheadCount}
                    </span>
                  ) : null}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full"
                  disabled={syncActionsDisabled}
                  onClick={handleFetchLatest}
                  aria-label="Fetch latest"
                  title="Fetch from remote"
                >
                  <RefreshCwIcon className="size-3.5" />
                </Button>
              </div>
            </div>

            {currentOperation ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {currentOperation.kind === "merge"
                        ? "Merge in progress"
                        : "Rebase in progress"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {currentOperation.status === "conflicted"
                        ? `Resolve the ${conflictedFiles.length} conflicted file${conflictedFiles.length === 1 ? "" : "s"}, then continue or abort.`
                        : "Git is waiting for the next step. Continue when the working tree is ready."}
                    </div>
                  </div>
                  <Badge
                    size="sm"
                    variant={currentOperation.status === "conflicted" ? "error" : "secondary"}
                    className="shadow-none"
                  >
                    {currentOperation.status === "conflicted" ? "Needs attention" : "In progress"}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    disabled={gitTaskInFlight !== null}
                    onClick={handleContinueOperation}
                  >
                    Continue
                  </Button>
                  {currentOperation.kind === "rebase" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={gitTaskInFlight !== null}
                      onClick={handleSkipRebase}
                    >
                      Skip
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full text-destructive hover:text-destructive"
                    disabled={gitTaskInFlight !== null}
                    onClick={() => void handleAbortOperation()}
                  >
                    Abort
                  </Button>
                </div>
              </div>
            ) : null}

            <GitCommitComposer
              gitCwd={project.cwd}
              activeThreadId={activeThreadId}
              gitStatus={gitStatusQuery.data ?? null}
              branchList={branchesQuery.data ?? null}
              stagedFiles={stagedFiles}
              externalBusy={gitTaskInFlight !== null}
              workspaceMode={gitWorkspaceMode}
            />

            <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-2xl border border-border/40 bg-background/50 backdrop-blur-xl shadow-sm p-5">
                <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">Changes</h3>
                    {conflictedFiles.length > 0 && (
                      <Badge size="sm" variant="error" className="shadow-none">
                        {conflictedFiles.length} conflicts
                      </Badge>
                    )}
                    {stagedFiles.length > 0 && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                        {stagedFiles.length} staged
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {stagedFiles.length > 0 ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={gitTaskInFlight !== null}
                        onClick={() => handleUnstageAll(stagedFiles)}
                      >
                        Unstage all
                      </Button>
                    ) : null}
                    {unstagedFiles.length + untrackedFiles.length > 0 ? (
                      <Button
                        type="button"
                        size="xs"
                        disabled={gitTaskInFlight !== null}
                        onClick={() => handleStageAll([...unstagedFiles, ...untrackedFiles])}
                      >
                        Stage all ({unstagedFiles.length + untrackedFiles.length})
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-4">
                  {conflictedFiles.length > 0 ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                      <div className="text-sm font-semibold text-foreground">
                        {conflictedFiles.length} merge conflict
                        {conflictedFiles.length === 1 ? "" : "s"} to resolve
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Git couldn&apos;t automatically combine two versions of these files. Pick a
                        strategy below, or open a file and use <strong>Resolve</strong> (edit it
                        yourself) or <strong>Fix with AI</strong> (let your agent resolve it).
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={gitTaskInFlight !== null}
                          onClick={() => void handleResolveAllWithAi()}
                          title="Send all conflicts to your agent to resolve them by editing the files"
                        >
                          <BotIcon className="size-3.5" />
                          Resolve all with AI
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={gitTaskInFlight !== null}
                          onClick={() => void handleResolveAllConflicts("ours")}
                          title="Keep your current branch's version for every conflicted file"
                        >
                          Use ours for all
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={gitTaskInFlight !== null}
                          onClick={() => void handleResolveAllConflicts("theirs")}
                          title="Keep the incoming version for every conflicted file"
                        >
                          Use theirs for all
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground/70">
                        “Ours” = the branch you&apos;re on. “Theirs” = the branch/commit being
                        merged in.
                      </p>
                    </div>
                  ) : null}
                  <GitChangeSection
                    title="Conflicts"
                    description="Files blocked by merge or rebase conflicts."
                    files={conflictedFiles}
                    selectedPath={selectedPath}
                    emptyLabel="No conflicts."
                    selectLabel="Resolve"
                    actionDisabled={gitTaskInFlight !== null}
                    onSelectFile={selectWorkingTreeFile}
                    onResolveFile={(file) => openConflictResolver(file.path, "manual")}
                    onFixWithAi={(file) => openConflictResolver(file.path, "ai")}
                    onOpenFile={openFileInEditor}
                    onStageFile={handleStageFile}
                    onUseOurs={(file) => void handleResolveConflictSide(file, "ours")}
                    onUseTheirs={(file) => void handleResolveConflictSide(file, "theirs")}
                    onDiscardFile={handleDiscardFile}
                  />
                  <GitChangeSection
                    title="Staged"
                    description="Included in the next commit."
                    files={stagedFiles}
                    selectedPath={selectedPath}
                    emptyLabel="Nothing staged."
                    selectLabel="Review"
                    actionDisabled={gitTaskInFlight !== null}
                    onSelectFile={selectWorkingTreeFile}
                    onUnstageFile={handleUnstageFile}
                    onDiscardFile={handleDiscardFile}
                  />
                  <GitChangeSection
                    title="Unstaged"
                    description="Modified files not yet added to the index."
                    files={unstagedFiles}
                    selectedPath={selectedPath}
                    emptyLabel="No unstaged tracked files."
                    selectLabel="Review"
                    actionDisabled={gitTaskInFlight !== null}
                    onSelectFile={selectWorkingTreeFile}
                    onStageFile={handleStageFile}
                    onDiscardFile={handleDiscardFile}
                  />
                  <GitChangeSection
                    title="Untracked"
                    description="New files not yet added to Git."
                    files={untrackedFiles}
                    selectedPath={selectedPath}
                    emptyLabel="No untracked files."
                    selectLabel="Review"
                    actionDisabled={gitTaskInFlight !== null}
                    onSelectFile={selectWorkingTreeFile}
                    onStageFile={handleStageFile}
                    onDiscardFile={handleDiscardFile}
                  />
                  {!hasWorkingTreeChanges ? (
                    <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
                      {gitStatusQuery.isLoading ? "Loading changes..." : "Working tree is clean."}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-w-0 rounded-2xl border border-border/40 bg-background/50 backdrop-blur-xl shadow-sm p-5 flex flex-col min-h-[500px]">
                <div className="flex min-w-0 flex-row items-start justify-between gap-4 border-b border-border/40 pb-4 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">Diff</h3>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {resolverFilePath
                        ? resolverMode === "manual"
                          ? "Resolve this conflicted file directly inside the Git workspace."
                          : "Review the conflicted file in the shared resolver surface before accepting an AI fix."
                        : selectedPath
                          ? "Live working-tree diff for the selected file."
                          : activeHistoryCommit
                            ? "Unified patch for the selected commit."
                            : "Select a changed file or commit to inspect its patch."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {resolverFilePath ? (
                      <Badge
                        size="sm"
                        variant={resolverMode === "manual" ? "secondary" : "outline"}
                        className="shadow-none"
                      >
                        {resolverMode === "manual" ? "Manual Resolver" : "AI Conflict Fix"}
                      </Badge>
                    ) : selectedPath ? (
                      <Badge size="sm" variant="secondary" className="shadow-none">
                        Working tree
                      </Badge>
                    ) : activeHistoryCommit ? (
                      <Badge size="sm" variant="outline" className="shadow-none">
                        Commit patch
                      </Badge>
                    ) : null}
                    {!resolverFilePath && diffQuery.data ? (
                      <>
                        <Badge size="sm" variant="success" className="shadow-none">
                          +{diffQuery.data.stats.insertions}
                        </Badge>
                        <Badge size="sm" variant="error" className="shadow-none">
                          -{diffQuery.data.stats.deletions}
                        </Badge>
                        <Badge size="sm" variant="outline" className="shadow-none">
                          {diffQuery.data.stats.filesChanged} file
                          {diffQuery.data.stats.filesChanged === 1 ? "" : "s"}
                        </Badge>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex min-h-0 flex-col gap-4 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {resolverFilePath ? (
                      <>
                        <Badge size="sm" variant="outline">
                          Conflicts{" "}
                          {activeConflictedFileIndex >= 0 ? activeConflictedFileIndex + 1 : 1} /{" "}
                          {Math.max(totalConflictCount, 1)}
                        </Badge>
                        <Badge size="sm" variant="secondary">
                          {resolverFilePath}
                        </Badge>
                        {totalConflictCount > 1 ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => navigateConflictResolver(-1)}
                            >
                              Previous
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => navigateConflictResolver(1)}
                            >
                              Next
                            </Button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!resolverFilePath}
                          onClick={() => {
                            if (resolverFilePath) openFileInEditor(resolverFilePath);
                          }}
                        >
                          Open In Editor
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={closeConflictResolver}
                        >
                          Close Resolver
                        </Button>
                      </>
                    ) : selectedPath ? (
                      <>
                        <Badge size="sm" variant="secondary">
                          {selectedPath}
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (selectedPath) openFileInEditor(selectedPath);
                          }}
                        >
                          Open In Editor
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedPath(project.id, null)}
                        >
                          Clear File
                        </Button>
                      </>
                    ) : activeHistoryCommit ? (
                      <>
                        <Badge size="sm" variant="outline">
                          {activeHistoryCommit.shortSha}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {activeHistoryCommit.subject}
                        </span>
                      </>
                    ) : null}
                  </div>

                  {resolverFilePath ? (
                    <div className="grid min-h-0 flex-1 gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                      <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-border/70 bg-background/40 p-4">
                        {conflictedFiles.length > 1 ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                Conflicted Files
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge size="sm" variant="outline">
                                  {activeConflictedFileIndex >= 0
                                    ? activeConflictedFileIndex + 1
                                    : 1}{" "}
                                  / {conflictedFiles.length}
                                </Badge>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="outline"
                                  onClick={() => navigateConflictResolver(-1)}
                                  aria-label="Previous conflicted file"
                                >
                                  <ChevronUpIcon className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="outline"
                                  onClick={() => navigateConflictResolver(1)}
                                  aria-label="Next conflicted file"
                                >
                                  <ChevronDownIcon className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                            <ScrollArea className="max-h-28 rounded-xl border border-border/70 bg-background/60">
                              <div className="flex gap-2 p-2">
                                {conflictedFiles.map((file) => (
                                  <Button
                                    key={`resolver-switch:${file.path}`}
                                    type="button"
                                    size="sm"
                                    variant={
                                      resolverFilePath === file.path ? "secondary" : "outline"
                                    }
                                    className="max-w-60 justify-start truncate"
                                    onClick={() => openConflictResolver(file.path, resolverMode)}
                                  >
                                    {basenameOfPath(file.path)}
                                  </Button>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-foreground">
                              {resolverMode === "manual"
                                ? "Manual conflict resolver"
                                : "AI conflict fix"}
                            </div>
                            {resolverMode === "manual" ? (
                              <Badge size="sm" variant={resolverDirty ? "outline" : "secondary"}>
                                {resolverDirty ? "Editing" : "Ready"}
                              </Badge>
                            ) : aiConflictState.status === "waiting" ? (
                              <Badge size="sm" variant="outline">
                                Waiting for Agents
                              </Badge>
                            ) : aiConflictState.proposal ? (
                              <Badge size="sm" variant="secondary">
                                Proposal Ready
                              </Badge>
                            ) : aiConflictState.status === "error" ? (
                              <Badge size="sm" variant="error">
                                Error
                              </Badge>
                            ) : (
                              <Badge size="sm" variant="outline">
                                Ready to Generate
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {resolverMode === "manual"
                              ? "Compare the base, ours, and theirs versions, then edit the final resolved file here before marking it resolved."
                              : "Generate an AI proposal into this same resolver, review the patch on the right, then accept or reject it."}
                          </p>
                        </div>
                        {resolverMode === "manual" ? (
                          conflictSnapshotQuery.isLoading ? (
                            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-4 text-sm text-muted-foreground">
                              Loading base / ours / theirs…
                            </div>
                          ) : (
                            <div className="grid gap-3 2xl:grid-cols-3">
                              <GitConflictTextPane
                                title="Base"
                                description="Shared ancestor"
                                contents={conflictSnapshotQuery.data?.baseContents}
                              />
                              <GitConflictTextPane
                                title="Ours"
                                description="Current branch"
                                contents={conflictSnapshotQuery.data?.oursContents}
                              />
                              <GitConflictTextPane
                                title="Theirs"
                                description="Incoming change"
                                contents={conflictSnapshotQuery.data?.theirsContents}
                              />
                            </div>
                          )
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={gitTaskInFlight !== null}
                            onClick={() => {
                              if (activeConflictedFile) {
                                void handleResolveConflictSide(activeConflictedFile, "ours");
                              }
                            }}
                          >
                            Use Ours
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={gitTaskInFlight !== null}
                            onClick={() => {
                              if (activeConflictedFile) {
                                void handleResolveConflictSide(activeConflictedFile, "theirs");
                              }
                            }}
                          >
                            Use Theirs
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              resolverMode === "ai" ||
                              gitTaskInFlight !== null ||
                              conflictFileQuery.isLoading ||
                              resolverFilePath === null
                            }
                            onClick={() => void handleSaveResolverDraft(false)}
                          >
                            Save Draft
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              resolverMode === "ai" ||
                              gitTaskInFlight !== null ||
                              conflictFileQuery.isLoading ||
                              resolverFilePath === null
                            }
                            onClick={() => void handleSaveResolverDraft(true)}
                          >
                            Save & Mark Resolved
                          </Button>
                          {resolverMode === "ai" ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={
                                  aiConflictState.status === "sending" ||
                                  aiConflictState.status === "waiting" ||
                                  !activeAgentsThread ||
                                  conflictFileQuery.isLoading
                                }
                                onClick={() => void handleGenerateAiConflictFix()}
                              >
                                {aiConflictState.status === "sending" ||
                                aiConflictState.status === "waiting"
                                  ? "Generating..."
                                  : "Generate Fix"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!aiConflictState.proposal}
                                onClick={handleAcceptAiConflictFix}
                              >
                                Accept Fix
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={!aiConflictState.proposal}
                                onClick={handleRejectAiConflictFix}
                              >
                                Reject
                              </Button>
                              {!activeAgentsThread ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void onOpenAgents()}
                                  >
                                    Open Agents
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void onCreateAgentsThread()}
                                  >
                                    Create Thread
                                  </Button>
                                </>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                        {resolverMode === "ai" ? (
                          <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-3 text-sm text-muted-foreground">
                            {!activeAgentsThread
                              ? "AI conflict fix uses this project's Agents runtime. Open Agents or create a thread, then generate the fix from this same panel."
                              : aiConflictState.status === "waiting"
                                ? "The conflict was sent to the current Agents thread. Waiting for the assistant to return a fully resolved file."
                                : aiConflictState.status === "error"
                                  ? (aiConflictState.error ??
                                    "Could not generate an AI conflict fix.")
                                  : aiConflictState.proposal
                                    ? "AI produced a proposed resolution. Review the patch on the right, then accept or reject it."
                                    : "Use Generate Fix to send this conflicted file to the current Agents thread and review the returned proposal here."}
                          </div>
                        ) : conflictFileQuery.isLoading ? (
                          <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
                            Loading conflicted file...
                          </div>
                        ) : (
                          <div className="flex min-h-0 flex-1 flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                Resolved Output
                              </div>
                              <Badge size="sm" variant={resolverDirty ? "outline" : "secondary"}>
                                {resolverDirty ? "Editing" : "Synced"}
                              </Badge>
                            </div>
                            <Textarea
                              value={resolverDraft}
                              onChange={(event) => {
                                setResolverDraft(event.target.value);
                                setResolverDirty(true);
                              }}
                              className="min-h-[22rem] flex-1 resize-none font-mono text-xs leading-6"
                              placeholder="Conflicted file contents will load here."
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-background/40">
                        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">Patch Preview</div>
                            <div className="text-xs text-muted-foreground">
                              {resolverPatch
                                ? resolverMode === "ai"
                                  ? "AI resolution preview."
                                  : "Unsaved resolution preview."
                                : "Current working-tree diff for this conflicted file."}
                            </div>
                          </div>
                          {resolverMode === "manual" && resolverDirty ? (
                            <Badge size="sm" variant="outline">
                              Unsaved changes
                            </Badge>
                          ) : null}
                        </div>
                        {resolverPatch ? (
                          <PatchViewer patch={resolverPatch} onOpenFile={openFileInEditor} />
                        ) : diffQuery.isLoading ? (
                          <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
                            Loading diff...
                          </div>
                        ) : diffQuery.data ? (
                          <PatchViewer patch={diffQuery.data.patch} onOpenFile={openFileInEditor} />
                        ) : (
                          <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
                            No patch available yet.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : diffQuery.isLoading ? (
                    <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
                      Loading diff...
                    </div>
                  ) : diffQuery.data ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-3">
                      {selectedPath ? (
                        <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-foreground">
                                Hunk Actions
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Apply hunks from the current diff without dropping to the CLI.
                              </div>
                            </div>
                            {hunkActionState.unavailableReason ? (
                              <Badge size="sm" variant="outline">
                                Disabled
                              </Badge>
                            ) : (
                              <Badge size="sm" variant="secondary">
                                {selectedPatchHunks.length} hunk
                                {selectedPatchHunks.length === 1 ? "" : "s"}
                              </Badge>
                            )}
                          </div>
                          {hunkActionState.unavailableReason ? (
                            <div className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
                              {hunkActionState.unavailableReason}
                            </div>
                          ) : selectedPatchHunks.length === 0 ? (
                            <div className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
                              No hunks were parsed from this diff.
                            </div>
                          ) : (
                            <ScrollArea className="mt-3 h-36 rounded-lg border border-border/70">
                              <div className="space-y-2 p-2">
                                {selectedPatchHunks.map((hunk, index) => (
                                  <div
                                    key={`${selectedPath}:hunk:${hunk.deletionStart}:${hunk.additionStart}:${hunk.deletionLineIndex}:${hunk.additionLineIndex}`}
                                    className="rounded-lg border border-border/70 bg-card/40 px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <div className="text-sm font-medium text-foreground">
                                          Hunk {index + 1}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          {hunk.hunkSpecs ??
                                            `-${hunk.deletionStart} +${hunk.additionStart}`}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {hunkActionState.modes.includes("stage") ? (
                                          <Button
                                            type="button"
                                            size="xs"
                                            variant="outline"
                                            disabled={gitTaskInFlight !== null}
                                            onClick={() => handleApplyHunk(hunk, "stage")}
                                          >
                                            Stage Hunk
                                          </Button>
                                        ) : null}
                                        {hunkActionState.modes.includes("unstage") ? (
                                          <Button
                                            type="button"
                                            size="xs"
                                            variant="outline"
                                            disabled={gitTaskInFlight !== null}
                                            onClick={() => handleApplyHunk(hunk, "unstage")}
                                          >
                                            Unstage Hunk
                                          </Button>
                                        ) : null}
                                        {hunkActionState.modes.includes("discard") ? (
                                          <Button
                                            type="button"
                                            size="xs"
                                            variant="ghost"
                                            disabled={gitTaskInFlight !== null}
                                            onClick={() => handleApplyHunk(hunk, "discard")}
                                          >
                                            Discard Hunk
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </ScrollArea>
                          )}
                        </div>
                      ) : null}
                      <PatchViewer
                        patch={diffQuery.data.patch}
                        onOpenFile={selectedPath ? openFileInEditor : undefined}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">
                      {changedFiles.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                            Quick Open Changed File
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {changedFiles.slice(0, 8).map((file) => (
                              <Button
                                key={`diff-quick-open:${file.path}`}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="max-w-80 justify-start truncate"
                                onClick={() => selectWorkingTreeFile(file.path)}
                              >
                                {file.path}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div>
                        Select a changed file for a live working-tree diff, or choose a commit from
                        the history list to inspect its patch here.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-border/40 bg-background/50 p-5 shadow-sm backdrop-blur-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground">History</h3>
                <div className="flex items-center gap-2">
                  {historyCommits.length > 0 ? (
                    <>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={gitTaskInFlight !== null}
                        onClick={handleAmendCommit}
                        title="Add staged changes to the last commit (keeps its message)"
                      >
                        Amend last
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={gitTaskInFlight !== null}
                        onClick={handleUndoLastCommit}
                        title="Undo the last commit, keeping its changes staged"
                      >
                        Undo last
                      </Button>
                    </>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {historyCommits.length} recent
                  </span>
                </div>
              </div>
              {historyCommits.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  {historyQuery.isLoading ? "Loading commits…" : "No commits yet."}
                </div>
              ) : (
                <ScrollArea className="max-h-[440px] rounded-xl border border-border/40">
                  <div className="space-y-0.5 p-2">
                    {historyCommits.map((commit, index) => (
                      <button
                        key={commit.sha}
                        type="button"
                        onClick={() => {
                          setSelectedPath(project.id, null);
                          setSelectedCommit(
                            project.id,
                            selectedCommit === commit.sha && !selectedPath ? null : commit.sha,
                          );
                        }}
                        className={cn(
                          "flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                          activeHistoryCommit?.sha === commit.sha &&
                            !selectedPath &&
                            "bg-primary/10",
                        )}
                      >
                        <div className="relative flex w-4 shrink-0 justify-center pt-1">
                          {index < historyCommits.length - 1 ? (
                            <span className="absolute top-4 h-[calc(100%-0.25rem)] w-px bg-border/60" />
                          ) : null}
                          <span
                            className={cn(
                              "relative z-10 mt-0.5 size-2 rounded-full border bg-card",
                              commit.isHead ? "border-primary bg-primary" : "border-primary/40",
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {commit.subject}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{commit.shortSha}</span>
                            <span>{commit.authorName}</span>
                            <span>{formatGitTimestamp(commit.authoredAt)}</span>
                          </div>
                        </div>
                        {commit.isHead ? (
                          <Badge size="sm" variant="secondary" className="shrink-0 self-start">
                            HEAD
                          </Badge>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </div>
      </GitEnvironmentGate>

      {!isBasicMode ? (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[1px]"
            onClick={() => handleWorkspaceModeChange("basic")}
          />
          <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[40rem] min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-l border-border/70 bg-background/96 p-5 sm:p-6">
            <Card className="min-w-0">
              <CardHeader className="min-w-0 border-b border-border/60 pb-4">
                <CardTitle>{branchesSection.title}</CardTitle>
                <CardDescription className="break-words">
                  {branchesSection.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    New Branch
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      value={branchDraft}
                      onChange={(event) => setBranchDraft(event.target.value)}
                      placeholder="new-branch-name"
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        const next = branchDraft.trim();
                        if (next.length === 0) return;
                        branchCreateMutation.mutate(next);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={branchDraft.trim().length === 0 || branchCreateMutation.isPending}
                      onClick={() => branchCreateMutation.mutate(branchDraft.trim())}
                    >
                      <PlusIcon className="size-3.5" />
                      Create
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Local
                    </div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {localBranches.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Remote
                    </div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {remoteBranches.length}
                    </div>
                  </div>
                </div>
                <ScrollArea className="max-h-72 rounded-xl border border-border/70">
                  <div className="space-y-1 p-2">
                    {branchesQuery.data?.branches.length ? (
                      branchesQuery.data.branches.map((branch: GitBranch) => (
                        <div
                          key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-sm",
                            branchToolsTarget === branch.name && !branch.isRemote
                              ? "border-primary/40 bg-primary/10"
                              : "border-border/60 bg-background/30",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => {
                                if (!branch.isRemote) {
                                  setBranchToolsTarget(branch.name);
                                }
                              }}
                            >
                              <div className="truncate font-medium text-foreground">
                                {branch.name}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {branch.isRemote
                                  ? branch.remoteName
                                    ? `Remote · ${branch.remoteName}`
                                    : "Remote"
                                  : branch.isDefault
                                    ? "Default branch"
                                    : "Local branch"}
                              </div>
                            </button>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {branch.current ? (
                                <Badge size="sm" variant="secondary">
                                  Current
                                </Badge>
                              ) : null}
                              {!branch.isRemote ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  disabled={branch.current || branchCheckoutMutation.isPending}
                                  onClick={() => branchCheckoutMutation.mutate(branch.name)}
                                >
                                  Checkout
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-2 py-3 text-sm text-muted-foreground">
                        {branchesQuery.isLoading ? "Loading branches..." : "No branch data yet."}
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <Collapsible open={branchManagerOpen} onOpenChange={setBranchManagerOpen}>
                  <div className="rounded-xl border border-border/70 bg-background/60">
                    <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-3 text-left">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">Branch management</div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          Rename, connect upstream, or remove a branch when needed.
                        </div>
                      </div>
                      <div className="shrink-0">
                        {branchManagerOpen ? (
                          <ChevronUpIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronDownIcon className="size-4 text-muted-foreground" />
                        )}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-t border-border/70">
                      <div className="space-y-3 p-3">
                        <Select
                          value={branchToolsTarget}
                          onValueChange={(value) => setBranchToolsTarget(value ?? "")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a local branch" />
                          </SelectTrigger>
                          <SelectPopup>
                            <div className="px-2 py-2">
                              <Input
                                value={branchToolsSearch}
                                onChange={(event) => setBranchToolsSearch(event.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="Search local branches"
                              />
                            </div>
                            <SelectSeparator />
                            {filteredBranchToolOptions.length ? (
                              filteredBranchToolOptions.map((branchName) => (
                                <SelectItem key={branchName} value={branchName}>
                                  {branchName}
                                </SelectItem>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No local branches found.
                              </div>
                            )}
                          </SelectPopup>
                        </Select>
                        <div className="flex gap-2">
                          <Input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            placeholder="rename-branch"
                            disabled={!branchToolsBranch}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                handleRenameBranch();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              !branchToolsBranch ||
                              renameDraft.trim().length === 0 ||
                              renameDraft.trim() === branchToolsBranch.name ||
                              branchToolsBusy
                            }
                            onClick={handleRenameBranch}
                          >
                            <PencilIcon className="size-3.5" />
                            Rename
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Select
                            value={upstreamSelection}
                            onValueChange={(value) => setUpstreamSelection(value ?? "")}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Choose a remote branch" />
                            </SelectTrigger>
                            <SelectPopup>
                              <div className="px-2 py-2">
                                <Input
                                  value={upstreamSearch}
                                  onChange={(event) => setUpstreamSearch(event.target.value)}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  placeholder="Search remote branches"
                                />
                              </div>
                              <SelectSeparator />
                              {filteredUpstreamOptions.length ? (
                                filteredUpstreamOptions.map((branch) => (
                                  <SelectItem key={branch.name} value={branch.name}>
                                    <span className="flex min-w-0 items-center justify-between gap-2">
                                      <span className="truncate">{branch.name}</span>
                                      <Badge size="sm" variant="info">
                                        Remote
                                      </Badge>
                                    </span>
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-sm text-muted-foreground">
                                  No remote branches found.
                                </div>
                              )}
                            </SelectPopup>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              !branchToolsBranch || !selectedUpstreamBranch || branchToolsBusy
                            }
                            onClick={handleSetUpstream}
                          >
                            Track
                          </Button>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="justify-start text-destructive hover:text-destructive"
                          disabled={
                            !branchToolsBranch || branchToolsBranch.current || branchToolsBusy
                          }
                          onClick={() => void handleDeleteBranch()}
                        >
                          <XIcon className="size-3.5" />
                          Delete Branch
                        </Button>
                        <Badge size="sm" variant="error">
                          Destructive
                        </Badge>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="min-w-0 border-b border-border/60 pb-4">
                <CardTitle>{advancedActionsSection.title}</CardTitle>
                <CardDescription className="break-words">
                  {advancedActionsSection.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-6">
                <Collapsible open={advancedActionsOpen} onOpenChange={setAdvancedActionsOpen}>
                  <div className="rounded-xl border border-border/70 bg-background/60">
                    <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-3 text-left">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">Merge / Rebase</div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          Start or resume long-running branch operations.
                        </div>
                      </div>
                      <div className="shrink-0">
                        {advancedActionsOpen ? (
                          <ChevronUpIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronDownIcon className="size-4 text-muted-foreground" />
                        )}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-t border-border/70">
                      <div className="space-y-3 p-3">
                        {currentOperation ? (
                          <div className="rounded-lg border border-border/70 bg-background/50 p-3 text-sm text-muted-foreground">
                            The active {currentOperation.kind} is already surfaced in the main
                            workspace above.
                          </div>
                        ) : (
                          <>
                            <Select
                              value={operationBranch}
                              onValueChange={(value) => setOperationBranch(value ?? "")}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Choose a branch" />
                              </SelectTrigger>
                              <SelectPopup className="max-h-80">
                                <div className="px-2 py-2">
                                  <Input
                                    value={operationBranchSearch}
                                    onChange={(event) =>
                                      setOperationBranchSearch(event.target.value)
                                    }
                                    onKeyDown={(event) => event.stopPropagation()}
                                    placeholder="Search branches"
                                  />
                                </div>
                                <SelectSeparator />
                                {filteredLocalOperationBranchOptions.length ? (
                                  <SelectGroup>
                                    <SelectGroupLabel>Local Branches</SelectGroupLabel>
                                    {filteredLocalOperationBranchOptions.map((branch) => (
                                      <SelectItem key={branch.value} value={branch.value}>
                                        <span className="flex min-w-0 items-center justify-between gap-2">
                                          <span className="truncate">{branch.label}</span>
                                          <Badge size="sm" variant="success">
                                            Local
                                          </Badge>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ) : null}
                                {filteredLocalOperationBranchOptions.length &&
                                filteredRemoteOperationBranchOptions.length ? (
                                  <SelectSeparator />
                                ) : null}
                                {filteredRemoteOperationBranchOptions.length ? (
                                  <SelectGroup>
                                    <SelectGroupLabel>Remote Branches</SelectGroupLabel>
                                    {filteredRemoteOperationBranchOptions.map((branch) => (
                                      <SelectItem key={branch.value} value={branch.value}>
                                        <span className="flex min-w-0 items-center justify-between gap-2">
                                          <span className="truncate">{branch.label}</span>
                                          <Badge size="sm" variant="info">
                                            Remote
                                          </Badge>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ) : null}
                                {filteredLocalOperationBranchOptions.length === 0 &&
                                filteredRemoteOperationBranchOptions.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-muted-foreground">
                                    No branches found.
                                  </div>
                                ) : null}
                              </SelectPopup>
                            </Select>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={operationBranch.length === 0 || gitTaskInFlight !== null}
                                onClick={handleStartMerge}
                              >
                                Merge Into Current
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={operationBranch.length === 0 || gitTaskInFlight !== null}
                                onClick={handleStartRebase}
                              >
                                Rebase Onto Selected
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={changedFiles.length === 0 || gitTaskInFlight !== null}
                    onClick={() => void handleSaveStash()}
                  >
                    Stash Changes
                    <Badge size="sm" variant="secondary">
                      Risky
                    </Badge>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={changedFiles.length === 0 || gitTaskInFlight !== null}
                    onClick={() => void handleDiscardAll()}
                  >
                    Discard All
                    <Badge size="sm" variant="error">
                      Destructive
                    </Badge>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="min-w-0 border-b border-border/60 pb-4">
                <CardTitle>Commit tools</CardTitle>
                <CardDescription className="break-words">
                  Revert or cherry-pick a commit by its hash, or tag a point in history.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Revert / Cherry-pick
                  </div>
                  <p className="text-[11px] text-muted-foreground/80">
                    Paste a commit hash (or use the selected commit). <strong>Revert</strong> makes
                    a new commit that undoes it; <strong>cherry-pick</strong> copies it onto this
                    branch.
                  </p>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      className="min-w-0 flex-1 font-mono"
                      value={commitToolSha}
                      onChange={(event) => setCommitToolSha(event.target.value)}
                      placeholder={selectedCommit ? selectedCommit.slice(0, 12) : "commit hash"}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={gitTaskInFlight !== null}
                      onClick={() => handleRevertCommit(commitToolSha || (selectedCommit ?? ""))}
                    >
                      Revert
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={gitTaskInFlight !== null}
                      onClick={() => handleCherryPick(commitToolSha || (selectedCommit ?? ""))}
                    >
                      Cherry-pick
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Create tag
                  </div>
                  <p className="text-[11px] text-muted-foreground/80">
                    A tag is a named bookmark for a commit (e.g. a release like <code>v1.0.0</code>
                    ). Tags the selected commit, or HEAD if none is selected.
                  </p>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      value={tagNameDraft}
                      onChange={(event) => setTagNameDraft(event.target.value)}
                      placeholder="v1.0.0"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          handleCreateTag(tagNameDraft, selectedCommit ?? undefined);
                          setTagNameDraft("");
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={tagNameDraft.trim().length === 0 || gitTaskInFlight !== null}
                      onClick={() => {
                        handleCreateTag(tagNameDraft, selectedCommit ?? undefined);
                        setTagNameDraft("");
                      }}
                    >
                      Create tag
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-0 min-w-0">
              <CardHeader className="min-w-0 border-b border-border/60 pb-4">
                <CardTitle>{historySection.title}</CardTitle>
                <CardDescription className="break-words">
                  {historySection.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 pt-6">
                <ScrollArea className="max-h-80 rounded-xl border border-border/70">
                  <div className="space-y-1 p-2">
                    {historyCommits.length ? (
                      historyCommits.map((commit, index) => (
                        <button
                          key={commit.sha}
                          type="button"
                          onClick={() => {
                            setSelectedPath(project.id, null);
                            setSelectedCommit(
                              project.id,
                              selectedCommit === commit.sha && !selectedPath ? null : commit.sha,
                            );
                          }}
                          className={cn(
                            "flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                            activeHistoryCommit?.sha === commit.sha &&
                              !selectedPath &&
                              "bg-primary/10",
                          )}
                        >
                          <div className="relative flex w-5 shrink-0 justify-center pt-1">
                            {index < historyCommits.length - 1 ? (
                              <span className="absolute top-5 h-[calc(100%-0.25rem)] w-px bg-linear-to-b from-primary/50 via-border/80 to-border/40" />
                            ) : null}
                            <span
                              className={cn(
                                "relative z-10 mt-0.5 size-2.5 rounded-full border bg-card shadow-sm",
                                commit.isHead
                                  ? "border-primary bg-primary shadow-[0_0_0_4px_rgba(59,130,246,0.14)]"
                                  : "border-primary/40",
                              )}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {commit.subject}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{commit.shortSha}</span>
                              <span>{commit.authorName}</span>
                              <span>{formatGitTimestamp(commit.authoredAt)}</span>
                            </div>
                            {commit.refs.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {commit.refs.slice(0, 4).map((ref) => {
                                  const refInfo = classifyGitHistoryRef(ref);
                                  return (
                                    <Badge
                                      key={`${commit.sha}:${ref}`}
                                      size="sm"
                                      variant={refInfo.variant}
                                    >
                                      {refInfo.label}
                                    </Badge>
                                  );
                                })}
                                {commit.refs.length > 4 ? (
                                  <Badge size="sm" variant="outline">
                                    +{commit.refs.length - 4} more
                                  </Badge>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          {commit.isHead ? (
                            <Badge size="sm" variant="secondary">
                              HEAD
                            </Badge>
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-sm text-muted-foreground">
                        {historyQuery.isLoading ? "Loading commit history..." : "No commits yet."}
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <Collapsible open={stashPanelOpen} onOpenChange={setStashPanelOpen}>
                  <div className="rounded-xl border border-border/70 bg-background/60">
                    <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-3 text-left">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {stashesSection.title}
                        </div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          {stashesSection.description}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge size="sm" variant="outline">
                          {stashEntries.length}
                        </Badge>
                        {stashPanelOpen ? (
                          <ChevronUpIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronDownIcon className="size-4 text-muted-foreground" />
                        )}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-t border-border/70">
                      <div className="space-y-3 p-3">
                        <div className="space-y-2">
                          <Input
                            value={stashMessage}
                            onChange={(event) => setStashMessage(event.target.value)}
                            placeholder="Optional stash message"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={changedFiles.length === 0 || gitTaskInFlight !== null}
                            onClick={() => void handleSaveStash()}
                          >
                            Save Stash
                          </Button>
                        </div>
                        <Separator />
                        <ScrollArea className="h-56 rounded-lg border border-border/70">
                          <div className="space-y-2 p-2">
                            {stashEntries.length ? (
                              stashEntries.map((entry) => (
                                <div
                                  key={entry.stashRef}
                                  className="rounded-lg border border-border/70 bg-card/40 p-2"
                                >
                                  <div className="text-sm font-medium text-foreground">
                                    {entry.stashRef}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                    {entry.message}
                                  </div>
                                  <div className="mt-1 text-[11px] text-muted-foreground/80">
                                    {entry.shortSha} · {formatGitTimestamp(entry.createdAt)}
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      disabled={gitTaskInFlight !== null}
                                      onClick={() => handleApplyStash(entry.stashRef, false)}
                                    >
                                      Apply
                                    </Button>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      disabled={gitTaskInFlight !== null}
                                      onClick={() => handleApplyStash(entry.stashRef, true)}
                                    >
                                      Pop
                                    </Button>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="ghost"
                                      disabled={gitTaskInFlight !== null}
                                      onClick={() => void handleDropStash(entry.stashRef)}
                                    >
                                      Drop
                                    </Button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="px-2 py-3 text-sm text-muted-foreground">
                                {stashQuery.isLoading ? "Loading stashes..." : "No stashes yet."}
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Trigger a release</DialogTitle>
              <DialogDescription>
                Dispatches the repository release workflow to build and publish installers for this
                version. Needs the GitHub CLI signed in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                autoFocus
                value={releaseVersion}
                onChange={(event) => setReleaseVersion(event.target.value)}
                placeholder="e.g. 1.2.16"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    releaseVersion.trim().length > 0 &&
                    releaseBranch.trim().length > 0
                  ) {
                    event.preventDefault();
                    onDispatchRelease(releaseVersion, releaseBranch);
                    setReleaseDialogOpen(false);
                  }
                }}
              />
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Release from branch
                <Select
                  value={releaseBranch}
                  onValueChange={(value) => setReleaseBranch(value ?? "")}
                >
                  <SelectTrigger className="h-8 w-full sm:text-sm">
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectPopup>
                    {localBranches.length === 0 ? (
                      <SelectItem value={releaseBranch}>{releaseBranch || "main"}</SelectItem>
                    ) : (
                      localBranches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectPopup>
                </Select>
              </label>
              <div className="rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                {releaseVersion.trim().length > 0 && releaseBranch.trim().length > 0
                  ? `gh workflow run release.yml --ref ${releaseBranch.trim()} --field version=${releaseVersion.trim().replace(/^v/, "")}`
                  : "Type a version and pick a branch to enable the release."}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReleaseDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={releaseVersion.trim().length === 0 || releaseBranch.trim().length === 0}
                onClick={() => {
                  onDispatchRelease(releaseVersion, releaseBranch);
                  setReleaseDialogOpen(false);
                }}
              >
                <RocketIcon className="size-4" />
                Trigger release
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <Dialog open={createBranchOpen} onOpenChange={setCreateBranchOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Create a new branch</DialogTitle>
              <DialogDescription>
                Branches off the current branch ({branchHeadline}) and switches to it.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={createBranchName}
              onChange={(event) => setCreateBranchName(event.target.value)}
              placeholder="feature/my-change"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateAndCheckoutBranch();
                }
              }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateBranchOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  createBranchName.trim().length === 0 ||
                  branchCreateMutation.isPending ||
                  branchCheckoutMutation.isPending
                }
                onClick={() => void handleCreateAndCheckoutBranch()}
              >
                Create & switch
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <Dialog open={discardAllConfirmOpen} onOpenChange={setDiscardAllConfirmOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Discard all local changes?</DialogTitle>
              <DialogDescription>
                This is destructive and cannot be undone. Type <code>DISCARD</code> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={discardAllConfirmText}
              onChange={(event) => setDiscardAllConfirmText(event.target.value)}
              placeholder="Type DISCARD"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDiscardAllConfirmOpen(false);
                  emitGitWorkspaceTelemetry("git_action_cancelled_confirm_dialog", {
                    action: "discard_all",
                  });
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={discardAllConfirmText.trim() !== "DISCARD"}
                onClick={() => {
                  setDiscardAllConfirmOpen(false);
                  executeDiscardAll();
                }}
              >
                Discard All
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <Dialog open={deleteBranchConfirmOpen} onOpenChange={setDeleteBranchConfirmOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Delete branch {branchToolsBranch?.name}?</DialogTitle>
              <DialogDescription>
                This can permanently remove branch history if forced. Type{" "}
                <code>{`DELETE ${branchToolsBranch?.name ?? ""}`}</code> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={deleteBranchConfirmText}
              onChange={(event) => setDeleteBranchConfirmText(event.target.value)}
              placeholder={`Type DELETE ${branchToolsBranch?.name ?? ""}`}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeleteBranchConfirmOpen(false);
                  emitGitWorkspaceTelemetry("git_action_cancelled_confirm_dialog", {
                    action: "delete_branch",
                  });
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  deleteBranchConfirmText.trim() !== `DELETE ${branchToolsBranch?.name ?? ""}`
                }
                onClick={() => {
                  setDeleteBranchConfirmOpen(false);
                  executeDeleteBranch();
                }}
              >
                Delete Branch
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      {confirmDialog}
    </div>
  );
}

function formatGitTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function GitChangeSection(props: {
  title: string;
  description: string;
  files: ReadonlyArray<GitStatusFile>;
  selectedPath: string | null;
  emptyLabel: string;
  selectLabel: string;
  actionDisabled: boolean;
  onSelectFile: (filePath: string) => void;
  onResolveFile?: (file: GitStatusFile) => void;
  onFixWithAi?: (file: GitStatusFile) => void;
  onOpenFile?: (filePath: string) => void | Promise<void>;
  onStageFile?: (file: GitStatusFile) => void;
  onUnstageFile?: (file: GitStatusFile) => void;
  onUseOurs?: (file: GitStatusFile) => void;
  onUseTheirs?: (file: GitStatusFile) => void;
  onDiscardFile: (file: GitStatusFile) => void;
}) {
  const toneDot =
    props.title === "Conflicts"
      ? "bg-destructive"
      : props.title === "Staged"
        ? "bg-emerald-500"
        : props.title === "Untracked"
          ? "bg-sky-500"
          : "bg-amber-500";
  if (props.files.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <span className={cn("size-1.5 rounded-full", toneDot)} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {props.title}
        </span>
        <span className="text-[11px] text-muted-foreground/60">{props.files.length}</span>
      </div>
      <div className="space-y-0.5">
        {props.files.map((file) => {
          const lastSlash = file.path.lastIndexOf("/");
          const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : "";
          const base = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
          const isSelected = props.selectedPath === file.path;
          return (
            <div
              key={`${props.title}:${file.path}`}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors",
                isSelected
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:border-border/50 hover:bg-muted/30",
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", toneDot)} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm"
                onClick={() => props.onSelectFile(file.path)}
                title={file.path}
              >
                {dir ? <span className="text-muted-foreground/70">{dir}</span> : null}
                <span className="font-medium text-foreground">{base}</span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
                {file.insertions > 0 ? (
                  <span className="text-diff-addition">+{file.insertions}</span>
                ) : null}
                {file.deletions > 0 ? (
                  <span className="text-diff-deletion">-{file.deletions}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {props.onResolveFile ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={props.actionDisabled}
                    onClick={() => props.onResolveFile?.(file)}
                  >
                    Resolve
                  </Button>
                ) : null}
                {props.onFixWithAi ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={props.actionDisabled}
                    onClick={() => props.onFixWithAi?.(file)}
                  >
                    Fix with AI
                  </Button>
                ) : null}
                {props.onOpenFile ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={props.actionDisabled}
                    onClick={() => void props.onOpenFile?.(file.path)}
                  >
                    Open
                  </Button>
                ) : null}
                {props.onUseOurs ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={props.actionDisabled}
                    onClick={() => props.onUseOurs?.(file)}
                  >
                    Ours
                  </Button>
                ) : null}
                {props.onUseTheirs ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={props.actionDisabled}
                    onClick={() => props.onUseTheirs?.(file)}
                  >
                    Theirs
                  </Button>
                ) : null}
                {props.onStageFile ? (
                  <Button
                    type="button"
                    size="xs"
                    disabled={props.actionDisabled}
                    onClick={() => props.onStageFile?.(file)}
                  >
                    {props.title === "Conflicts" ? "Mark Resolved" : "Stage"}
                  </Button>
                ) : null}
                {props.onUnstageFile ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={props.actionDisabled}
                    onClick={() => props.onUnstageFile?.(file)}
                  >
                    Unstage
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={props.actionDisabled}
                  onClick={() => props.onDiscardFile(file)}
                >
                  Discard
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GitConflictTextPane(props: {
  title: string;
  description: string;
  contents: string | null | undefined;
}) {
  return (
    <div className="min-h-0 rounded-xl border border-border/70 bg-background/60">
      <div className="border-b border-border/70 px-3 py-2">
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {props.title}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{props.description}</div>
      </div>
      <ScrollArea className="h-44">
        <pre className="px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap text-foreground/90">
          {props.contents?.length ? props.contents : "No contents available for this stage."}
        </pre>
      </ScrollArea>
    </div>
  );
}

function DesktopBrowserChrome(props: {
  projectId: ProjectId;
  projectCwd: string;
  sessionId?: string | undefined;
  title: string;
  isChromeExpanded: boolean;
  setIsChromeExpanded: (expanded: boolean) => void;
  sessionState: DesktopBrowserSessionState;
  browserState: ProjectBrowserToolState;
  draftUrl: string;
  setDraftUrl: (url: string) => void;
  submitDraftUrl: () => void;
  normalizedUrl: string;
  setBrowserViewport: typeof workspaceShellActions.setBrowserViewport;
  setViewportSelectorOpen: (open: boolean) => void;
  viewportSelectorOpen?: boolean;
  toolbarTarget: HTMLElement | null;
  children: ReactNode;
}) {
  const api = readNativeApi();
  const bridge = window.desktopBridge;
  const [activeToolbarMenu, setActiveToolbarMenu] = useState<
    "view" | "capture" | "tools" | "history" | "server" | null
  >(null);

  const activeNotice = useMemo(() => {
    switch (activeToolbarMenu) {
      case "capture":
        return {
          icon: <CameraIcon className="size-4.5" />,
          title: "Preview hidden for capture menu",
          description: "Close the capture menu and the preview will return automatically.",
        };
      case "tools":
        return {
          icon: <WrenchIcon className="size-4.5" />,
          title: "Preview hidden for browser tools",
          description: "Close the tools menu and the preview will return automatically.",
        };
      case "view":
        return {
          icon: <SlidersHorizontalIcon className="size-4.5" />,
          title: "Preview hidden for view settings",
          description: "Close the view menu and the preview will return automatically.",
        };
      case "history":
        return {
          icon: <HistoryIcon className="size-4.5" />,
          title: "Preview hidden for browser history",
          description: "Close the history menu and the preview will return automatically.",
        };
      case "server":
        return {
          icon: <ServerIcon className="size-4.5" />,
          title: "Preview hidden for server details",
          description: "Close the server menu and the preview will return automatically.",
        };
      default:
        if (props.viewportSelectorOpen) {
          return {
            icon: <GlobeIcon className="size-4.5" />,
            title: "Preview hidden for screen sizing",
            description: "Close the screen-size menu and the preview will return automatically.",
          };
        }
        return null;
    }
  }, [activeToolbarMenu, props.viewportSelectorOpen]);

  useEffect(() => {
    props.setViewportSelectorOpen(activeNotice !== null);
  }, [activeNotice, props.setViewportSelectorOpen]);

  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const recordingSessionId = props.sessionId ?? props.sessionState.sessionId;
  const [recordingBrowser, setRecordingBrowser] = useState(() =>
    isNativeBrowserRecordingActive(props.projectId, recordingSessionId),
  );
  const [changingRecording, setChangingRecording] = useState(false);
  const [pickingElement, setPickingElement] = useState(false);
  const [clearingBrowserData, setClearingBrowserData] = useState(false);
  const [recordIssueDialogOpen, setRecordIssueDialogOpen] = useState(false);
  const [issueRecording, setIssueRecording] = useState(false);
  const reproductionTasks = useAtomValue(threadsAtom, (threads) =>
    threads.filter((thread) => thread.projectId === props.projectId && !thread.archivedAt),
  );
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<PreviewAnnotationPayload | null>(null);
  const browserHistory = useBrowserHistoryStore((state) => state.entries);
  const recordBrowserHistory = useBrowserHistoryStore((state) => state.record);
  const clearBrowserHistory = useBrowserHistoryStore((state) => state.clear);

  useEffect(() => {
    setRecordingBrowser(isNativeBrowserRecordingActive(props.projectId, recordingSessionId));
  }, [props.projectId, recordingSessionId]);
  useEffect(() => {
    if (props.sessionState.loading || !props.sessionState.currentUrl) return;
    recordBrowserHistory({
      url: props.sessionState.currentUrl,
      title: props.sessionState.pageTitle?.trim() || props.sessionState.currentUrl,
      visitedAt: new Date().toISOString(),
    });
  }, [
    props.sessionState.currentUrl,
    props.sessionState.loading,
    props.sessionState.pageTitle,
    recordBrowserHistory,
  ]);

  const sessionArg = props.sessionId
    ? { projectId: props.projectId, sessionId: props.sessionId }
    : { projectId: props.projectId };
  const clearBrowserData = useCallback(async () => {
    if (!bridge || clearingBrowserData) return;
    const confirmed = await bridge.confirm(
      "Clear cookies, cache, and site storage for this browser session? This will sign you out of sites using the same browser profile.",
    );
    if (!confirmed) return;
    setClearingBrowserData(true);
    try {
      await bridge.clearBrowserSessionData(sessionArg);
      toastManager.add({
        type: "success",
        title: "Browser data cleared",
        description: "Cookies, cache, and site storage were cleared and the page was reloaded.",
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not clear browser data",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setClearingBrowserData(false);
    }
  }, [bridge, clearingBrowserData, sessionArg]);
  const captureScreenshot = useCallback(async () => {
    if (!bridge || capturingScreenshot) return;
    setCapturingScreenshot(true);
    try {
      const artifact = await bridge.captureBrowserScreenshot(
        props.sessionId
          ? { projectId: props.projectId, sessionId: props.sessionId }
          : { projectId: props.projectId },
      );
      toastManager.add({
        type: "success",
        title: "Browser screenshot saved",
        description: artifact.path,
        actionProps: {
          children: "Copy image",
          onClick: () => {
            void bridge.copyBrowserArtifactToClipboard(artifact.path).then(
              () =>
                toastManager.add({
                  type: "success",
                  title: "Screenshot copied",
                }),
              (cause) =>
                toastManager.add({
                  type: "error",
                  title: "Could not copy screenshot",
                  description: cause instanceof Error ? cause.message : String(cause),
                }),
            );
          },
        },
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not capture browser screenshot",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setCapturingScreenshot(false);
    }
  }, [bridge, capturingScreenshot, props.projectId, props.sessionId]);
  const toggleRecording = useCallback(async () => {
    if (!bridge || changingRecording) return;
    setChangingRecording(true);
    try {
      if (isNativeBrowserRecordingActive(props.projectId, recordingSessionId)) {
        const artifact = await stopNativeBrowserRecording(
          bridge,
          props.projectId,
          recordingSessionId,
        );
        setRecordingBrowser(false);
        toastManager.add({
          type: "success",
          title: "Browser recording saved",
          description: artifact.path,
          actionProps: {
            children: "Reveal in Finder",
            onClick: () => void bridge.revealBrowserArtifact(artifact.path),
          },
        });
      } else {
        await startNativeBrowserRecording(bridge, props.projectId, recordingSessionId);
        setRecordingBrowser(true);
        toastManager.add({
          type: "success",
          title: "Browser recording started",
          description: "Use Stop recording when you are finished.",
        });
      }
    } catch (cause) {
      setRecordingBrowser(isNativeBrowserRecordingActive(props.projectId, recordingSessionId));
      toastManager.add({
        type: "error",
        title: recordingBrowser
          ? "Could not stop browser recording"
          : "Could not start browser recording",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setChangingRecording(false);
    }
  }, [bridge, changingRecording, props.projectId, recordingBrowser, recordingSessionId]);
  const pickElement = useCallback(async () => {
    if (!bridge || pickingElement) return;
    setPickingElement(true);
    try {
      const annotation = await bridge.pickBrowserElement(
        props.sessionId
          ? { projectId: props.projectId, sessionId: props.sessionId }
          : { projectId: props.projectId },
      );
      if (!annotation) return;
      setPendingAnnotation(annotation);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not pick browser element",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setPickingElement(false);
    }
  }, [bridge, pickingElement, props.projectId, props.sessionId]);
  const attachAnnotation = useCallback(
    (annotation: PreviewAnnotationPayload) => {
      window.dispatchEvent(
        new CustomEvent<PreviewAnnotationPickedDetail>(PREVIEW_ANNOTATION_PICKED_EVENT, {
          detail: { projectId: props.projectId, annotation },
        }),
      );
      toastManager.add({
        type: "success",
        title: "Element attached to chat",
        description: "Review or remove the preview context in the composer before sending.",
      });
      setPendingAnnotation(null);
    },
    [props.projectId],
  );

  const activeRecordingControls = (
    <>
      {recordingBrowser && (
        <Button
          size="xs"
          variant="destructive"
          disabled={changingRecording}
          onClick={() => void toggleRecording()}
        >
          <SquareIcon className="size-3" />
          Stop video recording
        </Button>
      )}
      {issueRecording && (
        <Button size="xs" variant="destructive" onClick={() => setRecordIssueDialogOpen(true)}>
          <SquareIcon className="size-3" />
          Stop & review issue
        </Button>
      )}
    </>
  );

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col",
        props.isChromeExpanded ? "gap-2 pt-2" : "",
      )}
    >
      {props.isChromeExpanded ? (
        <Card className="relative z-20">
          <CardContent className="space-y-1.5 p-2">
            {props.sessionState.pendingPermission ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/25 text-xs text-foreground"
              >
                <div className="flex items-center gap-2 min-w-0 truncate">
                  <ShieldAlertIcon className="size-4 text-amber-500 shrink-0" />
                  <span className="truncate">
                    <strong className="font-semibold text-foreground">
                      {props.sessionState.pendingPermission.origin}
                    </strong>{" "}
                    wants access to{" "}
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {props.sessionState.pendingPermission.permission}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="xs"
                    variant="default"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      void window.desktopBridge?.respondBrowserPermission?.({
                        requestId: props.sessionState.pendingPermission!.requestId,
                        granted: true,
                        remember: true,
                      });
                    }}
                  >
                    Allow
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      void window.desktopBridge?.respondBrowserPermission?.({
                        requestId: props.sessionState.pendingPermission!.requestId,
                        granted: false,
                        remember: true,
                      });
                    }}
                  >
                    Block
                  </Button>
                </div>
              </div>
            ) : null}
            <BrowserToolbar
              title={props.title}
              canGoBack={props.sessionState.canGoBack}
              canGoForward={props.sessionState.canGoForward}
              onBack={() => void bridge?.goBackBrowserSession(sessionArg)}
              onForward={() => void bridge?.goForwardBrowserSession(sessionArg)}
              onReload={(ignoreCache) =>
                void bridge?.reloadBrowserSession({ ...sessionArg, ignoreCache })
              }
              onExternal={() =>
                void api?.shell.openExternal(props.sessionState.currentUrl ?? props.normalizedUrl)
              }
              onCollapse={() => props.setIsChromeExpanded(false)}
              onViewOpenChange={(open) => {
                setActiveToolbarMenu(open ? "view" : null);
              }}
              onCaptureOpenChange={(open) => {
                setActiveToolbarMenu(open ? "capture" : null);
              }}
              onToolsOpenChange={(open) => {
                setActiveToolbarMenu(open ? "tools" : null);
              }}
              address={
                <form
                  className="flex h-9 min-w-0 items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-1.5 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"
                  onSubmit={(event) => {
                    event.preventDefault();
                    props.submitDraftUrl();
                  }}
                >
                  <BrowserSecurityBadge
                    compact
                    securityContext={props.sessionState.securityContext}
                    currentUrl={props.sessionState.currentUrl}
                    onOpenExternal={() =>
                      void api?.shell.openExternal(
                        props.sessionState.currentUrl ?? props.normalizedUrl,
                      )
                    }
                  />
                  <Input
                    className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0"
                    value={props.draftUrl}
                    onChange={(event) => props.setDraftUrl(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    placeholder="Enter a URL"
                    aria-label={`${props.title} URL`}
                  />
                  <ServerReadinessBadge
                    compact
                    currentUrl={props.sessionState.currentUrl || props.normalizedUrl}
                    onNavigateToUrl={(url) => {
                      props.setDraftUrl(url);
                      void bridge?.navigateBrowserSession({ ...sessionArg, url });
                    }}
                    onReload={() => void bridge?.reloadBrowserSession(sessionArg)}
                    onOpenChange={(open) => {
                      setActiveToolbarMenu(open ? "server" : null);
                    }}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Navigate to address"
                    title="Go to address (Enter)"
                  >
                    <ArrowRightIcon className="size-3.5" />
                  </Button>
                </form>
              }
              captureActions={[
                {
                  label: capturingScreenshot ? "Capturing screenshot…" : "Take screenshot",
                  description: "Save an image of this page",
                  icon: <CameraIcon className="size-4" />,
                  disabled: capturingScreenshot,
                  onClick: () => void captureScreenshot(),
                },
                {
                  label: recordingBrowser ? "Stop video recording" : "Record video",
                  description: "Capture a video of this tab",
                  icon: <RadioIcon className="size-4" />,
                  disabled: changingRecording,
                  active: recordingBrowser,
                  onClick: () => void toggleRecording(),
                },
                {
                  label: issueRecording ? "Stop & review issue" : "Record issue",
                  description: "Reproduce a bug and send it to a task",
                  icon: <BugIcon className="size-4" />,
                  active: issueRecording,
                  onClick: () => setRecordIssueDialogOpen(true),
                },
              ]}
              toolActions={[
                {
                  label: props.sessionState.devToolsOpen
                    ? "Close developer tools"
                    : "Developer tools",
                  description: "Inspect the page and console",
                  icon: <BugIcon className="size-4" />,
                  active: props.sessionState.devToolsOpen,
                  onClick: () => void bridge?.toggleBrowserDevTools(sessionArg),
                },
                {
                  label: pickingElement ? "Pick on page…" : "Pick element",
                  description: "Attach an element to your task",
                  icon: <MousePointer2Icon className="size-4" />,
                  disabled: pickingElement,
                  onClick: () => void pickElement(),
                },
                {
                  label: "Compare pages",
                  description: "Compare viewports, routes, or profiles",
                  icon: <Columns2Icon className="size-4" />,
                  onClick: () => setComparisonOpen(true),
                },
              ]}
              viewControls={
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Zoom</span>
                    <div className="flex items-center rounded-md border border-border/70">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        disabled={props.sessionState.zoomFactor <= 0.5}
                        onClick={() =>
                          void bridge?.setBrowserZoomFactor({
                            ...sessionArg,
                            zoomFactor: props.sessionState.zoomFactor - 0.1,
                          })
                        }
                        aria-label="Zoom browser out"
                      >
                        <MinusIcon className="size-3" />
                      </Button>
                      <button
                        type="button"
                        className="min-w-10 text-[10px] tabular-nums text-muted-foreground"
                        onClick={() =>
                          void bridge?.setBrowserZoomFactor({ ...sessionArg, zoomFactor: 1 })
                        }
                        title="Reset browser zoom"
                      >
                        {Math.round(props.sessionState.zoomFactor * 100)}%
                      </button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        disabled={props.sessionState.zoomFactor >= 2}
                        onClick={() =>
                          void bridge?.setBrowserZoomFactor({
                            ...sessionArg,
                            zoomFactor: props.sessionState.zoomFactor + 0.1,
                          })
                        }
                        aria-label="Zoom browser in"
                      >
                        <PlusIcon className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Viewport</span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          props.setBrowserViewport(
                            props.projectId,
                            {
                              devicePreset: props.browserState.devicePreset,
                              landscape: !props.browserState.landscape,
                            },
                            props.sessionId,
                          )
                        }
                      >
                        <RotateCwIcon className="size-3.5" />
                        {props.browserState.landscape ? "Portrait" : "Landscape"}
                      </Button>
                    </div>
                    <BrowserViewportSelector
                      browserState={props.browserState}
                      projectId={props.projectId}
                      sessionId={props.sessionId}
                      setBrowserViewport={props.setBrowserViewport}
                    />
                  </div>
                  <div className="grid gap-1 border-t pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="justify-start"
                      onClick={() => {
                        const colorScheme =
                          props.sessionState.colorScheme === "system"
                            ? "light"
                            : props.sessionState.colorScheme === "light"
                              ? "dark"
                              : "system";
                        void bridge?.setBrowserColorScheme({ ...sessionArg, colorScheme });
                      }}
                    >
                      <MonitorIcon className="size-3.5" />
                      Appearance:{" "}
                      <span className="capitalize">{props.sessionState.colorScheme}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="justify-start"
                      onClick={() =>
                        void bridge?.setBrowserAudioMuted({
                          ...sessionArg,
                          audioMuted: !props.sessionState.audioMuted,
                        })
                      }
                    >
                      {props.sessionState.audioMuted ? (
                        <VolumeXIcon className="size-3.5" />
                      ) : (
                        <Volume2Icon className="size-3.5" />
                      )}
                      {props.sessionState.audioMuted ? "Unmute audio" : "Mute audio"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="justify-start"
                      onClick={() =>
                        void (props.sessionState.pictureInPicture
                          ? bridge?.closeBrowserPictureInPicture(sessionArg)
                          : bridge?.openBrowserPictureInPicture(sessionArg))
                      }
                    >
                      <PictureInPicture2Icon className="size-3.5" />
                      {props.sessionState.pictureInPicture
                        ? "Return popped-out page"
                        : "Pop out page"}
                    </Button>
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Profile: {props.sessionState.profileId || "Project session"}
                    </p>
                    <Menu
                      onOpenChange={(open) => {
                        setActiveToolbarMenu(
                          open ? "history" : activeToolbarMenu === "history" ? "view" : null,
                        );
                      }}
                    >
                      <MenuTrigger
                        render={
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            aria-label="Browser history"
                          >
                            <HistoryIcon className="size-3.5" /> History and site data
                          </Button>
                        }
                      />
                      <MenuPopup align="start" className="max-h-80 w-96 overflow-y-auto">
                        {browserHistory.length === 0 ? (
                          <MenuItem disabled>No browser history</MenuItem>
                        ) : (
                          browserHistory.slice(0, 30).map((entry) => (
                            <MenuItem
                              key={entry.url}
                              onClick={() => {
                                props.setDraftUrl(entry.url);
                                void bridge?.navigateBrowserSession({
                                  ...sessionArg,
                                  url: entry.url,
                                });
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate" title={entry.url}>
                                {entry.title}
                              </span>
                            </MenuItem>
                          ))
                        )}
                        {browserHistory.length > 0 ? (
                          <>
                            <MenuSeparator />
                            <MenuItem onClick={clearBrowserHistory}>Clear browser history</MenuItem>
                          </>
                        ) : null}
                        <MenuSeparator />
                        <MenuItem
                          disabled={clearingBrowserData}
                          onClick={() => void clearBrowserData()}
                        >
                          {clearingBrowserData
                            ? "Clearing browser data…"
                            : "Clear cookies and cache"}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </div>
                </>
              }
              status={
                props.sessionState.assignedTaskId ||
                (props.sessionState.controller && props.sessionState.controller !== "none") ||
                (props.sessionState.temporaryAgentTab && !props.sessionState.userRetained) ||
                recordingBrowser ||
                issueRecording ||
                pickingElement ? (
                  <>
                    {activeRecordingControls}
                    {pickingElement && (
                      <span className="text-xs text-primary">Select an element on the page…</span>
                    )}
                    {props.sessionState.assignedTaskId ? (
                      <Badge
                        variant="outline"
                        className="h-6 text-xs text-muted-foreground"
                        title={`Assigned to task ${props.sessionState.assignedTaskId}`}
                      >
                        Task: {props.sessionState.assignedTaskId.slice(0, 8)}
                      </Badge>
                    ) : null}
                    {props.sessionState.controller && props.sessionState.controller !== "none" ? (
                      <Badge
                        variant={
                          props.sessionState.controller === "agent" ? "default" : "secondary"
                        }
                        aria-live="polite"
                      >
                        {props.sessionState.controller === "agent"
                          ? "Agent control"
                          : "Human control"}
                      </Badge>
                    ) : null}
                    {props.sessionState.controller === "agent" ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        className="h-6 text-xs text-amber-500 hover:text-amber-400"
                        onClick={() => void bridge?.takeBrowserControl?.(sessionArg)}
                      >
                        Take control
                      </Button>
                    ) : props.sessionState.controller === "human" &&
                      props.sessionState.assignedTaskId ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        className="h-6 text-xs"
                        onClick={() =>
                          void bridge?.resumeBrowserAgent?.({
                            ...sessionArg,
                            taskId: props.sessionState.assignedTaskId ?? undefined,
                          })
                        }
                      >
                        Resume agent
                      </Button>
                    ) : null}
                    {props.sessionState.temporaryAgentTab && !props.sessionState.userRetained ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="h-6 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void bridge?.retainBrowserTab?.(sessionArg)}
                        title="Keep this tab open after agent task finishes"
                      >
                        Keep tab
                      </Button>
                    ) : null}
                  </>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : props.toolbarTarget ? (
        createPortal(
          <div className="flex items-center gap-1.5 pr-1">
            {activeRecordingControls}
            {props.sessionState.assignedTaskId ? (
              <Badge
                variant="outline"
                className="h-6 text-xs text-muted-foreground"
                title={`Assigned to task ${props.sessionState.assignedTaskId}`}
              >
                Task: {props.sessionState.assignedTaskId.slice(0, 8)}
              </Badge>
            ) : null}
            {props.sessionState.controller && props.sessionState.controller !== "none" ? (
              <Badge
                variant={props.sessionState.controller === "agent" ? "default" : "secondary"}
                className="h-6"
                aria-live="polite"
              >
                {props.sessionState.controller === "agent" ? "Agent" : "Human"}
              </Badge>
            ) : null}
            {props.sessionState.controller === "agent" ? (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                className="h-6 text-xs text-amber-500 hover:text-amber-400"
                onClick={() => void bridge?.takeBrowserControl?.(sessionArg)}
              >
                Take control
              </Button>
            ) : props.sessionState.controller === "human" && props.sessionState.assignedTaskId ? (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                className="h-6 text-xs"
                onClick={() =>
                  void bridge?.resumeBrowserAgent?.({
                    ...sessionArg,
                    taskId: props.sessionState.assignedTaskId ?? undefined,
                  })
                }
              >
                Resume
              </Button>
            ) : null}
            <div className="flex items-center rounded-lg border border-border/70 bg-card/60 p-0.5 shadow-2xs backdrop-blur-xs">
              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/80 hover:text-foreground transition-all duration-150 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
                        disabled={!props.sessionState.canGoBack}
                        onClick={() => void bridge?.goBackBrowserSession(sessionArg)}
                        aria-label="Back"
                      >
                        <ArrowLeftIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom" align="center" sideOffset={6}>
                    Back
                  </TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/80 hover:text-foreground transition-all duration-150 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
                        disabled={!props.sessionState.canGoForward}
                        onClick={() => void bridge?.goForwardBrowserSession(sessionArg)}
                        aria-label="Forward"
                      >
                        <ArrowRightIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom" align="center" sideOffset={6}>
                    Forward
                  </TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/80 hover:text-foreground transition-all duration-150 active:scale-95"
                        onClick={() => void bridge?.reloadBrowserSession(sessionArg)}
                        aria-label={`Reload ${props.title}`}
                      >
                        <RefreshCwIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom" align="center" sideOffset={6}>
                    Refresh
                  </TooltipPopup>
                </Tooltip>
              </div>

              <div className="mx-0.5 h-3.5 w-px bg-border/70" />

              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/80 hover:text-foreground transition-all duration-150 active:scale-95"
                        onClick={() => props.setIsChromeExpanded(true)}
                        aria-label={`Show ${props.title} controls`}
                      >
                        <PanelTopOpenIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom" align="center" sideOffset={6}>
                    Show browser controls
                  </TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/80 hover:text-foreground transition-all duration-150 active:scale-95"
                        onClick={() =>
                          void api?.shell.openExternal(
                            props.sessionState.currentUrl ?? props.normalizedUrl,
                          )
                        }
                        aria-label={`Open ${props.title} externally`}
                      >
                        <ExternalLinkIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom" align="center" sideOffset={6}>
                    Open in external browser
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
            <div className="h-4 w-px bg-border/60" />
          </div>,
          props.toolbarTarget,
        )
      ) : null}
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
        {activeNotice ? (
          <BrowserViewportHiddenNotice
            icon={activeNotice.icon}
            title={activeNotice.title}
            description={activeNotice.description}
          />
        ) : null}
        {props.children}
        {pendingAnnotation ? (
          <PreviewAnnotationEditor
            key={pendingAnnotation.id}
            annotation={pendingAnnotation}
            onCancel={() => setPendingAnnotation(null)}
            onAttach={attachAnnotation}
          />
        ) : null}
        <RecordIssueDialog
          key={`${props.projectId}:${props.sessionId}`}
          projectCwd={props.projectCwd}
          onRecordingChange={setIssueRecording}
          availableTasks={reproductionTasks.map((thread) => ({
            id: thread.id,
            title: thread.title,
          }))}
          onReproductionCreated={async (reproduction) => {
            const task = reproductionTasks.find((thread) => thread.id === reproduction.taskId);
            if (!api || !task) throw new Error("The selected task is no longer available.");
            await api.orchestration.dispatchCommand({
              type: "thread.turn.start",
              commandId: CommandId.makeUnsafe(`reproduction-${reproduction.id}`),
              threadId: task.id,
              message: {
                messageId: MessageId.makeUnsafe(reproduction.id),
                role: "user",
                attachments: [],
                text: [
                  `Investigate this browser issue in ${props.projectCwd}.`,
                  `Expected result: ${reproduction.expectedResult}`,
                  `Reproduction: ${reproduction.specPath}`,
                  `Evidence and reviewed steps: tests/e2e/reproductions/${reproduction.id}.json`,
                  `Verification: ${reproduction.verificationStatus}. ${reproduction.verificationMessage ?? ""}`,
                  "Run the reviewed assertions to verify any fix. Required inputs are environment variables; do not put secrets in source files.",
                ].join("\n"),
              },
              modelSelection: task.modelSelection,
              runtimeMode: task.runtimeMode,
              interactionMode: task.interactionMode,
              createdAt: reproduction.createdAt,
            });
          }}
          isOpen={recordIssueDialogOpen}
          onOpenChange={setRecordIssueDialogOpen}
          projectId={props.projectId}
          sessionId={props.sessionId}
          currentUrl={props.sessionState.currentUrl || props.normalizedUrl}
          viewport={
            props.browserState.customWidth && props.browserState.customHeight
              ? { width: props.browserState.customWidth, height: props.browserState.customHeight }
              : undefined
          }
          profileId={props.sessionState.profileId}
          assignedTaskId={props.sessionState.assignedTaskId}
        />
        <BrowserComparisonView
          isOpen={comparisonOpen}
          onOpenChange={setComparisonOpen}
          projectId={props.projectId}
          sessionId={props.sessionId}
          primaryUrl={props.sessionState.currentUrl || props.normalizedUrl}
          primaryProfileId={props.sessionState.profileId}
        />
      </div>
    </div>
  );
}

function DesktopBrowserTool(props: {
  project: Project;
  projectSettings: ProjectWorkspaceSettings;
  runningProcessIds?: ReadonlyArray<string> | undefined;
  onRunProcess?: ((processId: string) => void) | undefined;
}) {
  const [api, setBrowserEnvironmentApi] = useState<Awaited<
    ReturnType<typeof environmentApi>
  > | null>(null);
  useEffect(() => {
    let active = true;
    setBrowserEnvironmentApi(null);
    void environmentApi(props.project.environmentId)
      .then((next) => {
        if (active) setBrowserEnvironmentApi(next);
      })
      .catch(() => {
        if (active) setBrowserEnvironmentApi(null);
      });
    return () => {
      active = false;
    };
  }, [props.project.environmentId]);
  const bridge = window.desktopBridge;
  const browserState = useAtomValue(workspaceShellAtom, (state) => {
    const sessionExisting =
      state.browserStateBySessionKey?.[browserSessionStateKey(props.project.id)];
    if (sessionExisting) {
      return sessionExisting;
    }
    const projectExisting = state.browserStateByProjectId[props.project.id];
    if (projectExisting) {
      return projectExisting;
    }
    return {
      currentUrl: resolveProjectDefaultBrowserUrl(props.project, props.projectSettings),
      devicePreset: "project-default",
      customWidth: null,
      customHeight: null,
      landscape: false,
      chromeExpanded: false,
    } as const;
  });
  const setBrowserCurrentUrl = useCallback((projectId: ProjectId, url: string) => {
    workspaceShellActions.setBrowserCurrentUrl(projectId, url, "browser");
  }, []);
  const setBrowserViewport: typeof workspaceShellActions.setBrowserViewport = useCallback(
    (projectId, input, sessionId) => {
      workspaceShellActions.setBrowserViewport(projectId, input, sessionId ?? "browser");
    },
    [],
  );
  const [draftUrl, setDraftUrl] = useState(browserState.currentUrl);
  const [hostState, setHostState] = useState<DesktopBrowserHostState>(
    DEFAULT_DESKTOP_BROWSER_HOST_STATE,
  );
  const [sessionState, setSessionState] = useState<DesktopBrowserSessionState>(
    createEmptyBrowserSessionState(props.project.id),
  );
  const [viewportSelectorOpen, setViewportSelectorOpen] = useState(false);
  const isChromeExpanded = browserState.chromeExpanded ?? false;
  const setIsChromeExpanded = useCallback(
    (expanded: boolean) => {
      workspaceShellActions.setBrowserChromeExpanded(props.project.id, expanded, "browser");
    },
    [props.project.id],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lastRequestedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setDraftUrl(browserState.currentUrl);
  }, [browserState.currentUrl]);

  const normalizedUrl = normalizeBrowserUrl(
    browserState.currentUrl ||
      resolveProjectDefaultBrowserUrl(props.project, props.projectSettings),
  );

  // Find a preset that matches the current URL.
  const allServerPresets = props.projectSettings.serverPresets ?? [];
  const runningProcessIds = props.runningProcessIds ?? [];
  const matchingIdlePreset = findMatchingIdleServerPreset(
    normalizedUrl,
    allServerPresets,
    runningProcessIds,
  );
  // A "matching running preset" is a preset whose previewUrl matches the current
  // URL AND whose terminal is actively running (i.e. it's in runningProcessIds).
  const matchingRunningPreset = (() => {
    if (!normalizedUrl || normalizedUrl.length === 0 || allServerPresets.length === 0) return null;
    const runningSet = new Set(runningProcessIds);
    const targetNorm = normalizeBrowserUrl(normalizedUrl).toLowerCase();
    for (const preset of allServerPresets) {
      if (!preset.previewUrl || preset.previewUrl.trim().length === 0) continue;
      const presetNorm = normalizeBrowserUrl(preset.previewUrl).toLowerCase();
      if (presetNorm === targetNorm || isMatchingHostPort(targetNorm, presetNorm)) {
        if (runningSet.has(preset.id)) {
          return preset;
        }
      }
    }
    return null;
  })();

  // Transient startup: the preset IS running but Chromium got ERR_CONNECTION_REFUSED
  // because the dev server hasn't finished binding. Show "Starting..." and retry.
  const isTransientStartup = Boolean(matchingRunningPreset) && Boolean(sessionState.transientError);

  // Definitive offline: there's a matching preset but it's NOT running at all,
  // OR the page failed with a non-transient error.
  const isLocalOffline =
    !isTransientStartup &&
    (Boolean(matchingIdlePreset) ||
      (Boolean(sessionState.lastError) && isLocalOrDevServerUrl(normalizedUrl)));

  // ── Auto-retry while in transient startup ──────────────────────────────────
  // When the dev server eventually starts, it emits terminal output. We listen
  // for that and trigger a throttled reload so the browser connects as soon as
  // the port is ready, without the user ever clicking anything.
  const lastRetryAtRef = useRef<number>(0);
  useEffect(() => {
    if (!bridge || !isTransientStartup || !matchingRunningPreset) {
      return;
    }
    if (!api) return;
    const serverThreadId = `server:${props.project.id}`;
    const targetTerminalId = matchingRunningPreset.id;

    const unsubscribe = api.terminal.onEvent((event) => {
      // Only react to output from the matching server preset terminal.
      if (event.threadId !== serverThreadId || event.terminalId !== targetTerminalId) {
        return;
      }
      if (event.type !== "output" && event.type !== "activity") {
        return;
      }
      // Throttle: at most one retry per 2 seconds.
      const now = Date.now();
      if (now - lastRetryAtRef.current < 2000) {
        return;
      }
      lastRetryAtRef.current = now;
      void bridge.reloadBrowserSession({ projectId: props.project.id }).catch(() => undefined);
    });

    return () => {
      unsubscribe();
    };
  }, [api, bridge, isTransientStartup, matchingRunningPreset, props.project.id]);

  useEffect(() => {
    if (!bridge) {
      return;
    }

    let disposed = false;
    const partition = resolveBrowserPartition({
      projectId: props.project.id,
      sessionId: "browser",
      partitionMode: props.projectSettings.browser?.partitionMode,
      partitionProfile: props.projectSettings.browser?.partitionProfile,
    });
    void bridge
      .getBrowserHostState()
      .then((nextState) => {
        if (disposed) return;
        setHostState(nextState);
      })
      .catch(() => undefined);
    void bridge
      .getBrowserSessionState({
        projectId: props.project.id,
        sessionId: "browser",
      })
      .then((nextState) => {
        if (disposed || !nextState) return;
        setSessionState(nextState);
      })
      .catch(() => undefined);
    void bridge
      .ensureBrowserSession({
        projectId: props.project.id,
        sessionId: "browser",
        initialUrl: normalizedUrl,
        partition,
      })
      .then(() =>
        bridge.activateBrowserSession({
          projectId: props.project.id,
          sessionId: "browser",
        }),
      )
      .catch(() => undefined);

    const unsubscribe = bridge.onBrowserSessionState((nextState) => {
      if (nextState.projectId !== props.project.id || nextState.sessionId !== "browser") {
        return;
      }
      setSessionState(nextState);
    });

    return () => {
      disposed = true;
      unsubscribe();
      lastRequestedUrlRef.current = null;
      void bridge.hideBrowserSession().catch(() => undefined);
    };
  }, [
    bridge,
    normalizedUrl,
    props.project.id,
    props.projectSettings.browser?.partitionMode,
    props.projectSettings.browser?.partitionProfile,
  ]);

  useEffect(() => {
    if (!bridge || !hostState.available || normalizedUrl.length === 0) {
      return;
    }
    if (isSameWebUrl(sessionState.currentUrl, normalizedUrl)) {
      lastRequestedUrlRef.current = normalizedUrl;
      return;
    }
    if (isSameWebUrl(lastRequestedUrlRef.current, normalizedUrl)) {
      return;
    }
    lastRequestedUrlRef.current = normalizedUrl;
    void bridge
      .navigateBrowserSession({
        projectId: props.project.id,
        url: normalizedUrl,
      })
      .catch(() => {
        if (lastRequestedUrlRef.current === normalizedUrl) {
          lastRequestedUrlRef.current = null;
        }
      });
  }, [bridge, hostState.available, normalizedUrl, props.project.id, sessionState.currentUrl]);

  useEffect(() => {
    if (
      !sessionState.currentUrl ||
      isSameWebUrl(sessionState.currentUrl, browserState.currentUrl)
    ) {
      return;
    }
    setBrowserCurrentUrl(props.project.id, sessionState.currentUrl);
  }, [browserState.currentUrl, props.project.id, sessionState.currentUrl, setBrowserCurrentUrl]);

  const selectedPreset =
    BROWSER_DEVICE_PRESETS.find((preset) => preset.id === browserState.devicePreset) ??
    BROWSER_DEVICE_PRESETS[0]!;
  const baseWidth =
    selectedPreset.id === "custom" ? browserState.customWidth : selectedPreset.width;
  const baseHeight =
    selectedPreset.id === "custom" ? browserState.customHeight : selectedPreset.height;
  const viewportWidth = browserState.landscape ? baseHeight : baseWidth;
  const viewportHeight = browserState.landscape ? baseWidth : baseHeight;

  useEffect(() => {
    if (!bridge || !hostState.available) {
      return;
    }
    const hostNode = hostRef.current;
    if (!hostNode) {
      return;
    }

    let frameId = 0;
    let lastSignature = "";
    const publishBounds = () => {
      frameId = 0;
      const cssZoom =
        (typeof document !== "undefined" && parseFloat(document.documentElement.style.zoom)) || 1.0;
      const rect = hostNode.getBoundingClientRect();
      const nextBounds = {
        projectId: props.project.id,
        x: Math.round(rect.left * cssZoom),
        y: Math.round(rect.top * cssZoom),
        width: Math.round(rect.width * cssZoom),
        height: Math.round(rect.height * cssZoom),
        visible: rect.width > 0 && rect.height > 0,
      };
      const signature = [
        nextBounds.x,
        nextBounds.y,
        nextBounds.width,
        nextBounds.height,
        nextBounds.visible ? 1 : 0,
      ].join(":");
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      void bridge.setBrowserBounds(nextBounds).catch(() => undefined);
    };
    const scheduleBounds = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(publishBounds);
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleBounds();
    });
    resizeObserver.observe(hostNode);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("tabs-zoom-change", scheduleBounds);
    scheduleBounds();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("tabs-zoom-change", scheduleBounds);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
      void bridge
        .setBrowserBounds({
          projectId: props.project.id,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false,
        })
        .catch(() => undefined);
    };
  }, [bridge, hostState.available, props.project.id]);

  useEffect(() => {
    if (!bridge || !hostState.available) return;
    if (viewportSelectorOpen || isLocalOffline || isTransientStartup) {
      void bridge.hideBrowserSession().catch(() => undefined);
    } else {
      void bridge
        .activateBrowserSession({
          projectId: props.project.id,
        })
        .catch(() => undefined);
    }
  }, [bridge, hostState.available, viewportSelectorOpen, isLocalOffline, props.project.id]);

  // Keep a ref so the overlay-detection closure below always reads the current
  // loading/error state without needing to re-register the MutationObserver.
  const sessionStateRef = useRef(sessionState);
  useEffect(() => {
    sessionStateRef.current = sessionState;
  });

  useNativeSurfaceOverlaySuspension({
    enabled: Boolean(bridge && hostState.available),
    surfaceReady: !sessionState.loading && !sessionState.lastError,
    onSuspend: () => {
      void bridge?.hideBrowserSession().catch(() => undefined);
    },
    onResume: () => {
      void bridge
        ?.activateBrowserSession({
          projectId: props.project.id,
        })
        .catch(() => undefined);
    },
  });

  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updateTarget = () => {
      setToolbarTarget(document.getElementById("project-toolbar-extra-controls"));
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const submitDraftUrl = useCallback(() => {
    setBrowserCurrentUrl(props.project.id, normalizeBrowserUrl(draftUrl));
  }, [draftUrl, props.project.id, setBrowserCurrentUrl]);

  if (!bridge || !hostState.available) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-4">
        <Card className="overflow-hidden border-border/70 bg-card/70 backdrop-blur-sm">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle>Embedded browser unavailable</CardTitle>
            <CardDescription>
              {hostState.reason ??
                "This desktop session does not expose the embedded browser host. Open the page in your external browser instead."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Button type="button" onClick={() => void api?.shell.openExternal(normalizedUrl)}>
              <ExternalLinkIcon className="size-3.5" />
              Open In Browser
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DesktopBrowserChrome
      projectCwd={props.project.cwd}
      projectId={props.project.id}
      sessionId="browser"
      title="Browser"
      isChromeExpanded={isChromeExpanded}
      setIsChromeExpanded={setIsChromeExpanded}
      sessionState={sessionState}
      browserState={browserState}
      draftUrl={draftUrl}
      setDraftUrl={setDraftUrl}
      submitDraftUrl={submitDraftUrl}
      normalizedUrl={normalizedUrl}
      setBrowserViewport={setBrowserViewport}
      setViewportSelectorOpen={setViewportSelectorOpen}
      viewportSelectorOpen={viewportSelectorOpen}
      toolbarTarget={toolbarTarget}
    >
      {isTransientStartup && matchingRunningPreset ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6 bg-background/80 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
              <div className="flex items-center gap-2.5">
                <ServerIcon className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <h2 className="text-xs font-semibold text-foreground tracking-tight">
                    Starting {matchingRunningPreset.label}...
                  </h2>
                  <p className="text-[11px] text-muted-foreground font-mono">{normalizedUrl}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                <Spinner className="size-3" />
                Starting
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              The dev server is starting up. The browser will load automatically once the server is
              ready.
            </p>
            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => workspaceShellActions.setActiveTool(props.project.id, "server")}
                className="gap-2 cursor-pointer font-medium"
              >
                <TerminalSquareIcon className="size-3.5" />
                Open Server Tab
              </Button>
            </div>
          </div>
        </div>
      ) : isLocalOffline ? (
        <UniversalDevServerOfflineNotice
          preset={matchingIdlePreset}
          allPresets={props.projectSettings.serverPresets ?? []}
          url={normalizedUrl}
          onRunProcess={props.onRunProcess}
          onOpenServerTab={() => workspaceShellActions.setActiveTool(props.project.id, "server")}
        />
      ) : null}
      <BrowserViewportResizeFrame
        width={viewportWidth}
        height={viewportHeight}
        onCommit={({ width, height }) =>
          setBrowserViewport(props.project.id, {
            devicePreset: "custom",
            customWidth: width,
            customHeight: height,
            landscape: false,
          })
        }
      >
        <div ref={hostRef} className="absolute inset-0 bg-background" />
        {sessionState.loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-center border-b border-border/70 bg-background/80 text-sm text-muted-foreground backdrop-blur-sm">
            <Spinner className="mr-2 size-4" />
            Loading page...
          </div>
        ) : null}
        {sessionState.lastError ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
            <Card className="pointer-events-auto max-w-lg">
              <CardHeader>
                <CardTitle>Page load failed</CardTitle>
                <CardDescription>{sessionState.lastError}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() =>
                    void bridge.reloadBrowserSession({
                      projectId: props.project.id,
                    })
                  }
                >
                  <RefreshCwIcon className="size-3.5" />
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void api?.shell.openExternal(sessionState.currentUrl ?? normalizedUrl)
                  }
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open In Browser
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </BrowserViewportResizeFrame>
    </DesktopBrowserChrome>
  );
}

function EmbeddedBrowserTool(props: {
  project: Project;
  projectSettings: ProjectWorkspaceSettings;
  runningProcessIds?: ReadonlyArray<string> | undefined;
  onRunProcess?: ((processId: string) => void) | undefined;
}) {
  const api = readNativeApi();
  const browserState = useAtomValue(workspaceShellAtom, (state) => {
    const sessionExisting =
      state.browserStateBySessionKey?.[browserSessionStateKey(props.project.id)];
    if (sessionExisting) {
      return sessionExisting;
    }
    const projectExisting = state.browserStateByProjectId[props.project.id];
    if (projectExisting) {
      return projectExisting;
    }
    return {
      currentUrl: resolveProjectDefaultBrowserUrl(props.project, props.projectSettings),
      devicePreset: "project-default",
      customWidth: null,
      customHeight: null,
      landscape: false,
      chromeExpanded: false,
    } as const;
  });
  const setBrowserCurrentUrl = useCallback((projectId: ProjectId, url: string) => {
    workspaceShellActions.setBrowserCurrentUrl(projectId, url, "browser");
  }, []);
  const setBrowserViewport: typeof workspaceShellActions.setBrowserViewport = useCallback(
    (projectId, input, sessionId) => {
      workspaceShellActions.setBrowserViewport(projectId, input, sessionId ?? "browser");
    },
    [],
  );
  const [draftUrl, setDraftUrl] = useState(browserState.currentUrl);
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewportSelectorOpen, setViewportSelectorOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setDraftUrl(browserState.currentUrl);
  }, [browserState.currentUrl]);

  const normalizedUrl = normalizeBrowserUrl(
    browserState.currentUrl ||
      resolveProjectDefaultBrowserUrl(props.project, props.projectSettings),
  );

  const matchingIdlePreset = findMatchingIdleServerPreset(
    normalizedUrl,
    props.projectSettings.serverPresets ?? [],
    props.runningProcessIds ?? [],
  );

  const isLocalOffline =
    Boolean(matchingIdlePreset) || (Boolean(embedBlocked) && isLocalOrDevServerUrl(normalizedUrl));

  useEffect(() => {
    setEmbedBlocked(false);
    setLoading(true);
    const timeoutId = window.setTimeout(() => {
      setEmbedBlocked(true);
      setLoading(false);
    }, EMBED_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [normalizedUrl]);

  const selectedPreset =
    BROWSER_DEVICE_PRESETS.find((preset) => preset.id === browserState.devicePreset) ??
    BROWSER_DEVICE_PRESETS[0]!;
  const baseWidth =
    selectedPreset.id === "custom" ? browserState.customWidth : selectedPreset.width;
  const baseHeight =
    selectedPreset.id === "custom" ? browserState.customHeight : selectedPreset.height;
  const viewportWidth = browserState.landscape ? baseHeight : baseWidth;
  const viewportHeight = browserState.landscape ? baseWidth : baseHeight;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Card className="relative z-20">
        <CardContent className="space-y-1.5 p-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => iframeRef.current?.contentWindow?.location.reload()}
            >
              <RefreshCwIcon className="size-3.5" />
              Refresh
            </Button>
            <div className="flex min-w-[12rem] flex-1 items-center gap-1.5">
              <Input
                className="h-8"
                value={draftUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  setBrowserCurrentUrl(props.project.id, normalizeBrowserUrl(draftUrl));
                }}
                placeholder="Enter a URL"
              />
              <Button
                type="button"
                size="xs"
                onClick={() =>
                  setBrowserCurrentUrl(props.project.id, normalizeBrowserUrl(draftUrl))
                }
              >
                Go
              </Button>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void api?.shell.openExternal(normalizedUrl)}
            >
              <ExternalLinkIcon className="size-3.5" />
              External
            </Button>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  setBrowserViewport(
                    props.project.id,
                    {
                      devicePreset: browserState.devicePreset,
                      landscape: !browserState.landscape,
                    },
                    "browser",
                  )
                }
              >
                <RotateCwIcon className="size-3.5" />
                {browserState.landscape ? "Portrait" : "Landscape"}
              </Button>
              <BrowserViewportSelector
                browserState={browserState}
                projectId={props.project.id}
                sessionId="browser"
                setBrowserViewport={setBrowserViewport}
                onOpenChange={setViewportSelectorOpen}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="relative z-0 min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5">
        {viewportSelectorOpen ? <BrowserViewportHiddenNotice /> : null}
        {isLocalOffline ? (
          <UniversalDevServerOfflineNotice
            preset={matchingIdlePreset}
            allPresets={props.projectSettings.serverPresets ?? []}
            url={normalizedUrl}
            onRunProcess={props.onRunProcess}
            onOpenServerTab={() => workspaceShellActions.setActiveTool(props.project.id, "server")}
          />
        ) : embedBlocked ? (
          <div className="flex h-full min-h-[24rem] items-center justify-center">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle>Embedded preview blocked</CardTitle>
                <CardDescription>
                  This URL did not finish loading inside the IDE shell. Open it in your browser
                  instead.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => void api?.shell.openExternal(normalizedUrl)}>
                  <ExternalLinkIcon className="size-3.5" />
                  Open In Browser
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center overflow-hidden">
            <div
              className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-lg"
              style={{
                width: viewportWidth ? `min(${viewportWidth}px, 100%)` : "100%",
                height: viewportHeight ? `min(${viewportHeight}px, 100%)` : "100%",
                minHeight: viewportHeight ? undefined : "100%",
              }}
            >
              {loading ? (
                <div className="flex h-12 items-center justify-center border-b border-border/70 bg-muted/30 text-sm text-muted-foreground">
                  <Spinner className="mr-2 size-4" />
                  Loading preview...
                </div>
              ) : null}
              <iframe
                ref={iframeRef}
                title={`${props.project.name} preview`}
                src={normalizedUrl}
                sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
                className="h-full w-full bg-white"
                style={{
                  visibility: viewportSelectorOpen ? "hidden" : "visible",
                }}
                onLoad={() => {
                  setLoading(false);
                  setEmbedBlocked(false);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function isMatchingHostPort(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

function isLocalOrDevServerUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0") ||
    /^https?:\/\/[^/]+:[0-9]+/i.test(lower)
  );
}

function findMatchingIdleServerPreset(
  normalizedUrl: string,
  serverPresets: ReadonlyArray<ProjectWorkspaceSettings["serverPresets"][number]>,
  runningProcessIds: ReadonlyArray<string> = [],
) {
  if (
    !normalizedUrl ||
    normalizedUrl.length === 0 ||
    !serverPresets ||
    serverPresets.length === 0
  ) {
    return null;
  }
  const runningSet = new Set(runningProcessIds);
  const targetNorm = normalizeBrowserUrl(normalizedUrl).toLowerCase();

  for (const preset of serverPresets) {
    if (!preset.previewUrl || preset.previewUrl.trim().length === 0) continue;
    const presetNorm = normalizeBrowserUrl(preset.previewUrl).toLowerCase();
    if (presetNorm === targetNorm || isMatchingHostPort(targetNorm, presetNorm)) {
      if (!runningSet.has(preset.id)) {
        return preset;
      }
    }
  }
  return null;
}

function UniversalDevServerOfflineNotice(props: {
  preset: ProjectWorkspaceSettings["serverPresets"][number] | null;
  allPresets: ReadonlyArray<ProjectWorkspaceSettings["serverPresets"][number]>;
  url: string;
  onRunProcess?: ((processId: string) => void) | undefined;
  onOpenServerTab?: (() => void) | undefined;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6 bg-background/80 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="pointer-events-auto max-w-md w-full rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-5">
        {/* Header section with clean unboxed icon and subtle monotone pill */}
        <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2.5">
            <ServerIcon className="size-4 text-muted-foreground shrink-0" />
            <div>
              <h2 className="text-xs font-semibold text-foreground tracking-tight">
                Server Offline
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono">{props.url}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground/60" />
            Not responding
          </span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          The local development server is not running. Switch to the Server tab to start server
          presets and view live terminal logs.
        </p>

        {/* Bottom Actions */}
        <div className="flex items-center justify-between border-t border-border/60 pt-3.5">
          {props.onOpenServerTab ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 cursor-pointer font-medium"
              onClick={props.onOpenServerTab}
            >
              <TerminalSquareIcon className="size-4" />
              Open Server Tab
            </Button>
          ) : (
            <div />
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => window.location.reload()}
          >
            <RefreshCwIcon className="size-3.5" />
            Reload Page
          </Button>
        </div>
      </div>
    </div>
  );
}

function BrowserTool(props: {
  project: Project;
  projectSettings: ProjectWorkspaceSettings;
  runningProcessIds?: ReadonlyArray<string> | undefined;
  onRunProcess?: ((processId: string) => void) | undefined;
}) {
  if (window.desktopBridge) {
    return (
      <DesktopBrowserTool
        project={props.project}
        projectSettings={props.projectSettings}
        runningProcessIds={props.runningProcessIds}
        onRunProcess={props.onRunProcess}
      />
    );
  }

  return (
    <EmbeddedBrowserTool
      project={props.project}
      projectSettings={props.projectSettings}
      runningProcessIds={props.runningProcessIds}
      onRunProcess={props.onRunProcess}
    />
  );
}

function DesktopCustomEmbedTool(props: {
  project: Project;
  title: string;
  url: string;
  resumeLastVisitedPage?: boolean | undefined;
  lastVisitedUrl?: string | undefined;
  partitionMode?: BrowserPartitionMode | undefined;
  partitionProfile?: string | undefined;
  sessionId: string;
}) {
  const api = readNativeApi();
  const bridge = window.desktopBridge;
  const projectSettings = useProjectWorkspaceSettings(props.project.id);
  const sessionKey = `${projectUiStateKey(props.project.environmentId, props.project.id)}:${props.sessionId}`;
  const browserState = useAtomValue(workspaceShellAtom, (state) => {
    const existing =
      state.browserStateBySessionKey?.[browserSessionStateKey(props.project.id, props.sessionId)];
    if (existing) {
      return existing;
    }
    return {
      currentUrl: normalizeBrowserUrl(props.url),
      devicePreset: "project-default",
      customWidth: null,
      customHeight: null,
      landscape: false,
      chromeExpanded: false,
    } as const;
  });
  const setBrowserViewport: typeof workspaceShellActions.setBrowserViewport = useCallback(
    (projectId, input, sessionId) => {
      workspaceShellActions.setBrowserViewport(projectId, input, sessionId ?? props.sessionId);
    },
    [props.sessionId],
  );
  const [hostState, setHostState] = useState<DesktopBrowserHostState>(
    DEFAULT_DESKTOP_BROWSER_HOST_STATE,
  );
  const [sessionState, setSessionState] = useState<DesktopBrowserSessionState>(
    createEmptyBrowserSessionState(props.project.id, props.sessionId),
  );
  const [browserScopedState, setBrowserScopedState] = useProjectBrowserState(sessionKey);
  const viewportSelectorOpen = browserScopedState.viewportSelectorOpen;
  const setViewportSelectorOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setBrowserScopedState((prev) => ({
        viewportSelectorOpen: typeof v === "function" ? v(prev.viewportSelectorOpen) : v,
      }));
    },
    [setBrowserScopedState],
  );
  const isChromeExpanded = browserState.chromeExpanded ?? false;
  const setIsChromeExpanded = useCallback(
    (expanded: boolean) => {
      workspaceShellActions.setBrowserChromeExpanded(props.project.id, expanded, props.sessionId);
    },
    [props.project.id, props.sessionId],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lastRequestedUrlRef = useRef<string | null>(null);
  const storedUrl = useAtomValue(
    workspaceShellAtom,
    (state) =>
      state.browserUrlBySessionKey[browserSessionStateKey(props.project.id, props.sessionId)],
  );
  const setBrowserSessionUrl = workspaceShellActions.setBrowserSessionUrl;
  // A custom tab optionally reopens at the URL the user last navigated to (persisted),
  // falling back to its configured URL; editing the configured URL takes over.
  const configuredUrl = normalizeBrowserUrl(props.url);
  const normalizedUrl = normalizeBrowserUrl(
    props.resumeLastVisitedPage ? (storedUrl ?? props.lastVisitedUrl ?? props.url) : props.url,
  );
  // Editable address bar for the custom embed. Navigating here writes the
  // per-session URL (NOT the shared per-project browser state — see the
  // navigate effect below), which recomputes `normalizedUrl` and drives the
  // BrowserView. Lets the user recover a tab whose page broke by editing the
  // URL and reloading, without going back to Settings.
  const draftUrl = browserScopedState.draftUrl;
  const setDraftUrl = useCallback(
    (v: string | ((prev: string) => string)) => {
      setBrowserScopedState((prev) => ({
        draftUrl: typeof v === "function" ? v(prev.draftUrl) : v,
      }));
    },
    [setBrowserScopedState],
  );
  const submitDraftUrl = () => {
    const nextUrl = normalizeBrowserUrl(draftUrl);
    if (!nextUrl || nextUrl.length === 0) return;
    setBrowserSessionUrl(props.project.id, props.sessionId, nextUrl);
    if (bridge && hostState.available) {
      void bridge
        .navigateBrowserSession({
          projectId: props.project.id,
          sessionId: props.sessionId,
          url: nextUrl,
        })
        .catch(() => undefined);
    }
  };
  const prevConfiguredUrlRef = useRef(configuredUrl);
  useEffect(() => {
    if (prevConfiguredUrlRef.current !== configuredUrl) {
      prevConfiguredUrlRef.current = configuredUrl;
      if (!props.resumeLastVisitedPage || !storedUrl) {
        setBrowserSessionUrl(props.project.id, props.sessionId, configuredUrl);
      }
    }
  }, [
    configuredUrl,
    props.project.id,
    props.sessionId,
    props.resumeLastVisitedPage,
    storedUrl,
    setBrowserSessionUrl,
  ]);
  const { isClosing } = useAppClosing();
  const [debouncedCurrentUrl, currentUrlDebouncer] = useDebouncedValue(sessionState.currentUrl, {
    wait: 2000,
  });

  useEffect(() => {
    if (isClosing) {
      currentUrlDebouncer.flush();
    }
  }, [isClosing, currentUrlDebouncer]);

  useEffect(() => {
    const current = debouncedCurrentUrl;
    if (current && current !== storedUrl) {
      setBrowserSessionUrl(props.project.id, props.sessionId, current);
      if (props.resumeLastVisitedPage) {
        workspaceShellActions.upsertProjectSettings(props.project.id, (settings) => {
          const embedId = props.sessionId.replace(/^custom-/, "");
          const customEmbeds = settings.customEmbeds ?? [];
          const index = customEmbeds.findIndex((e) => e.id === embedId);
          if (index === -1) return settings;
          const embed = customEmbeds[index];
          if (!embed || embed.lastVisitedUrl === current) return settings;

          const nextEmbeds = [...customEmbeds];
          nextEmbeds[index] = { ...embed, lastVisitedUrl: current };
          return { ...settings, customEmbeds: nextEmbeds };
        });
      }
    }
  }, [
    debouncedCurrentUrl,
    storedUrl,
    setBrowserSessionUrl,
    props.project.id,
    props.sessionId,
    props.resumeLastVisitedPage,
  ]);
  // Keep the address bar reflecting where the embed actually is (e.g. after the
  // user clicks a link inside it or navigates), like a real browser URL bar.
  useEffect(() => {
    setDraftUrl(sessionState.currentUrl ?? normalizedUrl);
  }, [sessionState.currentUrl, normalizedUrl]);

  useEffect(() => {
    if (!bridge) {
      return;
    }

    let disposed = false;
    const partition = resolveBrowserPartition({
      projectId: props.project.id,
      sessionId: props.sessionId,
      partitionMode: props.partitionMode,
      partitionProfile: props.partitionProfile,
    });
    void bridge
      .getBrowserHostState()
      .then((nextState) => {
        if (disposed) return;
        setHostState(nextState);
      })
      .catch(() => undefined);
    void bridge
      .getBrowserSessionState({
        projectId: props.project.id,
        sessionId: props.sessionId,
      })
      .then((nextState) => {
        if (disposed || !nextState) return;
        setSessionState(nextState);
      })
      .catch(() => undefined);
    void bridge
      .ensureBrowserSession({
        projectId: props.project.id,
        sessionId: props.sessionId,
        initialUrl: normalizedUrl,
        partition,
      })
      .then(() =>
        bridge.activateBrowserSession({
          projectId: props.project.id,
          sessionId: props.sessionId,
        }),
      )
      .catch(() => undefined);

    const unsubscribe = bridge.onBrowserSessionState((nextState) => {
      if (nextState.projectId !== props.project.id || nextState.sessionId !== props.sessionId) {
        return;
      }
      setSessionState(nextState);
    });

    return () => {
      disposed = true;
      unsubscribe();
      lastRequestedUrlRef.current = null;
      void bridge.hideBrowserSession().catch(() => undefined);
    };
  }, [
    bridge,
    normalizedUrl,
    props.project.id,
    props.sessionId,
    props.partitionMode,
    props.partitionProfile,
  ]);

  useEffect(() => {
    if (!bridge || !hostState.available || normalizedUrl.length === 0) {
      return;
    }
    if (sessionState.currentUrl === normalizedUrl) {
      lastRequestedUrlRef.current = normalizedUrl;
      return;
    }
    if (lastRequestedUrlRef.current === normalizedUrl) {
      return;
    }
    lastRequestedUrlRef.current = normalizedUrl;
    // A custom embed is pinned to its configured URL — it must NOT write into
    // the shared per-project browser state (that would clobber the main
    // Browser tab's persisted URL on relaunch).
    void bridge
      .navigateBrowserSession({
        projectId: props.project.id,
        sessionId: props.sessionId,
        url: normalizedUrl,
      })
      .catch(() => {
        if (lastRequestedUrlRef.current === normalizedUrl) {
          lastRequestedUrlRef.current = null;
        }
      });
  }, [bridge, hostState.available, normalizedUrl, props.project.id, sessionState.currentUrl]);

  const selectedPreset =
    BROWSER_DEVICE_PRESETS.find((preset) => preset.id === browserState.devicePreset) ??
    BROWSER_DEVICE_PRESETS[0]!;
  const baseWidth =
    selectedPreset.id === "custom" ? browserState.customWidth : selectedPreset.width;
  const baseHeight =
    selectedPreset.id === "custom" ? browserState.customHeight : selectedPreset.height;
  const viewportWidth = browserState.landscape ? baseHeight : baseWidth;
  const viewportHeight = browserState.landscape ? baseWidth : baseHeight;

  useEffect(() => {
    if (!bridge || !hostState.available) {
      return;
    }
    const hostNode = hostRef.current;
    if (!hostNode) {
      return;
    }

    let frameId = 0;
    let lastSignature = "";
    const publishBounds = () => {
      frameId = 0;
      const cssZoom =
        (typeof document !== "undefined" && parseFloat(document.documentElement.style.zoom)) || 1.0;
      const rect = hostNode.getBoundingClientRect();
      const nextBounds = {
        projectId: props.project.id,
        sessionId: props.sessionId,
        x: Math.round(rect.left * cssZoom),
        y: Math.round(rect.top * cssZoom),
        width: Math.round(rect.width * cssZoom),
        height: Math.round(rect.height * cssZoom),
        visible: rect.width > 0 && rect.height > 0,
      };
      const signature = [
        nextBounds.x,
        nextBounds.y,
        nextBounds.width,
        nextBounds.height,
        nextBounds.visible ? 1 : 0,
      ].join(":");
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      void bridge.setBrowserBounds(nextBounds).catch(() => undefined);
    };
    const scheduleBounds = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(publishBounds);
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleBounds();
    });
    resizeObserver.observe(hostNode);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("tabs-zoom-change", scheduleBounds);
    scheduleBounds();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("tabs-zoom-change", scheduleBounds);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
      void bridge
        .setBrowserBounds({
          projectId: props.project.id,
          sessionId: props.sessionId,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false,
        })
        .catch(() => undefined);
    };
  }, [bridge, hostState.available, props.project.id]);

  useEffect(() => {
    if (!bridge || !hostState.available) return;
    if (viewportSelectorOpen) {
      void bridge.hideBrowserSession().catch(() => undefined);
    } else {
      void bridge
        .activateBrowserSession({
          projectId: props.project.id,
          sessionId: props.sessionId,
        })
        .catch(() => undefined);
    }
  }, [bridge, hostState.available, viewportSelectorOpen, props.project.id]);

  useNativeSurfaceOverlaySuspension({
    enabled: Boolean(bridge && hostState.available),
    surfaceReady: !sessionState.loading && !sessionState.lastError,
    onSuspend: () => {
      void bridge?.hideBrowserSession().catch(() => undefined);
    },
    onResume: () => {
      void bridge
        ?.activateBrowserSession({
          projectId: props.project.id,
          sessionId: props.sessionId,
        })
        .catch(() => undefined);
    },
  });

  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updateTarget = () => {
      setToolbarTarget(document.getElementById("project-toolbar-extra-controls"));
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!bridge || !hostState.available) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-4">
        <Card className="overflow-hidden border-border/70 bg-card/70 backdrop-blur-sm">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle>Embedded browser unavailable</CardTitle>
            <CardDescription>
              {hostState.reason ??
                "This desktop session does not expose the embedded browser host. Open the page in your external browser instead."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Button type="button" onClick={() => void api?.shell.openExternal(normalizedUrl)}>
              <ExternalLinkIcon className="size-3.5" />
              Open In Browser
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DesktopBrowserChrome
      projectCwd={props.project.cwd}
      projectId={props.project.id}
      sessionId={props.sessionId}
      title={props.title}
      isChromeExpanded={isChromeExpanded}
      setIsChromeExpanded={setIsChromeExpanded}
      sessionState={sessionState}
      browserState={browserState}
      draftUrl={draftUrl}
      setDraftUrl={setDraftUrl}
      submitDraftUrl={submitDraftUrl}
      normalizedUrl={normalizedUrl}
      setBrowserViewport={setBrowserViewport}
      setViewportSelectorOpen={setViewportSelectorOpen}
      viewportSelectorOpen={viewportSelectorOpen}
      toolbarTarget={toolbarTarget}
    >
      <BrowserViewportResizeFrame
        width={viewportWidth}
        height={viewportHeight}
        onCommit={({ width, height }) =>
          setBrowserViewport(
            props.project.id,
            {
              devicePreset: "custom",
              customWidth: width,
              customHeight: height,
              landscape: false,
            },
            props.sessionId,
          )
        }
      >
        <div ref={hostRef} className="absolute inset-0 bg-background" />
        {sessionState.loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-center border-b border-border/70 bg-background/80 text-sm text-muted-foreground backdrop-blur-sm">
            <Spinner className="mr-2 size-4" />
            Loading page...
          </div>
        ) : null}
        {sessionState.lastError ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
            <Card className="pointer-events-auto max-w-lg">
              <CardHeader>
                <CardTitle>Page load failed</CardTitle>
                <CardDescription>{sessionState.lastError}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() =>
                    void bridge.reloadBrowserSession({
                      projectId: props.project.id,
                      sessionId: props.sessionId,
                    })
                  }
                >
                  <RefreshCwIcon className="size-3.5" />
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void api?.shell.openExternal(sessionState.currentUrl ?? normalizedUrl)
                  }
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open In Browser
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </BrowserViewportResizeFrame>
    </DesktopBrowserChrome>
  );
}

function CustomEmbedTool(props: {
  project: Project;
  title: string;
  url: string;
  resumeLastVisitedPage?: boolean | undefined;
  lastVisitedUrl?: string | undefined;
  partitionMode?: BrowserPartitionMode | undefined;
  partitionProfile?: string | undefined;
  sessionId: string;
}) {
  if (window.desktopBridge) {
    return (
      <DesktopCustomEmbedTool
        project={props.project}
        title={props.title}
        url={props.url}
        resumeLastVisitedPage={props.resumeLastVisitedPage}
        lastVisitedUrl={props.lastVisitedUrl}
        partitionMode={props.partitionMode}
        partitionProfile={props.partitionProfile}
        sessionId={props.sessionId}
      />
    );
  }

  const api = readNativeApi();
  const [loading, setLoading] = useState(true);
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const storedUrl = useAtomValue(
    workspaceShellAtom,
    (state) =>
      state.browserUrlBySessionKey[browserSessionStateKey(props.project.id, props.sessionId)],
  );
  const normalizedUrl = normalizeBrowserUrl(
    props.resumeLastVisitedPage ? (storedUrl ?? props.lastVisitedUrl ?? props.url) : props.url,
  );

  useEffect(() => {
    setLoading(true);
    setEmbedBlocked(false);
    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setEmbedBlocked(true);
    }, EMBED_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [normalizedUrl]);

  if (normalizedUrl.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Embed URL missing</CardTitle>
            <CardDescription>
              This custom tool does not have a URL yet. Add one in project settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{props.title}</div>
            <div className="truncate text-xs text-muted-foreground">{normalizedUrl}</div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void api?.shell.openExternal(normalizedUrl)}
          >
            <ExternalLinkIcon className="size-3.5" />
            External
          </Button>
        </CardContent>
      </Card>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border/70 bg-card p-4">
        {embedBlocked ? (
          <div className="flex h-full min-h-[24rem] items-center justify-center">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle>Embedding blocked</CardTitle>
                <CardDescription>
                  This site cannot be shown inside the IDE shell. Open it in your browser instead.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => void api?.shell.openExternal(normalizedUrl)}>
                  <ExternalLinkIcon className="size-3.5" />
                  Open In Browser
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-background">
            {loading ? (
              <div className="flex h-12 items-center justify-center border-b border-border/70 bg-muted/30 text-sm text-muted-foreground">
                <Spinner className="mr-2 size-4" />
                Loading embed...
              </div>
            ) : null}
            <iframe
              title={props.title}
              src={normalizedUrl}
              sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
              className="h-full min-h-[32rem] w-full bg-white"
              onLoad={() => {
                setLoading(false);
                setEmbedBlocked(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CustomProcessTool(props: {
  project: Project;
  process: ProjectWorkspaceSettings["terminalProcesses"][number];
  threadId: ThreadId;
  terminalState: NonNullable<ReturnType<typeof selectThreadTerminalState>>;
  focusRequestId: number;
  onRunProcess: (processId: string) => void;
  onRestartProcess: (processId: string) => void;
  onStopProcess: (processId: string) => void;
  onActivateTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onHeightChange: (height: number) => void;
}) {
  const autoStartedRef = useRef(false);
  const commands = useMemo(
    () =>
      props.process.commands
        .map((command) => command.trim())
        .filter((command) => command.length > 0),
    [props.process.commands],
  );
  const isRunning = Boolean(props.terminalState?.runningTerminalIds.includes(props.process.id));
  const hasTerminal = Boolean(props.terminalState?.terminalIds.includes(props.process.id));

  useEffect(() => {
    autoStartedRef.current = false;
  }, [props.process.id]);

  useEffect(() => {
    if (commands.length === 0 || isRunning || autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;
    props.onRunProcess(props.process.id);
  }, [commands.length, isRunning, props.onRunProcess, props.process.id]);

  if (commands.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Terminal commands missing</CardTitle>
            <CardDescription>
              Add one or more commands in project settings before using this terminal tab.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="pointer-events-none absolute right-3 top-3 z-20">
        <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-background/80 shadow-sm backdrop-blur-sm">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="rounded-none"
            onClick={() => props.onRestartProcess(props.process.id)}
            aria-label={`Restart ${props.process.label}`}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
          <div className="h-4 w-px bg-border/80" />
          {isRunning ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-none"
              onClick={() => props.onStopProcess(props.process.id)}
              aria-label={`Stop ${props.process.label}`}
            >
              <PanelTopCloseIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-none"
              onClick={() => props.onRunProcess(props.process.id)}
              aria-label={`Start ${props.process.label}`}
            >
              <PlayIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {hasTerminal && props.terminalState ? (
        <ThreadTerminalDrawer
          key={`${props.threadId}:${props.process.id}`}
          variant="embedded"
          showControls={false}
          threadId={props.threadId}
          cwd={props.process.cwd.trim().length > 0 ? props.process.cwd : props.project.cwd}
          runtimeEnv={projectScriptRuntimeEnv({
            project: { cwd: props.project.cwd },
            worktreePath: null,
          })}
          height={props.terminalState.terminalHeight}
          terminalIds={[props.process.id]}
          activeTerminalId={props.process.id}
          terminalGroups={[
            {
              id: `group-${props.process.id}`,
              terminalIds: [props.process.id],
            },
          ]}
          activeTerminalGroupId={`group-${props.process.id}`}
          focusRequestId={props.focusRequestId}
          onSplitTerminal={() => {}}
          onNewTerminal={() => {}}
          onActiveTerminalChange={props.onActivateTerminal}
          onCloseTerminal={props.onCloseTerminal}
          onHeightChange={props.onHeightChange}
          onAddTerminalContext={() => {}}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Starting {props.process.label}</CardTitle>
              <CardDescription>
                Running{" "}
                {commands.length === 1 ? "the configured command" : "the configured commands"} in
                the embedded terminal.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      )}
    </div>
  );
}

function ServerTool(props: {
  project: Project;
  projectSettings: ProjectWorkspaceSettings;
  onOpenSettings: () => void;
  onRunProcess: (processId: string) => void;
  onRestartProcess: (processId: string) => void;
  onStopProcess: (processId: string) => void;
  onOpenProcessTerminal: (processId: string) => void;
  onRevealTerminal: () => void;
  onHideTerminal: () => void;
  onNewTerminal: () => void;
  onCloseAllTerminals: () => void;
  onSavePresets: (
    presets: Array<{
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      previewUrl?: string;
      autoOpenPreview?: boolean;
      previewOpenTarget?: "in-app" | "external";
      previewFocus?: boolean;
      dependsOn?: readonly string[];
    }>,
  ) => void;
  terminalVisible: boolean;
  terminalContent: ReactNode;
  terminalIds: ReadonlyArray<string>;
  runningProcessIds: ReadonlyArray<string>;
  activeTerminalId: string | null;
  hasTerminalWorkspace: boolean;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const processes = useMemo(() => {
    return props.projectSettings.serverPresets ?? [];
  }, [props.projectSettings.serverPresets]);
  const terminalIdSet = new Set(props.terminalIds);
  const runningProcessIdSet = new Set(props.runningProcessIds);
  const [serverState, setServerState] = useProjectServerState(
    projectUiStateKey(props.project.environmentId, props.project.id),
  );
  const presetsExpanded = serverState.presetsExpanded;
  const setPresetsExpanded = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setServerState((prev) => ({
        presetsExpanded: typeof v === "function" ? v(prev.presetsExpanded) : v,
      }));
    },
    [setServerState],
  );
  const hasRunnableCommands = useCallback(
    (commands: ReadonlyArray<string>) => commands.some((command) => command.trim().length > 0),
    [],
  );
  const normalizePresetDraft = useCallback(
    (preset: {
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      previewUrl?: string;
      autoOpenPreview?: boolean;
      previewOpenTarget?: "in-app" | "external";
      previewFocus?: boolean;
      dependsOn?: readonly string[];
    }) => {
      const res: {
        id: string;
        label: string;
        commands: string[];
        cwd: string;
        autoStart: boolean;
        previewUrl?: string;
        autoOpenPreview?: boolean;
        previewOpenTarget?: "in-app" | "external";
        previewFocus?: boolean;
        dependsOn?: readonly string[];
      } = {
        id: preset.id,
        label: preset.label.trim(),
        commands: preset.commands
          .map((command) => command.trim())
          .filter((command) => command.length > 0),
        cwd: preset.cwd.trim(),
        autoStart: preset.autoStart,
      };

      const trimmedUrl = preset.previewUrl?.trim();
      if (trimmedUrl) {
        res.previewUrl = trimmedUrl;
      }
      if (preset.autoOpenPreview !== undefined) {
        res.autoOpenPreview = preset.autoOpenPreview;
      }
      if (preset.previewOpenTarget !== undefined) {
        res.previewOpenTarget = preset.previewOpenTarget;
      }
      if (preset.previewFocus !== undefined) {
        res.previewFocus = preset.previewFocus;
      }
      if (preset.dependsOn !== undefined) {
        res.dependsOn = preset.dependsOn;
      }

      return res;
    },
    [],
  );
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  const [presetDialogMode, setPresetDialogMode] = useState<"add" | "manage">("manage");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const createBlankPreset = useCallback(
    () => ({
      id: `process-${randomUUID()}`,
      label: "",
      commands: [""],
      cwd: props.project.cwd,
      autoStart: false,
      previewUrl: "",
      autoOpenPreview: false,
      previewOpenTarget: "in-app" as const,
      previewFocus: false,
      dependsOn: [] as string[],
    }),
    [props.project.cwd],
  );

  const [presetDrafts, setPresetDrafts] = useState<
    Array<{
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      previewUrl?: string;
      autoOpenPreview?: boolean;
      previewOpenTarget?: "in-app" | "external";
      previewFocus?: boolean;
      dependsOn?: readonly string[];
    }>
  >([]);

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isEditingRightPane, setIsEditingRightPane] = useState(false);
  const [editingPresetDraft, setEditingPresetDraft] = useState<any>(null);
  const [presetToDeleteId, setPresetToDeleteId] = useState<string | null>(null);

  const hasInitializedDraftsRef = useRef(false);

  useEffect(() => {
    if (!isPresetDialogOpen) {
      setEditingPresetDraft(null);
      hasInitializedDraftsRef.current = false;
      return;
    }
    if (hasInitializedDraftsRef.current) return;
    hasInitializedDraftsRef.current = true;

    const drafts = processes.map((process: any) => ({
      id: process.id,
      label: process.label,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      previewUrl: process.previewUrl,
      autoOpenPreview: process.autoOpenPreview,
      previewOpenTarget: process.previewOpenTarget,
      previewFocus: process.previewFocus,
      dependsOn: process.dependsOn,
    }));
    setPresetDrafts(drafts);

    if (presetDialogMode === "add") {
      const blank = createBlankPreset();
      setEditingPresetDraft(blank);
      setSelectedPresetId(blank.id);
      setIsEditingRightPane(true);
    } else {
      if (editingPresetId) {
        const match = drafts.find((p) => p.id === editingPresetId);
        if (match) {
          setSelectedPresetId(editingPresetId);
          setEditingPresetDraft({ ...match });
          setIsEditingRightPane(true);
        } else {
          setSelectedPresetId(drafts[0]?.id ?? null);
          setIsEditingRightPane(false);
        }
      } else {
        setSelectedPresetId(drafts[0]?.id ?? null);
        setIsEditingRightPane(false);
      }
    }
  }, [isPresetDialogOpen, presetDialogMode, editingPresetId, processes, createBlankPreset]);

  const updatePresetDraft = useCallback((id: string, updater: (current: any) => any) => {
    setEditingPresetDraft((cur: any) => (cur ? updater(cur) : null));
  }, []);

  const addCommandStepDraft = useCallback((id: string) => {
    setEditingPresetDraft((cur: any) => {
      if (!cur) return null;
      return { ...cur, commands: [...cur.commands, ""] };
    });
  }, []);

  const updateCommandStepDraft = useCallback((id: string, stepIdx: number, val: string) => {
    setEditingPresetDraft((cur: any) => {
      if (!cur) return null;
      const nextCmds = [...cur.commands];
      nextCmds[stepIdx] = val;
      return { ...cur, commands: nextCmds };
    });
  }, []);

  const moveCommandStepDraft = useCallback((id: string, stepIdx: number, direction: -1 | 1) => {
    setEditingPresetDraft((cur: any) => {
      if (!cur) return null;
      const nextCmds = [...cur.commands];
      const targetIdx = stepIdx + direction;
      if (targetIdx < 0 || targetIdx >= nextCmds.length) return cur;
      const temp = nextCmds[stepIdx]!;
      nextCmds[stepIdx] = nextCmds[targetIdx]!;
      nextCmds[targetIdx] = temp;
      return { ...cur, commands: nextCmds };
    });
  }, []);

  const removeCommandStepDraft = useCallback((id: string, stepIdx: number) => {
    setEditingPresetDraft((cur: any) => {
      if (!cur) return null;
      const nextCmds = cur.commands.filter((_: any, idx: number) => idx !== stepIdx);
      return { ...cur, commands: nextCmds.length > 0 ? nextCmds : [""] };
    });
  }, []);

  const selectPreset = useCallback((id: string) => {
    setSelectedPresetId(id);
    setIsEditingRightPane(false);
    setEditingPresetDraft(null);
  }, []);

  const handleAddPresetClick = useCallback(() => {
    const blank = createBlankPreset();
    setSelectedPresetId(blank.id);
    setEditingPresetDraft(blank);
    setIsEditingRightPane(true);
  }, [createBlankPreset]);

  const handleEditClick = useCallback((preset: any) => {
    setEditingPresetDraft({ ...preset });
    setIsEditingRightPane(true);
  }, []);

  const handleCancelClick = useCallback(() => {
    setIsEditingRightPane(false);
    setEditingPresetDraft(null);
    const exists = presetDrafts.some((p) => p.id === selectedPresetId);
    if (!exists) {
      setSelectedPresetId(presetDrafts[0]?.id ?? null);
    }
  }, [presetDrafts, selectedPresetId]);

  const handleSaveClick = useCallback(() => {
    if (!editingPresetDraft) return;
    if (
      editingPresetDraft.label.trim().length === 0 ||
      editingPresetDraft.commands.filter((c: string) => c.trim().length > 0).length === 0
    ) {
      return;
    }

    const nextDrafts = [...presetDrafts];
    const idx = nextDrafts.findIndex((p) => p.id === editingPresetDraft.id);
    const normalized = normalizePresetDraft(editingPresetDraft);
    if (idx >= 0) {
      nextDrafts[idx] = normalized;
    } else {
      nextDrafts.push(normalized);
    }

    setPresetDrafts(nextDrafts);
    props.onSavePresets(nextDrafts);

    setSelectedPresetId(editingPresetDraft.id);
    setIsEditingRightPane(false);
    setEditingPresetDraft(null);

    if (presetDialogMode === "add") {
      setPresetDialogMode("manage");
    }
  }, [editingPresetDraft, presetDrafts, normalizePresetDraft, props, presetDialogMode]);

  const [draggedPresetId, setDraggedPresetId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedPresetId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedPresetId || draggedPresetId === targetId) {
      setDraggedPresetId(null);
      return;
    }
    const sourceIndex = presetDrafts.findIndex((p) => p.id === draggedPresetId);
    const targetIndex = presetDrafts.findIndex((p) => p.id === targetId);
    if (sourceIndex >= 0 && targetIndex >= 0) {
      const nextDrafts = [...presetDrafts];
      const [movedItem] = nextDrafts.splice(sourceIndex, 1);
      if (movedItem) {
        nextDrafts.splice(targetIndex, 0, movedItem);
        setPresetDrafts(nextDrafts);
        props.onSavePresets(nextDrafts);
      }
    }
    setDraggedPresetId(null);
  };

  const handleDeleteClick = useCallback((id: string) => {
    setPresetToDeleteId(id);
  }, []);

  const confirmDeletePreset = useCallback(() => {
    if (!presetToDeleteId) return;
    const nextDrafts = presetDrafts.filter((p) => p.id !== presetToDeleteId);
    setPresetDrafts(nextDrafts);
    props.onSavePresets(nextDrafts);

    const nextSelected = nextDrafts[0]?.id ?? null;
    setSelectedPresetId(nextSelected);
    setIsEditingRightPane(false);
    setEditingPresetDraft(null);
    setPresetToDeleteId(null);
  }, [presetToDeleteId, presetDrafts, props]);

  const editingPreset = editingPresetId
    ? (processes.find((process: any) => process.id === editingPresetId) ?? null)
    : null;

  const handleRunProcessWithDependencies = useCallback(
    (processId: string) => {
      props.onRunProcess(processId);
    },
    [props],
  );

  const selectedPreset = selectedPresetId
    ? (presetDrafts.find((p) => p.id === selectedPresetId) ?? null)
    : null;
  const selectedPresetStatus = selectedPreset
    ? resolveServerPresetRuntimeStatus({
        processId: selectedPreset.id,
        runningProcessIds: runningProcessIdSet,
        terminalIds: terminalIdSet,
      })
    : "idle";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {props.hasTerminalWorkspace ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={props.terminalVisible ? props.onHideTerminal : props.onRevealTerminal}
            >
              <TerminalSquareIcon className="size-3.5" />
              {props.terminalVisible ? "Hide Terminal" : "Show Terminal"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              props.onRevealTerminal();
              props.onNewTerminal();
            }}
          >
            <PlusIcon className="size-3.5" />
            New Terminal
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setPresetDialogMode("add");
              setEditingPresetId(null);
              setIsPresetDialogOpen(true);
            }}
          >
            <PlusIcon className="size-3.5" />
            Add Preset
          </Button>
          {processes.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPresetDialogMode("manage");
                setEditingPresetId(null);
                setIsPresetDialogOpen(true);
              }}
            >
              <PanelTopOpenIcon className="size-3.5" />
              View all presets
            </Button>
          ) : null}
          {props.hasTerminalWorkspace ? (
            <Button
              type="button"
              size="sm"
              variant="destructive-outline"
              onClick={async () => {
                const confirmed = await confirm(
                  "Are you sure you want to close all servers and terminals?",
                );
                if (confirmed) {
                  props.onCloseAllTerminals();
                }
              }}
            >
              <XIcon className="size-3.5" />
              Close All
            </Button>
          ) : null}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {processes.length === 0
            ? "Start with a clean terminal or add named presets for one-click server workflows."
            : "Use the same terminal UI as Agents. The buttons above launch your configured server presets and run each preset's steps in order."}
        </div>
        {processes.length > 0 ? (
          <ScrollArea className="mt-4 w-full">
            <div className="flex items-start gap-3 pb-1">
              {processes.map((process: any) => {
                const status = resolveServerPresetRuntimeStatus({
                  processId: process.id,
                  runningProcessIds: runningProcessIdSet,
                  terminalIds: terminalIdSet,
                });
                const isActive = props.activeTerminalId === process.id;

                return (
                  <div
                    key={process.id}
                    className={cn(
                      "flex shrink-0 items-center overflow-hidden rounded-full border border-input bg-popover shadow-xs/5",
                      isActive && "border-primary/35 bg-accent/60",
                    )}
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!hasRunnableCommands(process.commands)}
                      onClick={() =>
                        terminalIdSet.has(process.id)
                          ? props.onOpenProcessTerminal(process.id)
                          : handleRunProcessWithDependencies(process.id)
                      }
                      className={cn(
                        "max-w-[14rem] rounded-none border-0 bg-transparent px-3 shadow-none hover:bg-transparent",
                        isActive && "text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-2 rounded-full mr-2",
                          status === "running"
                            ? "bg-success"
                            : terminalIdSet.has(process.id)
                              ? "bg-sky-400"
                              : "bg-muted-foreground/30",
                        )}
                      />
                      <span className="truncate">{process.label}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {props.terminalVisible ? (
          props.terminalContent
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <Card className="w-full max-w-2xl border-border/70 bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>Server Workspace</CardTitle>
                <CardDescription>
                  Open a terminal for manual work or save presets like `Frontend` and `Backend` that
                  run in one click.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button type="button" onClick={props.onRevealTerminal}>
                  <TerminalSquareIcon className="size-3.5" />
                  Open Terminal
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPresetDialogMode("add");
                    setEditingPresetId(null);
                    setIsPresetDialogOpen(true);
                  }}
                >
                  <PlusIcon className="size-3.5" />
                  Add Preset
                </Button>
                {props.hasTerminalWorkspace ? (
                  <Button
                    type="button"
                    variant="destructive-outline"
                    onClick={async () => {
                      const confirmed = await confirm(
                        "Are you sure you want to close all servers and terminals?",
                      );
                      if (confirmed) {
                        props.onCloseAllTerminals();
                      }
                    }}
                  >
                    <XIcon className="size-3.5" />
                    Close All
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      <Dialog
        open={isPresetDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPresetDialogMode("manage");
            setEditingPresetId(null);
          }
          setIsPresetDialogOpen(open);
        }}
      >
        <DialogPopup className="max-w-4xl p-0 overflow-hidden flex flex-col h-[40rem] bg-card border border-border text-card-foreground">
          {/* Global Header */}
          <DialogHeader className="p-5 border-b border-border/60 shrink-0 relative flex flex-row items-start justify-between bg-muted/20">
            <div className="text-left">
              <DialogTitle className="text-lg font-bold text-foreground">
                Server Presets
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Create and manage one-click presets like 'Frontend' or 'Backend', each with ordered
                command steps.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex flex-1 min-h-0">
            {/* Left Sidebar */}
            <div className="w-60 bg-muted/30 border-r border-border/60 p-4 flex flex-col gap-4 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleAddPresetClick}
                className="w-full flex items-center justify-center gap-1.5 shrink-0"
              >
                <PlusIcon className="size-3.5" />
                Add Preset
              </Button>

              <ScrollArea className="flex-1 -mx-2 px-2">
                <div className="space-y-1">
                  {presetDrafts.map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    const status = resolveServerPresetRuntimeStatus({
                      processId: preset.id,
                      runningProcessIds: runningProcessIdSet,
                      terminalIds: terminalIdSet,
                    });
                    return (
                      <button
                        key={preset.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, preset.id)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, preset.id)}
                        onDragEnd={() => setDraggedPresetId(null)}
                        type="button"
                        onClick={() => selectPreset(preset.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-sm transition-all border border-transparent cursor-pointer",
                          isSelected
                            ? "bg-accent text-accent-foreground font-medium shadow-xs border-border/70"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          draggedPresetId === preset.id && "opacity-40 border-dashed border-border",
                        )}
                      >
                        <span className="truncate mr-2">{preset.label || "Untitled Preset"}</span>
                        {status === "running" && (
                          <span className="size-1.5 bg-success rounded-full shrink-0" />
                        )}
                      </button>
                    );
                  })}
                  {presetDrafts.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8">
                      No presets configured
                    </div>
                  )}
                </div>
              </ScrollArea>

              {selectedPreset && !isEditingRightPane && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full flex items-center justify-start gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                  onClick={() => handleDeleteClick(selectedPreset.id)}
                >
                  <Trash2Icon className="size-3.5" />
                  Delete Preset
                </Button>
              )}
            </div>

            {/* Right details / Edit pane */}
            <div className="flex-1 flex flex-col min-w-0 bg-card">
              <DialogPanel className="flex-1 overflow-y-auto p-6 min-h-0">
                {isEditingRightPane && editingPresetDraft ? (
                  <div className="space-y-4">
                    <ServerPresetFormFields
                      variant="plain"
                      preset={editingPresetDraft}
                      presetDrafts={presetDrafts as any}
                      projectCwd={props.project.cwd}
                      isEditing={true}
                      updatePresetRow={updatePresetDraft}
                      addCommandStep={addCommandStepDraft}
                      updateCommandStep={updateCommandStepDraft}
                      moveCommandStep={moveCommandStepDraft}
                      removeCommandStep={removeCommandStepDraft}
                    />
                    {/* Validation notice */}
                    {(!editingPresetDraft.label?.trim() ||
                      !editingPresetDraft.commands?.some((c: string) => c.trim().length > 0)) && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200/90 leading-normal">
                        Each preset needs a label and at least one command step before saving.
                      </div>
                    )}
                  </div>
                ) : selectedPreset ? (
                  <div className="space-y-6">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-bold text-foreground">
                          {selectedPreset.label || "Untitled Preset"}
                        </h2>
                        {selectedPresetStatus === "running" ? (
                          <Badge
                            variant="success"
                            className="text-[10px] uppercase tracking-wider font-semibold"
                          >
                            Running
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider font-semibold"
                          >
                            Idle
                          </Badge>
                        )}
                        {selectedPreset.autoOpenPreview && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider font-semibold text-blue-400 border-blue-500/30"
                          >
                            Auto-opens
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-2 truncate">
                        {selectedPreset.cwd || props.project.cwd}
                      </div>
                    </div>

                    <div className="space-y-3 mt-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Command Steps
                      </div>
                      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed text-foreground space-y-1 max-h-48 overflow-y-auto">
                        {selectedPreset.commands.map((cmd, idx) => (
                          <div key={idx} className="truncate flex items-start gap-2">
                            <span className="text-muted-foreground/60 w-4 text-right shrink-0">
                              {idx + 1}.
                            </span>
                            <span className="break-all whitespace-pre-wrap">{cmd}</span>
                          </div>
                        ))}
                        {selectedPreset.commands.length === 0 && (
                          <div className="text-muted-foreground/60 py-2">
                            No commands configured
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6">
                      {(selectedPreset.autoOpenPreview ||
                        !!selectedPreset.previewUrl ||
                        selectedPreset.previewOpenTarget === "external") && (
                        <div className="space-y-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Browser Tool Integration
                          </div>
                          <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-xs text-foreground space-y-3">
                            <div className="flex justify-between border-b border-border/40 pb-3">
                              <span className="text-muted-foreground">URL Target</span>
                              {selectedPreset.previewUrl ? (
                                <span className="font-mono">{selectedPreset.previewUrl}</span>
                              ) : (
                                <span className="italic text-muted-foreground/50">
                                  Not configured
                                </span>
                              )}
                            </div>
                            <div className="flex justify-between border-b border-border/40 pb-3">
                              <span className="text-muted-foreground">Target Browser</span>
                              <span>
                                {selectedPreset.previewOpenTarget === "external"
                                  ? "External Browser"
                                  : "Internal Browser"}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Auto switch to browser tab
                              </span>
                              <span>{selectedPreset.autoOpenPreview ? "Enabled" : "Disabled"}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Configuration
                        </div>
                        <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-xs text-foreground space-y-3">
                          <div
                            className={cn(
                              "flex justify-between",
                              selectedPreset.dependsOn &&
                                selectedPreset.dependsOn.length > 0 &&
                                "border-b border-border/40 pb-3",
                            )}
                          >
                            <span className="text-muted-foreground">Auto-start on launch</span>
                            <span>{selectedPreset.autoStart ? "Enabled" : "Disabled"}</span>
                          </div>
                          {selectedPreset.dependsOn && selectedPreset.dependsOn.length > 0 && (
                            <div className="flex justify-between items-start">
                              <span className="text-muted-foreground">Dependencies</span>
                              <div className="flex flex-col items-end gap-1">
                                {selectedPreset.dependsOn.map((depId) => (
                                  <span key={depId}>
                                    {presetDrafts.find((p) => p.id === depId)?.label ||
                                      "Unknown Preset"}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 py-16">
                    <TerminalSquareIcon className="size-8 stroke-1 text-muted-foreground/60" />
                    <span className="text-sm">Select or create a server preset to get started</span>
                  </div>
                )}
              </DialogPanel>

              <DialogFooter className="p-4 border-t border-border/60 shrink-0 bg-muted/20 flex items-center justify-between gap-3">
                {isEditingRightPane && editingPresetDraft ? (
                  <>
                    <div className="flex gap-2 w-full justify-end">
                      <Button type="button" variant="outline" size="sm" onClick={handleCancelClick}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleSaveClick}
                        disabled={
                          !editingPresetDraft?.label?.trim() ||
                          !editingPresetDraft?.commands?.some((c: string) => c.trim().length > 0)
                        }
                      >
                        Save Changes
                      </Button>
                    </div>
                  </>
                ) : selectedPreset ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={!hasRunnableCommands(selectedPreset.commands)}
                      onClick={() => {
                        if (selectedPresetStatus === "running") {
                          props.onOpenProcessTerminal(selectedPreset.id);
                        } else {
                          handleRunProcessWithDependencies(selectedPreset.id);
                        }
                        setIsPresetDialogOpen(false);
                      }}
                    >
                      <PlayIcon className="size-3.5 mr-1.5" />
                      {selectedPresetStatus === "running" ? "Open" : "Run"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditClick(selectedPreset)}
                    >
                      <PencilIcon className="size-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!hasRunnableCommands(selectedPreset.commands)}
                      onClick={() => {
                        props.onRestartProcess(selectedPreset.id);
                        setIsPresetDialogOpen(false);
                      }}
                    >
                      <RefreshCwIcon className="size-3.5 mr-1.5" />
                      Restart
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!terminalIdSet.has(selectedPreset.id)}
                      onClick={() => props.onStopProcess(selectedPreset.id)}
                    >
                      <XIcon className="size-3.5 mr-1.5" />
                      Stop
                    </Button>
                  </div>
                ) : (
                  <div className="flex justify-end w-full"></div>
                )}
              </DialogFooter>
            </div>
          </div>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={!!presetToDeleteId}
        onOpenChange={(open) => !open && setPresetToDeleteId(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Preset?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this server preset? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDeletePreset}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {confirmDialog}
    </div>
  );
}

export function WorkspaceShell(props: { agentsContent: ReactNode; settingsContent: ReactNode }) {
  const installedExtensions = useInstalledExtensions();
  useDesktopIconThemeSync();
  useAutoRefreshModelsOnStartup();
  const openAddProjectCommandPalette = useOpenAddProjectCommandPalette();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSettingsNavigationPending, setIsSettingsNavigationPending] = useState(false);
  const openSettings = useCallback(() => {
    if (location.pathname === "/settings") return;

    // TanStack Router can retain the current match while the destination is
    // resolving. Hide that stale surface immediately so a slow first render of
    // Settings never looks like an ignored click or a frozen Agents view.
    setIsSettingsNavigationPending(true);
    void navigate({ to: "/settings" }).catch(() => {
      setIsSettingsNavigationPending(false);
    });
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (location.pathname === "/settings") {
      setIsSettingsNavigationPending(false);
    }
  }, [location.pathname]);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeEnvironmentId = useParams({
    strict: false,
    select: (params) => params.environmentId ?? null,
  });
  const projects = useAtomValue(projectsAtom);
  const threads = useAtomValue(threadsAtom);
  const { handleNewThread } = useHandleNewThread();
  const workspaceState = useWorkspaceShellState();
  const {
    syncProjects,
    openProject,
    openProjectSurface,
    closeProject,
    setActiveProject,
    setActiveTool,
    setCodeFocusedPath,
    rememberThread,
    upsertProjectSettings,
    openPendingTab,
    resolvePendingTab,
    closePendingTab,
  } = workspaceShellActions;
  const activePendingTabId = workspaceState.session.activePendingTabId ?? null;
  const pendingTabIds = workspaceState.session.pendingTabIds ?? [];
  const isActivePendingTab = Boolean(activePendingTabId);
  const settings = useSettings();
  // Close a project tab, optionally asking for confirmation first. Gated by the
  // "Confirm before closing a tab" setting (Settings → General).
  const requestCloseProject = useCallback(
    async (projectId: ProjectId): Promise<boolean> => {
      if (settings.confirmTabClose) {
        const confirmed = await (readNativeApi() ?? ensureNativeApi()).dialogs.confirm(
          "Close this tab? Anything unsaved in it may be lost.",
        );
        if (!confirmed) return false;
      }
      closeProject(projectId);
      return true;
    },
    [closeProject, settings.confirmTabClose],
  );
  const threadsHydrated = useAtomValue(threadsHydratedAtom);
  const embeddedMode = useMemo(() => resolveEmbeddedWorkspaceMode(), []);
  const embeddedProjectCreateRequestedRef = useRef<string | null>(null);

  useEffect(() => {
    // Wait for the server read model to actually arrive before syncing. Until
    // then `projects` is the empty initial state, and syncing against it would
    // filter the persisted `openProjectIds` (and active tab) down to nothing
    // and then persist that empty result — wiping the restored workspace on
    // every launch. `threadsHydrated` flips true only once the snapshot (with
    // its projects) has been applied, so gating on it preserves the saved tabs.
    if (!threadsHydrated) {
      return;
    }
    syncProjects(projects, threads);
  }, [projects, syncProjects, threads, threadsHydrated]);

  useEffect(() => {
    if (!embeddedMode.enabled || !embeddedMode.workspaceRoot || !threadsHydrated) {
      return;
    }

    const existingProject =
      projects.find((project) => project.cwd === embeddedMode.workspaceRoot) ?? null;
    if (existingProject) {
      embeddedProjectCreateRequestedRef.current = null;
      openProject(existingProject.id);

      const projectSettings = workspaceState.projectSettingsByProjectId[existingProject.id];
      const toolId = projectSettings
        ? (resolveProjectTools(projectSettings).find(
            (tool) => tool.kind === embeddedMode.tool || tool.id === embeddedMode.tool,
          )?.id ?? null)
        : null;

      if (workspaceState.session.activeProjectId !== existingProject.id) {
        setActiveProject(existingProject.id);
      }
      if (toolId) {
        setActiveTool(existingProject.id, toolId);
      }
      if (location.pathname === "/settings") {
        void navigate({ to: "/" });
      }
      return;
    }

    if (embeddedProjectCreateRequestedRef.current === embeddedMode.workspaceRoot) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    embeddedProjectCreateRequestedRef.current = embeddedMode.workspaceRoot;
    void api.orchestration
      .dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId: newProjectId(),
        title: basenameOfPath(embeddedMode.workspaceRoot),
        workspaceRoot: embeddedMode.workspaceRoot,
        defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
        createdAt: new Date().toISOString(),
      })
      .catch((error) => {
        embeddedProjectCreateRequestedRef.current = null;
        toastManager.add({
          type: "error",
          title: "Could not attach workspace",
          description:
            error instanceof Error ? error.message : "The embedded workspace could not be created.",
        });
      });
  }, [
    embeddedMode.enabled,
    embeddedMode.tool,
    embeddedMode.workspaceRoot,
    location.pathname,
    navigate,
    openProject,
    projects,
    setActiveProject,
    setActiveTool,
    threadsHydrated,
    workspaceState.projectSettingsByProjectId,
    workspaceState.session.activeProjectId,
  ]);

  const activeThread = routeThreadId
    ? (threads.find(
        (thread) => thread.id === routeThreadId && thread.environmentId === routeEnvironmentId,
      ) ?? null)
    : null;
  const routeProjectId = activeThread?.projectId ?? workspaceState.session.activeProjectId ?? null;

  const routerState = useRouterState({
    select: (s) => ({
      status: s.status,
      location: s.location,
      resolvedLocation: s.resolvedLocation,
    }),
  });

  useEffect(() => {
    if (!routeThreadId || !routeProjectId || activePendingTabId) {
      return;
    }
    // If the router is pending navigation, or if requested location does not match resolved location,
    // foreground navigation is in flight (e.g. project switch). Do not let stale route params overwrite store!
    if (routerState.status === "pending") {
      return;
    }
    const requestedPathname = routerState.location.pathname;
    const resolvedPathname = routerState.resolvedLocation?.pathname ?? requestedPathname;
    if (requestedPathname !== resolvedPathname) {
      return;
    }
    // If the requested location pathname does not contain the current routeThreadId,
    // this routeThreadId is stale leftover from an ongoing navigation to "/" or another route.
    if (!isPathTargetingThread(requestedPathname, routeThreadId)) {
      return;
    }
    const inFlight = getInFlightSurfaceActivation();
    if (
      inFlight &&
      Date.now() - inFlight.timestamp < 3000 &&
      !isPathAlignedWithSurfaceActivation(requestedPathname, inFlight)
    ) {
      return;
    }

    rememberThread(routeProjectId, routeThreadId);
    if (workspaceState.session.activeProjectId !== routeProjectId) {
      openProjectSurface(routeProjectId, "agents", routeThreadId);
    } else {
      setActiveTool(routeProjectId, "agents");
    }
  }, [
    activePendingTabId,
    openProjectSurface,
    rememberThread,
    routeProjectId,
    routeThreadId,
    routerState.location.pathname,
    routerState.resolvedLocation?.pathname,
    routerState.status,
    setActiveTool,
    workspaceState.session.activeProjectId,
  ]);

  const activeProject = resolveProjectById(projects, workspaceState.session.activeProjectId);
  const [activeProjectApi, setActiveProjectApi] = useState<Awaited<
    ReturnType<typeof environmentApi>
  > | null>(null);
  useEffect(() => {
    let active = true;
    setActiveProjectApi(null);
    if (activeProject) {
      void environmentApi(activeProject.environmentId)
        .then((api) => {
          if (active) setActiveProjectApi(api);
        })
        .catch(() => {
          if (active) setActiveProjectApi(null);
        });
    }
    return () => {
      active = false;
    };
  }, [activeProject?.environmentId]);
  const openProjects = workspaceState.session.openProjectIds
    .map((projectId) => projects.find((project) => project.id === projectId) ?? null)
    .filter((project): project is Project => project !== null);
  const activeProjectSettings = useProjectWorkspaceSettings(activeProject?.id ?? null);
  const extensionTools: ProjectToolDefinition[] = activeProject
    ? installedExtensions.flatMap((extension) =>
        isExtensionEnabledForProject(extension.assignment, activeProject.id)
          ? extension.manifest.contributes.tools.map((tool) => ({
              id: `ext:${extension.id}:${tool.id}`,
              kind: "extension" as const,
              label: tool.label,
              visible: true,
              extensionId: extension.id,
              extensionToolId: tool.id,
            }))
          : [],
      )
    : [];
  const resolvedTools = activeProjectSettings
    ? [...resolveProjectTools(activeProjectSettings), ...extensionTools]
    : [];
  const activeToolId = activeProject
    ? (resolvedTools.find(
        (tool) => tool.id === workspaceState.session.activeToolIdByProjectId[activeProject.id],
      )?.id ??
      resolvedTools[0]?.id ??
      "agents")
    : null;
  const activeTool = activeToolId
    ? (resolvedTools.find((tool) => tool.id === activeToolId) ?? null)
    : null;
  const activeToolSettings = resolvedTools;
  const availableTools = resolvedTools.map((tool) => ({
    id: tool.id,
    kind: tool.kind,
    label: tool.label,
  }));

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    void bridge.syncCodeSessions(workspaceState.session.openProjectIds).catch(() => undefined);
  }, [workspaceState.session.openProjectIds]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    void bridge.syncBrowserSessions(workspaceState.session.openProjectIds).catch(() => undefined);
  }, [workspaceState.session.openProjectIds]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || activeTool?.kind === "code") {
      return;
    }
    void bridge.hideCodeSession().catch(() => undefined);
  }, [activeTool?.kind]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || activeTool?.kind === "browser" || activeTool?.kind === "custom_embed") {
      return;
    }
    void bridge.hideBrowserSession().catch(() => undefined);
  }, [activeTool?.kind]);

  const verifyProjectExists = useCallback(
    async (projectId: ProjectId): Promise<boolean> => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return false;
      try {
        const api = await environmentApi(project.environmentId);
        await api.projects.filesystemBrowse({
          partialPath:
            project.cwd.endsWith("/") || project.cwd.endsWith("\\")
              ? project.cwd
              : project.cwd + "/",
        });
        return true;
      } catch (err) {
        const detail = err instanceof Error ? err.message.toLowerCase() : "";
        const pathIsMissing =
          detail.includes("enoent") ||
          detail.includes("no such file") ||
          detail.includes("path does not exist") ||
          detail.includes("directory does not exist");
        if (!pathIsMissing) {
          // An offline remote must not be mistaken for a deleted workspace.
          return true;
        }
        toastManager.add({
          type: "error",
          title: "Project folder not found",
          description: `The folder at "${project.cwd}" does not exist. Removing it from recents.`,
        });
        void environmentApi(project.environmentId)
          .then((api) =>
            api.orchestration.dispatchCommand({
              type: "project.delete",
              commandId: newCommandId(),
              projectId,
            }),
          )
          .catch(() => undefined);
        closeProject(projectId);
        return false;
      }
    },
    [closeProject, projects],
  );

  // Periodically verify existence of recent projects every 30 seconds while welcome screen is open
  useEffect(() => {
    const isShowingWelcome = isActivePendingTab || !activeProject || !activeProjectSettings;
    if (!isShowingWelcome || !threadsHydrated) {
      return;
    }

    const checkRecentProjects = async () => {
      const recentProjectsList = projects
        .toSorted((left, right) =>
          (right.updatedAt ?? right.createdAt ?? "").localeCompare(
            left.updatedAt ?? left.createdAt ?? "",
          ),
        )
        .slice(0, 6);

      for (const project of recentProjectsList) {
        await verifyProjectExists(project.id);
      }
    };

    // Run immediately when welcome screen mounts/becomes active
    void checkRecentProjects();

    const interval = setInterval(() => {
      void checkRecentProjects();
    }, 30000);

    return () => clearInterval(interval);
  }, [
    activeProject,
    activeProjectSettings,
    isActivePendingTab,
    projects,
    threadsHydrated,
    verifyProjectExists,
  ]);

  const focusProject = useCallback(
    async (projectId: ProjectId) => {
      const exists = await verifyProjectExists(projectId);
      if (!exists) return;

      await activateProjectSurface({
        projectId,
        projects,
        threads,
        navigate,
        currentPathname: location.pathname,
        stayOnSettings: location.pathname === "/settings",
      });
    },
    [location.pathname, navigate, projects, threads, verifyProjectExists],
  );

  const keybindings = useKeybindings();

  const routeTerminalState = useThreadTerminalState(routeThreadId ?? null);
  const terminalOpen = routeTerminalState?.terminalOpen ?? false;

  const handleCreateProject = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    const cwd = await api.dialogs.pickFolder();
    if (!cwd) return;
    const existing = projects.find((project) => project.cwd === cwd);
    if (existing) {
      if (activePendingTabId) {
        // Resolve the pending tab into the existing project at the same slot.
        resolvePendingTab(activePendingTabId, existing.id);
        setActiveTool(existing.id, "agents");
        await navigate({ to: "/" });
      } else {
        await focusProject(existing.id);
      }
      return;
    }

    const projectId = newProjectId();
    const createdAt = new Date().toISOString();
    await api.orchestration.dispatchCommand({
      type: "project.create",
      commandId: newCommandId(),
      projectId,
      title: basenameOfPath(cwd),
      workspaceRoot: cwd,
      defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
      createdAt,
    });
    if (activePendingTabId) {
      // Convert the pending slot into a real project tab.
      resolvePendingTab(activePendingTabId, projectId);
      setActiveTool(projectId, "code");
      await navigate({ to: "/" });
    } else {
      openProject(projectId);
      setActiveProject(projectId);
      setActiveTool(projectId, "code");
      await navigate({ to: "/" });
    }
  }, [
    activePendingTabId,
    focusProject,
    navigate,
    openProject,
    projects,
    resolvePendingTab,
    setActiveProject,
    setActiveTool,
  ]);

  // Browser-like tab keyboard shortcuts, driven by application-menu accelerators
  // (cmd/ctrl + T / W / 1..9 / shift+[ ] / ctrl+Tab). Using menu accelerators —
  // not a window keydown listener — means they fire even when focus is inside an
  // embedded Code-OSS or Browser BrowserView, so they work everywhere in Tabs.
  const tabShortcutStateRef = useRef({
    openProjectIds: workspaceState.session.openProjectIds,
    pendingTabIds: workspaceState.session.pendingTabIds,
    activeProjectId: workspaceState.session.activeProjectId,
    activePendingTabId: workspaceState.session.activePendingTabId,
  });
  tabShortcutStateRef.current = {
    openProjectIds: workspaceState.session.openProjectIds,
    pendingTabIds: workspaceState.session.pendingTabIds,
    activeProjectId: workspaceState.session.activeProjectId,
    activePendingTabId: workspaceState.session.activePendingTabId,
  };
  const ensureProjectForWorkspaceRootRef = useRef<(workspaceRoot: string) => Promise<ProjectId>>(
    async () => {
      throw new Error("Project opening is not ready yet.");
    },
  );
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    return bridge.onMenuAction((action) => {
      if (action.startsWith("code-open-folder:")) {
        const encodedPath = action.slice("code-open-folder:".length);
        void ensureProjectForWorkspaceRootRef
          .current(decodeURIComponent(encodedPath))
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: "Could not open folder",
              description: error instanceof Error ? error.message : "The folder path is invalid.",
            });
          });
        return;
      }
      const { openProjectIds, pendingTabIds, activeProjectId, activePendingTabId } =
        tabShortcutStateRef.current;

      const tabsList = [
        ...openProjectIds.map((id) => ({ kind: "project" as const, id })),
        ...pendingTabIds.map((id) => ({ kind: "pending" as const, id })),
      ];

      const activate = (index: number) => {
        const targetTab = tabsList[index];
        if (targetTab) {
          if (targetTab.kind === "project") {
            void focusProject(targetTab.id);
          } else {
            openPendingTab(targetTab.id);
            void navigate({ to: "/" });
          }
        }
      };

      const getCurrentIndex = () => {
        if (activePendingTabId) {
          return tabsList.findIndex((t) => t.kind === "pending" && t.id === activePendingTabId);
        }
        if (activeProjectId) {
          return tabsList.findIndex((t) => t.kind === "project" && t.id === activeProjectId);
        }
        return -1;
      };

      const currentIndex = getCurrentIndex();
      const base = currentIndex < 0 ? 0 : currentIndex;

      switch (action) {
        case "tab-new":
          void (() => {
            const pendingId = randomUUID();
            openPendingTab(pendingId);
            void navigate({ to: "/" });
          })();
          return;
        case "tab-close":
          if (activePendingTabId) {
            closePendingTab(activePendingTabId);
          } else if (activeProjectId) {
            const closingId = activeProjectId;
            void requestCloseProject(closingId).then((closed) => {
              if (!closed) return;
              const remainingProjectIds = tabShortcutStateRef.current.openProjectIds.filter(
                (id) => id !== closingId,
              );
              const fallbackProjectId = remainingProjectIds[remainingProjectIds.length - 1] ?? null;
              if (fallbackProjectId) {
                void focusProject(fallbackProjectId);
              } else {
                void navigate({ to: "/" });
              }
            });
          }
          return;
        case "tab-next":
          if (tabsList.length > 0) activate((base + 1) % tabsList.length);
          return;
        case "tab-prev":
          if (tabsList.length > 0) activate((base - 1 + tabsList.length) % tabsList.length);
          return;
        default: {
          const tabGoMatch = /^tab-go-([1-9])$/.exec(action);
          if (tabGoMatch && tabsList.length > 0) {
            const requested = Number(tabGoMatch[1]);
            activate(
              requested === 9 ? tabsList.length - 1 : Math.min(requested - 1, tabsList.length - 1),
            );
          }
        }
      }
    });
  }, [openPendingTab, closePendingTab, requestCloseProject, focusProject, navigate]);

  const ensureProjectForWorkspaceRoot = useCallback(
    async (workspaceRoot: string): Promise<ProjectId> => {
      const existing = projects.find((project) => project.cwd === workspaceRoot);
      if (existing) {
        openProject(existing.id);
        return existing.id;
      }

      const projectId = newProjectId();
      await ensureNativeApi().orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title: basenameOfPath(workspaceRoot),
        workspaceRoot,
        defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
        createdAt: new Date().toISOString(),
      });
      openProject(projectId);
      return projectId;
    },
    [openProject, projects],
  );
  ensureProjectForWorkspaceRootRef.current = ensureProjectForWorkspaceRoot;

  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const handleClonedRepository = useCallback(
    async (clonedPath: string) => {
      const projectId = await ensureProjectForWorkspaceRoot(clonedPath);
      if (activePendingTabId) {
        resolvePendingTab(activePendingTabId, projectId);
      }
      setActiveProject(projectId);
      setActiveTool(projectId, "code");
      await navigate({ to: "/" });
    },
    [
      activePendingTabId,
      ensureProjectForWorkspaceRoot,
      navigate,
      resolvePendingTab,
      setActiveProject,
      setActiveTool,
    ],
  );

  const handleOpenProjectFile = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    const filePath = await api.dialogs.pickFile();
    if (!filePath) return;

    const workspaceRoot = dirnameOfPath(filePath);
    if (!workspaceRoot) {
      toastManager.add({
        type: "error",
        title: "Could not open file",
        description: "The selected file does not have a usable parent folder.",
      });
      return;
    }

    const relativePath = relativePathFromParent(workspaceRoot, filePath);
    if (!relativePath) {
      toastManager.add({
        type: "error",
        title: "Could not open file",
        description: "Tabs could not resolve the selected file inside its project folder.",
      });
      return;
    }

    const projectId = await ensureProjectForWorkspaceRoot(workspaceRoot);
    setActiveProject(projectId);
    setActiveTool(projectId, "code");
    setCodeFocusedPath(projectId, relativePath);
    await navigate({ to: "/" });
  }, [
    ensureProjectForWorkspaceRoot,
    navigate,
    setActiveProject,
    setActiveTool,
    setCodeFocusedPath,
  ]);

  const openAgentsForProject = useCallback(
    async (projectId: ProjectId) => {
      const targetThreadId = resolveProjectAgentThreadId(
        projectId,
        threads,
        workspaceState.session.rememberedThreadIdByProjectId[projectId] ?? null,
      );
      setActiveProject(projectId);
      setActiveTool(projectId, "agents");
      const targetProject = projects.find((project) => project.id === projectId);
      if (targetThreadId && targetProject?.environmentId) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: targetProject.environmentId,
            threadId: targetThreadId,
          },
        });
        return;
      }
      await navigate({ to: "/" });
    },
    [
      navigate,
      projects,
      setActiveProject,
      setActiveTool,
      threads,
      workspaceState.session.rememberedThreadIdByProjectId,
    ],
  );

  const createAgentsThreadForProject = useCallback(
    async (projectId: ProjectId) => {
      setActiveProject(projectId);
      setActiveTool(projectId, "agents");
      await handleNewThread(projectId, {
        envMode: settings.defaultThreadEnvMode,
      });
    },
    [handleNewThread, setActiveProject, setActiveTool, settings.defaultThreadEnvMode],
  );

  const handleDeleteThread = useCallback(
    async (thread: Thread) => {
      const api = await environmentApi(thread.environmentId);
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId: thread.id,
      });
      if (routeThreadId === thread.id && routeEnvironmentId === thread.environmentId) {
        void navigate({ to: "/" });
      }
    },
    [navigate, routeEnvironmentId, routeThreadId],
  );

  const handleArchiveThread = useCallback(
    async (thread: Thread) => {
      const api = await environmentApi(thread.environmentId);
      await api.orchestration.dispatchCommand({
        type: "thread.archive",
        commandId: newCommandId(),
        threadId: thread.id,
      });
      if (routeThreadId === thread.id && routeEnvironmentId === thread.environmentId) {
        void navigate({ to: "/" });
      }
    },
    [navigate, routeEnvironmentId, routeThreadId],
  );

  const handleUnarchiveThread = useCallback(async (thread: Thread) => {
    const api = await environmentApi(thread.environmentId);
    await api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId: thread.id,
    });
  }, []);

  const handleSelectTool = useCallback(
    async (toolId: string) => {
      if (!activeProject || !activeToolSettings) {
        return;
      }
      const nextTool =
        activeToolSettings.find((tool) => tool.id === toolId) ?? activeToolSettings[0] ?? null;
      if (!nextTool) {
        return;
      }
      setActiveTool(activeProject.id, nextTool.id);
      if (location.pathname === "/settings") {
        return;
      }
      if (nextTool.kind === "agents") {
        const nextThreadId = resolveProjectAgentThreadId(
          activeProject.id,
          threads,
          workspaceState.session.rememberedThreadIdByProjectId[activeProject.id] ?? null,
        );
        if (nextThreadId && activeProject.environmentId) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: activeProject.environmentId,
              threadId: nextThreadId,
            },
          });
          return;
        }
      } else if (location.pathname !== "/") {
        await navigate({ to: "/" });
      }
    },
    [
      activeProject,
      activeToolSettings,
      location.pathname,
      navigate,
      setActiveTool,
      threads,
      workspaceState.session.rememberedThreadIdByProjectId,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          shellChromeFocus: document.hasFocus(),
        },
      });
      if (!command) {
        if (event.metaKey || event.ctrlKey) {
          if (event.key === "=" || event.key === "+") {
            event.preventDefault();
            event.stopPropagation();
            zoomIn();
            return;
          }
          if (event.key === "-") {
            event.preventDefault();
            event.stopPropagation();
            zoomOut();
            return;
          }
          if (event.key === "0") {
            event.preventDefault();
            event.stopPropagation();
            resetZoom();
            return;
          }
        }
        return;
      }

      if (command === "zoom.in") {
        event.preventDefault();
        event.stopPropagation();
        zoomIn();
        return;
      }
      if (command === "zoom.out") {
        event.preventDefault();
        event.stopPropagation();
        zoomOut();
        return;
      }
      if (command === "zoom.reset") {
        event.preventDefault();
        event.stopPropagation();
        resetZoom();
        return;
      }

      if (command === "tab.new") {
        event.preventDefault();
        event.stopPropagation();
        const pendingId = randomUUID();
        openPendingTab(pendingId);
        void navigate({ to: "/" });
        return;
      }

      if (command === "chat.new" || command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        if (workspaceState.session.activeProjectId) {
          void handleNewThread(workspaceState.session.activeProjectId, {
            envMode: command === "chat.newLocal" ? "local" : settings.defaultThreadEnvMode,
          });
        }
        return;
      }
      if (command.startsWith("tool.jumpTo")) {
        const index = parseInt(command.slice(-1), 10) - 1;
        if (workspaceState.session.activeProjectId && availableTools.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const targetTool =
            availableTools[
              index === 8 ? availableTools.length - 1 : Math.min(index, availableTools.length - 1)
            ];
          if (targetTool) {
            handleSelectTool(targetTool.id);
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    keybindings,
    terminalOpen,
    openPendingTab,
    navigate,
    handleNewThread,
    workspaceState.session.activeProjectId,
    settings.defaultThreadEnvMode,
    availableTools,
    handleSelectTool,
  ]);

  useEffect(() => {
    initializeZoom();
  }, []);

  // Tool-switching shortcuts (cmd/ctrl+alt+1..9 → the Nth visible tool of the
  // active project), via menu accelerators so they work everywhere — including
  // inside the embedded editor/browser views.
  const toolShortcutRef = useRef({
    availableTools,
    switchTool: handleSelectTool,
  });
  toolShortcutRef.current = { availableTools, switchTool: handleSelectTool };
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    return bridge.onMenuAction((action) => {
      const kindMatch = /^tool-kind-(code|agents|server|git|browser|testing)$/.exec(action);
      if (kindMatch) {
        const { availableTools: tools, switchTool } = toolShortcutRef.current;
        const target = tools.find((tool) => tool.kind === kindMatch[1]);
        if (target) void switchTool(target.id);
        return;
      }
      const match = /^tool-go-([1-9])$/.exec(action);
      if (!match) return;
      const { availableTools: tools, switchTool } = toolShortcutRef.current;
      const target = tools[Number(match[1]) - 1];
      if (target) void switchTool(target.id);
    });
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onCodeChromeState) return;
    return bridge.onCodeChromeState((update) => {
      if (update?.projectId && update?.state) {
        workspaceShellActions.setCodeChromeState(update.projectId as ProjectId, update.state);
      }
    });
  }, []);

  const rememberedThreadId = activeProject
    ? (workspaceState.session.rememberedThreadIdByProjectId[activeProject.id] ?? null)
    : null;
  const rememberedThread =
    rememberedThreadId && activeProject
      ? (threads.find(
          (thread) => thread.id === rememberedThreadId && thread.projectId === activeProject.id,
        ) ?? null)
      : null;
  const gitActionThreadId = rememberedThread?.id ?? routeThreadId ?? null;
  const gitTerminalThreadId = activeProject ? ThreadId.makeUnsafe(`git:${activeProject.id}`) : null;
  const serverThreadId = activeProject ? ThreadId.makeUnsafe(`server:${activeProject.id}`) : null;
  const gitTerminalState = useThreadTerminalState(gitTerminalThreadId);
  const serverTerminalState = useThreadTerminalState(serverThreadId);
  // Custom "terminal tab" embeds (gemini/codex/etc.) must run in their OWN
  // terminal thread — never the shared `server:<project>` thread — so their
  // terminals don't leak into the Server tab's terminal list. Only the active
  // custom_process tab needs a live thread at a time.
  const activeCustomProcessId =
    activeTool?.kind === "custom_process" ? (activeTool.terminalProcessId ?? null) : null;
  const customProcessThreadId =
    activeProject && activeCustomProcessId
      ? ThreadId.makeUnsafe(`server:${activeProject.id}:custom:${activeCustomProcessId}`)
      : null;
  const customProcessTerminalState = useThreadTerminalState(customProcessThreadId);
  const storeSetTerminalOpen = terminalActions.setOpen;
  const storeSetTerminalHeight = terminalActions.setHeight;
  const storeSplitTerminal = terminalActions.split;
  const storeNewTerminal = terminalActions.new;
  const storeSetActiveTerminal = terminalActions.setActive;
  const storeCloseTerminal = terminalActions.close;
  const storeClearTerminalState = terminalActions.clear;
  const [shellTerminalFocusRequestId, setShellTerminalFocusRequestId] = useState(0);

  const setGitTerminalOpen = useCallback(
    (open: boolean) => {
      if (!gitTerminalThreadId) return;
      storeSetTerminalOpen(gitTerminalThreadId, open);
    },
    [gitTerminalThreadId, storeSetTerminalOpen],
  );
  const toggleGitTerminalVisibility = useCallback(() => {
    if (!gitTerminalThreadId || !gitTerminalState) return;
    setGitTerminalOpen(!gitTerminalState.terminalOpen);
    if (!gitTerminalState.terminalOpen) {
      setShellTerminalFocusRequestId((value) => value + 1);
    }
  }, [gitTerminalState, gitTerminalThreadId, setGitTerminalOpen]);
  const setGitTerminalHeight = useCallback(
    (height: number) => {
      if (!gitTerminalThreadId) return;
      storeSetTerminalHeight(gitTerminalThreadId, height);
    },
    [gitTerminalThreadId, storeSetTerminalHeight],
  );
  const splitGitTerminal = useCallback(() => {
    if (!gitTerminalThreadId) return;
    storeSplitTerminal(gitTerminalThreadId, `terminal-${randomUUID()}`);
    setShellTerminalFocusRequestId((value) => value + 1);
  }, [gitTerminalThreadId, storeSplitTerminal]);
  const createNewGitTerminal = useCallback(() => {
    if (!gitTerminalThreadId) return;
    storeNewTerminal(gitTerminalThreadId, `terminal-${randomUUID()}`);
    if (
      gitTerminalState?.terminalIds.includes(DEFAULT_THREAD_TERMINAL_ID) &&
      !gitTerminalState.runningTerminalIds.includes(DEFAULT_THREAD_TERMINAL_ID)
    ) {
      storeCloseTerminal(gitTerminalThreadId, DEFAULT_THREAD_TERMINAL_ID);
    }
    setShellTerminalFocusRequestId((value) => value + 1);
  }, [gitTerminalThreadId, storeNewTerminal, gitTerminalState, storeCloseTerminal]);
  const activateGitTerminal = useCallback(
    (terminalId: string) => {
      if (!gitTerminalThreadId) return;
      storeSetActiveTerminal(gitTerminalThreadId, terminalId);
      setShellTerminalFocusRequestId((value) => value + 1);
    },
    [gitTerminalThreadId, storeSetActiveTerminal],
  );
  const closeGitTerminal = useCallback(
    (terminalId: string) => {
      const api = activeProjectApi;
      if (!gitTerminalThreadId || !api || !gitTerminalState) return;
      const isFinalTerminal = gitTerminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: gitTerminalThreadId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: gitTerminalThreadId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: gitTerminalThreadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      storeCloseTerminal(gitTerminalThreadId, terminalId);
      setShellTerminalFocusRequestId((value) => value + 1);
    },
    [activeProjectApi, gitTerminalState, gitTerminalThreadId, storeCloseTerminal],
  );
  const runCommandInGitTerminal = useCallback(
    async (command: string, errorTitle: string) => {
      const api = activeProjectApi;
      if (!gitTerminalThreadId || !api || !activeProject) return;
      setGitTerminalOpen(true);
      setShellTerminalFocusRequestId((value) => value + 1);
      const terminalId =
        gitTerminalState?.activeTerminalId ??
        gitTerminalState?.terminalIds[0] ??
        DEFAULT_THREAD_TERMINAL_ID;
      if (gitTerminalState?.terminalIds.includes(terminalId)) {
        storeSetActiveTerminal(gitTerminalThreadId, terminalId);
      } else {
        storeNewTerminal(gitTerminalThreadId, terminalId);
      }
      try {
        await api.terminal.open({
          threadId: gitTerminalThreadId,
          terminalId,
          cwd: activeProject.cwd,
        });
        await api.terminal.write({
          threadId: gitTerminalThreadId,
          terminalId,
          data: `${command}\r`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: errorTitle,
          description: error instanceof Error ? error.message : "Failed to launch the terminal.",
        });
      }
    },
    [
      activeProject,
      activeProjectApi,
      gitTerminalState,
      gitTerminalThreadId,
      setGitTerminalOpen,
      storeNewTerminal,
      storeSetActiveTerminal,
    ],
  );
  const runGitHubLoginInGitTerminal = useCallback(
    () => runCommandInGitTerminal("gh auth login", "Could not start GitHub sign-in"),
    [runCommandInGitTerminal],
  );
  const dispatchReleaseInGitTerminal = useCallback(
    async (version: string, branch: string) => {
      const trimmed = version.trim().replace(/^v/, "");
      const branchRef = branch.trim();
      if (trimmed.length === 0 || branchRef.length === 0 || !activeProjectApi || !activeProject) {
        return;
      }
      try {
        await activeProjectApi.git.triggerReleaseWorkflow({
          cwd: activeProject.cwd,
          ref: branchRef,
          version: trimmed,
        });
        toastManager.add({
          type: "success",
          title: `Release ${trimmed} dispatched`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not trigger release",
          description: error instanceof Error ? error.message : "Release dispatch failed.",
        });
      }
    },
    [activeProject, activeProjectApi],
  );
  const setServerTerminalOpen = useCallback(
    (open: boolean) => {
      if (!serverThreadId) return;
      storeSetTerminalOpen(serverThreadId, open);
    },
    [serverThreadId, storeSetTerminalOpen],
  );
  const revealServerTerminal = useCallback(() => {
    if (!serverThreadId) return;
    setServerTerminalOpen(true);
    setShellTerminalFocusRequestId((value) => value + 1);
  }, [serverThreadId, setServerTerminalOpen]);
  const hideServerTerminal = useCallback(() => {
    if (!serverThreadId) return;
    setServerTerminalOpen(false);
  }, [serverThreadId, setServerTerminalOpen]);
  const setServerTerminalHeight = useCallback(
    (height: number) => {
      if (!serverThreadId) return;
      storeSetTerminalHeight(serverThreadId, height);
    },
    [serverThreadId, storeSetTerminalHeight],
  );
  const splitServerTerminal = useCallback(() => {
    if (!serverThreadId) return;
    storeSplitTerminal(serverThreadId, `terminal-${randomUUID()}`);
    setShellTerminalFocusRequestId((value) => value + 1);
  }, [serverThreadId, storeSplitTerminal]);
  const createNewServerTerminal = useCallback(() => {
    if (!serverThreadId) return;
    storeNewTerminal(serverThreadId, `terminal-${randomUUID()}`);
    if (
      serverTerminalState?.terminalIds.includes(DEFAULT_THREAD_TERMINAL_ID) &&
      !serverTerminalState.runningTerminalIds.includes(DEFAULT_THREAD_TERMINAL_ID)
    ) {
      storeCloseTerminal(serverThreadId, DEFAULT_THREAD_TERMINAL_ID);
    }
    setShellTerminalFocusRequestId((value) => value + 1);
  }, [serverThreadId, storeNewTerminal, serverTerminalState, storeCloseTerminal]);
  const activateServerTerminal = useCallback(
    (terminalId: string) => {
      if (!serverThreadId) return;
      storeSetActiveTerminal(serverThreadId, terminalId);
      setShellTerminalFocusRequestId((value) => value + 1);
    },
    [serverThreadId, storeSetActiveTerminal],
  );
  const focusServerProcessTerminal = useCallback(
    (terminalId: string) => {
      if (!serverThreadId || !serverTerminalState?.terminalIds.includes(terminalId)) return;
      revealServerTerminal();
      activateServerTerminal(terminalId);
    },
    [
      activateServerTerminal,
      revealServerTerminal,
      serverTerminalState?.terminalIds,
      serverThreadId,
    ],
  );
  // ── Thread-parameterized terminal/process cores ──────────────────────
  // Shared by the Server tab (server thread) and each custom terminal tab
  // (its own isolated thread) so the two never cross-contaminate.
  const executedCommandsRef = useRef<Map<string, number>>(new Map());
  const previewTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const openProcessTerminal = useCallback(
    async (input: {
      threadId: ThreadId;
      terminalState: ReturnType<typeof selectThreadTerminalState> | null;
      process: ProjectWorkspaceSettings["terminalProcesses"][number];
      reveal: boolean;
    }) => {
      const api = activeProjectApi;
      if (!api || !activeProject) return;
      const commands = input.process.commands
        .map((command) => command.trim())
        .filter((command) => command.length > 0);
      if (commands.length === 0) return;
      const terminalId = input.process.id || DEFAULT_THREAD_TERMINAL_ID;
      const cwd = input.process.cwd.trim().length > 0 ? input.process.cwd : activeProject.cwd;
      const env = input.process.env;
      if (input.reveal) {
        storeSetTerminalOpen(input.threadId, true);
      }
      // Create/activate the named process terminal FIRST, so the thread already
      // has this real terminal before we evict the placeholder below.
      if (input.terminalState?.terminalIds.includes(terminalId)) {
        storeSetActiveTerminal(input.threadId, terminalId);
      } else {
        storeNewTerminal(input.threadId, terminalId);
      }
      // Every terminal thread is seeded with a default placeholder ("Terminal
      // 1"). When opening a named process terminal, evict that unused placeholder
      // so it doesn't linger as a phantom extra terminal in the sidebar. This
      // MUST run after creating the process terminal above: closeTerminal
      // re-seeds the default whenever the thread would otherwise become empty, so
      // evicting the lone placeholder first would just recreate it. Only evict
      // when the placeholder is genuinely unused (no live session) and isn't the
      // terminal we're opening.
      if (
        terminalId !== DEFAULT_THREAD_TERMINAL_ID &&
        input.terminalState?.terminalIds.includes(DEFAULT_THREAD_TERMINAL_ID) &&
        !input.terminalState.runningTerminalIds.includes(DEFAULT_THREAD_TERMINAL_ID)
      ) {
        storeCloseTerminal(input.threadId, DEFAULT_THREAD_TERMINAL_ID);
      }
      setShellTerminalFocusRequestId((value) => value + 1);
      try {
        await api.terminal.open({
          threadId: input.threadId,
          terminalId,
          cwd,
          env,
        });
        const runKey = `${input.threadId}:${terminalId}`;
        const isAlreadyRunningLocally = executedCommandsRef.current.has(runKey);
        const isAlreadyRunningRemotely =
          input.terminalState?.runningTerminalIds.includes(terminalId);

        if (!isAlreadyRunningLocally && !isAlreadyRunningRemotely) {
          executedCommandsRef.current.set(runKey, Date.now());
          for (const command of commands) {
            await api.terminal.write({
              threadId: input.threadId,
              terminalId,
              data: `${command}\r`,
            });
          }
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Could not run "${input.process.label}"`,
          description: error instanceof Error ? error.message : "Terminal startup failed.",
        });
      }
    },
    [
      activeProject,
      activeProjectApi,
      storeCloseTerminal,
      storeNewTerminal,
      storeSetActiveTerminal,
      storeSetTerminalOpen,
    ],
  );
  const closeThreadTerminal = useCallback(
    async (input: {
      threadId: ThreadId;
      terminalState: ReturnType<typeof selectThreadTerminalState> | null;
      terminalId: string;
      clearIfFinal: boolean;
    }) => {
      executedCommandsRef.current.delete(`${input.threadId}:${input.terminalId}`);
      const api = activeProjectApi;
      const isFinalTerminal = (input.terminalState?.terminalIds.length ?? 0) <= 1;
      const fallbackExitWrite = () =>
        api?.terminal
          .write({
            threadId: input.threadId,
            terminalId: input.terminalId,
            data: "exit\n",
          })
          .catch(() => undefined) ?? Promise.resolve();
      if (api && "close" in api.terminal && typeof api.terminal.close === "function") {
        try {
          if (input.clearIfFinal && isFinalTerminal) {
            await api.terminal
              .clear({ threadId: input.threadId, terminalId: input.terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: input.threadId,
            terminalId: input.terminalId,
            deleteHistory: true,
          });
        } catch {
          await fallbackExitWrite().catch(() => undefined);
        }
      } else {
        await fallbackExitWrite().catch(() => undefined);
      }
      storeCloseTerminal(input.threadId, input.terminalId);
      setShellTerminalFocusRequestId((value) => value + 1);
    },
    [activeProjectApi, storeCloseTerminal],
  );
  const closeServerTerminal = useCallback(
    (terminalId: string) => {
      const api = activeProjectApi;
      if (!serverThreadId || !api || !serverTerminalState) return;
      executedCommandsRef.current.delete(`${serverThreadId}:${terminalId}`);
      const isFinalTerminal = serverTerminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: serverThreadId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: serverThreadId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: serverThreadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      storeCloseTerminal(serverThreadId, terminalId);
      setShellTerminalFocusRequestId((value) => value + 1);
    },
    [activeProjectApi, serverTerminalState, serverThreadId, storeCloseTerminal],
  );
  const stopServerProcess = useCallback(
    async (processId: string) => {
      const api = activeProjectApi;
      if (!serverThreadId || !serverTerminalState?.terminalIds.includes(processId)) {
        return;
      }
      const fallbackExitWrite = () =>
        api?.terminal.write({
          threadId: serverThreadId,
          terminalId: processId,
          data: "exit\n",
        }) ?? Promise.resolve();

      try {
        if (api && "close" in api.terminal && typeof api.terminal.close === "function") {
          await api.terminal.close({
            threadId: serverThreadId,
            terminalId: processId,
            deleteHistory: true,
          });
        } else {
          await fallbackExitWrite();
        }
      } catch {
        await fallbackExitWrite().catch(() => undefined);
      } finally {
        executedCommandsRef.current.delete(`${serverThreadId}:${processId}`);
        if (previewTimeoutsRef.current.has(processId)) {
          clearTimeout(previewTimeoutsRef.current.get(processId)!);
          previewTimeoutsRef.current.delete(processId);
        }
        storeCloseTerminal(serverThreadId, processId);
        setShellTerminalFocusRequestId((value) => value + 1);
      }
    },
    [activeProjectApi, serverTerminalState?.terminalIds, serverThreadId, storeCloseTerminal],
  );
  const runServerProcess = useCallback(
    async (processId: string) => {
      if (!activeProjectSettings || !serverThreadId) return;
      const process = (activeProjectSettings.serverPresets ?? []).find(
        (entry: any) => entry.id === processId,
      );
      if (!process) return;

      const liveState = getThreadTerminalState(serverThreadId);
      if (liveState?.runningTerminalIds.includes(processId)) {
        revealServerTerminal();
        activateServerTerminal(processId);
        return;
      }

      executedCommandsRef.current.delete(`${serverThreadId}:${processId}`);
      revealServerTerminal();
      await openProcessTerminal({
        threadId: serverThreadId,
        // Read the LIVE terminal state (not the rendered `serverTerminalState`
        // snapshot) so running several presets in quick succession each see the
        // terminals the previous run just created — otherwise the placeholder
        // eviction and dedupe work off stale data.
        terminalState: getThreadTerminalState(serverThreadId),
        process,
        reveal: true,
      });

      // Delay opening the browser slightly to give the server (e.g. Vite) time to start up
      // and bind to the port, preventing "Connection Refused" errors.
      if (previewTimeoutsRef.current.has(processId)) {
        clearTimeout(previewTimeoutsRef.current.get(processId)!);
      }
      const timeoutId = setTimeout(() => {
        previewTimeoutsRef.current.delete(processId);
        if (process.previewOpenTarget === "external" && process.previewUrl) {
          const api = activeProjectApi;
          if (api?.shell?.openExternal) {
            api.shell.openExternal(process.previewUrl).catch(console.error);
          } else {
            window.open(process.previewUrl, "_blank", "noopener,noreferrer");
          }
        } else {
          if (process.previewUrl && activeProject?.id) {
            workspaceShellActions.setBrowserCurrentUrl(activeProject.id, process.previewUrl);
            window.desktopBridge?.reloadBrowserSession({
              projectId: activeProject.id,
            });
          }
          if (process.autoOpenPreview && activeProject?.id) {
            workspaceShellActions.setActiveTool(activeProject.id, "browser");
          }
        }
      }, 3000);
      previewTimeoutsRef.current.set(processId, timeoutId);
    },
    [
      activeProjectSettings,
      activateServerTerminal,
      getThreadTerminalState,
      openProcessTerminal,
      revealServerTerminal,
      serverThreadId,
      activeProject?.id,
      activeProjectApi,
    ],
  );
  const dependencyTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const runServerProcessWithDependencies = useCallback(
    async (processId: string) => {
      if (!activeProjectSettings || !serverThreadId) return;
      const presets = activeProjectSettings.serverPresets ?? [];
      const process = presets.find((entry: any) => entry.id === processId);
      if (!process) return;

      const liveTerminalState = getThreadTerminalState(serverThreadId);
      const runningIds = new Set(liveTerminalState?.runningTerminalIds ?? []);
      const currentTerminalIds = new Set(liveTerminalState?.terminalIds ?? []);

      if (process.dependsOn && process.dependsOn.length > 0) {
        for (const depId of process.dependsOn) {
          const depStatus = resolveServerPresetRuntimeStatus({
            processId: depId,
            runningProcessIds: runningIds,
            terminalIds: currentTerminalIds,
          });
          if (depStatus === "idle") {
            await runServerProcess(depId);
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }

      await runServerProcess(processId);
    },
    [activeProjectSettings, serverThreadId, getThreadTerminalState, runServerProcess],
  );
  const restartServerProcess = useCallback(
    async (processId: string) => {
      await stopServerProcess(processId);
      await runServerProcessWithDependencies(processId);
    },
    [runServerProcessWithDependencies, stopServerProcess],
  );
  // ── Custom terminal-tab handlers (isolated per-process thread) ────────
  const runCustomProcess = useCallback(
    async (
      process:
        | ProjectWorkspaceSettings["terminalProcesses"][number]
        | ProjectWorkspaceSettings["serverPresets"][number],
      threadId: ThreadId,
    ) => {
      executedCommandsRef.current.delete(`${threadId}:${process.id}`);
      await openProcessTerminal({
        threadId,
        terminalState: getThreadTerminalState(threadId),
        process,
        reveal: true,
      });
    },
    [openProcessTerminal],
  );
  const stopCustomProcess = useCallback(
    async (terminalId: string, threadId: ThreadId) => {
      await closeThreadTerminal({
        threadId,
        terminalState: getThreadTerminalState(threadId),
        terminalId,
        clearIfFinal: false,
      });
    },
    [closeThreadTerminal],
  );
  const closeAllServerTerminals = useCallback(async () => {
    const api = activeProjectApi;
    if (!serverThreadId || !serverTerminalState) {
      return;
    }
    const terminalIds = [...new Set(serverTerminalState.terminalIds)];
    terminalIds.forEach((id) => {
      executedCommandsRef.current.delete(`${serverThreadId}:${id}`);
      if (previewTimeoutsRef.current.has(id)) {
        clearTimeout(previewTimeoutsRef.current.get(id)!);
        previewTimeoutsRef.current.delete(id);
      }
    });
    await Promise.all(
      terminalIds.map(async (terminalId) => {
        const fallbackExitWrite = () =>
          api?.terminal.write({
            threadId: serverThreadId,
            terminalId,
            data: "exit\n",
          }) ?? Promise.resolve();

        try {
          if (api && "close" in api.terminal && typeof api.terminal.close === "function") {
            await api.terminal.close({
              threadId: serverThreadId,
              terminalId,
              deleteHistory: true,
            });
          } else {
            await fallbackExitWrite();
          }
        } catch {
          await fallbackExitWrite().catch(() => undefined);
        }
      }),
    );
    storeClearTerminalState(serverThreadId);
    serverAutoStartedProcessIdsRef.current.clear();
    setShellTerminalFocusRequestId((value) => value + 1);
  }, [activeProjectApi, serverTerminalState, serverThreadId, storeClearTerminalState]);

  const serverAutoStartedProcessIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    serverAutoStartedProcessIdsRef.current.clear();
  }, [activeProject?.id]);
  useEffect(() => {
    if (!activeProjectSettings) return;
    // Processes backing custom terminal tabs auto-start in their own tab — the
    // Server tab must not also launch them in the shared server thread.
    for (const process of activeProjectSettings.serverPresets ?? []) {
      if (
        !process.autoStart ||
        process.commands.every((command: string) => command.trim().length === 0)
      ) {
        continue;
      }
      if (serverAutoStartedProcessIdsRef.current.has(process.id)) continue;
      serverAutoStartedProcessIdsRef.current.add(process.id);
      void runServerProcess(process.id);
    }
  }, [activeProjectSettings, runServerProcess]);

  const gitTool = activeProject ? (
    <GitToolV2
      cwd={activeProject.cwd}
      environmentId={activeProject.environmentId}
      activeThreadId={gitActionThreadId}
      terminalAvailable
      terminalOpen={Boolean(gitTerminalState?.terminalOpen)}
      onToggleTerminal={toggleGitTerminalVisibility}
      onRunInTerminal={(cmd) => void runCommandInGitTerminal(cmd, "Command failed")}
      onOpenAgents={() => openAgentsForProject(activeProject.id)}
      onRunGitHubLogin={() => void runGitHubLoginInGitTerminal()}
    />
  ) : null;
  const browserTool =
    activeProject && activeProjectSettings ? (
      <BrowserTool
        project={activeProject}
        projectSettings={activeProjectSettings}
        runningProcessIds={serverTerminalState?.runningTerminalIds ?? []}
        onRunProcess={(processId) => void runServerProcessWithDependencies(processId)}
      />
    ) : null;
  const serverTool =
    activeProject && activeProjectSettings ? (
      <ServerTool
        project={activeProject}
        projectSettings={activeProjectSettings}
        onOpenSettings={openSettings}
        onRunProcess={(processId) => void runServerProcessWithDependencies(processId)}
        onRestartProcess={(processId) => void restartServerProcess(processId)}
        onStopProcess={(processId) => void stopServerProcess(processId)}
        onOpenProcessTerminal={focusServerProcessTerminal}
        onRevealTerminal={revealServerTerminal}
        onHideTerminal={hideServerTerminal}
        onNewTerminal={createNewServerTerminal}
        onCloseAllTerminals={() => void closeAllServerTerminals()}
        onSavePresets={(presets) =>
          upsertProjectSettings(activeProject.id, (current) => {
            return {
              ...current,
              serverPresets: presets.map((preset) => {
                const res: any = {
                  id: preset.id,
                  label: preset.label,
                  commands: preset.commands,
                  cwd: preset.cwd,
                  env: {},
                  autoStart: preset.autoStart,
                };
                if (preset.previewUrl !== undefined) res.previewUrl = preset.previewUrl;
                if (preset.autoOpenPreview !== undefined)
                  res.autoOpenPreview = preset.autoOpenPreview;
                if (preset.previewOpenTarget !== undefined)
                  res.previewOpenTarget = preset.previewOpenTarget;
                if (preset.previewFocus !== undefined) res.previewFocus = preset.previewFocus;
                if (preset.dependsOn !== undefined) res.dependsOn = preset.dependsOn;
                return res;
              }),
            };
          })
        }
        terminalVisible={Boolean(serverTerminalState?.terminalOpen)}
        terminalIds={serverTerminalState?.terminalIds ?? []}
        runningProcessIds={serverTerminalState?.runningTerminalIds ?? []}
        activeTerminalId={serverTerminalState?.activeTerminalId ?? null}
        hasTerminalWorkspace={Boolean(
          serverTerminalState &&
          (serverTerminalState.terminalOpen ||
            serverTerminalState.runningTerminalIds.length > 0 ||
            serverTerminalState.terminalIds.some(
              (terminalId) => terminalId !== DEFAULT_THREAD_TERMINAL_ID,
            )),
        )}
        terminalContent={
          serverThreadId && serverTerminalState ? (
            <ThreadTerminalDrawer
              key={serverThreadId}
              variant="embedded"
              threadId={serverThreadId}
              cwd={activeProject.cwd}
              runtimeEnv={projectScriptRuntimeEnv({
                project: { cwd: activeProject.cwd },
                worktreePath: null,
              })}
              height={serverTerminalState.terminalHeight}
              terminalIds={serverTerminalState.terminalIds}
              activeTerminalId={serverTerminalState.activeTerminalId}
              terminalGroups={serverTerminalState.terminalGroups}
              activeTerminalGroupId={serverTerminalState.activeTerminalGroupId}
              focusRequestId={shellTerminalFocusRequestId}
              terminalLabels={{
                ...serverTerminalState.terminalLabels,
                ...Object.fromEntries(
                  [
                    ...(activeProjectSettings.terminalProcesses ?? []),
                    ...(activeProjectSettings.serverPresets ?? []),
                  ].map((p) => [p.id, p.label]),
                ),
              }}
              onSplitTerminal={splitServerTerminal}
              onNewTerminal={createNewServerTerminal}
              onActiveTerminalChange={activateServerTerminal}
              onCloseTerminal={closeServerTerminal}
              onHeightChange={setServerTerminalHeight}
              onAddTerminalContext={() => {}}
            />
          ) : null
        }
      />
    ) : null;
  const codeTool = activeProject ? <CodeTool project={activeProject} /> : null;
  const customEmbedTool =
    activeProject && activeProjectSettings && activeTool?.kind === "custom_embed"
      ? (() => {
          const embed = activeTool.customEmbedId
            ? ((activeProjectSettings.customEmbeds ?? []).find(
                (entry) => entry.id === activeTool.customEmbedId,
              ) ?? null)
            : null;
          return embed ? (
            // Key by embed id so switching between custom browser tabs mounts a
            // fresh instance per session. Without it React reuses one instance
            // and only swaps props; the bounds/session effects (which don't list
            // sessionId as a dep) then never re-run for the newly selected tab,
            // leaving its BrowserView unpositioned (blank). The underlying
            // BrowserView is kept alive in the main process, so this does not
            // reload page content.
            <CustomEmbedTool
              key={embed.id}
              project={activeProject}
              title={embed.label}
              url={embed.url}
              resumeLastVisitedPage={embed.resumeLastVisitedPage}
              partitionMode={embed.partitionMode}
              partitionProfile={embed.partitionProfile}
              sessionId={`custom-${embed.id}`}
            />
          ) : null;
        })()
      : null;
  const customProcessTool =
    activeProject &&
    activeProjectSettings &&
    activeTool?.kind === "custom_process" &&
    customProcessThreadId
      ? (() => {
          const process = activeTool.terminalProcessId
            ? ((activeProjectSettings.terminalProcesses ?? []).find(
                (entry) => entry.id === activeTool.terminalProcessId,
              ) ?? null)
            : null;
          const threadId = customProcessThreadId;
          return process ? (
            <CustomProcessTool
              key={process.id}
              project={activeProject}
              process={process}
              threadId={threadId}
              terminalState={customProcessTerminalState ?? selectThreadTerminalState({}, threadId)}
              focusRequestId={shellTerminalFocusRequestId}
              onRunProcess={() => void runCustomProcess(process, threadId)}
              onRestartProcess={() => {
                void (async () => {
                  await stopCustomProcess(process.id, threadId);
                  await runCustomProcess(process, threadId);
                })();
              }}
              onStopProcess={() => void stopCustomProcess(process.id, threadId)}
              onActivateTerminal={(terminalId) => {
                storeSetActiveTerminal(threadId, terminalId);
                setShellTerminalFocusRequestId((value) => value + 1);
              }}
              onCloseTerminal={(terminalId) => void stopCustomProcess(terminalId, threadId)}
              onHeightChange={(height) => storeSetTerminalHeight(threadId, height)}
            />
          ) : null;
        })()
      : null;

  // The content area renders the landing/welcome screen specifically when the
  // active tab is a pending (unassigned) tab. A pending-active tab takes
  // priority over any activeProject — they cannot both be non-null simultaneously
  // (openPendingTab clears activeProjectId), but the explicit check here makes
  // intent clear and guards against any unexpected state.

  const isSettingsRoute = location.pathname === "/settings";
  const isSettingsSurfaceActive = isSettingsRoute || isSettingsNavigationPending;
  const shouldHideShellChrome = embeddedMode.enabled;
  const isEmbeddedWorkspacePending =
    embeddedMode.enabled &&
    Boolean(embeddedMode.workspaceRoot) &&
    (!activeProject || activeProject.cwd !== embeddedMode.workspaceRoot || !activeProjectSettings);

  let content: ReactNode;
  if (isSettingsNavigationPending) {
    content = (
      <PageLoadingState label="Opening Settings" detail="Restoring your last settings section…" />
    );
  } else if (!threadsHydrated) {
    content = (
      <PageLoadingState
        label="Loading your projects"
        detail="Restoring open workspaces and their last active tools…"
      />
    );
  } else if (isEmbeddedWorkspacePending) {
    content = (
      <PageLoadingState
        label="Attaching workspace"
        detail={`Connecting the embedded Tabs panel to ${embeddedMode.workspaceRoot}.`}
      />
    );
  } else if (isSettingsRoute) {
    content = (
      <div className="flex h-full min-h-0 flex-col animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
        {props.settingsContent}
      </div>
    );
  } else if (isActivePendingTab) {
    // The focused tab is a pending/unassigned "New Tab" — show the landing
    // screen inside that tab's content area so the user can pick a project.
    // We reuse the existing Welcome JSX exactly; only the activation condition
    // has changed (was: !activeProject globally; now: active tab is pending).
    const recentProjects = projects
      .toSorted((left, right) =>
        (right.updatedAt ?? right.createdAt ?? "").localeCompare(
          left.updatedAt ?? left.createdAt ?? "",
        ),
      )
      .slice(0, 6);
    const handleRecentProject = async (project: Project) => {
      const exists = await verifyProjectExists(project.id);
      if (!exists) return;

      if (activePendingTabId) {
        resolvePendingTab(activePendingTabId, project.id);
        void focusProject(project.id);
      } else {
        void focusProject(project.id);
      }
    };
    content = (
      <div className="flex h-full min-h-0 overflow-auto bg-background px-10 py-12">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
          <div className="space-y-2">
            <h1 className="text-4xl font-medium tracking-tight text-foreground">Welcome</h1>
            <p className="text-base text-muted-foreground">
              Open a local project to start using the workspace shell.
            </p>
          </div>

          <div className="grid gap-12 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div>
                <div className="text-xl font-medium text-foreground">Start</div>
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={() => void handleCreateProject()}
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  <span>Add Project...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={() => void handleOpenProjectFile()}
                >
                  <FolderSearchIcon className="size-4 text-muted-foreground" />
                  <span>Open File...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={() => openAddProjectCommandPalette()}
                >
                  <GitBranchIcon className="size-4 text-muted-foreground" />
                  <span>Clone from Git...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={openSettings}
                >
                  <SettingsIcon className="size-4 text-muted-foreground" />
                  <span>Workspace Settings</span>
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="text-xl font-medium text-foreground">Recent</div>
              </div>
              {recentProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                  No recent projects yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="flex w-full items-start justify-between gap-4 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/40"
                      onClick={() => handleRecentProject(project)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{project.cwd}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
                        Open
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  } else if (!activeProject || !activeProjectSettings) {
    // No pending tab is active, but still no real project resolved — this is the
    // old global fallback (e.g. on first launch before any project is added).
    const recentProjects = projects
      .toSorted((left, right) =>
        (right.updatedAt ?? right.createdAt ?? "").localeCompare(
          left.updatedAt ?? left.createdAt ?? "",
        ),
      )
      .slice(0, 6);
    content = (
      <div className="flex h-full min-h-0 overflow-auto bg-background px-10 py-12">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
          <div className="space-y-2">
            <h1 className="text-4xl font-medium tracking-tight text-foreground">Welcome</h1>
            <p className="text-base text-muted-foreground">
              Open a local project to start using the workspace shell.
            </p>
          </div>

          <div className="grid gap-12 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div>
                <div className="text-xl font-medium text-foreground">Start</div>
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={() => void handleCreateProject()}
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  <span>Add Project...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={() => void handleOpenProjectFile()}
                >
                  <FolderSearchIcon className="size-4 text-muted-foreground" />
                  <span>Open File...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={() => openAddProjectCommandPalette()}
                >
                  <GitBranchIcon className="size-4 text-muted-foreground" />
                  <span>Clone from Git...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40"
                  onClick={openSettings}
                >
                  <SettingsIcon className="size-4 text-muted-foreground" />
                  <span>Workspace Settings</span>
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="text-xl font-medium text-foreground">Recent</div>
              </div>
              {recentProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                  No recent projects yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="flex w-full items-start justify-between gap-4 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/40"
                      onClick={() => void focusProject(project.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{project.cwd}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
                        Open
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  } else if (activeTool?.kind === "agents") {
    content = (
      <AgentsThreadList
        project={activeProject}
        threads={sortProjectThreads(
          threads.filter(
            (thread) =>
              thread.projectId === activeProject.id &&
              thread.environmentId === activeProject.environmentId,
          ),
        )}
        activeThreadId={routeThreadId}
        onSelectThread={(threadId) => {
          if (!activeProject.environmentId) return;
          const pKey = projectUiStateKey(activeProject.environmentId, activeProject.id);
          agentsLayoutActions.openInActivePane(pKey, threadId);
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: activeProject.environmentId, threadId },
          });
        }}
        onOpenThreadToSide={(threadId) => {
          if (!activeProject.environmentId) return;
          const pKey = projectUiStateKey(activeProject.environmentId, activeProject.id);
          agentsLayoutActions.openToSide(pKey, threadId);
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: activeProject.environmentId, threadId },
          });
        }}
        onCreateThread={async () => {
          if (!activeProject.environmentId) return;
          const tid = await handleNewThread(activeProject.id, {
            environmentId: activeProject.environmentId,
            envMode: settings.defaultThreadEnvMode,
          });
          if (tid) {
            const pKey = projectUiStateKey(activeProject.environmentId, activeProject.id);
            agentsLayoutActions.openInActivePane(pKey, tid);
          }
        }}
        onDeleteThread={handleDeleteThread}
        onArchiveThread={handleArchiveThread}
        onUnarchiveThread={handleUnarchiveThread}
      >
        {props.agentsContent}
      </AgentsThreadList>
    );
  } else if (activeTool?.kind === "code") {
    content = codeTool;
  } else if (activeTool?.kind === "server") {
    content = serverTool;
  } else if (activeTool?.kind === "git") {
    content = gitTool;
  } else if (activeTool?.kind === "testing") {
    content = (
      <TestingTool
        projectId={activeProject.id}
        {...(activeProject.environmentId ? { environmentId: activeProject.environmentId } : {})}
        projectPath={activeProject.cwd}
        defaultModelSelection={activeProject.defaultModelSelection}
      />
    );
  } else if (activeTool?.kind === "custom_embed") {
    content = customEmbedTool;
  } else if (activeTool?.kind === "custom_process") {
    content = customProcessTool;
  } else if (activeTool?.kind === "extension") {
    const extension = installedExtensions.find((item) => item.id === activeTool.extensionId);
    content =
      activeProject && extension && activeTool.extensionToolId ? (
        <ExtensionToolSurface
          key={`${activeProject.id}:${extension.id}:${activeTool.extensionToolId}`}
          label={activeTool.label}
          input={{
            projectId: activeProject.id,
            extensionId: extension.id,
            toolId: activeTool.extensionToolId,
            profileId: extensionProfileForProject(extension.assignment, activeProject.id),
          }}
        />
      ) : null;
  } else {
    content = browserTool;
  }

  const shouldAnimateReactSurface =
    threadsHydrated &&
    !isEmbeddedWorkspacePending &&
    Boolean(activeProject && activeTool) &&
    activeTool?.kind !== "code" &&
    activeTool?.kind !== "browser" &&
    activeTool?.kind !== "custom_embed" &&
    !isSettingsSurfaceActive;
  const renderedContent = shouldAnimateReactSurface ? (
    <div
      key={`${activeProject?.id ?? "none"}:${activeTool?.id ?? "none"}`}
      className="tabs-surface-enter flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      {content}
    </div>
  ) : (
    content
  );

  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <CloneRepositoryDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onCloned={handleClonedRepository}
      />
      {!threadsHydrated || shouldHideShellChrome ? null : (
        <ProjectTabs
          projects={projects}
          openProjects={openProjects}
          activeProjectId={activeProject?.id ?? null}
          pendingTabIds={pendingTabIds}
          activePendingTabId={activePendingTabId}
          threads={threads}
          onActivateProject={(projectId) => void focusProject(projectId)}
          onCloseProject={(projectId) => {
            const wasActive = workspaceState.session.activeProjectId === projectId;
            void requestCloseProject(projectId).then((closed) => {
              if (!closed || !wasActive) return;
              const remainingProjectIds = workspaceState.session.openProjectIds.filter(
                (id) => id !== projectId,
              );
              const fallbackProjectId = remainingProjectIds[remainingProjectIds.length - 1] ?? null;
              if (fallbackProjectId) {
                void focusProject(fallbackProjectId);
              } else {
                void navigate({ to: "/" });
              }
            });
          }}
          onNewTab={() => {
            const pendingId = randomUUID();
            openPendingTab(pendingId);
            void navigate({ to: "/" });
          }}
          onActivatePendingTab={(pendingId) => {
            openPendingTab(pendingId);
            void navigate({ to: "/" });
          }}
          onClosePendingTab={(pendingId) => {
            closePendingTab(pendingId);
          }}
          showSettings={
            !isSettingsSurfaceActive && Boolean(activeProject) && availableTools.length <= 1
          }
          onOpenSettings={openSettings}
        />
      )}

      {!shouldHideShellChrome &&
      !isSettingsSurfaceActive &&
      activeProject &&
      availableTools.length >= 2 ? (
        <ProjectToolBar
          activeToolId={activeTool?.id ?? ""}
          availableTools={availableTools}
          threads={threads}
          activeProjectId={activeProject?.id ?? null}
          onSelectTool={(toolId) => void handleSelectTool(toolId)}
          onOpenSettings={openSettings}
        />
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ToolErrorBoundary
          resetKey={`${activeProject?.environmentId ?? "none"}:${activeProject?.id ?? "none"}:${activeTool?.id ?? "none"}`}
        >
          {renderedContent}
        </ToolErrorBoundary>
      </div>

      {!shouldHideShellChrome &&
      activeTool?.kind === "git" &&
      activeProject &&
      gitTerminalThreadId &&
      gitTerminalState?.terminalOpen ? (
        <ThreadTerminalDrawer
          key={gitTerminalThreadId}
          threadId={gitTerminalThreadId}
          cwd={activeProject.cwd}
          runtimeEnv={projectScriptRuntimeEnv({
            project: { cwd: activeProject.cwd },
            worktreePath: null,
          })}
          height={gitTerminalState.terminalHeight}
          terminalIds={gitTerminalState.terminalIds}
          activeTerminalId={gitTerminalState.activeTerminalId}
          terminalGroups={gitTerminalState.terminalGroups}
          activeTerminalGroupId={gitTerminalState.activeTerminalGroupId}
          focusRequestId={shellTerminalFocusRequestId}
          terminalLabels={gitTerminalState.terminalLabels}
          onSplitTerminal={splitGitTerminal}
          onNewTerminal={createNewGitTerminal}
          onActiveTerminalChange={activateGitTerminal}
          onCloseTerminal={closeGitTerminal}
          onHeightChange={setGitTerminalHeight}
          onAddTerminalContext={() => {}}
        />
      ) : null}
    </div>
  );
}

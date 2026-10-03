import {
  type ApprovalRequestId,
  type ClaudeCodeEffort,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ModelSlug,
  type ProviderKind,
  type ProjectEntry,
  type ProviderApprovalDecision,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type EditorId,
  EnvironmentId,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  type ThreadId,
  type TurnId,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  RuntimeMode,
  DEFAULT_MODEL,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
  type ProviderOptionSelection,
  type PreviewAnnotationPayload,
  type ServerProviderSkill,
  type AssistantCitation,
} from "@tabs/contracts";
import {
  formatProviderSkillDisplayName,
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@tabs/client-runtime/providerSkills";
import { searchProviderSkills } from "../providerSkillSearch";
import {
  applyClaudePromptEffortPrefix,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
} from "@tabs/shared/model";
import { resolveThreadCurrentPullRequest } from "@tabs/shared/threadPullRequests";
import { useAtomValue } from "@effect/atom-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectUiStateKey, useProjectAgentsState } from "~/state/scopedStateStore";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate, useSearch, useLocation } from "@tanstack/react-router";
import { gitBranchesQueryOptions, gitCreateWorktreeMutationOptions } from "~/lib/gitReactQuery";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { isElectron } from "../env";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  parseStandaloneComposerSlashCommand,
  replaceTextRange,
} from "../composer-logic";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  deriveActiveTaskNodes,
  deriveTaskGroups,
  deriveLatestTaskDescription,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  formatElapsed,
  type ProviderPickerKind,
} from "../session-logic";
import { isScrollContainerNearBottom } from "../chat-scroll";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import {
  markThreadVisitedInAtoms,
  setThreadBranchInAtoms,
  setThreadErrorInAtoms,
  syncServerReadModelToAtoms,
} from "../state/readModel";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  proposedPlanTitle,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import { truncateTitle } from "../truncateTitle";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type TurnDiffSummary,
} from "../types";
import { basenameOfPath } from "../vscode-icons";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useConfirm } from "~/hooks/useConfirm";
import BranchToolbar from "./BranchToolbar";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import PlanSidebar from "./PlanSidebar";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import {
  ArchiveIcon,
  BookmarkIcon,
  BookmarkPlusIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  FileTextIcon,
  ImageIcon,
  ListOrderedIcon,
  ListTodoIcon,
  LockIcon,
  LockOpenIcon,
  MousePointer2Icon,
  PaperclipIcon,
  PenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMessageQueueStore, getThreadQueuedMessages } from "../stores/messageQueueStore";
import { useRightPanelStore, type RightPanelTab } from "../stores/rightPanelStore";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { AppleTimePicker } from "./ui/AppleTimePicker";
import { cn, isMacPlatform, randomUUID } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { toastManager } from "./ui/toast";
import { isSettled } from "../state/threadLifecycle";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptIdFromCommand,
  setupProjectScript,
} from "~/projectScripts";
import { SidebarTrigger } from "./ui/sidebar";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { environmentApi } from "~/connection/environmentApiRegistry";
import {
  getProviderModelCapabilities,
  getProviderModels,
  resolveSelectableProvider,
} from "../providerModels";
import { useSettings } from "../hooks/useSettings";
import { makeAppModelSelection, resolveAppModelSelection } from "../modelSelection";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  type ComposerImageAttachment,
  type ComposerFileAttachment,
  type DraftThreadEnvMode,
  type PersistedComposerImageAttachment,
  hydrateImagesFromPersisted,
  useComposerDraftStore,
  useEffectiveComposerModelState,
} from "../composerDraftStore";
import {
  composerDraftActions,
  createScopedComposerDraftActions,
  composerDraftsAtom,
  scopedComposerThreadId,
  useComposerDraft,
  useDraftThread,
} from "../state/composerDrafts";
import {
  partitionStashAttachments,
  promptStashSnippet,
  usePromptStashStore,
} from "../promptStashStore";
import { ComposerStashBadge } from "./chat/ComposerStashBadge";
import { ComposerStashMenu } from "./chat/ComposerStashMenu";
import { appAtomRegistry } from "../state/atomRegistry";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import { deriveLatestContextWindowSnapshot } from "../lib/contextWindow";
import { shouldUseCompactComposerFooter } from "./composerFooterLayout";
import { terminalActions, useThreadTerminalState } from "../state/terminal";
import { projectsAtom, threadsAtom } from "../state/threads";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import { ComposerPromptLengthValidation } from "./chat/ComposerPromptLengthValidation";
import { getComposerPromptLengthValidationMessage } from "./chat/composerSubmission";
import { appendReviewCommentsToPrompt, type ReviewCommentContext } from "~/reviewCommentContext";
import { ComposerPendingReviewComments } from "./chat/ComposerPendingReviewComments";
import {
  appendPreviewAnnotationPrompt,
  PREVIEW_ANNOTATION_PICKED_EVENT,
  previewAnnotationScreenshotFile,
  type PreviewAnnotationPickedDetail,
} from "../lib/previewAnnotation";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { assistantCitationFromLocation } from "~/lib/assistantCitationNavigation";
import { type AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { formatAssistantCitationForComposer } from "~/composer-logic";
import { ChatHeader } from "./chat/ChatHeader";
import { ContextWindowMeter } from "./chat/ContextWindowMeter";
import {
  isCompactCommandMessage,
  providerSupportsManualCompaction,
} from "./chat/ContextWindowMeter.logic";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { AVAILABLE_PROVIDER_OPTIONS, ProviderModelPicker } from "./chat/ProviderModelPicker";
import { FusedModelPicker } from "./chat/FusedModelPicker";
import { ComposerCommandItem, ComposerCommandMenu } from "./chat/ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./chat/ComposerPendingApprovalActions";
import { CompactComposerControlsMenu } from "./chat/CompactComposerControlsMenu";
import { ComposerPendingApprovalPanel } from "./chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./chat/ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./chat/ComposerPlanFollowUpBanner";
import { TaskListPanel } from "./chat/TaskListPanel";
import { getComposerProviderState } from "./chat/composerProviderRegistry";
import { TraitsMenuContent, TraitsPicker } from "./chat/TraitsPicker";

function renderProviderTraitsMenuContent(input: {
  provider: ProviderKind;
  threadId: ThreadId;
  model: ModelSlug;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  return (
    <TraitsMenuContent
      provider={input.provider}
      models={input.models}
      threadId={input.threadId}
      model={input.model}
      modelOptions={input.modelOptions}
      prompt={input.prompt}
      onPromptChange={input.onPromptChange}
    />
  );
}

function renderProviderTraitsPicker(input: {
  provider: ProviderKind;
  threadId: ThreadId;
  model: ModelSlug;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  return (
    <TraitsPicker
      provider={input.provider}
      models={input.models}
      threadId={input.threadId}
      model={input.model}
      modelOptions={input.modelOptions}
      prompt={input.prompt}
      onPromptChange={input.onPromptChange}
    />
  );
}
import {
  getProviderStatusBannerKey,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./chat/ProviderStatusBanner";
import { ThreadErrorBanner } from "./chat/ThreadErrorBanner";
import {
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  buildTemporaryWorktreeBranchName,
  cloneComposerImageForRetry,
  collectUserMessageBlobPreviewUrls,
  deriveComposerSendState,
  isPaintOnlyThreadTimeline,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  peekHeldThreadTimeline,
  peekRememberedThreadScrollTop,
  peekRememberedThreadTimeline,
  PullRequestDialogState,
  readFileAsDataUrl,
  rememberReadyThreadTimeline,
  rememberThreadScrollTop,
  resolveBaseComposerPlaceholder,
  resolveThreadSwitchTimeline,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  SendPhase,
  shouldPauseAutoScrollOnUserScrollIntent,
  shouldUseCenteredEmptyComposer,
  timelineHasEphemeralPreviewUrls,
} from "./ChatView.logic";
import { scopedThreadKey, scopeThreadRef } from "@tabs/client-runtime/environment";
import { useLocalStorage } from "~/hooks/useLocalStorage";

const noop = () => {};

const ATTACHMENT_PREVIEW_HANDOFF_TTL_MS = 5000;
const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;
const FILE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_FILE_BYTES / (1024 * 1024))}MB`;
const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";
const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_AVAILABLE_EDITORS: EditorId[] = [];
const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_SKILLS: ServerProviderSkill[] = [];
const EMPTY_PROVIDER_SLASH_COMMANDS: ServerProviderSlashCommand[] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const EMPTY_MAP = new Map();

function formatOutgoingPrompt(params: {
  provider: ProviderKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeCodeEffort | null);
  }
  return params.text;
}
const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

interface ChatViewProps {
  environmentId?: EnvironmentId;
  threadId: ThreadId;
  /**
   * Compact embed mode (the Code-tab AI side chat): hides the top toolbar
   * (project/branch picker, GitHub, terminal, diff) — that chrome belongs to the
   * full Agents tab. The conversation + composer stay.
   */
  compact?: boolean;
  /**
   * Compact-mode thread router. When the embed needs to switch the rendered
   * thread (e.g. a draft was promoted to a new thread id), it calls this instead
   * of navigating the app to the `/$threadId` route. This keeps the side chat in
   * the Code tab and decoupled from the Agents tab — so it keeps working even
   * when the Agents tool is toggled off in settings (its route would be hidden).
   * Ignored unless `compact` is set; the full Agents tab navigates as normal.
   */
  onRequestThread?: (threadId: ThreadId) => void;
  isActivePane?: boolean | undefined;
  onActivatePane?: (() => void) | undefined;
  onToggleDiff?: (() => void) | undefined;
  diffOpen?: boolean | undefined;
  isSplitActive?: boolean | undefined;
  isMaximized?: boolean | undefined;
  onToggleMaximize?: (() => void) | undefined;
  onClosePane?: (() => void) | undefined;
}

export default function ChatView({
  environmentId,
  threadId,
  compact = false,
  onRequestThread,
  isActivePane = true,
  onActivatePane,
  onToggleDiff: propOnToggleDiff,
  diffOpen: propDiffOpen,
  isSplitActive = false,
  isMaximized = false,
  onToggleMaximize,
  onClosePane,
}: ChatViewProps) {
  const [threadApi, setThreadApi] = useState<Awaited<ReturnType<typeof environmentApi>> | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    setThreadApi(null);
    void environmentApi(environmentId).then((api) => {
      if (active) setThreadApi(api);
    });
    return () => {
      active = false;
    };
  }, [environmentId]);
  const { confirm, confirmDialog } = useConfirm();
  const threads = useAtomValue(threadsAtom);
  const projects = useAtomValue(projectsAtom);
  const markThreadVisited = markThreadVisitedInAtoms;
  const syncServerReadModel = syncServerReadModelToAtoms;
  const setStoreThreadError = setThreadErrorInAtoms;
  const setStoreThreadBranch = setThreadBranchInAtoms;
  const settings = useSettings();
  const setStickyComposerModelSelection = composerDraftActions.setStickyModelSelection;
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  // Route to a thread. In the full Agents tab this navigates the app to the
  // thread's `/$threadId` route; in the compact Code-tab side chat it asks the
  // host to swap the rendered thread instead, so the embed never leaves the Code
  // tab and never depends on the Agents route (which can be hidden via the
  // project's tool-visibility settings).
  const routeToThread = useCallback(
    (nextThreadId: ThreadId): Promise<unknown> | void => {
      if (compact) {
        onRequestThread?.(nextThreadId);
        return;
      }
      if (!environmentId) return;
      return navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: nextThreadId },
      });
    },
    [compact, environmentId, navigate, onRequestThread],
  );
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const composerDraft = useComposerDraft(threadId, environmentId);
  const prompt = composerDraft.prompt;
  const composerImages = composerDraft.images;
  const composerFiles = composerDraft.files;
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerPreviewAnnotations = composerDraft.previewAnnotations;
  const composerReviewComments = composerDraft.reviewComments;
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length,
        fileCount: composerFiles.length,
        contextCount: composerPreviewAnnotations.length + composerReviewComments.length,
        terminalContexts: composerTerminalContexts,
      }),
    [
      composerFiles.length,
      composerImages.length,
      composerPreviewAnnotations.length,
      composerReviewComments.length,
      composerTerminalContexts,
      prompt,
    ],
  );
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
  const {
    setPrompt: setComposerDraftPrompt,
    setModelSelection: setComposerDraftModelSelection,
    setRuntimeMode: setComposerDraftRuntimeMode,
    setInteractionMode: setComposerDraftInteractionMode,
    addImage: addComposerDraftImage,
    addImages: addComposerDraftImages,
    removeImage: removeComposerDraftImage,
    addFiles: addComposerDraftFiles,
    removeFile: removeComposerDraftFile,
    insertTerminalContext: insertComposerDraftTerminalContext,
    addTerminalContexts: addComposerDraftTerminalContexts,
    removeTerminalContext: removeComposerDraftTerminalContext,
    setTerminalContexts: setComposerDraftTerminalContexts,
    addPreviewAnnotation: addComposerDraftPreviewAnnotation,
    setPreviewAnnotations: setComposerDraftPreviewAnnotations,
    removePreviewAnnotation: removeComposerDraftPreviewAnnotation,
    addReviewComment: addComposerDraftReviewComment,
    setReviewComments: setComposerDraftReviewComments,
    removeReviewComment: removeComposerDraftReviewComment,
    clearPersistedAttachments: clearComposerDraftPersistedAttachments,
    syncPersistedAttachments: syncComposerDraftPersistedAttachments,
    clearComposerContent: clearComposerDraftContent,
    setDraftThreadContext,
    getDraftThreadByProjectId,
    getDraftThread,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
    setProviderModelOptions: setComposerProviderModelOptions,
  } = useMemo(
    () => (environmentId ? createScopedComposerDraftActions(environmentId) : composerDraftActions),
    [environmentId],
  );
  const draftThread = useDraftThread(threadId, environmentId);
  const promptRef = useRef(prompt);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>(composerTerminalContexts);
  const composerReviewCommentsRef = useRef<ReviewCommentContext[]>(composerReviewComments);
  useEffect(() => {
    composerReviewCommentsRef.current = composerReviewComments;
  }, [composerReviewComments]);
  const [localDraftErrorsByThreadId, setLocalDraftErrorsByThreadId] = useState<
    Record<ThreadId, string | null>
  >({});
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [submissionValidationMessage, setSubmissionValidationMessage] = useState<string | null>(
    null,
  );
  const [sendStartedAt, setSendStartedAt] = useState<string | null>(null);
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const activeProjectId =
    threads.find(
      (candidate) =>
        candidate.id === threadId &&
        (environmentId === undefined || candidate.environmentId === environmentId),
    )?.projectId ??
    draftThread?.projectId ??
    projects.find(
      (candidate) => environmentId === undefined || candidate.environmentId === environmentId,
    )?.id ??
    "";
  const [agentsState, setAgentsState] = useProjectAgentsState(
    projectUiStateKey(environmentId, activeProjectId),
  );
  const pendingUserInputAnswersByRequestId =
    (agentsState.pendingUserInputAnswersByRequestId as Record<
      string,
      Record<string, PendingUserInputDraftAnswer>
    >) ?? {};
  const setPendingUserInputAnswersByRequestId = useCallback(
    (
      updater:
        | Record<string, Record<string, PendingUserInputDraftAnswer>>
        | ((
            prev: Record<string, Record<string, PendingUserInputDraftAnswer>>,
          ) => Record<string, Record<string, PendingUserInputDraftAnswer>>),
    ) => {
      setAgentsState((prev) => ({
        pendingUserInputAnswersByRequestId:
          typeof updater === "function"
            ? updater(
                (prev.pendingUserInputAnswersByRequestId as Record<
                  string,
                  Record<string, PendingUserInputDraftAnswer>
                >) ?? {},
              )
            : updater,
      }));
    },
    [setAgentsState],
  );
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const expandedWorkGroups = agentsState.expandedWorkGroups;
  const setExpandedWorkGroups = useCallback(
    (
      updater:
        | Record<string, boolean>
        | ((prev: Record<string, boolean>) => Record<string, boolean>),
    ) => {
      setAgentsState((prev) => ({
        expandedWorkGroups:
          typeof updater === "function" ? updater(prev.expandedWorkGroups) : updater,
      }));
    },
    [setAgentsState],
  );
  const planSidebarOpen = agentsState.planSidebarOpen;
  const setPlanSidebarOpen = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setAgentsState((prev) => ({
        planSidebarOpen: typeof updater === "function" ? updater(prev.planSidebarOpen) : updater,
      }));
    },
    [setAgentsState],
  );
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the thread-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new thread" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(prompt, prompt.length),
  );
  const [, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [messagesScrollElement, setMessagesScrollElement] = useState<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastKnownScrollTopRef = useRef(0);
  const isPointerScrollActiveRef = useRef(false);
  const lastTouchClientYRef = useRef<number | null>(null);
  const pendingUserScrollUpIntentRef = useRef(false);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingInteractionAnchorRef = useRef<{
    element: HTMLElement;
    top: number;
  } | null>(null);
  const pendingInteractionAnchorFrameRef = useRef<number | null>(null);
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerCardRef = useRef<HTMLDivElement>(null);
  const composerFooterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerFormHeightRef = useRef(0);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<Record<string, number>>({});
  const sendInFlightRef = useRef(false);
  const dragDepthRef = useRef(0);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});
  const setMessagesScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    messagesScrollRef.current = element;
    setMessagesScrollElement(element);
  }, []);

  const terminalState = useThreadTerminalState(threadId)!;
  const storeSetTerminalOpen = terminalActions.setOpen;
  const storeSetTerminalHeight = terminalActions.setHeight;
  const storeSplitTerminal = terminalActions.split;
  const storeNewTerminal = terminalActions.new;
  const storeSetActiveTerminal = terminalActions.setActive;
  const storeCloseTerminal = terminalActions.close;

  const setPrompt = useCallback(
    (nextPrompt: string) => {
      setComposerDraftPrompt(threadId, nextPrompt);
    },
    [setComposerDraftPrompt, threadId],
  );
  const [isStashMenuOpen, setIsStashMenuOpen] = useState(false);
  const [stashPulsing, setStashPulsing] = useState(false);
  const stashPulseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (stashPulseTimeoutRef.current !== null) {
        window.clearTimeout(stashPulseTimeoutRef.current);
      }
    };
  }, []);

  const pulseStashBadge = useCallback(() => {
    setStashPulsing(true);
    if (stashPulseTimeoutRef.current !== null) {
      window.clearTimeout(stashPulseTimeoutRef.current);
    }
    stashPulseTimeoutRef.current = window.setTimeout(() => {
      stashPulseTimeoutRef.current = null;
      setStashPulsing(false);
    }, 1200);
  }, []);

  const promptStashEntries = usePromptStashStore((state) => state.entries);
  const stashPrompt = usePromptStashStore((state) => state.stashEntry);
  const takeStashedPrompt = usePromptStashStore((state) => state.take);
  const removeStashedPrompt = usePromptStashStore((state) => state.remove);
  const clearPromptStash = usePromptStashStore((state) => state.clear);

  const queueByThread = useMessageQueueStore((state) => state.queueByThread);
  const enqueueMessage = useMessageQueueStore((state) => state.enqueueMessage);
  const dequeueMessage = useMessageQueueStore((state) => state.dequeueMessage);
  const peekNextMessage = useMessageQueueStore((state) => state.peekNextMessage);
  const peekNextReadyMessage = useMessageQueueStore((state) => state.peekNextReadyMessage);
  const dequeueNextReadyMessage = useMessageQueueStore((state) => state.dequeueNextReadyMessage);
  const clearThreadQueue = useMessageQueueStore((state) => state.clearQueue);
  const threadQueuedMessages = getThreadQueuedMessages(queueByThread, threadId);
  const [isSchedulePopoverOpen, setIsSchedulePopoverOpen] = useState(false);
  const [isIdleSchedulePopoverOpen, setIsIdleSchedulePopoverOpen] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const interruptAttemptedAtRef = useRef<number | null>(null);
  const stuckTimerRef = useRef<number | null>(null);

  const openRightPanelSurface = useCallback(
    (surface: RightPanelTab) => {
      if (compact || !environmentId) return;
      useRightPanelStore.getState().setActiveTab(surface);
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        replace: true,
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return { ...rest, diff: "1" };
        },
      });
    },
    [compact, environmentId, navigate, threadId],
  );

  const stashCurrentPrompt = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed && composerImages.length === 0 && composerFiles.length === 0) {
      if (promptStashEntries.length === 1 && promptStashEntries[0]) {
        await restoreStashedPrompt(promptStashEntries[0].id);
      } else {
        openRightPanelSurface("stash");
      }
      return false;
    }

    try {
      const candidateAttachments = await Promise.all(
        composerImages.map(async (image) => ({
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          dataUrl: await readFileAsDataUrl(image.file),
        })),
      );

      const { kept, droppedNames } = partitionStashAttachments(candidateAttachments);

      const stashedFiles = composerFiles.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        ...(environmentId ? { environmentId } : {}),
      }));

      const entryId = randomUUID();
      const { evicted, written, durable } = stashPrompt({
        id: entryId,
        createdAt: new Date().toISOString(),
        prompt,
        attachments: kept,
        ...(stashedFiles.length > 0 ? { files: stashedFiles } : {}),
        ...(environmentId ? { environmentId } : {}),
        threadId,
        droppedImageNames: droppedNames,
      });

      if (!written) {
        toastManager.add({
          type: "error",
          title: "Could not stash prompt",
          description: "Storage quota exceeded or browser storage blocked.",
        });
        return false;
      }

      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Stashed prompt will not survive a reload",
          description: "Browser storage is unavailable; stash is kept in memory for this session.",
        });
      }

      clearComposerDraftContent(threadId);
      promptRef.current = "";
      setComposerCursor(0);
      setComposerTrigger(null);
      pulseStashBadge();

      toastManager.add({
        type: "success",
        title: "Prompt stashed",
        description: evicted
          ? "Saved this prompt and discarded the oldest stash entry."
          : "You can restore it from the stash menu.",
      });
      return true;
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not stash prompt",
        description: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  }, [
    clearComposerDraftContent,
    composerFiles,
    composerImages,
    environmentId,
    prompt,
    promptStashEntries,
    pulseStashBadge,
    stashPrompt,
    threadId,
  ]);

  const restoreStashedPrompt = useCallback(
    async (entryId: string) => {
      const targetEntry = promptStashEntries.find((candidate) => candidate.id === entryId);
      if (
        targetEntry?.environmentId &&
        environmentId &&
        targetEntry.environmentId !== environmentId
      ) {
        toastManager.add({
          type: "warning",
          title: "Stashed prompt belongs to another environment",
          description: `This prompt was stashed under environment "${targetEntry.environmentId}".`,
        });
      }

      if (prompt.trim() || composerImages.length > 0 || composerFiles.length > 0) {
        const stashed = await stashCurrentPrompt();
        if (!stashed) return;
      }

      const entry = takeStashedPrompt(entryId);
      if (!entry) return;

      setIsStashMenuOpen(false);
      clearComposerDraftContent(threadId);
      setPrompt(entry.prompt);
      const restoredImages = hydrateImagesFromPersisted(entry.attachments);
      if (restoredImages.length > 0) addComposerDraftImages(threadId, restoredImages);
      promptRef.current = entry.prompt;
      const cursor = collapseExpandedComposerCursor(entry.prompt, entry.prompt.length);
      setComposerCursor(cursor);
      setComposerTrigger(null);
      window.requestAnimationFrame(() => composerEditorRef.current?.focusAtEnd());
    },
    [
      addComposerDraftImages,
      clearComposerDraftContent,
      composerFiles.length,
      composerImages.length,
      environmentId,
      prompt,
      promptStashEntries,
      setPrompt,
      stashCurrentPrompt,
      takeStashedPrompt,
      threadId,
    ],
  );

  const clearAllStashedPrompts = useCallback(() => {
    clearPromptStash(environmentId ?? undefined);
    setIsStashMenuOpen(false);
    toastManager.add({
      type: "info",
      title: "Stash cleared",
      description: "All stashed prompts have been removed.",
    });
  }, [clearPromptStash, environmentId]);

  const onQueueMessage = useCallback(
    (scheduledFor?: string | null) => {
      if (!threadId) return;
      const promptForQueue = promptRef.current;
      const {
        trimmedPrompt: trimmed,
        sendableTerminalContexts,
        hasSendableContent,
      } = deriveComposerSendState({
        prompt: promptForQueue,
        imageCount: composerImages.length,
        fileCount: composerFiles.length,
        contextCount: composerPreviewAnnotations.length,
        terminalContexts: composerTerminalContexts,
      });

      if (!hasSendableContent) return;

      enqueueMessage({
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        threadId,
        environmentId,
        text: trimmed,
        terminalContextIds: sendableTerminalContexts.map((c) => c.id),
        createdAt: new Date().toISOString(),
        scheduledFor: scheduledFor ?? undefined,
      });

      // Reset composer
      promptRef.current = "";
      setPrompt("");
      clearComposerDraftContent(threadId);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);

      toastManager.add({
        type: "info",
        title: scheduledFor ? "Message scheduled" : "Message queued",
        description: scheduledFor
          ? `Will dispatch on ${new Date(scheduledFor).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
          : "Will send automatically when the active turn completes.",
      });
    },
    [
      clearComposerDraftContent,
      composerFiles.length,
      composerImages.length,
      composerPreviewAnnotations.length,
      composerTerminalContexts,
      enqueueMessage,
      environmentId,
      setPrompt,
      threadId,
    ],
  );
  const addComposerImage = useCallback(
    (image: ComposerImageAttachment) => {
      addComposerDraftImage(threadId, image);
    },
    [addComposerDraftImage, threadId],
  );
  const addComposerImagesToDraft = useCallback(
    (images: ComposerImageAttachment[]) => {
      addComposerDraftImages(threadId, images);
    },
    [addComposerDraftImages, threadId],
  );
  const addComposerTerminalContextsToDraft = useCallback(
    (contexts: TerminalContextDraft[]) => {
      addComposerDraftTerminalContexts(threadId, contexts);
    },
    [addComposerDraftTerminalContexts, threadId],
  );
  const removeComposerImageFromDraft = useCallback(
    (imageId: string) => {
      removeComposerDraftImage(threadId, imageId);
    },
    [removeComposerDraftImage, threadId],
  );
  const addComposerFilesToDraft = useCallback(
    (files: ComposerFileAttachment[]) => {
      addComposerDraftFiles(threadId, files);
    },
    [addComposerDraftFiles, threadId],
  );
  const removeComposerFileFromDraft = useCallback(
    (fileId: string) => {
      removeComposerDraftFile(threadId, fileId);
    },
    [removeComposerDraftFile, threadId],
  );
  const removeComposerTerminalContextFromDraft = useCallback(
    (contextId: string) => {
      const contextIndex = composerTerminalContexts.findIndex(
        (context) => context.id === contextId,
      );
      if (contextIndex < 0) {
        return;
      }
      const nextPrompt = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
      promptRef.current = nextPrompt.prompt;
      setPrompt(nextPrompt.prompt);
      removeComposerDraftTerminalContext(threadId, contextId);
      setComposerCursor(nextPrompt.cursor);
      setComposerTrigger(
        detectComposerTrigger(
          nextPrompt.prompt,
          expandCollapsedComposerCursor(nextPrompt.prompt, nextPrompt.cursor),
        ),
      );
    },
    [composerTerminalContexts, removeComposerDraftTerminalContext, setPrompt, threadId],
  );

  const serverThread = threads.find(
    (thread) =>
      thread.id === threadId &&
      (environmentId === undefined || thread.environmentId === environmentId),
  );
  const fallbackDraftProject = projects.find(
    (project) =>
      project.id === draftThread?.projectId &&
      (environmentId === undefined || project.environmentId === environmentId),
  );
  const localDraftError = serverThread ? null : (localDraftErrorsByThreadId[threadId] ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ??
              makeAppModelSelection("codex", DEFAULT_MODEL),
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId],
  );
  const activeThread = serverThread ?? localDraftThread;
  const activeLifecycle = activeThread ?? null;
  const activeThreadIsSettled = Boolean(
    activeThread &&
    activeLifecycle &&
    isSettled(activeLifecycle, activeThread.updatedAt ?? activeThread.createdAt),
  );
  const runtimeMode =
    composerDraft.runtimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerDraft.interactionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isServerThread = serverThread !== undefined;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const diffOpen = propDiffOpen !== undefined ? propDiffOpen : rawSearch.diff === "1";
  const activeThreadId = activeThread?.id ?? null;
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(activeThread?.activities ?? []),
    [activeThread?.activities],
  );
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);

  const citationLocation = useLocation({
    select: (location) => ({
      href: location.href,
      key:
        (location.state as unknown as Record<string, unknown> | undefined)
          ?.assistantCitationActivation ??
        (location.state as unknown as Record<string, unknown> | undefined)?.__TSR_key,
    }),
  });
  const resolvedEnvironmentId =
    environmentId ?? activeThread?.environmentId ?? EnvironmentId.make("local");
  const citationRequest = useMemo<AssistantCitationRequest | null>(() => {
    const citation = assistantCitationFromLocation(citationLocation.href);
    return citation &&
      citation.environmentId === resolvedEnvironmentId &&
      citation.threadId === activeThread?.id
      ? { citation, key: String(citationLocation.key ?? citationLocation.href) }
      : null;
  }, [citationLocation.href, citationLocation.key, resolvedEnvironmentId, activeThread?.id]);
  const activeProject = projects.find(
    (project) =>
      project.id === activeThread?.projectId &&
      (activeThread?.environmentId === undefined ||
        project.environmentId === activeThread.environmentId),
  );
  const createWorktreeMutation = useMutation(
    gitCreateWorktreeMutationOptions({
      queryClient,
      environmentId: activeProject?.environmentId,
    }),
  );

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
      setComposerHighlightedItemId(null);
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const storedDraftThread = getDraftThreadByProjectId(activeProject.id);
      if (storedDraftThread) {
        setDraftThreadContext(storedDraftThread.threadId, input);
        setProjectDraftThreadId(activeProject.id, storedDraftThread.threadId, input);
        if (storedDraftThread.threadId !== threadId) {
          await routeToThread(storedDraftThread.threadId);
        }
        return;
      }

      const activeDraftThread = getDraftThread(threadId);
      if (!isServerThread && activeDraftThread?.projectId === activeProject.id) {
        setDraftThreadContext(threadId, input);
        setProjectDraftThreadId(activeProject.id, threadId, input);
        return;
      }

      clearProjectDraftThreadId(activeProject.id);
      const nextThreadId = newThreadId();
      setProjectDraftThreadId(activeProject.id, nextThreadId, {
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await routeToThread(nextThreadId);
    },
    [
      activeProject,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      routeToThread,
      isServerThread,
      navigate,
      setDraftThreadContext,
      setProjectDraftThreadId,
      threadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftThread],
  );

  useEffect(() => {
    if (!activeThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThread.lastVisitedAt ? Date.parse(activeThread.lastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(activeThread.id, undefined, environmentId);
  }, [
    activeThread?.id,
    activeThread?.lastVisitedAt,
    activeLatestTurn?.completedAt,
    latestTurnSettled,
    markThreadVisited,
    environmentId,
  ]);

  const sessionProvider = activeThread?.session?.provider ?? null;
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const hasThreadStarted = Boolean(
    activeThread &&
    (activeThread.latestTurn !== null ||
      activeThread.messages.length > 0 ||
      activeThread.session !== null),
  );
  const lockedProvider: ProviderKind | null = hasThreadStarted
    ? ((sessionProvider ??
        threadProvider ??
        selectedProviderByThreadId ??
        null) as ProviderKind | null)
    : null;
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = serverConfigQuery.data?.providers ?? EMPTY_PROVIDERS;
  // For new threads, default to the provider the user configured in Settings.
  const settingsDefaultProvider = settings.textGenerationModelSelection?.instanceId ?? "codex";
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? settingsDefaultProvider,
  );
  const selectedProvider: ProviderKind = (lockedProvider ??
    unlockedSelectedProvider) as ProviderKind;
  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId: environmentId ? scopedComposerThreadId(environmentId, threadId) : threadId,
    providers: providerStatuses,
    selectedProvider,
    threadModelSelection: activeThread?.modelSelection,
    projectModelSelection: activeProject?.defaultModelSelection,
    settings,
  });
  const selectedProviderModels = getProviderModels(providerStatuses, selectedProvider);
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        prompt,
        modelOptions: composerModelOptions?.[selectedProvider],
      }),
    [composerModelOptions, prompt, selectedModel, selectedProvider, selectedProviderModels],
  );
  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  const selectedModelSelection = useMemo<ModelSelection>(
    () => makeAppModelSelection(selectedProvider, selectedModel, selectedModelOptionsForDispatch),
    [selectedModel, selectedModelOptionsForDispatch, selectedProvider],
  );
  const selectedModelForPicker = selectedModel;

  // If the user manually removes the Ultrathink prefix from the prompt, revert the model selection
  // to avoid being stuck in an effort mode that doesn't match the prompt content.
  useEffect(() => {
    if (selectedPromptEffort === "ultrathink" && !isClaudeUltrathinkPrompt(prompt)) {
      const nextOptions = (composerModelOptions?.[selectedProvider] ?? []).filter(
        (o) => o.value !== "ultrathink",
      );
      setComposerDraftModelSelection(
        threadId,
        makeAppModelSelection(selectedProvider, selectedModel, nextOptions),
      );
    }
  }, [
    prompt,
    selectedPromptEffort,
    composerModelOptions,
    selectedProvider,
    selectedModel,
    threadId,
    setComposerDraftModelSelection,
  ]);

  const phase = derivePhase(activeThread?.session ?? null);
  const isSendBusy = sendPhase !== "idle";
  const isPreparingWorktree = sendPhase === "preparing-worktree";
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const pendingCompactionMessage =
    isSendBusy &&
    optimisticCompactionMessage !== undefined &&
    isCompactCommandMessage(optimisticCompactionMessage)
      ? optimisticCompactionMessage
      : activeThread?.messages.findLast(isCompactCommandMessage);
  const compactRequestIsActive =
    pendingCompactionMessage !== undefined &&
    (pendingCompactionMessage.createdAt >
      (activeLatestTurn?.requestedAt ?? pendingCompactionMessage.createdAt) ||
      (activeLatestTurn?.state === "running" &&
        pendingCompactionMessage.createdAt === activeLatestTurn.requestedAt));
  const compactionSettled =
    pendingCompactionMessage !== undefined &&
    Boolean(
      activeThread?.activities.some((activity) => {
        if (
          activity.kind !== "context-compaction" &&
          activity.kind !== "provider.turn.start.failed"
        ) {
          return false;
        }
        const payload = activity.payload as { readonly requestId?: unknown } | null | undefined;
        return payload?.requestId === pendingCompactionMessage.id;
      }),
    );
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    Boolean(compactRequestIsActive) &&
    !compactionSettled;
  const isWorking =
    phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint || isCompacting;
  const nowIso = new Date(nowTick).toISOString();
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    sendStartedAt,
  );
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, undefined),
    [threadActivities],
  );
  const activeTaskNodes = useMemo(
    () => deriveActiveTaskNodes(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const taskGroups = useMemo(() => deriveTaskGroups(threadActivities), [threadActivities]);
  const latestTaskDescription = useMemo(
    () => deriveLatestTaskDescription(activeTaskNodes),
    [activeTaskNodes],
  );
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activePendingAllowsCustomAnswer =
    activePendingProgress?.activeQuestion?.allowCustomAnswer !== false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
        ...(environmentId ? { environmentId } : {}),
      }),
    [activeLatestTurn, activeThread?.id, environmentId, latestTurnSettled, threads],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const isComposerApprovalState = activePendingApproval !== null;
  const hasComposerHeader =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (showPlanFollowUpPrompt && activeProposedPlan !== null);
  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);
  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      lastSyncedPendingInputRef.current = null;
      return;
    }
    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      detectComposerTrigger(
        nextCustomAnswer,
        expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
      ),
    );
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.customAnswer,
    activePendingUserInput?.requestId,
    activePendingProgress?.activeQuestion?.id,
  ]);
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const timeoutId of Object.values(attachmentPreviewHandoffTimeoutByMessageIdRef.current)) {
      window.clearTimeout(timeoutId);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrls.includes(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });

    const existingTimeout = attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    if (typeof existingTimeout === "number") {
      window.clearTimeout(existingTimeout);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId] = window.setTimeout(() => {
      const currentPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId];
      if (currentPreviewUrls) {
        for (const previewUrl of currentPreviewUrls) {
          revokeBlobPreviewUrl(previewUrl);
        }
      }
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) return existing;
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      delete attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    }, ATTACHMENT_PREVIEW_HANDOFF_TTL_MS);
  }, []);
  const serverMessages = activeThread?.messages;
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const activeEnvironmentId =
    environmentId ?? activeThread?.environmentId ?? EnvironmentId.make("local");
  const activeThreadKey = activeThreadId
    ? scopedThreadKey(scopeThreadRef(activeEnvironmentId, activeThreadId))
    : null;

  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(
        timelineMessages,
        activeThread?.proposedPlans ?? [],
        workLogEntries,
        taskGroups,
      ),
    [activeThread?.proposedPlans, taskGroups, timelineMessages, workLogEntries],
  );

  const threadDetailLoading =
    !isLocalDraftThread &&
    !activeThread?.error &&
    !localDraftError &&
    timelineEntries.length === 0 &&
    Boolean(activeThreadId);

  const displayedTimeline = resolveThreadSwitchTimeline({
    loading: threadDetailLoading,
    activeThreadKey,
    nextEntries: timelineEntries,
    rememberedForActive: peekRememberedThreadTimeline<typeof timelineEntries>(activeThreadKey),
  });
  const displayedTimelineKey = displayedTimeline.displayThreadKey ?? activeThreadKey;
  const paintOnlyDisplayedTimeline = isPaintOnlyThreadTimeline(
    displayedTimeline.displayThreadKey,
    activeThreadKey,
  );
  const heldPaintContext = paintOnlyDisplayedTimeline
    ? peekHeldThreadTimeline<typeof timelineEntries>()
    : null;
  const hasTimelineEntries = displayedTimeline.entries.length > 0;
  const hasConversationHistory = hasTimelineEntries || activeLatestTurn !== null;
  const baseComposerPlaceholder = resolveBaseComposerPlaceholder({
    hasConversationHistory,
    phase,
  });
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") {
          break;
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }

    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!completionSummary) return null;

    const turnStartedAt = Date.parse(activeLatestTurn.startedAt);
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnStartedAt)) return null;
    if (Number.isNaN(turnCompletedAt)) return null;

    let inRangeMatch: string | null = null;
    let fallbackMatch: string | null = null;
    for (const timelineEntry of timelineEntries) {
      if (timelineEntry.kind !== "message") continue;
      if (timelineEntry.message.role !== "assistant") continue;
      const messageAt = Date.parse(timelineEntry.message.createdAt);
      if (Number.isNaN(messageAt) || messageAt < turnStartedAt) continue;
      fallbackMatch = timelineEntry.id;
      if (messageAt <= turnCompletedAt) {
        inRangeMatch = timelineEntry.id;
      }
    }
    return inRangeMatch ?? fallbackMatch;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    completionSummary,
    latestTurnSettled,
    timelineEntries,
  ]);
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProject?.cwd ?? undefined;
  useLayoutEffect(() => {
    if (
      threadDetailLoading ||
      !activeThread ||
      timelineEntries.length === 0 ||
      timelineHasEphemeralPreviewUrls(timelineEntries)
    ) {
      return;
    }
    rememberReadyThreadTimeline({
      threadKey: activeThreadKey,
      entries: timelineEntries,
      markdownCwd: gitCwd ?? null,
      workspaceRoot: activeWorkspaceRoot ?? null,
    });
  }, [
    activeThread,
    activeThreadKey,
    activeWorkspaceRoot,
    gitCwd,
    threadDetailLoading,
    timelineEntries,
  ]);
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
    pathTriggerQuery,
    { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
  const branchesQuery = useQuery(gitBranchesQueryOptions(gitCwd));
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const availableEditors = serverConfigQuery.data?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;
  const modelOptionsByProvider = useMemo(() => {
    const result: Partial<
      Record<ProviderPickerKind, ReadonlyArray<{ slug: string; name: string }>>
    > = {};
    for (const option of AVAILABLE_PROVIDER_OPTIONS) {
      result[option.value] =
        providerStatuses.find((provider) => provider.instanceId === option.value)?.models ?? [];
    }
    return result;
  }, [providerStatuses]);
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const currentOptions = modelOptionsByProvider[selectedProvider] ?? [];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [modelOptionsByProvider, selectedModelForPicker, selectedProvider]);
  const searchableModelOptions = useMemo(
    () =>
      AVAILABLE_PROVIDER_OPTIONS.filter(
        (option) => lockedProvider === null || option.value === lockedProvider,
      ).flatMap((option) =>
        (modelOptionsByProvider[option.value] ?? []).map(({ slug, name }) => ({
          provider: option.value,
          providerLabel: option.label,
          slug,
          name,
          searchSlug: slug.toLowerCase(),
          searchName: name.toLowerCase(),
          searchProvider: option.label.toLowerCase(),
        })),
      ),
    [lockedProvider, modelOptionsByProvider],
  );
  const activeProviderStatus = useMemo(
    () =>
      providerStatuses.find(
        (status) => status.instanceId === selectedProvider || status.driver === selectedProvider,
      ) ?? null,
    [selectedProvider, providerStatuses],
  );
  const providerStatusBannerKey = getProviderStatusBannerKey(activeProviderStatus);
  const [dismissedProviderStatusBannerKey, setDismissedProviderStatusBannerKey] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (providerStatusBannerKey === null && dismissedProviderStatusBannerKey !== null) {
      setDismissedProviderStatusBannerKey(null);
    }
  }, [dismissedProviderStatusBannerKey, providerStatusBannerKey]);
  const visibleProviderStatus = shouldShowProviderStatusBanner(
    activeProviderStatus,
    dismissedProviderStatusBannerKey,
  )
    ? activeProviderStatus
    : null;
  const manualCompactionProviderAvailable = useMemo(() => {
    if (!activeProviderStatus) return false;
    return (
      providerSupportsManualCompaction(activeProviderStatus) ||
      selectedProvider === "codex" ||
      selectedProvider === "claudeAgent" ||
      selectedProvider === "opencode"
    );
  }, [activeProviderStatus, selectedProvider]);

  const activeThreadHasCompactableConversation = useMemo(
    () =>
      activeThread?.messages.some(
        (message) => message.role === "user" && !isCompactCommandMessage(message),
      ) ?? false,
    [activeThread?.messages],
  );

  const compactThreadUnavailable =
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    !manualCompactionProviderAvailable ||
    phase === "running" ||
    isSendBusy ||
    isConnecting ||
    isCompacting ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0 ||
    showPlanFollowUpPrompt;
  const compactDisabled = compactThreadUnavailable;
  const compactDisabledReason = compactDisabled
    ? !activeProject
      ? "Choose a project before compacting"
      : !manualCompactionProviderAvailable
        ? "Compaction is unavailable for this provider"
        : !activeThreadHasCompactableConversation
          ? "Start a conversation before compacting"
          : "Compacting is unavailable right now"
    : null;
  const selectedProviderSkills = useMemo(() => {
    if (!activeProviderStatus) return EMPTY_PROVIDER_SKILLS;
    return resolveProviderSkillsForCwd(activeProviderStatus, gitCwd);
  }, [activeProviderStatus, gitCwd]);

  const selectedProviderSlashCommands = useMemo(() => {
    if (!activeProviderStatus) return EMPTY_PROVIDER_SLASH_COMMANDS;
    return resolveProviderSlashCommandsForCwd(activeProviderStatus, gitCwd);
  }, [activeProviderStatus, gitCwd]);
  const workspaceProviderRefreshRef = useRef<{
    key: string;
    inFlight: boolean;
    retryAfter: number;
  } | null>(null);
  const hadWorkspaceProviderSnapshotRef = useRef(false);
  useEffect(() => {
    if (!threadApi || !activeProviderStatus || !gitCwd || !activeProviderStatus.enabled) return;
    const hasWorkspaceSnapshot = Boolean(
      activeProviderStatus.workspaceSnapshots?.some((snapshot) => snapshot.cwd === gitCwd),
    );
    if (hadWorkspaceProviderSnapshotRef.current && !hasWorkspaceSnapshot) {
      workspaceProviderRefreshRef.current = null;
    }
    hadWorkspaceProviderSnapshotRef.current = hasWorkspaceSnapshot;
    if (hasWorkspaceSnapshot) {
      return;
    }
    const key = `${activeProviderStatus.instanceId}:${gitCwd}`;
    const previousRefresh = workspaceProviderRefreshRef.current;
    if (
      previousRefresh?.key === key &&
      (previousRefresh.inFlight || previousRefresh.retryAfter > Date.now())
    ) {
      return;
    }
    workspaceProviderRefreshRef.current = { key, inFlight: true, retryAfter: 0 };
    void threadApi.server
      .refreshProviders({ instanceId: activeProviderStatus.instanceId, cwd: gitCwd })
      .then((payload) => {
        queryClient.setQueryData(
          serverQueryKeys.config(),
          (current: typeof serverConfigQuery.data) =>
            current ? { ...current, providers: payload.providers } : current,
        );
        const refreshed = payload.providers
          .find((provider) => provider.instanceId === activeProviderStatus.instanceId)
          ?.workspaceSnapshots?.some((snapshot) => snapshot.cwd === gitCwd);
        if (workspaceProviderRefreshRef.current?.key === key) {
          workspaceProviderRefreshRef.current = refreshed
            ? { key, inFlight: false, retryAfter: Number.POSITIVE_INFINITY }
            : { key, inFlight: false, retryAfter: Date.now() + 30_000 };
        }
      })
      .catch(() => {
        if (workspaceProviderRefreshRef.current?.key === key) {
          workspaceProviderRefreshRef.current = {
            key,
            inFlight: false,
            retryAfter: Date.now() + 30_000,
          };
        }
      });
  }, [activeProviderStatus, gitCwd, prompt, queryClient, serverConfigQuery.data, threadApi]);
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: activeProject?.environmentId,
      cwd: gitCwd,
      query: effectivePathQuery,
      enabled: isPathTrigger,
      limit: 80,
    }),
  );
  const workspaceEntries = workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return workspaceEntries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path",
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.path.includes("/")
          ? entry.path.substring(0, entry.path.lastIndexOf("/"))
          : "",
      }));
    }

    if (composerTrigger.kind === "slash-command") {
      const slashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        {
          id: "slash:plan",
          type: "slash-command",
          command: "plan",
          label: "/plan",
          description: "Switch this thread into plan mode",
        },
        {
          id: "slash:default",
          type: "slash-command",
          command: "default",
          label: "/default",
          description: "Switch this thread back to normal chat mode",
        },
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const skills = searchProviderSkills(
        getProviderSkillsForSlashMenu(selectedProviderSkills),
        composerTrigger.query,
      );
      const providerCommands = getProviderSlashCommandsForSlashMenu(
        selectedProviderSlashCommands,
        skills,
      ).map((command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }));
      const skillItems = skills.map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        skill,
        label: `/skill:${skill.name}`,
        description: skill.shortDescription ?? skill.description ?? "Run provider skill",
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      return [...slashCommandItems, ...providerCommands, ...skillItems].filter((item) => {
        if (!query) return true;
        return (
          item.label.toLowerCase().includes(query) || item.description.toLowerCase().includes(query)
        );
      });
    }

    if (composerTrigger.kind === "skill") {
      const skills = searchProviderSkills(selectedProviderSkills, composerTrigger.query);
      return skills.map((skill: ServerProviderSkill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description: skill.shortDescription ?? skill.description ?? "Run provider skill",
      }));
    }

    return searchableModelOptions
      .filter(({ searchSlug, searchName, searchProvider }) => {
        const query = composerTrigger.query.trim().toLowerCase();
        if (!query) return true;
        return (
          searchSlug.includes(query) || searchName.includes(query) || searchProvider.includes(query)
        );
      })
      .map(({ provider, providerLabel, slug, name }) => ({
        id: `model:${provider}:${slug}`,
        type: "model",
        provider,
        model: slug,
        label: name,
        description: `${providerLabel} · ${slug}`,
      }));
  }, [
    composerTrigger,
    searchableModelOptions,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderSlashCommands,
    workspaceEntries,
  ]);
  const composerMenuOpen = Boolean(composerTrigger);
  const activeComposerMenuItem = useMemo(
    () =>
      composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
      composerMenuItems[0] ??
      null,
    [composerHighlightedItemId, composerMenuItems],
  );
  composerMenuOpenRef.current = composerMenuOpen;
  composerMenuItemsRef.current = composerMenuItems;
  activeComposerMenuItemRef.current = activeComposerMenuItem;
  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );
  const activeProjectCwd = activeProject?.cwd ?? null;
  const threadTerminalRuntimeEnv = useMemo(() => {
    if (!activeProjectCwd) return {};
    return projectScriptRuntimeEnv({
      project: {
        cwd: activeProjectCwd,
      },
      worktreePath: activeThreadWorktreePath,
    });
  }, [activeProjectCwd, activeThreadWorktreePath]);
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = branchesQuery.data?.isRepo ?? true;
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.toggle"),
    [keybindings],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split"),
    [keybindings],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new"),
    [keybindings],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close"),
    [keybindings],
  );
  const diffPanelShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "diff.toggle"),
    [keybindings],
  );
  const onToggleDiff = useCallback(() => {
    if (propOnToggleDiff) {
      propOnToggleDiff();
      return;
    }
    // The diff panel is a full Agents-tab feature driven by route search params.
    // The compact side chat has no diff route, so don't navigate the app there.
    if (compact || !environmentId) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen ? { ...rest, diff: undefined } : { ...rest, diff: "1" };
      },
    });
  }, [compact, diffOpen, environmentId, navigate, propOnToggleDiff, threadId]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );
  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      if (
        threads.some(
          (thread) =>
            thread.id === targetThreadId &&
            (environmentId === undefined || thread.environmentId === environmentId),
        )
      ) {
        setStoreThreadError(targetThreadId, error, environmentId);
        return;
      }
      setLocalDraftErrorsByThreadId((existing) => {
        if ((existing[targetThreadId] ?? null) === error) {
          return existing;
        }
        return {
          ...existing,
          [targetThreadId]: error,
        };
      });
    },
    [environmentId, setStoreThreadError, threads],
  );

  const focusComposer = useCallback(() => {
    composerEditorRef.current?.focusAtEnd();
  }, []);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      if (!activeThread) {
        return;
      }
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor,
      );
      const nextCollapsedCursor = collapseExpandedComposerCursor(
        insertion.prompt,
        insertion.cursor,
      );
      const inserted = insertComposerDraftTerminalContext(
        activeThread.id,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex,
      );
      if (!inserted) {
        return;
      }
      promptRef.current = insertion.prompt;
      setComposerCursor(nextCollapsedCursor);
      setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCollapsedCursor);
      });
    },
    [activeThread, composerCursor, composerTerminalContexts, insertComposerDraftTerminalContext],
  );
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadId) return;
      storeSetTerminalOpen(activeThreadId, open);
    },
    [activeThreadId, storeSetTerminalOpen],
  );
  const setTerminalHeight = useCallback(
    (height: number) => {
      if (!activeThreadId) return;
      storeSetTerminalHeight(activeThreadId, height);
    },
    [activeThreadId, storeSetTerminalHeight],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadId) return;
    setTerminalOpen(!terminalState.terminalOpen);
  }, [activeThreadId, setTerminalOpen, terminalState.terminalOpen]);
  const splitTerminal = useCallback(() => {
    if (!activeThreadId || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeThreadId, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadId, hasReachedSplitLimit, storeSplitTerminal]);
  const createNewTerminal = useCallback(() => {
    if (!activeThreadId) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeThreadId, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadId, storeNewTerminal]);
  const activateTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadId) return;
      storeSetActiveTerminal(activeThreadId, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeThreadId, storeSetActiveTerminal],
  );
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = threadApi;
      if (!activeThreadId || !api) return;
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: activeThreadId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: activeThreadId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: activeThreadId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      storeCloseTerminal(activeThreadId, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeThreadId, storeCloseTerminal, terminalState.terminalIds.length, threadApi],
  );
  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      const api = threadApi;
      if (!api || !activeThreadId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : baseTerminalId;

      setTerminalOpen(true);
      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeThreadId, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeThreadId, targetTerminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: options?.worktreePath ?? activeThread.worktreePath ?? null,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const openTerminalInput: Parameters<typeof api.terminal.open>[0] = shouldCreateNewTerminal
        ? {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            env: runtimeEnv,
          };

      try {
        await api.terminal.open(openTerminalInput);
        await api.terminal.write({
          threadId: activeThreadId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        });
      } catch (error) {
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      gitCwd,
      setTerminalOpen,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
      threadApi,
    ],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
      threadId,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { interactionMode: mode });
      }

      const currentOptions = composerModelOptions?.[selectedProvider] ?? [];
      if (currentOptions.some((o) => o.id === "mode")) {
        const nextOptions = currentOptions.map((o) =>
          o.id === "mode" ? { ...o, currentValue: mode } : o,
        );
        setComposerProviderModelOptions(threadId, selectedProvider, nextOptions, {
          persistSticky: true,
          model: selectedModel,
        });
      }

      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
      threadId,
      composerModelOptions,
      selectedProvider,
      selectedModel,
      setComposerProviderModelOptions,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const toggleRuntimeMode = useCallback(() => {
    void handleRuntimeModeChange(
      runtimeMode === "full-access" ? "approval-required" : "full-access",
    );
  }, [handleRuntimeModeChange, runtimeMode]);
  const togglePlanSidebar = useCallback(() => {
    setPlanSidebarOpen((open) => {
      if (open) {
        const turnKey = activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? null;
        if (turnKey) {
          planSidebarDismissedForTurnRef.current = turnKey;
        }
      } else {
        planSidebarDismissedForTurnRef.current = null;
      }
      return !open;
    });
  }, [activePlan?.turnId, sidebarProposedPlan?.turnId]);

  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (!serverThread) {
        return;
      }
      const api = threadApi;
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.instanceId !== serverThread.modelSelection.instanceId ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: input.threadId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }
    },
    [serverThread, threadApi],
  );

  // Auto-scroll on new messages
  const messageCount = timelineMessages.length;
  const scrollMessagesToBottom = useCallback(
    (
      behavior: ScrollBehavior = "auto",
      options?: {
        enableAutoScroll?: boolean;
      },
    ) => {
      const scrollContainer = messagesScrollRef.current;
      if (!scrollContainer) return;
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior });
      lastKnownScrollTopRef.current = scrollContainer.scrollTop;
      if (options?.enableAutoScroll ?? true) {
        shouldAutoScrollRef.current = true;
      }
    },
    [],
  );
  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current;
    if (pendingFrame === null) return;
    pendingAutoScrollFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);
  const cancelPendingInteractionAnchorAdjustment = useCallback(() => {
    const pendingFrame = pendingInteractionAnchorFrameRef.current;
    if (pendingFrame === null) return;
    pendingInteractionAnchorFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);
  const pauseAutoScrollForUserNavigation = useCallback(() => {
    if (!shouldAutoScrollRef.current) return;
    shouldAutoScrollRef.current = false;
    pendingUserScrollUpIntentRef.current = false;
    setShowScrollToBottom(true);
    cancelPendingStickToBottom();
  }, [cancelPendingStickToBottom]);
  const scheduleStickToBottom = useCallback(() => {
    if (pendingAutoScrollFrameRef.current !== null) return;
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!shouldAutoScrollRef.current) return;
      scrollMessagesToBottom("auto", { enableAutoScroll: false });
    });
  }, [scrollMessagesToBottom]);
  const onMessagesClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const scrollContainer = messagesScrollRef.current;
      if (!scrollContainer || !(event.target instanceof Element)) return;

      const trigger = event.target.closest<HTMLElement>(
        "button, summary, [role='button'], [data-scroll-anchor-target]",
      );
      if (!trigger || !scrollContainer.contains(trigger)) return;
      if (trigger.closest("[data-scroll-anchor-ignore]")) return;

      pendingInteractionAnchorRef.current = {
        element: trigger,
        top: trigger.getBoundingClientRect().top,
      };

      cancelPendingInteractionAnchorAdjustment();
      pendingInteractionAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingInteractionAnchorFrameRef.current = null;
        const anchor = pendingInteractionAnchorRef.current;
        pendingInteractionAnchorRef.current = null;
        const activeScrollContainer = messagesScrollRef.current;
        if (!anchor || !activeScrollContainer) return;
        if (!anchor.element.isConnected || !activeScrollContainer.contains(anchor.element)) return;

        const nextTop = anchor.element.getBoundingClientRect().top;
        const delta = nextTop - anchor.top;
        if (Math.abs(delta) < 0.5) return;

        activeScrollContainer.scrollTop += delta;
        lastKnownScrollTopRef.current = activeScrollContainer.scrollTop;
      });
    },
    [cancelPendingInteractionAnchorAdjustment],
  );
  const forceStickToBottom = useCallback(() => {
    cancelPendingStickToBottom();
    scrollMessagesToBottom();
    scheduleStickToBottom();
  }, [cancelPendingStickToBottom, scheduleStickToBottom, scrollMessagesToBottom]);
  const onMessagesScroll = useCallback(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;
    const currentScrollTop = scrollContainer.scrollTop;
    const isNearBottom = isScrollContainerNearBottom(scrollContainer);
    const scrollDelta = currentScrollTop - lastKnownScrollTopRef.current;
    const scrolledUp = scrollDelta < -1;
    const userMovedViewportAwayFromBottom =
      !isNearBottom &&
      (scrolledUp ||
        pendingUserScrollUpIntentRef.current ||
        (isPointerScrollActiveRef.current && Math.abs(scrollDelta) > 1));

    if (!shouldAutoScrollRef.current && isNearBottom && !scrolledUp) {
      shouldAutoScrollRef.current = true;
      pendingUserScrollUpIntentRef.current = false;
    } else if (shouldAutoScrollRef.current && userMovedViewportAwayFromBottom) {
      shouldAutoScrollRef.current = false;
      pendingUserScrollUpIntentRef.current = false;
      cancelPendingStickToBottom();
    } else if (shouldAutoScrollRef.current && !isNearBottom && scrolledUp) {
      // Catch-all for keyboard/assistive scroll interactions.
      shouldAutoScrollRef.current = false;
      pendingUserScrollUpIntentRef.current = false;
      cancelPendingStickToBottom();
    }

    setShowScrollToBottom(!shouldAutoScrollRef.current);
    lastKnownScrollTopRef.current = currentScrollTop;
    if (activeThreadKey && !paintOnlyDisplayedTimeline) {
      rememberThreadScrollTop(activeThreadKey, currentScrollTop);
    }
  }, [activeThreadKey, cancelPendingStickToBottom, paintOnlyDisplayedTimeline]);

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer || !displayedTimelineKey) return;
    const savedScrollTop = peekRememberedThreadScrollTop(displayedTimelineKey);
    if (savedScrollTop !== null) {
      scrollContainer.scrollTop = savedScrollTop;
      lastKnownScrollTopRef.current = savedScrollTop;
      shouldAutoScrollRef.current = false;
      setShowScrollToBottom(true);
    }
  }, [displayedTimelineKey]);
  const onMessagesWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const scrollContainer = messagesScrollRef.current;
      if (
        shouldPauseAutoScrollOnUserScrollIntent({
          shouldAutoScroll: shouldAutoScrollRef.current,
          intentDirection: event.deltaY < 0 ? "up" : "down",
          canScrollUp: (scrollContainer?.scrollTop ?? 0) > 0,
        })
      ) {
        pendingUserScrollUpIntentRef.current = true;
        pauseAutoScrollForUserNavigation();
      }
    },
    [pauseAutoScrollForUserNavigation],
  );
  const onMessagesPointerDown = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    isPointerScrollActiveRef.current = true;
  }, []);
  const onMessagesPointerUp = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    isPointerScrollActiveRef.current = false;
  }, []);
  const onMessagesPointerCancel = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    isPointerScrollActiveRef.current = false;
  }, []);
  const onMessagesTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    lastTouchClientYRef.current = touch.clientY;
  }, []);
  const onMessagesTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const scrollContainer = messagesScrollRef.current;
      const touch = event.touches[0];
      if (!touch) return;
      const previousTouchY = lastTouchClientYRef.current;
      if (
        previousTouchY !== null &&
        shouldPauseAutoScrollOnUserScrollIntent({
          shouldAutoScroll: shouldAutoScrollRef.current,
          intentDirection: touch.clientY > previousTouchY + 1 ? "up" : "down",
          canScrollUp: (scrollContainer?.scrollTop ?? 0) > 0,
        })
      ) {
        pendingUserScrollUpIntentRef.current = true;
        pauseAutoScrollForUserNavigation();
      }
      lastTouchClientYRef.current = touch.clientY;
    },
    [pauseAutoScrollForUserNavigation],
  );
  const onMessagesTouchEnd = useCallback((_event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchClientYRef.current = null;
  }, []);
  useEffect(() => {
    return () => {
      cancelPendingStickToBottom();
      cancelPendingInteractionAnchorAdjustment();
    };
  }, [cancelPendingInteractionAnchorAdjustment, cancelPendingStickToBottom]);
  useLayoutEffect(() => {
    if (!activeThread?.id) return;
    shouldAutoScrollRef.current = true;
    scheduleStickToBottom();
    const timeout = window.setTimeout(() => {
      const scrollContainer = messagesScrollRef.current;
      if (!scrollContainer) return;
      if (isScrollContainerNearBottom(scrollContainer)) return;
      scheduleStickToBottom();
    }, 96);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeThread?.id, scheduleStickToBottom]);
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;

    composerFormHeightRef.current = composerForm.getBoundingClientRect().height;
    setIsComposerFooterCompact(
      shouldUseCompactComposerFooter(measureComposerFormWidth(), {
        hasWideActions: composerFooterHasWideActions,
      }),
    );
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      const nextCompact = shouldUseCompactComposerFooter(measureComposerFormWidth(), {
        hasWideActions: composerFooterHasWideActions,
      });
      setIsComposerFooterCompact((previous) => (previous === nextCompact ? previous : nextCompact));

      const nextHeight = entry.contentRect.height;
      const previousHeight = composerFormHeightRef.current;
      composerFormHeightRef.current = nextHeight;

      if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
      if (!shouldAutoScrollRef.current) return;
      scheduleStickToBottom();
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
    };
  }, [activeThread?.id, composerFooterHasWideActions, scheduleStickToBottom]);
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    scheduleStickToBottom();
  }, [messageCount, scheduleStickToBottom]);
  useEffect(() => {
    if (phase !== "running") return;
    if (!shouldAutoScrollRef.current) return;
    scheduleStickToBottom();
  }, [phase, scheduleStickToBottom, timelineEntries]);

  useEffect(() => {
    // Reset send-in-flight flag so the send button is never permanently stuck
    // after switching away from a thread mid-send.
    sendInFlightRef.current = false;
    setSendPhase("idle");
    setSendStartedAt(null);

    // Clear optimistic messages — they belong to the previous thread.
    setOptimisticUserMessages([]);

    setExpandedWorkGroups({});
    setPullRequestDialogState(null);
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false;
      setPlanSidebarOpen(true);
    } else {
      setPlanSidebarOpen(false);
    }
    planSidebarDismissedForTurnRef.current = null;

    // On cleanup (when switching away from this thread), remove its entry
    // from the terminal-open tracking ref to prevent unbounded growth.
    const threadIdForCleanup = activeThread?.id;
    return () => {
      if (threadIdForCleanup) {
        delete terminalOpenByThreadRef.current[threadIdForCleanup];
      }
    };
  }, [activeThread?.id]);

  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      return;
    }
    setComposerHighlightedItemId((existing) =>
      existing && composerMenuItems.some((item) => item.id === existing)
        ? existing
        : (composerMenuItems[0]?.id ?? null),
    );
  }, [composerMenuItems, composerMenuOpen]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || terminalState.terminalOpen || !isActivePane) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, isActivePane, terminalState.terminalOpen]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages]);

  useEffect(() => {
    composerFilesRef.current = composerFiles;
  }, [composerFiles]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    promptRef.current = prompt;
    setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
  }, [prompt]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    setSendPhase("idle");
    setSendStartedAt(null);
    setComposerHighlightedItemId(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
    dragDepthRef.current = 0;
    setIsDragOverComposer(false);
    setExpandedImage(null);
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(threadId);
        return;
      }
      const composerStorageThreadId = environmentId
        ? scopedComposerThreadId(environmentId, threadId)
        : threadId;
      const getPersistedAttachmentsForThread = () =>
        appAtomRegistry.get(composerDraftsAtom).draftsByThreadId[composerStorageThreadId]
          ?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) {
          return;
        }
        // Stage attachments in persisted draft state first so persist middleware can write them.
        syncComposerDraftPersistedAttachments(threadId, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds = fallbackPersistedAttachments
          .map((attachment) => attachment.id)
          .filter((id) => currentImageIds.has(id));
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) {
          return;
        }
        syncComposerDraftPersistedAttachments(threadId, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearComposerDraftPersistedAttachments,
    composerImages,
    syncComposerDraftPersistedAttachments,
    threadId,
    environmentId,
  ]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeThread?.worktreePath;
  const envMode: DraftThreadEnvMode = activeWorktreePath
    ? "worktree"
    : isLocalDraftThread
      ? (draftThread?.envMode ?? "local")
      : "local";

  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [phase]);

  const beginSendPhase = useCallback((nextPhase: Exclude<SendPhase, "idle">) => {
    setSendStartedAt((current) => current ?? new Date().toISOString());
    setSendPhase(nextPhase);
  }, []);

  const resetSendPhase = useCallback(() => {
    setSendPhase("idle");
    setSendStartedAt(null);
  }, []);

  useEffect(() => {
    if (sendPhase === "idle") {
      return;
    }
    if (
      phase === "running" ||
      activePendingApproval !== null ||
      activePendingUserInput !== null ||
      activeThread?.error
    ) {
      resetSendPhase();
    }
  }, [
    activePendingApproval,
    activePendingUserInput,
    activeThread?.error,
    phase,
    resetSendPhase,
    sendPhase,
  ]);

  useEffect(() => {
    if (!activeThreadId) return;
    const previous = terminalOpenByThreadRef.current[activeThreadId] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadId] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadId] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadId] = current;
  }, [activeThreadId, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || event.defaultPrevented || !isActivePane) return;

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        void stashCurrentPrompt();
        return;
      }

      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "thread.copyReference") {
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThread || event.repeat) return;
        const currentPr = resolveThreadCurrentPullRequest(activeThread.pullRequests ?? []);
        const prUrl = currentPr
          ? currentPr.kind === "stack"
            ? currentPr.top.url
            : currentPr.link.url
          : activeThread.linkedPullRequest?.url;
        const reference = prUrl ?? activeThread.id;
        const label = prUrl ? "PR link" : "Thread ID";
        void navigator.clipboard.writeText(reference).then(
          () => {
            toastManager.add({
              type: "success",
              title: `${label} copied`,
              description: reference,
            });
          },
          (error: unknown) => {
            toastManager.add({
              type: "error",
              title: `Failed to copy ${label.toLowerCase()}`,
              description: error instanceof Error ? error.message : "Clipboard access failed.",
            });
          },
        );
        return;
      }

      if (command === "thread.settle") {
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThread || event.repeat) return;
        if (!threadApi) return;
        void threadApi.orchestration
          .dispatchCommand(
            activeThreadIsSettled
              ? {
                  type: "thread.unsettle",
                  commandId: newCommandId(),
                  threadId: activeThread.id,
                  reason: "user",
                }
              : {
                  type: "thread.settle",
                  commandId: newCommandId(),
                  threadId: activeThread.id,
                },
          )
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: activeThreadIsSettled
                ? "Could not unsettle thread"
                : "Could not settle thread",
              description: error instanceof Error ? error.message : "The thread action failed.",
            });
          });
        return;
      }

      if (command === "thread.pin") {
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThread || event.repeat) return;
        const isPinned = activeThread.pinnedAt != null;
        if (!threadApi) return;
        void threadApi.orchestration
          .dispatchCommand({
            type: isPinned ? "thread.unpin" : "thread.pin",
            commandId: newCommandId(),
            threadId: activeThread.id,
          })
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: isPinned ? "Could not unpin thread" : "Could not pin thread",
              description: error instanceof Error ? error.message : "The thread action failed.",
            });
          });
        return;
      }

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProject.scripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeProject,
    activeThread,
    activeThreadIsSettled,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    activeThreadId,
    closeTerminal,
    createNewTerminal,
    setTerminalOpen,
    runProjectScript,
    splitTerminal,
    keybindings,
    onToggleDiff,
    stashCurrentPrompt,
    toggleTerminalVisibility,
    isServerThread,
    isActivePane,
    threadApi,
  ]);

  const addComposerImages = (files: File[]) => {
    if (!activeThreadId || files.length === 0) return;

    if (pendingUserInputs.length > 0) {
      toastManager.add({
        type: "error",
        title: "Attach files after answering plan questions.",
      });
      return;
    }

    const nextImages: ComposerImageAttachment[] = [];
    const nextFiles: ComposerFileAttachment[] = [];
    let nextAttachmentCount = composerImagesRef.current.length + composerFilesRef.current.length;
    let error: string | null = null;
    for (const file of files) {
      if (nextAttachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
        error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
        break;
      }
      if (file.type.startsWith("image/")) {
        if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} image limit.`;
          continue;
        }
        nextImages.push({
          type: "image",
          id: randomUUID(),
          name: file.name || "image",
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl: URL.createObjectURL(file),
          file,
        });
      } else {
        if (file.size === 0 || file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
          error = `'${file.name}' is empty or exceeds the ${FILE_SIZE_LIMIT_LABEL} file limit.`;
          continue;
        }
        const normalizedFile = file.type
          ? file
          : new File([file], file.name, {
              type: "application/octet-stream",
              lastModified: file.lastModified,
            });
        nextFiles.push({
          type: "file",
          id: randomUUID(),
          name: normalizedFile.name || "attachment",
          mimeType: normalizedFile.type,
          sizeBytes: normalizedFile.size,
          file: normalizedFile,
        });
      }
      nextAttachmentCount += 1;
    }

    if (nextImages.length === 1 && nextImages[0]) {
      addComposerImage(nextImages[0]);
    } else if (nextImages.length > 1) {
      addComposerImagesToDraft(nextImages);
    }
    if (nextFiles.length > 0) addComposerFilesToDraft(nextFiles);
    setThreadError(activeThreadId, error);
  };

  useEffect(() => {
    const handlePickedAnnotation = (event: Event) => {
      if (!isActivePane) return;
      const detail = (event as CustomEvent<PreviewAnnotationPickedDetail>).detail;
      if (!detail || detail.projectId !== activeProject?.id || !activeThreadId) return;
      const annotation: PreviewAnnotationPayload = detail.annotation;
      addComposerDraftPreviewAnnotation(activeThreadId, annotation);
      void previewAnnotationScreenshotFile(annotation)
        .then((file) => {
          if (!file) return;
          if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            setThreadError(
              activeThreadId,
              "The captured browser screenshot exceeds the attachment limit.",
            );
            return;
          }
          if (composerImagesRef.current.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
            setThreadError(
              activeThreadId,
              `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`,
            );
            return;
          }
          addComposerImage({
            type: "image",
            id: annotation.id,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            previewUrl: URL.createObjectURL(file),
            file,
          });
        })
        .catch((cause: unknown) => {
          setThreadError(
            activeThreadId,
            cause instanceof Error ? cause.message : "Could not attach the browser screenshot.",
          );
        });
      focusComposer();
    };
    window.addEventListener(PREVIEW_ANNOTATION_PICKED_EVENT, handlePickedAnnotation);
    return () =>
      window.removeEventListener(PREVIEW_ANNOTATION_PICKED_EVENT, handlePickedAnnotation);
  }, [
    activeProject?.id,
    activeThreadId,
    addComposerDraftPreviewAnnotation,
    addComposerImage,
    focusComposer,
    isActivePane,
    setThreadError,
  ]);

  const removeComposerImage = (imageId: string) => {
    removeComposerImageFromDraft(imageId);
  };

  const removeComposerFile = (fileId: string) => {
    removeComposerFileFromDraft(fileId);
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    addComposerImages(files);
  };

  const onComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverComposer(true);
  };

  const onComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOverComposer(true);
  };

  const onComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOverComposer(false);
    }
  };

  const onComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOverComposer(false);
    const files = Array.from(event.dataTransfer.files);
    addComposerImages(files);
    focusComposer();
  };

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = threadApi;
      if (!api || !activeThread || isRevertingCheckpoint) return;

      if (phase === "running" || isSendBusy || isConnecting) {
        setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
        return;
      }
      const confirmed = await confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this thread.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to revert thread state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [
      activeThread,
      confirm,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      phase,
      setThreadError,
      threadApi,
    ],
  );

  const onCompactContext = useCallback(async () => {
    if (compactDisabled || !activeThread || sendInFlightRef.current) {
      return;
    }
    const api = threadApi;
    if (!api) return;

    // Compaction is a standalone command; the draft and its attachments stay local.
    const threadId = activeThread.id;
    const messageId = newMessageId();
    const createdAt = new Date().toISOString();
    sendInFlightRef.current = true;
    beginSendPhase("sending-turn");
    setThreadError(threadId, null);
    setOptimisticUserMessages((messages) => [
      ...messages,
      {
        id: messageId,
        role: "user",
        text: "/compact",
        turnId: null,
        createdAt,
        updatedAt: createdAt,
        streaming: false,
      },
    ]);
    scrollMessagesToBottom();
    try {
      await persistThreadSettingsForNextTurn({
        threadId,
        createdAt,
        modelSelection: selectedModelSelection,
        runtimeMode,
        interactionMode,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: {
          messageId,
          role: "user",
          text: "/compact",
          attachments: [],
        },
        modelSelection: selectedModelSelection,
        runtimeMode,
        interactionMode,
        createdAt,
      });
    } catch (err) {
      setOptimisticUserMessages((messages) =>
        messages.filter((message) => message.id !== messageId),
      );
      setThreadError(threadId, err instanceof Error ? err.message : "Failed to compact context.");
    } finally {
      sendInFlightRef.current = false;
      resetSendPhase();
    }
  }, [
    activeThread,
    beginSendPhase,
    compactDisabled,
    interactionMode,
    persistThreadSettingsForNextTurn,
    resetSendPhase,
    runtimeMode,
    scrollMessagesToBottom,
    selectedModelSelection,
    setThreadError,
    threadApi,
  ]);

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const api = threadApi;
    if (!api || !activeThread || isSendBusy || isConnecting || sendInFlightRef.current) return;
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }
    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      fileCount: composerFiles.length,
      contextCount: composerPreviewAnnotations.length,
      terminalContexts: composerTerminalContexts,
    });
    if (showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      const validationMessage = getComposerPromptLengthValidationMessage(followUp.text);
      if (validationMessage) {
        setSubmissionValidationMessage(validationMessage);
        return;
      }
      setSubmissionValidationMessage(null);
      promptRef.current = "";
      clearComposerDraftContent(activeThread.id);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(activeThread.id);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
      return;
    }
    if (
      trimmed.toLowerCase() === "/compact" &&
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerPreviewAnnotations.length === 0
    ) {
      if (manualCompactionProviderAvailable && activeThreadHasCompactableConversation) {
        promptRef.current = "";
        clearComposerDraftContent(activeThread.id);
        setComposerHighlightedItemId(null);
        setComposerCursor(0);
        setComposerTrigger(null);
        void onCompactContext();
        return;
      }
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        });
      }
      return;
    }
    const providerInputWithContexts = composerPreviewAnnotations.reduce(
      (text, annotation) => appendPreviewAnnotationPrompt(text, annotation),
      appendTerminalContextsToPrompt(promptForSend, sendableComposerTerminalContexts),
    );
    const providerInputForValidation = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: selectedPromptEffort,
      text: providerInputWithContexts || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const validationMessage = getComposerPromptLengthValidationMessage(providerInputForValidation);
    if (validationMessage) {
      setSubmissionValidationMessage(validationMessage);
      return;
    }
    setSubmissionValidationMessage(null);
    if (!activeProject) return;

    // Check provider entitlement & authentication before initiating turn dispatch
    const activeProviderSnapshot = providerStatuses.find(
      (p) => p.instanceId === selectedProvider || p.driver === selectedProvider,
    );
    if (
      activeProviderSnapshot &&
      activeProviderSnapshot.auth?.status === "authenticated_unentitled"
    ) {
      toastManager.add({
        type: "warning",
        title: "No active Copilot seat",
        description:
          "Your connected GitHub account does not have an active Copilot subscription. Configure authentication in Settings → Providers.",
      });
      return;
    }
    if (
      activeProviderSnapshot &&
      activeProviderSnapshot.installed &&
      activeProviderSnapshot.auth?.status === "unauthenticated"
    ) {
      toastManager.add({
        type: "warning",
        title: `${activeProviderSnapshot.displayName ?? selectedProvider} not authenticated`,
        description: `Please sign in to ${activeProviderSnapshot.displayName ?? selectedProvider} in Settings → Providers before sending a message.`,
      });
      return;
    }
    const credentialSource = activeProviderSnapshot?.auth?.credentialSource;
    if (
      activeProviderSnapshot &&
      credentialSource &&
      ["api_key", "byok", "cloud_credential"].includes(credentialSource)
    ) {
      const confirmationKey = `tabs.billing-confirmed.${activeProviderSnapshot.instanceId ?? activeProviderSnapshot.driver}`;
      if (window.localStorage.getItem(confirmationKey) !== "true") {
        const billingLabel =
          activeProviderSnapshot.auth.billingLabel ??
          activeProviderSnapshot.auth.label ??
          "usage-based credentials";
        const confirmed = await confirm(
          `${activeProviderSnapshot.displayName} is configured to use ${billingLabel}. ` +
            "Requests may be billed separately from your existing subscription. " +
            "Continue and remember this choice for this provider?",
        );
        if (!confirmed) return;
        window.localStorage.setItem(confirmationKey, "true");
      }
    }

    const threadIdForSend = activeThread.id;
    if (activeThreadIsSettled) {
      await api.orchestration.dispatchCommand({
        type: "thread.unsettle",
        commandId: newCommandId(),
        threadId: activeThread.id,
        reason: "user",
      });
    }
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      isFirstMessage && envMode === "worktree" && !activeThread.worktreePath
        ? activeThread.branch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && envMode === "worktree" && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThread.branch) {
      setStoreThreadError(
        threadIdForSend,
        "Select a base branch before sending in New worktree mode.",
        environmentId,
      );
      return;
    }

    sendInFlightRef.current = true;
    beginSendPhase(baseBranchForWorktree ? "preparing-worktree" : "sending-turn");

    const composerImagesSnapshot = [...composerImages];
    const composerFilesSnapshot = [...composerFiles];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const composerPreviewAnnotationsSnapshot = [...composerPreviewAnnotations];
    const composerReviewCommentsSnapshot = [...composerReviewComments];
    const messageTextWithContexts = appendTerminalContextsToPrompt(
      promptForSend,
      composerTerminalContextsSnapshot,
    );
    const messageTextWithPreviewAnnotations = composerPreviewAnnotationsSnapshot.reduce(
      (text, annotation) => appendPreviewAnnotationPrompt(text, annotation),
      messageTextWithContexts,
    );
    const messageTextForSend = appendReviewCommentsToPrompt(
      messageTextWithPreviewAnnotations,
      composerReviewCommentsSnapshot,
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: selectedPromptEffort,
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const turnAttachmentsPromise = Promise.all([
      ...composerImagesSnapshot.map(async (image) => ({
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      })),
      ...composerFilesSnapshot.map(async (file) => ({
        type: "file" as const,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        dataUrl: await readFileAsDataUrl(file.file),
      })),
    ]);
    const optimisticAttachments = [
      ...composerImagesSnapshot.map((image) => ({
        type: "image" as const,
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        previewUrl: image.previewUrl,
      })),
      ...composerFilesSnapshot.map((file) => ({
        type: "file" as const,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      })),
    ];
    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
      },
    ]);
    // Sending a message should always bring the latest user turn into view.
    shouldAutoScrollRef.current = true;
    forceStickToBottom();

    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add({
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      });
    }
    promptRef.current = "";
    clearComposerDraftContent(threadIdForSend);
    setComposerHighlightedItemId(null);
    setComposerCursor(0);
    setComposerTrigger(null);

    let createdServerThreadForLocalDraft = false;
    let turnStartSucceeded = false;
    let nextThreadBranch = activeThread.branch;
    let nextThreadWorktreePath = activeThread.worktreePath;
    await (async () => {
      // On first message: lock in branch + create worktree if needed.
      if (baseBranchForWorktree) {
        beginSendPhase("preparing-worktree");
        const newBranch = buildTemporaryWorktreeBranchName();
        const result = await createWorktreeMutation.mutateAsync({
          cwd: activeProject.cwd,
          branch: baseBranchForWorktree,
          newBranch,
          environmentId: activeProject.environmentId,
        });
        nextThreadBranch = result.worktree.branch;
        nextThreadWorktreePath = result.worktree.path;
        if (isServerThread) {
          await api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: threadIdForSend,
            branch: result.worktree.branch,
            worktreePath: result.worktree.path,
          });
          // Keep local thread state in sync immediately so terminal drawer opens
          // with the worktree cwd/env instead of briefly using the project root.
          setStoreThreadBranch(
            threadIdForSend,
            result.worktree.branch,
            result.worktree.path,
            environmentId,
          );
        }
      }

      let firstComposerImageName: string | null = null;
      if (composerImagesSnapshot.length > 0) {
        const firstComposerImage = composerImagesSnapshot[0];
        if (firstComposerImage) {
          firstComposerImageName = firstComposerImage.name;
        }
      }
      let titleSeed = trimmed;
      if (!titleSeed) {
        if (firstComposerImageName) {
          titleSeed = `Image: ${firstComposerImageName}`;
        } else if (composerFilesSnapshot[0]) {
          titleSeed = `File: ${composerFilesSnapshot[0].name}`;
        } else if (composerTerminalContextsSnapshot.length > 0) {
          titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
        } else {
          titleSeed = "New thread";
        }
      }
      const title = truncateTitle(titleSeed);
      const threadCreateModelSelection: ModelSelection = makeAppModelSelection(
        selectedProvider,
        selectedModel || activeProject.defaultModelSelection?.model || DEFAULT_MODEL,
        selectedModelSelection.options,
      );

      if (isLocalDraftThread) {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          projectId: activeProject.id,
          title,
          modelSelection: threadCreateModelSelection,
          runtimeMode,
          interactionMode,
          branch: nextThreadBranch,
          worktreePath: nextThreadWorktreePath,
          createdAt: activeThread.createdAt,
        });
        createdServerThreadForLocalDraft = true;
      }

      let setupScript: ProjectScript | null = null;
      if (baseBranchForWorktree) {
        setupScript = setupProjectScript(activeProject.scripts);
      }
      if (setupScript) {
        let shouldRunSetupScript = false;
        if (isServerThread) {
          shouldRunSetupScript = true;
        } else {
          if (createdServerThreadForLocalDraft) {
            shouldRunSetupScript = true;
          }
        }
        if (shouldRunSetupScript) {
          const setupScriptOptions: Parameters<typeof runProjectScript>[1] = {
            worktreePath: nextThreadWorktreePath,
            rememberAsLastInvoked: false,
          };
          if (nextThreadWorktreePath) {
            setupScriptOptions.cwd = nextThreadWorktreePath;
          }
          await runProjectScript(setupScript, setupScriptOptions);
        }
      }

      // Auto-title from first message
      if (isFirstMessage && isServerThread) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          title,
        });
      }

      if (isServerThread) {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          ...(selectedModel ? { modelSelection: selectedModelSelection } : {}),
          runtimeMode,
          interactionMode,
        });
      }

      beginSendPhase("sending-turn");
      const turnAttachments = await turnAttachmentsPromise;
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          attachments: turnAttachments,
        },
        modelSelection: selectedModelSelection,
        runtimeMode,
        interactionMode,
        createdAt: messageCreatedAt,
      });
      turnStartSucceeded = true;
    })().catch(async (err: unknown) => {
      if (createdServerThreadForLocalDraft && !turnStartSucceeded) {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: threadIdForSend,
          })
          .catch(() => undefined);
      }
      if (
        !turnStartSucceeded &&
        promptRef.current.length === 0 &&
        composerImagesRef.current.length === 0 &&
        composerFilesRef.current.length === 0 &&
        composerTerminalContextsRef.current.length === 0 &&
        (useComposerDraftStore.getState().draftsByThreadId[activeThread.id]?.previewAnnotations
          .length ?? 0) === 0
      ) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        promptRef.current = promptForSend;
        setPrompt(promptForSend);
        setComposerCursor(collapseExpandedComposerCursor(promptForSend, promptForSend.length));
        addComposerImagesToDraft(composerImagesSnapshot.map(cloneComposerImageForRetry));
        addComposerFilesToDraft(composerFilesSnapshot);
        addComposerTerminalContextsToDraft(composerTerminalContextsSnapshot);
        setComposerDraftPreviewAnnotations(activeThread.id, composerPreviewAnnotationsSnapshot);
        setComposerDraftReviewComments(activeThread.id, composerReviewCommentsSnapshot);
        setComposerTrigger(detectComposerTrigger(promptForSend, promptForSend.length));
      }
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send message.",
      );
    });
    sendInFlightRef.current = false;
    if (!turnStartSucceeded) {
      resetSendPhase();
    }
  };

  const isAutoDispatchingRef = useRef(false);
  const [scheduleTick, setScheduleTick] = useState(0);

  // Periodic tick for scheduled messages in queue
  useEffect(() => {
    const hasScheduled = threadQueuedMessages.some((m) => Boolean(m.scheduledFor));
    if (!hasScheduled) return;

    const interval = window.setInterval(() => {
      setScheduleTick((t) => t + 1);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [threadQueuedMessages]);

  // Auto-dispatch queued messages when turn completes or scheduled time arrives
  useEffect(() => {
    if (!activeThread?.id) return;

    // latestTurnSettled is false when there has never been a turn (activeLatestTurn
    // is null). A fresh thread with no history is still eligible for dispatch, so
    // allow it through when activeLatestTurn is null and the thread isn't running.
    const canDispatch = latestTurnSettled || (!activeLatestTurn && phase !== "running");
    if (!canDispatch) return;

    if (
      phase === "running" ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current ||
      isAutoDispatchingRef.current
    ) {
      return;
    }
    if (activePendingApproval || activePendingProgress) return;
    if (activeThread.error) return;

    const nextReady = peekNextReadyMessage(activeThread.id);
    if (!nextReady) return;

    // Mark as dispatching immediately (synchronously) to prevent a concurrent
    // effect re-run from also dequeuing while we wait for the 80ms timeout.
    isAutoDispatchingRef.current = true;

    const threadIdForDispatch = activeThread.id;
    const timer = window.setTimeout(() => {
      // Re-check guards inside the timeout to handle the case where the
      // component re-renders or a user-initiated send started in the gap.
      if (sendInFlightRef.current) {
        isAutoDispatchingRef.current = false;
        return;
      }

      const dequeued = dequeueNextReadyMessage(threadIdForDispatch);
      if (!dequeued) {
        isAutoDispatchingRef.current = false;
        return;
      }

      promptRef.current = dequeued.text;
      setPrompt(dequeued.text);

      toastManager.add({
        type: "info",
        title: dequeued.scheduledFor
          ? "Dispatching scheduled message"
          : "Dispatching queued message",
        description: dequeued.text.length > 50 ? `${dequeued.text.slice(0, 50)}...` : dequeued.text,
      });

      void onSend().finally(() => {
        isAutoDispatchingRef.current = false;
      });
    }, 80);

    return () => {
      window.clearTimeout(timer);
      isAutoDispatchingRef.current = false;
    };
  }, [
    activePendingApproval,
    activePendingProgress,
    activeLatestTurn,
    activeThread?.error,
    activeThread?.id,
    dequeueNextReadyMessage,
    isConnecting,
    isSendBusy,
    latestTurnSettled,
    onSend,
    peekNextReadyMessage,
    phase,
    scheduleTick,
    setPrompt,
  ]);

  const onInterrupt = async () => {
    const api = threadApi;
    if (!api || !activeThread) return;

    // Double-click escape hatch: if user clicks stop again within 15s while waiting,
    // force stop the session immediately
    if (
      interruptAttemptedAtRef.current !== null &&
      Date.now() - interruptAttemptedAtRef.current < 15_000
    ) {
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
        });
        setIsStuck(false);
        interruptAttemptedAtRef.current = null;
        if (stuckTimerRef.current !== null) {
          window.clearTimeout(stuckTimerRef.current);
          stuckTimerRef.current = null;
        }
        toastManager.add({
          type: "info",
          title: "Session stopped",
          description: "Generation was forcefully stopped.",
        });
        return;
      } catch {
        // fall through to turn interrupt
      }
    }

    interruptAttemptedAtRef.current = Date.now();

    // Start 5-second countdown to show the stuck escape hatch banner
    if (stuckTimerRef.current !== null) {
      window.clearTimeout(stuckTimerRef.current);
    }
    stuckTimerRef.current = window.setTimeout(() => {
      if (interruptAttemptedAtRef.current !== null) {
        setIsStuck(true);
      }
    }, 5_000);

    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      ...(activeThread.session?.activeTurnId ? { turnId: activeThread.session.activeTurnId } : {}),
      createdAt: new Date().toISOString(),
    });
  };

  // Reset stuck state when phase leaves "running"
  useEffect(() => {
    if (phase !== "running") {
      setIsStuck(false);
      interruptAttemptedAtRef.current = null;
      if (stuckTimerRef.current !== null) {
        window.clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
    }
  }, [phase]);

  // Clean up any pending timer on unmount
  useEffect(() => {
    return () => {
      if (stuckTimerRef.current !== null) {
        window.clearTimeout(stuckTimerRef.current);
      }
    };
  }, []);

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = threadApi;
      if (!api || !activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit approval decision.",
            environmentId,
          );
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setStoreThreadError, threadApi],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = threadApi;
      if (!api || !activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit user input.",
            environmentId,
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setStoreThreadError, threadApi],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string, optionValue?: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: {
            selectedOptionLabel: optionLabel,
            ...(optionValue ? { selectedOptionValue: optionValue } : {}),
            customAnswer: "",
          },
        },
      }));
      promptRef.current = "";
      setComposerCursor(0);
      setComposerTrigger(null);
    },
    [activePendingUserInput],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(value, expandedCursor),
      );
    },
    [activePendingUserInput],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = threadApi;
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        effort: selectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginSendPhase("sending-turn");
      setThreadError(threadIdForSend, null);
      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);
      shouldAutoScrollRef.current = true;
      forceStickToBottom();

      try {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: selectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(threadIdForSend, nextInteractionMode);

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default") {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetSendPhase();
      }
    },
    [
      activeThread,
      activeProposedPlan,
      beginSendPhase,
      forceStickToBottom,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      resetSendPhase,
      runtimeMode,
      selectedPromptEffort,
      selectedModelSelection,
      selectedProvider,
      selectedProviderModels,
      setComposerDraftInteractionMode,
      setThreadError,
      selectedModel,
      threadApi,
    ],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = threadApi;
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: selectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncateTitle(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = selectedModelSelection;

    sendInFlightRef.current = true;
    beginSendPhase("sending-turn");
    const finish = () => {
      sendInFlightRef.current = false;
      resetSendPhase();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: activeThread.branch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          runtimeMode,
          interactionMode: "default",
          createdAt,
        });
      })
      .then(() => api.orchestration.getSnapshot())
      .then((snapshot) => {
        syncServerReadModel(snapshot);
        // Signal that the plan sidebar should open on the new thread.
        planSidebarOpenOnNextThreadRef.current = true;
        return routeToThread(nextThreadId);
      })
      .catch(async (err) => {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .catch(() => undefined);
        await api.orchestration
          .getSnapshot()
          .then((snapshot) => {
            syncServerReadModel(snapshot);
          })
          .catch(() => undefined);
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            err instanceof Error ? err.message : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeThread,
    beginSendPhase,
    isConnecting,
    isSendBusy,
    isServerThread,
    routeToThread,
    resetSendPhase,
    runtimeMode,
    selectedPromptEffort,
    selectedModelSelection,
    selectedProvider,
    selectedProviderModels,
    syncServerReadModel,
    selectedModel,
    threadApi,
  ]);

  const onProviderModelSelect = useCallback(
    (
      provider: ProviderPickerKind,
      model: ModelSlug,
      options?: ReadonlyArray<import("@tabs/contracts").ProviderOptionSelection>,
    ) => {
      if (!activeThread) return;
      if (lockedProvider !== null && provider !== lockedProvider) {
        scheduleComposerFocus();
        return;
      }
      const resolvedProvider = resolveSelectableProvider(providerStatuses, provider);
      const resolvedModel = resolveAppModelSelection(
        resolvedProvider,
        settings,
        providerStatuses,
        model,
      );
      const nextModelSelection: ModelSelection = makeAppModelSelection(
        resolvedProvider,
        resolvedModel,
        options,
      );
      setComposerDraftModelSelection(activeThread.id, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      const currentPrompt = promptRef.current;
      if (nextPrompt === currentPrompt) {
        scheduleComposerFocus();
        return;
      }
      promptRef.current = nextPrompt;
      setSubmissionValidationMessage(null);
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [scheduleComposerFocus, setPrompt],
  );
  const onFusedModelOptionsChange = useCallback(
    (nextOptions: ReadonlyArray<import("@tabs/contracts").ProviderOptionSelection> | undefined) => {
      const newMode = nextOptions?.find((o) => o.id === "mode")?.value;
      if (
        typeof newMode === "string" &&
        (newMode === "plan" || newMode === "default") &&
        newMode !== interactionMode
      ) {
        handleInteractionModeChange(newMode);
      }

      setComposerProviderModelOptions(threadId, selectedProvider, nextOptions, {
        persistSticky: true,
        model: selectedModel,
      });
    },
    [
      threadId,
      selectedProvider,
      selectedModel,
      interactionMode,
      handleInteractionModeChange,
      setComposerProviderModelOptions,
    ],
  );
  const providerTraitsMenuContent = renderProviderTraitsMenuContent({
    provider: selectedProvider,
    threadId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedProvider],
    prompt,
    onPromptChange: setPromptFromTraits,
  });
  const providerTraitsPicker = renderProviderTraitsPicker({
    provider: selectedProvider,
    threadId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedProvider],
    prompt,
    onPromptChange: setPromptFromTraits,
  });
  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { envMode: mode });
      }
      scheduleComposerFocus();
    },
    [isLocalDraftThread, scheduleComposerFocus, setDraftThreadContext, threadId],
  );

  const extendReplacementRangeForTrailingSpace = (
    text: string,
    rangeEnd: number,
    replacement: string,
  ): number => {
    if (!replacement.endsWith(" ")) {
      return rangeEnd;
    }
    return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
  };

  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: {
        expectedText?: string;
        focusEditorAfterReplace?: boolean;
        citationComment?: { start: number; sourceAnchor: AssistantCitationSourceAnchor };
      },
    ): boolean => {
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        options?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== options.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
      if (options?.citationComment) {
        composerEditorRef.current?.requestCitationComment({
          previousValue: currentText,
          value: next.text,
          citationStart: options.citationComment.start,
          sourceAnchor: options.citationComment.sourceAnchor,
        });
      }
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInput) {
        setPendingUserInputAnswersByRequestId((existing) => ({
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [activePendingQuestion.id]: setPendingUserInputCustomAnswer(
              existing[activePendingUserInput.requestId]?.[activePendingQuestion.id],
              next.text,
            ),
          },
        }));
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(next.text, nextExpandedCursor));
      if (options?.focusEditorAfterReplace !== false) {
        window.requestAnimationFrame(() => {
          if (promptRef.current !== next.text) return;
          composerEditorRef.current?.focusAt(nextCursor);
        });
      }
      return true;
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput, setPrompt],
  );

  const readComposerSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
    };
  }, [composerCursor, composerTerminalContexts]);

  const citeAssistantText = useCallback(
    (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor): boolean => {
      if (isComposerApprovalState || pendingUserInputs.length > 0 || !composerEditorRef.current) {
        toastManager.add({
          type: "warning",
          title: "The composer is not ready",
          description:
            "Try citing the selection after the connection or pending input is resolved.",
        });
        return false;
      }

      const text = formatAssistantCitationForComposer(citation, citation.comment);
      const prompt = promptRef.current;
      const cursor = readComposerSnapshot().expandedCursor;
      const needsLeadingSpace = cursor > 0 && !/\s/.test(prompt[cursor - 1] ?? "");
      const replacement = needsLeadingSpace ? ` ${text}` : text;
      const rangeEnd = extendReplacementRangeForTrailingSpace(prompt, cursor, text);

      return applyPromptReplacement(cursor, rangeEnd, replacement, {
        citationComment: {
          start: cursor + (needsLeadingSpace ? 1 : 0),
          sourceAnchor,
        },
        focusEditorAfterReplace: false,
      });
    },
    [
      applyPromptReplacement,
      isComposerApprovalState,
      pendingUserInputs.length,
      readComposerSnapshot,
    ],
  );

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        const replacement = `@${item.path} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          {
            expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
          },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "model") {
          const replacement = "/model ";
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            {
              expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
            },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "provider-slash-command") {
        const replacement = `/${item.command.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        if (
          applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
            expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
          })
        ) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "skill") {
        const replacement = `$${item.skill.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        if (
          applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
            expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
          })
        ) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      onProviderModelSelect(item.provider, item.model);
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
    },
    [
      applyPromptReplacement,
      handleInteractionModeChange,
      onProviderModelSelect,
      resolveActiveComposerTrigger,
    ],
  );
  const onComposerMenuItemHighlighted = useCallback((itemId: string | null) => {
    setComposerHighlightedItemId(itemId);
  }, []);
  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) {
        return;
      }
      const highlightedIndex = composerMenuItems.findIndex(
        (item) => item.id === composerHighlightedItemId,
      );
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      const nextItem = composerMenuItems[nextIndex];
      setComposerHighlightedItemId(nextItem?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems],
  );
  const isComposerMenuLoading =
    composerTriggerKind === "path" &&
    ((pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
      workspaceEntriesQuery.isLoading ||
      workspaceEntriesQuery.isFetching);

  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[],
    ) => {
      if (activePendingProgress?.activeQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
        setComposerDraftTerminalContexts(
          threadId,
          syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
        );
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      composerTerminalContexts,
      onChangeActivePendingUserInputCustomAnswer,
      setPrompt,
      setComposerDraftTerminalContexts,
      threadId,
    ],
  );

  const onComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (key === "Tab" && event.shiftKey) {
      toggleInteractionMode();
      return true;
    }

    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = composerMenuOpenRef.current || trigger !== null;

    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current;
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if (key === "Tab" || key === "Enter") {
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
    }

    if (key === "Enter" && !event.shiftKey) {
      if (phase === "running" || isSendBusy) {
        onQueueMessage();
        return true;
      }
      void onSend();
      return true;
    }
    return false;
  };
  const onToggleWorkGroup = useCallback((groupId: string) => {
    setExpandedWorkGroups((existing) => ({
      ...existing,
      [groupId]: !existing[groupId],
    }));
  }, []);
  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      // The diff panel is a full Agents-tab feature driven by route search
      // params; the compact side chat has no diff route, so don't navigate there.
      if (compact || !environmentId) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [compact, environmentId, navigate, threadId],
  );
  const onRevertUserMessage = (messageId: MessageId) => {
    const targetTurnCount = revertTurnCountByUserMessageId.get(messageId);
    if (typeof targetTurnCount !== "number") {
      return;
    }
    void onRevertToTurnCount(targetTurnCount);
  };

  // Empty state: no active thread
  if (!activeThread) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Threads</span>
            </div>
          </header>
        )}
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs text-muted-foreground/50">No active thread</span>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/50">
              Select a thread or create a new one to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const shouldCenterEmptyThreadComposer =
    !paintOnlyDisplayedTimeline &&
    shouldUseCenteredEmptyComposer({
      isLocalDraftThread,
      hasTimelineEntries,
      isWorking,
    });
  const composerPromptLengthValidationMessage =
    submissionValidationMessage ?? getComposerPromptLengthValidationMessage(prompt);
  const composerSection = (
    <div className={cn("px-3 pt-1.5 sm:px-5 sm:pt-2", isGitRepo ? "pb-1" : "pb-3 sm:pb-4")}>
      <form
        ref={composerFormRef}
        onSubmit={onSend}
        className="mx-auto w-full min-w-0 max-w-3xl"
        data-chat-composer-form="true"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              addComposerImages(Array.from(event.target.files));
              event.target.value = "";
            }
          }}
        />
        {activeThreadIsSettled && (
          <div className="mb-1.5 flex justify-center px-2">
            <div
              className="flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/95 py-1.5 pl-2.5 pr-1.5 text-xs shadow-sm backdrop-blur"
              role="status"
              aria-label="This thread is settled. Sending a message will return it to Unsettled."
            >
              <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
              <span className="truncate font-medium text-foreground">Thread settled</span>
              <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
                Send a message to resume
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 rounded-full px-2 text-xs"
                onClick={() => {
                  const api = threadApi;
                  if (!api) return;
                  void api.orchestration.dispatchCommand({
                    type: "thread.unsettle",
                    commandId: newCommandId(),
                    threadId: activeThread.id,
                    reason: "user",
                  });
                }}
              >
                Unsettle
              </Button>
            </div>
          </div>
        )}
        <div
          className={cn(
            "group relative rounded-2xl p-0.5 transition-all duration-200",
            composerProviderState.composerFrameClassName,
          )}
          onDragEnter={onComposerDragEnter}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
        >
          {composerMenuOpen && !isComposerApprovalState && (
            <div className="absolute inset-x-0 bottom-full z-30 mb-2 px-1">
              <ComposerCommandMenu
                items={composerMenuItems}
                resolvedTheme={resolvedTheme}
                isLoading={isComposerMenuLoading}
                triggerKind={composerTriggerKind}
                activeItemId={activeComposerMenuItem?.id ?? null}
                onHighlightedItemChange={onComposerMenuItemHighlighted}
                onSelect={onSelectComposerItem}
              />
            </div>
          )}
          <div
            ref={composerCardRef}
            className={cn(
              "rounded-2xl border bg-card/90 shadow-md transition-all duration-200 overflow-hidden flex flex-col",
              isDragOverComposer
                ? "border-foreground/40 bg-accent/30"
                : "border-border/60 hover:border-border/80 has-focus-visible:border-foreground/30 has-focus-visible:ring-1 has-focus-visible:ring-foreground/20",
              composerProviderState.composerSurfaceClassName,
            )}
          >
            {/* Top Toolbar Row inside Prompt Box */}
            <div
              ref={composerFooterRef}
              data-chat-composer-footer="true"
              className={cn(
                "flex items-center justify-between border-b border-border/40 bg-muted/10 px-3 py-2",
                isComposerFooterCompact ? "gap-1.5" : "flex-wrap gap-2 sm:flex-nowrap sm:gap-0",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5",
                  isComposerFooterCompact
                    ? "overflow-hidden"
                    : "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible",
                )}
              >
                {isComposerFooterCompact ? (
                  <>
                    <ProviderModelPicker
                      compact={isComposerFooterCompact}
                      provider={selectedProvider}
                      model={selectedModelForPickerWithCustomFallback}
                      lockedProvider={lockedProvider}
                      providers={providerStatuses}
                      modelOptionsByProvider={modelOptionsByProvider}
                      {...(composerProviderState.modelPickerIconClassName
                        ? {
                            activeProviderIconClassName:
                              composerProviderState.modelPickerIconClassName,
                          }
                        : {})}
                      onProviderModelChange={onProviderModelSelect}
                    />
                    <CompactComposerControlsMenu
                      activePlan={Boolean(activePlan || sidebarProposedPlan || planSidebarOpen)}
                      interactionMode={interactionMode}
                      planSidebarOpen={planSidebarOpen}
                      runtimeMode={runtimeMode}
                      traitsMenuContent={providerTraitsMenuContent}
                      onToggleInteractionMode={toggleInteractionMode}
                      onTogglePlanSidebar={togglePlanSidebar}
                      onToggleRuntimeMode={toggleRuntimeMode}
                    />
                  </>
                ) : (
                  <>
                    <FusedModelPicker
                      provider={selectedProvider}
                      model={selectedModelForPickerWithCustomFallback}
                      lockedProvider={lockedProvider}
                      providers={providerStatuses}
                      prompt={prompt}
                      onPromptChange={setPromptFromTraits}
                      modelOptions={composerModelOptions?.[selectedProvider]}
                      onProviderModelChange={onProviderModelSelect}
                      onModelOptionsChange={onFusedModelOptionsChange}
                      popupAnchorRef={composerFooterRef}
                    />

                    <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

                    <Button
                      variant="ghost"
                      className={cn(
                        "shrink-0 whitespace-nowrap px-2.5 sm:px-3 text-xs font-medium transition-colors",
                        interactionMode === "plan"
                          ? "text-foreground font-semibold"
                          : "text-muted-foreground/70 hover:text-foreground/80",
                      )}
                      size="sm"
                      type="button"
                      onClick={toggleInteractionMode}
                      title={
                        interactionMode === "plan"
                          ? "Plan mode — click to return to normal chat mode"
                          : "Default mode — click to enter plan mode"
                      }
                    >
                      {interactionMode === "plan" ? <ListTodoIcon /> : <BotIcon />}
                      <span className="sr-only sm:not-sr-only">
                        {interactionMode === "plan" ? "Plan" : "Build"}
                      </span>
                    </Button>

                    <Button
                      variant="ghost"
                      className={cn(
                        "shrink-0 whitespace-nowrap px-2.5 sm:px-3 text-xs font-medium transition-colors",
                        runtimeMode === "full-access"
                          ? "text-foreground/90 font-semibold"
                          : runtimeMode === "auto-accept-edits"
                            ? "text-foreground/80 font-medium"
                            : "text-muted-foreground/70 hover:text-foreground/80",
                      )}
                      size="sm"
                      type="button"
                      onClick={() => {
                        const modes = [
                          "approval-required",
                          "auto-accept-edits",
                          "full-access",
                        ] as const;
                        const currentMode = runtimeMode || "approval-required";
                        const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
                        const nextMode = modes[nextIndex];
                        if (nextMode) {
                          void handleRuntimeModeChange(nextMode);
                        }
                      }}
                      title={
                        runtimeMode === "full-access"
                          ? "Full access — click to require approvals"
                          : runtimeMode === "auto-accept-edits"
                            ? "Auto-accept edits — click for full access"
                            : "Supervised — click for auto-accept edits"
                      }
                    >
                      {runtimeMode === "full-access" ? (
                        <LockOpenIcon />
                      ) : runtimeMode === "auto-accept-edits" ? (
                        <PenIcon />
                      ) : (
                        <LockIcon />
                      )}
                      <span className="sr-only sm:not-sr-only">
                        {runtimeMode === "full-access"
                          ? "Full access"
                          : runtimeMode === "auto-accept-edits"
                            ? "Auto-accept edits"
                            : "Supervised"}
                      </span>
                    </Button>

                    {activePlan || sidebarProposedPlan || planSidebarOpen ? (
                      <>
                        <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
                        <Button
                          variant="ghost"
                          className={cn(
                            "shrink-0 whitespace-nowrap px-2.5 sm:px-3 text-xs font-medium transition-colors",
                            planSidebarOpen
                              ? "text-foreground font-semibold"
                              : "text-muted-foreground/70 hover:text-foreground/80",
                          )}
                          size="sm"
                          type="button"
                          onClick={togglePlanSidebar}
                          title={planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"}
                        >
                          <ListTodoIcon />
                          <span className="sr-only sm:not-sr-only">Plan</span>
                        </Button>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {activeContextWindow ? (
                  <ContextWindowMeter
                    usage={activeContextWindow}
                    modelDisplayName={selectedModel}
                    onCompact={onCompactContext}
                    compactDisabled={compactDisabled}
                    compactDisabledReason={compactDisabledReason}
                  />
                ) : null}
                <div className="relative flex items-center gap-1">
                  <ComposerStashBadge
                    count={promptStashEntries.length}
                    menuOpen={isStashMenuOpen}
                    pulsing={stashPulsing}
                    onToggleMenu={() => openRightPanelSurface("stash")}
                  />
                  {(prompt.trim().length > 0 ||
                    composerImages.length > 0 ||
                    composerFiles.length > 0) && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 size-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/60 cursor-pointer"
                            onClick={() => void stashCurrentPrompt()}
                            aria-label={`Stash current draft (${typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌘S" : "Ctrl+S"})`}
                          >
                            <BookmarkPlusIcon className="size-3.5 text-foreground" />
                          </Button>
                        }
                      />
                      <TooltipPopup side="top">
                        Stash current draft (
                        {typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
                          ? "⌘S"
                          : "Ctrl+S"}
                        )
                      </TooltipPopup>
                    </Tooltip>
                  )}
                  <ComposerStashMenu
                    entries={promptStashEntries}
                    isOpen={isStashMenuOpen}
                    currentEnvironmentId={environmentId}
                    stashShortcutLabel={
                      typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
                        ? "⌘S"
                        : "Ctrl+S"
                    }
                    onRestore={(entry) => void restoreStashedPrompt(entry.id)}
                    onDelete={(entry) => removeStashedPrompt(entry.id)}
                    onClearAll={clearAllStashedPrompts}
                    onClose={() => setIsStashMenuOpen(false)}
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground/70 hover:text-foreground/80 px-2 sm:px-2.5"
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Attach images"
                        title="Attach images"
                      >
                        <ImageIcon className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">Attach images</TooltipPopup>
                </Tooltip>
              </div>
            </div>

            {/* Approval / Question Banners if active */}
            {activePendingApproval ? (
              <div className="border-b border-border/65 bg-muted/20">
                <ComposerPendingApprovalPanel
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                />
              </div>
            ) : pendingUserInputs.length > 0 ? (
              <div className="border-b border-border/65 bg-muted/20">
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  respondingRequestIds={respondingRequestIds}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onSelectOption={onSelectActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                />
              </div>
            ) : showPlanFollowUpPrompt && activeProposedPlan ? (
              <div className="border-b border-border/65 bg-muted/20">
                <ComposerPlanFollowUpBanner
                  key={activeProposedPlan.id}
                  planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                />
              </div>
            ) : null}

            {/* Main Textarea + Floating Action Area */}
            <div className="relative flex min-h-[76px] flex-col justify-between p-3 sm:p-3.5">
              {!isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerPreviewAnnotations.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap gap-2" aria-label="Preview annotations">
                    {composerPreviewAnnotations.map((annotation) => (
                      <div
                        key={annotation.id}
                        className="flex max-w-full items-center gap-2 rounded-md border border-border/80 bg-muted/30 px-2.5 py-1.5 text-xs"
                      >
                        <MousePointer2Icon className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {annotation.pageTitle || annotation.pageUrl || "Preview element"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            removeComposerDraftPreviewAnnotation(activeThread.id, annotation.id);
                          }}
                          aria-label={`Remove preview annotation from ${annotation.pageTitle || annotation.pageUrl}`}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

              {!isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerImages.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap gap-2">
                    {composerImages.map((image) => (
                      <div
                        key={image.id}
                        className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                      >
                        {image.previewUrl ? (
                          <button
                            type="button"
                            className="h-full w-full cursor-zoom-in"
                            aria-label={`Preview ${image.name}`}
                            onClick={() => {
                              const preview = buildExpandedImagePreview(composerImages, image.id);
                              if (!preview) return;
                              setExpandedImage(preview);
                            }}
                          >
                            <img
                              src={image.previewUrl}
                              alt={image.name}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground/70">
                            {image.name}
                          </div>
                        )}
                        {nonPersistedComposerImageIdSet.has(image.id) && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  role="img"
                                  aria-label="Draft attachment may not persist"
                                  className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                >
                                  <CircleAlertIcon className="size-3" />
                                </span>
                              }
                            />
                            <TooltipPopup
                              side="top"
                              className="max-w-64 whitespace-normal leading-tight"
                            >
                              Draft attachment could not be saved locally and may be lost on
                              navigation.
                            </TooltipPopup>
                          </Tooltip>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                          onClick={() => removeComposerImage(image.id)}
                          aria-label={`Remove ${image.name}`}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

              {!isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerFiles.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap gap-2">
                    {composerFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex max-w-64 items-center gap-2 rounded-lg border border-border/80 bg-background px-2.5 py-2 text-xs"
                      >
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate" title={file.name}>
                          {file.name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeComposerFile(file.id)}
                          aria-label={`Remove ${file.name}`}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

              {!isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerReviewComments.length > 0 && (
                  <ComposerPendingReviewComments
                    comments={composerReviewComments}
                    onRemove={(commentId) => removeComposerDraftReviewComment(threadId, commentId)}
                    className="mb-2.5"
                  />
                )}

              {/* Queued Messages Bar */}
              {threadQueuedMessages.length > 0 && (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-border/80 bg-muted/40 px-3 py-1.5 text-xs text-foreground/90 backdrop-blur-xs">
                  <div className="flex items-center gap-1.5 font-medium">
                    <ListOrderedIcon className="size-3.5 text-foreground" />
                    <span>
                      {threadQueuedMessages.length} message
                      {threadQueuedMessages.length === 1 ? "" : "s"} queued
                      {threadQueuedMessages.some((m) => m.scheduledFor)
                        ? " (with scheduled time)"
                        : " — will send when turn finishes"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openRightPanelSurface("queue")}
                      className="rounded px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-primary/10 cursor-pointer"
                    >
                      View Queue
                    </button>
                    <button
                      type="button"
                      onClick={() => activeThread && clearThreadQueue(activeThread.id)}
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                      title="Clear queue"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 pr-11">
                <ComposerPromptEditor
                  ref={composerEditorRef}
                  value={
                    isComposerApprovalState
                      ? ""
                      : activePendingProgress
                        ? activePendingProgress.customAnswer
                        : prompt
                  }
                  cursor={composerCursor}
                  terminalContexts={
                    !isComposerApprovalState && pendingUserInputs.length === 0
                      ? composerTerminalContexts
                      : []
                  }
                  onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                  historyMessages={activeThread?.messages ?? []}
                  onChange={onPromptChange}
                  onCommandKeyDown={onComposerCommandKey}
                  onCitationSubmitAndSend={() => void onSend()}
                  onPaste={onComposerPaste}
                  placeholder={
                    isComposerApprovalState
                      ? (activePendingApproval?.detail ??
                        "Resolve this approval request to continue")
                      : activePendingProgress
                        ? activePendingAllowsCustomAnswer
                          ? "Type your own answer, or leave this blank to use the selected option"
                          : "Choose one of the available options"
                        : showPlanFollowUpPrompt && activeProposedPlan
                          ? "Add feedback to refine the plan, or leave this blank to implement it"
                          : baseComposerPlaceholder
                  }
                  disabled={
                    isConnecting ||
                    isComposerApprovalState ||
                    (activePendingProgress !== null && !activePendingAllowsCustomAnswer)
                  }
                />
              </div>

              {/* Bottom Right Floating Send / Action Button */}
              <div className="absolute bottom-3 right-3 sm:bottom-3.5 sm:right-3.5 flex items-center gap-2">
                {activePendingApproval ? (
                  <ComposerPendingApprovalActions
                    requestId={activePendingApproval.requestId}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    options={activePendingApproval.options}
                    onRespondToApproval={onRespondToApproval}
                  />
                ) : isPreparingWorktree ? (
                  <span className="text-muted-foreground/70 text-xs">Preparing worktree...</span>
                ) : activePendingProgress ? (
                  <div className="flex items-center gap-2">
                    {activePendingProgress.questionIndex > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={onPreviousActivePendingUserInputQuestion}
                        disabled={activePendingIsResponding}
                      >
                        Previous
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      size="sm"
                      className="rounded-full px-4"
                      disabled={
                        activePendingIsResponding ||
                        (activePendingProgress.isLastQuestion
                          ? !activePendingResolvedAnswers
                          : !activePendingProgress.canAdvance)
                      }
                    >
                      {activePendingIsResponding
                        ? "Submitting..."
                        : activePendingProgress.isLastQuestion
                          ? "Submit answers"
                          : "Next question"}
                    </Button>
                  </div>
                ) : phase === "running" ? (
                  <div className="flex flex-col items-end gap-1.5">
                    {isStuck && activeThread && threadApi && (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300 dark:border-amber-400/20 dark:bg-amber-400/10">
                        <span>Agent may be stuck.</span>
                        <button
                          type="button"
                          className="font-medium underline underline-offset-2 cursor-pointer hover:text-amber-950 dark:hover:text-amber-200 transition-colors"
                          onClick={async () => {
                            try {
                              await threadApi.orchestration.dispatchCommand({
                                type: "thread.session.stop",
                                commandId: newCommandId(),
                                threadId: activeThread.id,
                                createdAt: new Date().toISOString(),
                              });
                              setIsStuck(false);
                              interruptAttemptedAtRef.current = null;
                              toastManager.add({
                                type: "info",
                                title: "Thread unblocked",
                                description: "The agent turn was stopped.",
                              });
                            } catch {
                              toastManager.add({
                                type: "error",
                                title: "Could not stop session",
                                description: "Failed to force-stop the session.",
                              });
                            }
                          }}
                        >
                          Force stop
                        </button>
                        <span className="text-muted-foreground/50">|</span>
                        <button
                          type="button"
                          className="font-medium underline underline-offset-2 cursor-pointer hover:text-amber-950 dark:hover:text-amber-200 transition-colors"
                          onClick={async () => {
                            try {
                              await threadApi.orchestration.dispatchCommand({
                                type: "thread.session.stop",
                                commandId: newCommandId(),
                                threadId: activeThread.id,
                                createdAt: new Date().toISOString(),
                              });
                              await threadApi.orchestration.dispatchCommand({
                                type: "thread.settle",
                                commandId: newCommandId(),
                                threadId: activeThread.id,
                              });
                              setIsStuck(false);
                              interruptAttemptedAtRef.current = null;
                            } catch {
                              toastManager.add({
                                type: "error",
                                title: "Could not settle thread",
                                description: "Please try again from the thread menu.",
                              });
                            }
                          }}
                        >
                          Force settle &rarr;
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      {composerSendState.hasSendableContent && (
                        <div className="flex items-center">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => onQueueMessage()}
                            className="h-8 gap-1.5 rounded-l-lg rounded-r-none border border-r-0 border-border/80 bg-secondary/90 px-2.5 text-xs font-medium text-foreground hover:bg-secondary transition-all cursor-pointer shadow-2xs"
                            title="Queue message for when agent finishes (Enter)"
                          >
                            <ListOrderedIcon className="size-3.5 text-foreground" />
                            <span>Queue</span>
                          </Button>
                          <Popover
                            open={isSchedulePopoverOpen}
                            onOpenChange={setIsSchedulePopoverOpen}
                            modal
                          >
                            <PopoverTrigger
                              render={
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-8 w-8 rounded-l-none rounded-r-lg border border-border/80 bg-secondary/90 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer shadow-2xs"
                                  title="Schedule message for specific time..."
                                  aria-label="Schedule message for specific time"
                                >
                                  <ClockIcon className="size-3.5" />
                                </Button>
                              }
                            />
                            <PopoverPopup
                              align="end"
                              side="top"
                              hasBackdrop
                              className="p-0 border-none bg-transparent shadow-none"
                            >
                              <AppleTimePicker
                                onConfirm={(scheduledDate) => {
                                  onQueueMessage(scheduledDate.toISOString());
                                  setIsSchedulePopoverOpen(false);
                                }}
                                onCancel={() => setIsSchedulePopoverOpen(false)}
                              />
                            </PopoverPopup>
                          </Popover>
                        </div>
                      )}
                      <button
                        type="button"
                        className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-rose-500/90 text-white transition-all duration-150 hover:bg-rose-500 hover:scale-105 sm:h-8 sm:w-8"
                        onClick={() => void onInterrupt()}
                        aria-label={
                          interruptAttemptedAtRef.current !== null
                            ? "Force stop session"
                            : "Stop generation"
                        }
                        title={
                          interruptAttemptedAtRef.current !== null
                            ? "Click again to force stop immediately"
                            : "Stop generation"
                        }
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="2" y="2" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : pendingUserInputs.length === 0 ? (
                  showPlanFollowUpPrompt ? (
                    prompt.trim().length > 0 ? (
                      <Button
                        type="submit"
                        size="sm"
                        className="h-9 rounded-full px-4 sm:h-8"
                        disabled={
                          isSendBusy ||
                          isConnecting ||
                          Boolean(composerPromptLengthValidationMessage)
                        }
                      >
                        {isConnecting || isSendBusy ? "Sending..." : "Refine"}
                      </Button>
                    ) : (
                      <div className="flex items-center">
                        <Button
                          type="submit"
                          size="sm"
                          className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
                          disabled={isSendBusy || isConnecting}
                        >
                          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
                        </Button>
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                size="sm"
                                variant="default"
                                className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
                                aria-label="Implementation actions"
                                disabled={isSendBusy || isConnecting}
                              >
                                <ChevronDownIcon className="size-3.5" />
                              </Button>
                            }
                          />
                          <MenuPopup align="end" side="top">
                            <MenuItem
                              disabled={isSendBusy || isConnecting}
                              onClick={() => void onImplementPlanInNewThread()}
                            >
                              Implement in a new thread
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </div>
                    )
                  ) : (
                    // Idle composer: split send button with schedule clock always visible
                    <div className="flex items-center">
                      <button
                        type="submit"
                        className="flex h-9 w-9 enabled:cursor-pointer items-center justify-center rounded-l-lg rounded-r-none bg-foreground text-background transition-all duration-150 hover:bg-foreground/90 hover:scale-105 disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100 sm:h-8 sm:w-8"
                        disabled={
                          isSendBusy ||
                          isConnecting ||
                          threadDetailLoading ||
                          !composerSendState.hasSendableContent ||
                          Boolean(composerPromptLengthValidationMessage)
                        }
                        aria-label={
                          threadDetailLoading
                            ? "Messages loading"
                            : isConnecting
                              ? "Connecting"
                              : isPreparingWorktree
                                ? "Preparing worktree"
                                : isSendBusy
                                  ? "Sending"
                                  : "Send message"
                        }
                      >
                        {isConnecting || isSendBusy ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            className="animate-spin"
                            aria-hidden="true"
                          >
                            <circle
                              cx="7"
                              cy="7"
                              r="5.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeDasharray="28"
                              strokeDashoffset="10"
                            />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M7 11.5V2.5" />
                            <path d="M2.5 7L7 2.5L11.5 7" />
                          </svg>
                        )}
                      </button>
                      {/* Clock / schedule button — always visible even on idle/fresh threads */}
                      <Popover
                        open={isIdleSchedulePopoverOpen}
                        onOpenChange={setIsIdleSchedulePopoverOpen}
                        modal
                      >
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              disabled={
                                !composerSendState.hasSendableContent ||
                                isSendBusy ||
                                isConnecting ||
                                threadDetailLoading ||
                                Boolean(composerPromptLengthValidationMessage)
                              }
                              aria-label="Schedule message for a specific time"
                              title="Schedule this message to send at a specific time"
                              className="flex h-9 w-7 enabled:cursor-pointer items-center justify-center rounded-l-none rounded-r-lg border-l border-foreground/15 bg-foreground text-background/70 transition-all duration-150 hover:bg-foreground/90 hover:text-background hover:scale-105 disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100 sm:h-8"
                            />
                          }
                        >
                          <ClockIcon className="size-3" />
                        </PopoverTrigger>
                        <PopoverPopup
                          align="end"
                          side="top"
                          hasBackdrop
                          className="p-0 border-none bg-transparent shadow-none"
                        >
                          <AppleTimePicker
                            onConfirm={(scheduledDate) => {
                              onQueueMessage(scheduledDate.toISOString());
                              setIsIdleSchedulePopoverOpen(false);
                            }}
                            onCancel={() => setIsIdleSchedulePopoverOpen(false)}
                          />
                        </PopoverPopup>
                      </Popover>
                    </div>
                  )
                ) : null}
              </div>
            </div>
            <ComposerPromptLengthValidation message={composerPromptLengthValidationMessage} />
          </div>
        </div>
      </form>
    </div>
  );
  const branchToolbar = isGitRepo ? (
    <BranchToolbar
      threadId={activeThread.id}
      {...(environmentId ? { environmentId } : {})}
      onEnvModeChange={onEnvModeChange}
      envLocked={envLocked}
      onComposerFocusRequest={scheduleComposerFocus}
      {...(canCheckoutPullRequestIntoThread
        ? { onCheckoutPullRequestRequest: openPullRequestDialog }
        : {})}
    />
  ) : null;

  return (
    <div
      onPointerDownCapture={onActivatePane}
      onFocusCapture={onActivatePane}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* Top bar — hidden in the compact side-chat embed (the Code tab provides
          its own chrome; the branch/github/terminal/diff tools live in Agents). */}
      {compact ? null : (
        <header
          className={cn(
            "@container/chat-header border-b border-border transition-colors",
            isSplitActive ? "px-2.5 sm:px-3" : "px-3 sm:px-5",
            isElectron ? "drag-region flex h-[52px] items-center" : "py-2 sm:py-3",
            isSplitActive && !isActivePane && "opacity-80 hover:opacity-100 transition-opacity",
          )}
        >
          <ChatHeader
            activeThreadId={activeThread.id}
            activeThreadTitle={activeThread.title}
            activeProjectName={activeProject?.name}
            isGitRepo={isGitRepo}
            openInCwd={gitCwd}
            keybindings={keybindings}
            availableEditors={availableEditors}
            terminalAvailable={activeProject !== undefined}
            terminalOpen={terminalState.terminalOpen}
            terminalToggleShortcutLabel={terminalToggleShortcutLabel}
            diffToggleShortcutLabel={diffPanelShortcutLabel}
            gitCwd={gitCwd}
            environmentId={activeProject?.environmentId}
            diffOpen={diffOpen}
            onToggleTerminal={toggleTerminalVisibility}
            onToggleDiff={onToggleDiff}
            isSplitActive={isSplitActive}
            isActivePane={isActivePane}
            isMaximized={isMaximized}
            onToggleMaximize={onToggleMaximize}
            onClosePane={onClosePane}
          />
        </header>
      )}

      {/* Error banner */}
      <ProviderStatusBanner
        status={visibleProviderStatus}
        onDismiss={() => setDismissedProviderStatusBannerKey(providerStatusBannerKey)}
      />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden")}>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                ref={setMessagesScrollContainerRef}
                className={cn(
                  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain py-3",
                  isSplitActive ? "px-2.5 sm:px-3" : "px-3 sm:px-5 sm:py-4",
                )}
                onScroll={onMessagesScroll}
                onClickCapture={onMessagesClickCapture}
                onWheel={onMessagesWheel}
                onPointerDown={onMessagesPointerDown}
                onPointerUp={onMessagesPointerUp}
                onPointerCancel={onMessagesPointerCancel}
                onTouchStart={onMessagesTouchStart}
                onTouchMove={onMessagesTouchMove}
                onTouchEnd={onMessagesTouchEnd}
                onTouchCancel={onMessagesTouchEnd}
              >
                <MessagesTimeline
                  key={displayedTimelineKey ?? activeThread.id}
                  hasMessages={hasTimelineEntries}
                  isWorking={!paintOnlyDisplayedTimeline && isWorking}
                  activeTurnInProgress={
                    !paintOnlyDisplayedTimeline && (isWorking || !latestTurnSettled)
                  }
                  activeTurnStartedAt={paintOnlyDisplayedTimeline ? null : activeWorkStartedAt}
                  scrollContainer={messagesScrollElement}
                  timelineEntries={displayedTimeline.entries}
                  completionDividerBeforeEntryId={
                    paintOnlyDisplayedTimeline ? null : completionDividerBeforeEntryId
                  }
                  completionSummary={paintOnlyDisplayedTimeline ? null : completionSummary}
                  turnDiffSummaryByAssistantMessageId={
                    paintOnlyDisplayedTimeline
                      ? (EMPTY_MAP as Map<MessageId, TurnDiffSummary>)
                      : turnDiffSummaryByAssistantMessageId
                  }
                  nowIso={nowIso}
                  expandedWorkGroups={expandedWorkGroups}
                  onToggleWorkGroup={onToggleWorkGroup}
                  onOpenTurnDiff={paintOnlyDisplayedTimeline ? noop : onOpenTurnDiff}
                  revertTurnCountByUserMessageId={
                    paintOnlyDisplayedTimeline
                      ? (EMPTY_MAP as Map<MessageId, number>)
                      : revertTurnCountByUserMessageId
                  }
                  onRevertUserMessage={paintOnlyDisplayedTimeline ? noop : onRevertUserMessage}
                  isRevertingCheckpoint={!paintOnlyDisplayedTimeline && isRevertingCheckpoint}
                  onImageExpand={onExpandTimelineImage}
                  markdownCwd={
                    (paintOnlyDisplayedTimeline ? heldPaintContext?.markdownCwd : gitCwd) ??
                    undefined
                  }
                  resolvedTheme={resolvedTheme}
                  timestampFormat={timestampFormat}
                  workspaceRoot={
                    (paintOnlyDisplayedTimeline
                      ? heldPaintContext?.workspaceRoot
                      : activeProject?.cwd) ?? undefined
                  }
                  environmentId={environmentId ?? undefined}
                  threadId={activeThread.id}
                  citationRequest={citationRequest}
                  onCiteAssistantText={citeAssistantText}
                  latestTaskDescription={paintOnlyDisplayedTimeline ? null : latestTaskDescription}
                  providerInstanceId={selectedProvider}
                />
              </div>

              {shouldCenterEmptyThreadComposer ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
                  <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground/92 sm:text-4xl">
                    {activeProject?.name
                      ? `What should we build in ${activeProject.name}?`
                      : "What should we build?"}
                  </h2>
                  <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground/65 sm:text-base">
                    Start a new thread with a task, question, or plan. Tabs will keep the project
                    context and workspace tools connected to this conversation.
                  </p>
                </div>
              ) : null}

              {showScrollToBottom && (
                <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                  <button
                    type="button"
                    onClick={() => scrollMessagesToBottom("smooth")}
                    className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
                  >
                    <ChevronDownIcon className="size-3.5" />
                    Scroll to bottom
                  </button>
                </div>
              )}
            </div>

            <div className="relative w-full">
              <div className="w-full">{composerSection}</div>
            </div>

            {branchToolbar}
          </div>
          {pullRequestDialogState ? (
            <PullRequestThreadDialog
              key={pullRequestDialogState.key}
              open
              cwd={activeProject?.cwd ?? null}
              initialReference={pullRequestDialogState.initialReference}
              onOpenChange={(open) => {
                if (!open) {
                  closePullRequestDialog();
                }
              }}
              onPrepared={handlePreparedPullRequestThread}
            />
          ) : null}
        </div>
        {/* end chat column */}

        {/* Plan sidebar */}
        {planSidebarOpen ? (
          <PlanSidebar
            activePlan={activePlan}
            activeProposedPlan={sidebarProposedPlan}
            markdownCwd={gitCwd ?? undefined}
            workspaceRoot={activeProject?.cwd ?? undefined}
            environmentId={environmentId ?? undefined}
            timestampFormat={timestampFormat}
            onClose={() => {
              setPlanSidebarOpen(false);
              // Track that the user explicitly dismissed for this turn so auto-open won't fight them.
              const turnKey = activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? null;
              if (turnKey) {
                planSidebarDismissedForTurnRef.current = turnKey;
              }
            }}
          />
        ) : null}
      </div>
      {/* end horizontal flex container */}

      {(() => {
        if (!terminalState.terminalOpen || !activeProject) {
          return null;
        }
        return (
          <ThreadTerminalDrawer
            key={activeThread.id}
            threadId={activeThread.id}
            cwd={gitCwd ?? activeProject.cwd}
            runtimeEnv={threadTerminalRuntimeEnv}
            height={terminalState.terminalHeight}
            terminalIds={terminalState.terminalIds}
            activeTerminalId={terminalState.activeTerminalId}
            terminalGroups={terminalState.terminalGroups}
            activeTerminalGroupId={terminalState.activeTerminalGroupId}
            focusRequestId={terminalFocusRequestId}
            onSplitTerminal={splitTerminal}
            onNewTerminal={createNewTerminal}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            onActiveTerminalChange={activateTerminal}
            onCloseTerminal={closeTerminal}
            onHeightChange={setTerminalHeight}
            onAddTerminalContext={addTerminalContextToDraft}
          />
        );
      })()}

      {expandedImage && (
        <ExpandedImageDialog preview={expandedImage} onClose={closeExpandedImage} />
      )}
      {confirmDialog}
    </div>
  );
}

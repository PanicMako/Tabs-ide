import {
  CommandId,
  DEFAULT_TEAMMATE_FINISH,
  DEFAULT_TEAMMATE_LOOK_AROUND,
  DEFAULT_TEAMMATE_NOTIFY,
  MessageId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type Teammate,
  TEAMMATE_DEFAULT_NAME,
  TeammateError,
  type TeammateActivity,
  type TeammateId,
  type TeammateItem,
  type TeammateItemId,
  type TeammateItemStatus,
  type TeammateMemoryFact,
  type TeammateMemoryFactId,
  type TeammateNotice,
  type TeammatesCreateInput,
  type TeammatesDeleteResult,
  type TeammatesItemsUpdateInput,
  type TeammatesLookAroundNowResult,
  type TeammatesOpenHomeResult,
  type TeammatesSnapshot,
  type TeammatesSuggestionsStartResult,
  type TeammatesUpdateInput,
  type TeammateSuggestion,
  type TeammateSuggestionId,
  ThreadId,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import { isBlockingRequest } from "../orchestration-v2/DelegatedTaskQuestionReactor.ts";
import { randomUuidV4 } from "../orchestration-v2/RandomUuid.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { forkParked } from "../serverActivation.ts";
import { deriveTeammateActivity, type ThreadActivityInput } from "./teammateActivity.ts";
import { lookAroundDueSlot } from "./lookAroundSchedule.ts";
import { TeammateHome } from "./TeammateHome.ts";
import { chooseWorkerWorkspace, type WorkerGit } from "./workerWorkspace.ts";
import { queueSoulNotice } from "./TeammateTurnHooks.ts";
import {
  type TeammateThreadKind,
  type TeammateThreadLink,
  TeammateStore,
} from "./TeammateStore.ts";
import {
  SUGGESTION_LIMITS,
  type WorkerOutcome,
  lookAroundPrompt,
  renderMemoryIndex,
  soulChangedNotice,
  suggestionDedupeKey,
  workerNotice,
} from "./teammateText.ts";

/** Everything a teammate's own chat may do through its MCP tool. */
export type TeammateAgentAction =
  | "remember"
  | "forget"
  | "item_add"
  | "item_set"
  | "item_done"
  | "item_list"
  | "worker_start"
  | "worker_status"
  | "worker_message"
  | "list_projects"
  | "list_threads"
  | "suggest";

/** A look-around turn only reads and suggests; it may never change anything else. */
const LOOK_AROUND_ACTIONS: ReadonlySet<TeammateAgentAction> = new Set([
  "suggest",
  "item_list",
  "worker_status",
  "list_projects",
  "list_threads",
]);

export interface AgentCaller {
  readonly teammate: Teammate;
  readonly link: TeammateThreadLink;
}

export interface WorkerStartInput {
  readonly prompt: string;
  readonly title?: string | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly itemId?: TeammateItemId | undefined;
  readonly newWorktree?: boolean | undefined;
  readonly baseRef?: string | undefined;
}

export interface WorkerStatus {
  readonly threadId: ThreadId;
  readonly itemId: TeammateItemId | null;
  readonly title: string;
  readonly status: string;
  readonly waitingOnPerson: boolean;
  readonly lastMessage: string | null;
}

const MAX_OPEN_SUGGESTIONS = 25;
const MAX_ITEM_TEXT = 4_000;
const MAX_FACT_TEXT = 500;
const HAPPY_MS = 8_000;
const MAX_NOTICES = 20;
const MAX_ACTIVITY_WORKERS = 20;
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);

const clamp = (text: string, max: number) => text.trim().slice(0, max);

export class TeammateService extends Context.Service<
  TeammateService,
  {
    readonly snapshot: Effect.Effect<TeammatesSnapshot, TeammateError>;
    /** The current snapshot, then a fresh one after every change. */
    readonly subscribe: Stream.Stream<TeammatesSnapshot, TeammateError>;
    readonly create: (input: TeammatesCreateInput) => Effect.Effect<Teammate, TeammateError>;
    readonly update: (input: TeammatesUpdateInput) => Effect.Effect<Teammate, TeammateError>;
    readonly delete: (id: TeammateId) => Effect.Effect<TeammatesDeleteResult, TeammateError>;
    readonly openHome: (id: TeammateId) => Effect.Effect<TeammatesOpenHomeResult, TeammateError>;
    readonly updateItem: (
      input: TeammatesItemsUpdateInput,
    ) => Effect.Effect<TeammateItem, TeammateError>;
    readonly startSuggestion: (
      id: TeammateSuggestionId,
    ) => Effect.Effect<TeammatesSuggestionsStartResult, TeammateError>;
    readonly dismissSuggestion: (
      id: TeammateSuggestionId,
    ) => Effect.Effect<TeammateSuggestion, TeammateError>;
    readonly listFacts: (
      id: TeammateId,
    ) => Effect.Effect<ReadonlyArray<TeammateMemoryFact>, TeammateError>;
    readonly forgetFact: (id: TeammateMemoryFactId) => Effect.Effect<void, TeammateError>;
    readonly lookAroundNow: (
      id: TeammateId,
    ) => Effect.Effect<TeammatesLookAroundNowResult, TeammateError>;
    readonly getSoul: (id: TeammateId) => Effect.Effect<string, TeammateError>;
    readonly setSoul: (id: TeammateId, soul: string) => Effect.Effect<string, TeammateError>;

    /** Whether a thread is a teammate's home or look-around chat (the only ones that see its tools). */
    readonly isTeammateThread: (threadId: ThreadId) => Effect.Effect<boolean>;
    // ---- The teammate's own tool (MCP). `caller` resolves from the calling thread.
    readonly resolveCaller: (
      threadId: ThreadId,
      action: TeammateAgentAction,
    ) => Effect.Effect<AgentCaller, TeammateError>;
    readonly remember: (
      caller: AgentCaller,
      input: { readonly text: string; readonly topic?: string | undefined },
    ) => Effect.Effect<
      { readonly factId: TeammateMemoryFactId; readonly saved: boolean },
      TeammateError
    >;
    readonly forget: (
      caller: AgentCaller,
      text: string,
    ) => Effect.Effect<{ readonly removed: number }, TeammateError>;
    readonly addItem: (
      caller: AgentCaller,
      input: {
        readonly title: string;
        readonly detail?: string | undefined;
        readonly link?: string | undefined;
      },
    ) => Effect.Effect<TeammateItem, TeammateError>;
    readonly setItem: (
      caller: AgentCaller,
      input: {
        readonly itemId: TeammateItemId;
        readonly status?: TeammateItemStatus | undefined;
        readonly title?: string | undefined;
        readonly detail?: string | undefined;
        readonly question?: string | null | undefined;
        readonly link?: string | null | undefined;
      },
    ) => Effect.Effect<TeammateItem, TeammateError>;
    readonly listItems: (
      caller: AgentCaller,
      all: boolean,
    ) => Effect.Effect<ReadonlyArray<TeammateItem>, TeammateError>;
    readonly suggest: (
      caller: AgentCaller,
      input: {
        readonly title: string;
        readonly why: string;
        readonly ask: string;
        readonly link?: string | undefined;
      },
    ) => Effect.Effect<{ readonly added: boolean; readonly reason?: string }, TeammateError>;
    readonly startWorker: (
      caller: AgentCaller,
      input: WorkerStartInput,
    ) => Effect.Effect<{ readonly threadId: ThreadId; readonly item: TeammateItem }, TeammateError>;
    readonly workerStatus: (
      caller: AgentCaller,
      threadId: ThreadId | undefined,
    ) => Effect.Effect<ReadonlyArray<WorkerStatus>, TeammateError>;
    readonly messageWorker: (
      caller: AgentCaller,
      input: { readonly threadId: ThreadId; readonly text: string },
    ) => Effect.Effect<void, TeammateError>;
    readonly listProjects: Effect.Effect<
      ReadonlyArray<{
        readonly projectId: ProjectId;
        readonly title: string;
        readonly workspaceRoot: string;
      }>,
      TeammateError
    >;
    readonly listThreads: (
      caller: AgentCaller,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{
        readonly threadId: ThreadId;
        readonly projectId: ProjectId;
        readonly title: string;
        readonly status: string;
        readonly branch: string | null;
      }>,
      TeammateError
    >;
  }
>()("tabs/teammates/TeammateService") {}

const make = Effect.gen(function* () {
  const store = yield* TeammateStore;
  const home = yield* TeammateHome;
  const launcher = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const scheduler = yield* Scheduler.Scheduler;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const gitDriver = yield* GitVcsDriver.GitVcsDriver;

  const workerGit: WorkerGit = {
    isRepository: (cwd) => gitWorkflow.isRepository(cwd).pipe(Effect.orElseSucceed(() => false)),
    defaultBranch: (cwd) =>
      gitDriver.resolvePrimaryRemoteName(cwd).pipe(
        Effect.flatMap((remote) => gitDriver.resolveDefaultBranchName(cwd, remote)),
        Effect.catch(() => Effect.succeed(null)),
        Effect.flatMap((remoteDefault) =>
          remoteDefault !== null
            ? Effect.succeed<string | null>(remoteDefault)
            : gitDriver
                .execute({
                  operation: "TeammateService.currentBranch",
                  cwd,
                  args: ["symbolic-ref", "--short", "HEAD"],
                  allowNonZeroExit: true,
                })
                .pipe(
                  Effect.map((result) =>
                    result.exitCode === 0 ? result.stdout.trim() || null : null,
                  ),
                  Effect.orElseSucceed((): string | null => null),
                ),
        ),
      ),
  };

  // Sliding(1): every signal triggers a full snapshot, so only the latest matters.
  const changes = yield* PubSub.sliding<void>(1);
  const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const writeLock = yield* Semaphore.make(1);
  const notices = yield* Ref.make<ReadonlyArray<TeammateNotice>>([]);
  const happyUntil = new Map<TeammateId, number>();
  const linkIndex = new Map<ThreadId, TeammateThreadLink>();
  const seenEvents = new Set<string>();
  // A look-around start in flight, so the scheduler tick and "Look now" never double-launch.
  const startingLook = new Set<TeammateId>();

  const fail = (message: string, teammateId?: TeammateId) => (cause?: unknown) =>
    new TeammateError({
      message,
      ...(teammateId === undefined ? {} : { teammateId }),
      ...(cause === undefined ? {} : { cause }),
    });
  const failWith = (message: string, teammateId?: TeammateId) =>
    Effect.fail(fail(message, teammateId)());
  const asTeammateError =
    (message: string, teammateId?: TeammateId) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError((cause) =>
          cause instanceof TeammateError ? cause : fail(message, teammateId)(cause),
        ),
      );

  const nowIso = Effect.map(
    Effect.clockWith((clock) => clock.currentTimeMillis),
    (ms) => new Date(ms).toISOString(),
  );
  const newId = (prefix: string) => randomUuidV4.pipe(Effect.map((uuid) => `${prefix}-${uuid}`));

  const link = (value: TeammateThreadLink) =>
    store
      .linkThread(value)
      .pipe(Effect.tap(() => Effect.sync(() => linkIndex.set(value.threadId, value))));

  const requireTeammate = (id: TeammateId) =>
    store
      .getTeammate(id)
      .pipe(
        Effect.flatMap((found) =>
          found === null ? failWith("That teammate no longer exists.", id) : Effect.succeed(found),
        ),
      );

  const publish = (teammate: Teammate) =>
    store.putTeammate(teammate).pipe(
      Effect.tap(() => notifyChanged),
      Effect.as(teammate),
    );

  // ------------------------------------------------------------------ models and projects

  const resolveProject = (teammate: Teammate, explicit?: ProjectId) =>
    Effect.gen(function* () {
      const projectId = explicit ?? teammate.projectId;
      if (projectId !== null && projectId !== undefined) return projectId;
      const scratch = yield* managedFolders.ensureScratchProject;
      return scratch.projectId;
    }).pipe(asTeammateError("Could not find a project for this teammate.", teammate.id));

  const resolveModel = (teammate: Teammate, projectId: ProjectId) =>
    Effect.gen(function* () {
      if (teammate.modelSelection !== null) return teammate.modelSelection;
      const current = yield* settings.getSettings;
      if (current.defaultModelSelection !== null) return current.defaultModelSelection;
      const project = yield* projects.getById(projectId);
      const projectModel = Option.isSome(project) ? project.value.defaultModelSelection : null;
      const chosen = projectModel ?? current.textGenerationModelSelection;
      if (chosen === null || chosen === undefined) {
        return yield* failWith(
          `Pick a model for ${teammate.name} in its settings; no default model is set.`,
          teammate.id,
        );
      }
      return chosen as ModelSelection;
    }).pipe(asTeammateError("Could not choose a model for this teammate.", teammate.id));

  const projectTitle = (projectId: ProjectId | null) =>
    projectId === null
      ? Effect.succeed<string | null>(null)
      : projects.getById(projectId).pipe(
          Effect.map((found) => (Option.isSome(found) ? found.value.title : null)),
          Effect.orElseSucceed((): string | null => null),
        );

  // ------------------------------------------------------------------ memory files

  const syncMemoryFile = (teammateId: TeammateId) =>
    Effect.gen(function* () {
      const facts = yield* store.listFacts(teammateId);
      const index = renderMemoryIndex(
        facts.map((fact) => ({ text: fact.text, topic: fact.topic, createdAt: fact.createdAt })),
      );
      yield* home.writeMemory(teammateId, index);
    }).pipe(asTeammateError("Could not update MEMORY.md.", teammateId));

  // The file keeps every line; the preamble loader caps what a chat reads.

  // ------------------------------------------------------------------ activity and snapshot

  const shellOf = (threadId: ThreadId) =>
    threads
      .getThreadShell(threadId)
      .pipe(Effect.orElseSucceed((): OrchestrationV2ThreadShell | null => null));

  const isActiveThread = (shell: OrchestrationV2ThreadShell | null) =>
    shell !== null && shell.archivedAt === null && shell.deletedAt === null;

  const activityFor = (
    teammate: Teammate,
    links: ReadonlyArray<TeammateThreadLink>,
    items: ReadonlyArray<TeammateItem>,
    now: number,
  ) =>
    Effect.gen(function* () {
      const open = new Set(
        items
          .filter((item) => item.status !== "done" && item.status !== "dropped")
          .map((item) => item.id),
      );
      const own = links.filter((candidate) => candidate.teammateId === teammate.id);
      const relevant = [
        ...own.filter((candidate) => candidate.kind === "home"),
        ...own.filter((candidate) => candidate.kind === "look-around").slice(-1),
        ...own
          .filter(
            (candidate) =>
              candidate.kind === "worker" &&
              candidate.itemId !== null &&
              open.has(candidate.itemId),
          )
          .slice(-MAX_ACTIVITY_WORKERS),
      ];
      const inputs = yield* Effect.forEach(
        relevant,
        (candidate) =>
          shellOf(candidate.threadId).pipe(
            Effect.map((shell): ThreadActivityInput | null =>
              shell === null || !isActiveThread(shell)
                ? null
                : {
                    threadId: candidate.threadId,
                    kind: candidate.kind,
                    status: shell.status,
                    hasPendingRequest: shell.pendingRuntimeRequest !== null,
                  },
            ),
          ),
        { concurrency: 8 },
      );
      const happy = (happyUntil.get(teammate.id) ?? 0) > now;
      return deriveTeammateActivity({
        teammateId: teammate.id,
        paused: teammate.paused,
        threads: inputs.filter((value): value is ThreadActivityInput => value !== null),
        needsYouItems: items.filter(
          (item) => item.teammateId === teammate.id && item.status === "needsYou",
        ).length,
        recentlyHappy: happy,
      });
    });

  const snapshotNow = Effect.gen(function* () {
    const [teammates, items, suggestions, links, noticeList] = yield* Effect.all([
      store.listTeammates,
      store.listItems,
      store.listSuggestions,
      store.listThreadLinks,
      Ref.get(notices),
    ]);
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const activity: TeammateActivity[] = yield* Effect.forEach(
      teammates,
      (teammate) => activityFor(teammate, links, items, now),
      { concurrency: 4 },
    );
    return {
      teammates,
      items,
      suggestions: suggestions.filter((suggestion) => suggestion.status !== "dismissed"),
      activity,
      notices: noticeList,
      hiddenThreadIds: links
        .filter((candidate) => candidate.kind !== "worker")
        .map((candidate) => candidate.threadId),
    } satisfies TeammatesSnapshot;
  }).pipe(asTeammateError("Could not read teammates."));

  const nextName = (existing: ReadonlyArray<Teammate>) => {
    const taken = new Set(existing.map((teammate) => teammate.name.toLowerCase()));
    if (!taken.has(TEAMMATE_DEFAULT_NAME.toLowerCase())) return TEAMMATE_DEFAULT_NAME;
    for (let n = 2; ; n += 1) {
      const candidate = `${TEAMMATE_DEFAULT_NAME} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  };

  const createTeammate = (input: TeammatesCreateInput) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const existing = yield* store.listTeammates;
        const id = (yield* newId("teammate")) as TeammateId;
        const now = yield* nowIso;
        const name = input.name ?? nextName(existing);
        const teammate: Teammate = {
          id,
          name,
          finish: input.finish ?? DEFAULT_TEAMMATE_FINISH,
          modelSelection: input.modelSelection ?? null,
          projectId: input.projectId ?? null,
          paused: false,
          lookAround: { ...DEFAULT_TEAMMATE_LOOK_AROUND },
          notify: { ...DEFAULT_TEAMMATE_NOTIFY },
          homeThreadId: null,
          lastLookAroundAt: null,
          createdAt: now,
          updatedAt: now,
        };
        yield* home.ensure({ id, name, soul: input.soul });
        yield* publish(teammate);
        return teammate;
      }).pipe(asTeammateError("Could not create the teammate.")),
    );

  /** On first enable, one teammate named Notch exists. */
  const ensureDefault = Effect.gen(function* () {
    const current = yield* settings.getSettings;
    if (!current.teammatesEnabled) return;
    // Only once ever: deleting the last teammate must not bring Notch back.
    if (yield* home.defaultSeeded) return;
    if ((yield* store.listTeammates).length > 0) {
      yield* home.markDefaultSeeded;
      return;
    }
    yield* home.markDefaultSeeded;
    yield* createTeammate({});
  }).pipe(Effect.orElseSucceed(() => undefined));

  const snapshot = ensureDefault.pipe(Effect.andThen(snapshotNow));

  const subscribe = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const settingsChanges = yield* settings.subscribeChanges;
      return Stream.concat(
        Stream.fromEffect(snapshot),
        Stream.merge(
          Stream.fromSubscription(subscription),
          settingsChanges.pipe(Stream.map(() => undefined)),
        ).pipe(Stream.mapEffect(() => snapshot)),
      );
    }),
  ).pipe(
    Stream.mapError((cause) =>
      cause instanceof TeammateError ? cause : fail("Teammates stream failed.")(cause),
    ),
  );

  // ------------------------------------------------------------------ threads

  const launchThread = (input: {
    readonly teammate: Teammate;
    readonly kind: TeammateThreadKind;
    readonly itemId: TeammateItemId | null;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly prompt: string | null;
    readonly runtimeMode: "approval-required" | "default";
    readonly workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy;
    readonly createdBy: "user" | "agent" | "system";
    readonly creationSource: "web" | "mcp" | "server";
  }) =>
    Effect.gen(function* () {
      const modelSelection = yield* resolveModel(input.teammate, input.projectId);
      const current = yield* settings.getSettings;
      const threadId = yield* ids.allocate.thread({ projectId: input.projectId });
      const createdAt = yield* nowIso;
      // Linked before launch: the first turn already needs the preamble and the tool.
      yield* link({
        threadId,
        teammateId: input.teammate.id,
        kind: input.kind,
        itemId: input.itemId,
        createdAt,
      });
      const uuid = yield* randomUuidV4;
      yield* launcher
        .launch({
          commandId: CommandId.make(`teammate:${input.kind}:${uuid}`),
          threadId,
          projectId: input.projectId,
          title: input.title.slice(0, 120),
          modelSelection,
          runtimeMode:
            input.runtimeMode === "default" ? current.defaultRuntimeMode : "approval-required",
          interactionMode: "default",
          workspaceStrategy: input.workspaceStrategy,
          ...(input.prompt === null
            ? {}
            : {
                initialMessage: {
                  messageId: MessageId.make(`teammate:${input.kind}:${uuid}:message`),
                  text: input.prompt,
                  attachments: [],
                },
              }),
          // Home and look-around chats are reached through the Teammates panel, so the
          // thread itself carries the marker; the sidebar needs no Labs-gated lookup.
          ...(input.kind === "worker" ? {} : { teammate: true }),
          createdBy: input.createdBy,
          creationSource: input.creationSource,
        })
        .pipe(Effect.tapError(() => Effect.sync(() => linkIndex.delete(threadId))));
      return threadId;
    }).pipe(
      asTeammateError(`Could not start a chat for ${input.teammate.name}.`, input.teammate.id),
    );

  const homeThreadIsUsable = (threadId: ThreadId) =>
    shellOf(threadId).pipe(Effect.map(isActiveThread));

  const openHome = (id: TeammateId) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const teammate = yield* requireTeammate(id);
        yield* home.ensure({ id, name: teammate.name });
        if (teammate.homeThreadId !== null && (yield* homeThreadIsUsable(teammate.homeThreadId))) {
          const shell = yield* shellOf(teammate.homeThreadId);
          return { teammateId: id, threadId: teammate.homeThreadId, projectId: shell!.projectId };
        }
        const projectId = yield* resolveProject(teammate);
        const threadId = yield* launchThread({
          teammate,
          kind: "home",
          itemId: null,
          projectId,
          title: teammate.name,
          prompt: null,
          runtimeMode: "default",
          workspaceStrategy: { type: "root" },
          createdBy: "system",
          creationSource: "server",
        });
        yield* publish({ ...teammate, homeThreadId: threadId, updatedAt: yield* nowIso });
        return { teammateId: id, threadId, projectId };
      }).pipe(asTeammateError("Could not open the home chat.", id)),
    );

  const archiveThread = (threadId: ThreadId, tag: string) =>
    newId(tag).pipe(
      Effect.flatMap((commandId) =>
        threads.dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`teammate:archive:${commandId}`),
          threadId,
        }),
      ),
      Effect.catchCause(() => Effect.void),
    );

  /** Sends a note into a teammate's home chat; the teammate answers it like any message. */
  const postToHome = (teammate: Teammate, key: string, text: string) =>
    Effect.gen(function* () {
      if (teammate.homeThreadId === null) return;
      const shell = yield* shellOf(teammate.homeThreadId);
      if (!isActiveThread(shell)) return;
      yield* threads.sendToThread({
        projectId: shell!.projectId,
        commandId: CommandId.make(`teammate:note:${key}`),
        threadId: teammate.homeThreadId,
        messageId: MessageId.make(`teammate:note:${key}:message`),
        text,
        attachments: [],
        mode: "queue",
        createdBy: "system",
        creationSource: "server",
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not post a note to a teammate home chat", {
          teammateId: teammate.id,
          cause,
        }),
      ),
    );

  const addNotice = (input: Omit<TeammateNotice, "id" | "at">) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(input.teammateId);
      if (teammate === null || !teammate.notify[input.kind]) return;
      const id = yield* newId("notice");
      const at = yield* nowIso;
      yield* Ref.update(notices, (current) =>
        [...current, { ...input, id, at }].slice(-MAX_NOTICES),
      );
    }).pipe(Effect.orElseSucceed(() => undefined));

  // ------------------------------------------------------------------ items

  const touchItem = (item: TeammateItem, patch: Partial<TeammateItem>) =>
    Effect.gen(function* () {
      const next: TeammateItem = { ...item, ...patch, updatedAt: yield* nowIso };
      yield* store.putItem(next);
      yield* notifyChanged;
      return next;
    });

  const requireItem = (id: TeammateItemId, teammateId?: TeammateId) =>
    store
      .getItem(id)
      .pipe(
        Effect.flatMap((found) =>
          found === null || (teammateId !== undefined && found.teammateId !== teammateId)
            ? failWith("That item no longer exists.", teammateId)
            : Effect.succeed(found),
        ),
      );

  const normalizeItemPatch = (
    item: TeammateItem,
    patch: {
      readonly status?: TeammateItemStatus | undefined;
      readonly title?: string | undefined;
      readonly detail?: string | undefined;
      readonly question?: string | null | undefined;
      readonly link?: string | null | undefined;
    },
  ): Partial<TeammateItem> => {
    const status = patch.status ?? item.status;
    const question =
      patch.question !== undefined
        ? patch.question === null
          ? null
          : clamp(patch.question, 400)
        : status === "needsYou"
          ? item.question
          : null;
    return {
      ...(patch.title === undefined ? {} : { title: clamp(patch.title, 200) || item.title }),
      ...(patch.detail === undefined ? {} : { detail: clamp(patch.detail, MAX_ITEM_TEXT) }),
      ...(patch.link === undefined
        ? {}
        : { link: patch.link === null ? null : clamp(patch.link, 500) }),
      status,
      question: status === "needsYou" ? question : null,
    };
  };

  const updateItem: TeammateService["Service"]["updateItem"] = (input) =>
    Effect.gen(function* () {
      const item = yield* requireItem(input.id);
      return yield* touchItem(item, normalizeItemPatch(item, input.patch));
    }).pipe(asTeammateError("Could not update the item."));

  const createItem = (
    teammateId: TeammateId,
    input: {
      readonly title: string;
      readonly detail?: string | undefined;
      readonly link?: string | null | undefined;
      readonly status?: TeammateItemStatus | undefined;
      readonly workerThreadIds?: ReadonlyArray<ThreadId> | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const item: TeammateItem = {
        id: (yield* newId("item")) as TeammateItemId,
        teammateId,
        title: clamp(input.title, 200) || "Untitled",
        detail: clamp(input.detail ?? "", MAX_ITEM_TEXT),
        status: input.status ?? "todo",
        workerThreadIds: [...(input.workerThreadIds ?? [])],
        question: null,
        link: input.link === undefined || input.link === null ? null : clamp(input.link, 500),
        createdAt: now,
        updatedAt: now,
      };
      yield* store.putItem(item);
      yield* notifyChanged;
      return item;
    });

  // ------------------------------------------------------------------ workers

  const launchWorker = (input: {
    readonly teammate: Teammate;
    readonly prompt: string;
    readonly title: string;
    readonly projectId?: ProjectId | undefined;
    readonly item: TeammateItem;
    readonly newWorktree?: boolean | undefined;
    readonly baseRef?: string | undefined;
    readonly createdBy: "user" | "agent";
    readonly creationSource: "web" | "mcp";
  }) =>
    Effect.gen(function* () {
      const projectId = input.projectId ?? input.teammate.projectId;
      if (projectId === null || projectId === undefined) {
        return yield* failWith(
          `${input.teammate.name} needs a default project to start workers. Pick one in its settings.`,
          input.teammate.id,
        );
      }
      const project = yield* projects
        .getById(projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      const workspaceStrategy = Option.isSome(project)
        ? yield* chooseWorkerWorkspace(workerGit, project.value.workspaceRoot, input)
        : ({ type: "root" } as const);
      const threadId = yield* launchThread({
        teammate: input.teammate,
        kind: "worker",
        itemId: input.item.id,
        projectId,
        title: input.title,
        prompt: input.prompt,
        runtimeMode: "default",
        workspaceStrategy,
        createdBy: input.createdBy,
        creationSource: input.creationSource,
      });
      const item = yield* touchItem(input.item, {
        status:
          input.item.status === "done" || input.item.status === "dropped" ? "working" : "working",
        question: null,
        workerThreadIds: [...input.item.workerThreadIds, threadId],
      });
      return { threadId, item };
    });

  const startSuggestion: TeammateService["Service"]["startSuggestion"] = (id) =>
    Effect.gen(function* () {
      const suggestion = yield* store.getSuggestion(id);
      if (suggestion === null) return yield* failWith("That suggestion no longer exists.");
      if (suggestion.status !== "open")
        return yield* failWith("That suggestion was already handled.", suggestion.teammateId);
      const teammate = yield* requireTeammate(suggestion.teammateId);
      const item = yield* createItem(teammate.id, {
        title: suggestion.title,
        detail: suggestion.why,
        link: suggestion.link,
        status: "working",
      });
      const started = yield* launchWorker({
        teammate,
        prompt: suggestion.ask,
        title: suggestion.title,
        item,
        createdBy: "user",
        creationSource: "web",
      }).pipe(Effect.tapError(() => touchItem(item, { status: "dropped" }).pipe(Effect.ignore)));
      yield* store.setSuggestionStatus(id, "started");
      yield* notifyChanged;
      return {
        suggestion: { ...suggestion, status: "started" as const },
        item: started.item,
        workerThreadId: started.threadId,
      };
    }).pipe(asTeammateError("Could not start that suggestion."));

  const dismissSuggestion: TeammateService["Service"]["dismissSuggestion"] = (id) =>
    Effect.gen(function* () {
      const suggestion = yield* store.getSuggestion(id);
      if (suggestion === null) return yield* failWith("That suggestion no longer exists.");
      yield* store.setSuggestionStatus(id, "dismissed");
      yield* notifyChanged;
      return { ...suggestion, status: "dismissed" as const };
    }).pipe(asTeammateError("Could not dismiss that suggestion."));

  // ------------------------------------------------------------------ look around

  const lookHistory = (teammateId: TeammateId) =>
    store.listSuggestions.pipe(
      Effect.map((all) => {
        const own = all.filter((suggestion) => suggestion.teammateId === teammateId);
        return {
          open: own.filter((s) => s.status === "open").map((s) => s.title),
          started: own
            .filter((s) => s.status === "started")
            .slice(-10)
            .map((s) => s.title),
          dismissed: own
            .filter((s) => s.status === "dismissed")
            .slice(-50)
            .map((s) => s.title),
        };
      }),
    );

  const latestLookThread = (teammateId: TeammateId) =>
    store.listThreadLinks.pipe(
      Effect.map(
        (links) =>
          links
            .filter(
              (candidate) =>
                candidate.teammateId === teammateId && candidate.kind === "look-around",
            )
            .at(-1) ?? null,
      ),
    );

  const startLookAround = (teammate: Teammate) =>
    Effect.gen(function* () {
      if (startingLook.has(teammate.id)) return { status: "busy" as const, threadId: null };
      startingLook.add(teammate.id);
      return yield* Effect.gen(function* () {
        const last = yield* latestLookThread(teammate.id);
        if (last !== null) {
          const shell = yield* shellOf(last.threadId);
          const active =
            shell !== null &&
            ["preparing", "queued", "starting", "running", "waiting"].includes(shell.status);
          if (active) return { status: "busy" as const, threadId: last.threadId };
        }
        const projectId = yield* resolveProject(teammate);
        const prompt = lookAroundPrompt({
          name: teammate.name,
          focus: teammate.lookAround.focus,
          maxSuggestions: teammate.lookAround.maxSuggestions,
          history: yield* lookHistory(teammate.id),
          projectName: yield* projectTitle(teammate.projectId),
        });
        const now = yield* nowIso;
        // Stamp first: a failed launch is retried at the next slot, not every five seconds.
        yield* publish({ ...teammate, lastLookAroundAt: now, updatedAt: now });
        yield* home.ensure({ id: teammate.id, name: teammate.name });
        const threadId = yield* launchThread({
          teammate,
          kind: "look-around",
          itemId: null,
          projectId,
          title: `${teammate.name}: look around`,
          prompt,
          runtimeMode: "approval-required",
          workspaceStrategy: { type: "root" },
          createdBy: "system",
          creationSource: "server",
        });
        return { status: "started" as const, threadId };
      }).pipe(Effect.ensuring(Effect.sync(() => startingLook.delete(teammate.id))));
    });

  const lookAroundNow: TeammateService["Service"]["lookAroundNow"] = (id) =>
    requireTeammate(id).pipe(
      Effect.flatMap(startLookAround),
      asTeammateError("Could not look around.", id),
    );

  const runDueLooks = Effect.gen(function* () {
    const current = yield* settings.getSettings;
    if (!current.teammatesEnabled) return;
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    for (const teammate of yield* store.listTeammates) {
      if (teammate.paused || !teammate.lookAround.enabled) continue;
      const armed = Date.parse(teammate.lookAround.since ?? teammate.createdAt);
      const slot = lookAroundDueSlot({
        preset: teammate.lookAround.preset,
        armedAt: Number.isNaN(armed) ? now : armed,
        lastLookAt:
          teammate.lastLookAroundAt === null ? null : Date.parse(teammate.lastLookAroundAt),
        now,
      });
      if (slot === null) continue;
      yield* startLookAround(teammate).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Teammate look-around failed to start", {
            teammateId: teammate.id,
            cause,
          }),
        ),
      );
    }
  });

  // ------------------------------------------------------------------ CRUD

  const update: TeammateService["Service"]["update"] = (input) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const teammate = yield* requireTeammate(input.id);
        const patch = input.patch;
        const now = yield* nowIso;
        const defined = <T extends object>(
          value: T | undefined,
        ): { [K in keyof T]?: Exclude<T[K], undefined> } =>
          Object.fromEntries(
            Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
          ) as { [K in keyof T]?: Exclude<T[K], undefined> };
        const lookAround = { ...teammate.lookAround, ...defined(patch.lookAround) };
        const turnedOn = patch.lookAround?.enabled === true && !teammate.lookAround.enabled;
        const next: Teammate = {
          ...teammate,
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.finish === undefined ? {} : { finish: patch.finish }),
          ...(patch.modelSelection === undefined ? {} : { modelSelection: patch.modelSelection }),
          ...(patch.projectId === undefined ? {} : { projectId: patch.projectId }),
          ...(patch.paused === undefined ? {} : { paused: patch.paused }),
          lookAround:
            turnedOn || teammate.lookAround.since === undefined
              ? { ...lookAround, since: now }
              : lookAround,
          notify: { ...teammate.notify, ...defined(patch.notify) },
          updatedAt: now,
        };
        yield* publish(next);
        if (
          patch.name !== undefined &&
          patch.name !== teammate.name &&
          teammate.homeThreadId !== null
        ) {
          const uuid = yield* randomUuidV4;
          yield* threads
            .dispatch({
              type: "thread.metadata.update",
              commandId: CommandId.make(`teammate:rename:${uuid}`),
              threadId: teammate.homeThreadId,
              title: patch.name,
            })
            .pipe(Effect.catchCause(() => Effect.void));
        }
        return next;
      }).pipe(asTeammateError("Could not update the teammate.", input.id)),
    );

  const deleteTeammate: TeammateService["Service"]["delete"] = (id) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        yield* requireTeammate(id);
        const links = yield* store.deleteTeammate(id);
        for (const entry of links) {
          linkIndex.delete(entry.threadId);
          // Workers are ordinary threads and stay; the chats that only existed for it go away.
          if (entry.kind !== "worker") yield* archiveThread(entry.threadId, "delete");
        }
        yield* home.remove(id);
        yield* home.markDefaultSeeded;
        yield* notifyChanged;
        return { id };
      }).pipe(asTeammateError("Could not delete the teammate.", id)),
    );

  const create: TeammateService["Service"]["create"] = (input) => createTeammate(input);

  // ------------------------------------------------------------------ memory and soul

  const listFacts: TeammateService["Service"]["listFacts"] = (id) => store.listFacts(id);

  const forgetFact: TeammateService["Service"]["forgetFact"] = (id) =>
    Effect.gen(function* () {
      const fact = yield* store.getFact(id);
      if (fact === null) return;
      yield* store.deleteFact(id);
      yield* syncMemoryFile(fact.teammateId);
      yield* notifyChanged;
    }).pipe(asTeammateError("Could not forget that."));

  const getSoul: TeammateService["Service"]["getSoul"] = (id) =>
    Effect.gen(function* () {
      const teammate = yield* requireTeammate(id);
      yield* home.ensure({ id, name: teammate.name });
      return (yield* home.readSoul(id)) ?? "";
    }).pipe(asTeammateError("Could not read SOUL.md.", id));

  const setSoul: TeammateService["Service"]["setSoul"] = (id, soul) =>
    Effect.gen(function* () {
      yield* requireTeammate(id);
      yield* home.writeSoul(id, soul);
      queueSoulNotice(id, soulChangedNotice(soul));
      return soul;
    }).pipe(asTeammateError("Could not save SOUL.md.", id));

  // ------------------------------------------------------------------ the teammate's own tool

  const isTeammateThread: TeammateService["Service"]["isTeammateThread"] = (threadId) =>
    Effect.gen(function* () {
      const found = linkIndex.get(threadId) ?? (yield* store.getThreadLink(threadId));
      return found !== null && found !== undefined && found.kind !== "worker";
    }).pipe(Effect.orElseSucceed(() => false));

  const resolveCaller: TeammateService["Service"]["resolveCaller"] = (threadId, action) =>
    Effect.gen(function* () {
      const found = linkIndex.get(threadId) ?? (yield* store.getThreadLink(threadId));
      if (found === null || found === undefined || found.kind === "worker") {
        return yield* failWith("This tool is only available in a teammate's own chat.");
      }
      if (found.kind === "look-around" && !LOOK_AROUND_ACTIONS.has(action)) {
        return yield* failWith(
          `A look-around only reads and suggests; "${action}" is not allowed here. Suggest it instead.`,
          found.teammateId,
        );
      }
      const teammate = yield* requireTeammate(found.teammateId);
      return { teammate, link: found };
    });

  const remember: TeammateService["Service"]["remember"] = (caller, input) =>
    Effect.gen(function* () {
      const text = clamp(input.text, MAX_FACT_TEXT);
      if (text === "") return yield* failWith("Nothing to remember.", caller.teammate.id);
      const existing = yield* store.listFacts(caller.teammate.id);
      const same = existing.find((fact) => fact.text.toLowerCase() === text.toLowerCase());
      if (same !== undefined) return { factId: same.id, saved: false };
      const fact: TeammateMemoryFact = {
        id: (yield* newId("fact")) as TeammateMemoryFactId,
        teammateId: caller.teammate.id,
        text,
        topic:
          input.topic === undefined || input.topic.trim() === "" ? null : clamp(input.topic, 60),
        source: "teammate",
        createdAt: yield* nowIso,
      };
      yield* store.insertFact(fact);
      yield* syncMemoryFile(caller.teammate.id);
      yield* notifyChanged;
      return { factId: fact.id, saved: true };
    }).pipe(asTeammateError("Could not save that to memory.", caller.teammate.id));

  const forget: TeammateService["Service"]["forget"] = (caller, text) =>
    Effect.gen(function* () {
      const needle = text.trim().toLowerCase();
      if (needle === "") return yield* failWith("Say which fact to forget.", caller.teammate.id);
      const matches = (yield* store.listFacts(caller.teammate.id)).filter((fact) =>
        fact.text.toLowerCase().includes(needle),
      );
      for (const fact of matches) yield* store.deleteFact(fact.id);
      if (matches.length > 0) {
        yield* syncMemoryFile(caller.teammate.id);
        yield* notifyChanged;
      }
      return { removed: matches.length };
    }).pipe(asTeammateError("Could not forget that.", caller.teammate.id));

  const addItem: TeammateService["Service"]["addItem"] = (caller, input) =>
    createItem(caller.teammate.id, input).pipe(
      asTeammateError("Could not add the item.", caller.teammate.id),
    );

  const setItem: TeammateService["Service"]["setItem"] = (caller, input) =>
    Effect.gen(function* () {
      const item = yield* requireItem(input.itemId, caller.teammate.id);
      const next = yield* touchItem(item, normalizeItemPatch(item, input));
      if (next.status === "needsYou" && item.status !== "needsYou") {
        yield* addNotice({
          teammateId: caller.teammate.id,
          kind: "needsYou",
          title: next.question ?? next.title,
          itemId: next.id,
          threadId: caller.teammate.homeThreadId,
        });
        yield* notifyChanged;
      }
      return next;
    }).pipe(asTeammateError("Could not update the item.", caller.teammate.id));

  const listItems: TeammateService["Service"]["listItems"] = (caller, all) =>
    store.listItems.pipe(
      Effect.map((items) =>
        items.filter(
          (item) =>
            item.teammateId === caller.teammate.id &&
            (all || (item.status !== "done" && item.status !== "dropped")),
        ),
      ),
      asTeammateError("Could not list items.", caller.teammate.id),
    );

  const suggest: TeammateService["Service"]["suggest"] = (caller, input) =>
    Effect.gen(function* () {
      const title = clamp(input.title, SUGGESTION_LIMITS.title);
      const ask = clamp(input.ask, SUGGESTION_LIMITS.ask);
      if (title === "" || ask === "")
        return yield* failWith("A suggestion needs a title and an ask.", caller.teammate.id);
      const all = yield* store.listSuggestions;
      const own = all.filter((suggestion) => suggestion.teammateId === caller.teammate.id);
      if (own.filter((suggestion) => suggestion.status === "open").length >= MAX_OPEN_SUGGESTIONS) {
        return {
          added: false,
          reason: "The Up Next list is full; the owner has to act on some first.",
        };
      }
      if (caller.link.kind === "look-around") {
        const thisLook = own.filter((suggestion) => suggestion.createdAt >= caller.link.createdAt);
        if (thisLook.length >= caller.teammate.lookAround.maxSuggestions) {
          return {
            added: false,
            reason: `Limit of ${caller.teammate.lookAround.maxSuggestions} suggestions per look reached.`,
          };
        }
      }
      const link =
        input.link === undefined || input.link.trim() === "" ? null : clamp(input.link, 500);
      const suggestion: TeammateSuggestion = {
        id: (yield* newId("suggestion")) as TeammateSuggestionId,
        teammateId: caller.teammate.id,
        title,
        why: clamp(input.why, SUGGESTION_LIMITS.why),
        ask,
        link,
        status: "open",
        createdAt: yield* nowIso,
      };
      const added = yield* store.insertSuggestionIfNew(
        suggestion,
        suggestionDedupeKey(title, link),
      );
      if (added) yield* notifyChanged;
      return added
        ? { added: true }
        : { added: false, reason: "Already suggested before (listed, started or dismissed)." };
    }).pipe(asTeammateError("Could not add the suggestion.", caller.teammate.id));

  const startWorker: TeammateService["Service"]["startWorker"] = (caller, input) =>
    Effect.gen(function* () {
      const prompt = input.prompt.trim();
      if (prompt === "") return yield* failWith("A worker needs a prompt.", caller.teammate.id);
      const title = clamp(input.title ?? prompt.split("\n")[0] ?? "Worker", 120);
      const item =
        input.itemId === undefined
          ? yield* createItem(caller.teammate.id, { title, detail: "", status: "working" })
          : yield* requireItem(input.itemId, caller.teammate.id);
      const started = yield* launchWorker({
        teammate: caller.teammate,
        prompt,
        title,
        projectId: input.projectId,
        item,
        newWorktree: input.newWorktree,
        baseRef: input.baseRef,
        createdBy: "agent",
        creationSource: "mcp",
      });
      return { threadId: started.threadId, item: started.item };
    }).pipe(asTeammateError("Could not start the worker.", caller.teammate.id));

  const workerStatus: TeammateService["Service"]["workerStatus"] = (caller, threadId) =>
    Effect.gen(function* () {
      const links = (yield* store.listThreadLinks).filter(
        (entry) =>
          entry.teammateId === caller.teammate.id &&
          entry.kind === "worker" &&
          (threadId === undefined || entry.threadId === threadId),
      );
      const selected = threadId === undefined ? links.slice(-15) : links;
      const rows = yield* Effect.forEach(
        selected,
        (entry) =>
          shellOf(entry.threadId).pipe(
            Effect.map((shell): WorkerStatus | null =>
              shell === null
                ? null
                : {
                    threadId: entry.threadId,
                    itemId: entry.itemId,
                    title: shell.title,
                    status: shell.status,
                    waitingOnPerson: shell.pendingRuntimeRequest !== null,
                    lastMessage:
                      shell.latestVisibleMessage === null
                        ? null
                        : shell.latestVisibleMessage.text.slice(0, 1_000),
                  },
            ),
          ),
        { concurrency: 8 },
      );
      return rows.filter((row): row is WorkerStatus => row !== null);
    }).pipe(asTeammateError("Could not read worker status.", caller.teammate.id));

  const messageWorker: TeammateService["Service"]["messageWorker"] = (caller, input) =>
    Effect.gen(function* () {
      const entry = linkIndex.get(input.threadId) ?? (yield* store.getThreadLink(input.threadId));
      if (
        entry === null ||
        entry === undefined ||
        entry.teammateId !== caller.teammate.id ||
        entry.kind !== "worker"
      ) {
        return yield* failWith("That is not one of your workers.", caller.teammate.id);
      }
      const shell = yield* shellOf(input.threadId);
      if (!isActiveThread(shell))
        return yield* failWith("That worker thread is gone.", caller.teammate.id);
      const uuid = yield* randomUuidV4;
      yield* threads.sendToThread({
        projectId: shell!.projectId,
        commandId: CommandId.make(`teammate:worker-message:${uuid}`),
        threadId: input.threadId,
        messageId: MessageId.make(`teammate:worker-message:${uuid}:message`),
        text: input.text,
        attachments: [],
        mode: "auto",
        createdBy: "agent",
        creationSource: "mcp",
      });
    }).pipe(asTeammateError("Could not message the worker.", caller.teammate.id));

  const listProjects: TeammateService["Service"]["listProjects"] = projects.listShells().pipe(
    Effect.map((shells) =>
      shells.map((shell) => ({
        projectId: shell.id,
        title: shell.title,
        workspaceRoot: shell.workspaceRoot,
      })),
    ),
    asTeammateError("Could not list projects."),
  );

  const listThreads: TeammateService["Service"]["listThreads"] = (caller, limit) =>
    Effect.gen(function* () {
      const projectIds =
        caller.teammate.projectId === null
          ? (yield* projects.listShells()).map((shell) => shell.id)
          : [caller.teammate.projectId];
      const lists = yield* Effect.forEach(
        projectIds,
        (projectId) => threads.listProjectThreads({ projectId, includeSubagents: false }),
        { concurrency: 4 },
      );
      return lists
        .flat()
        .filter((shell) => !linkIndex.has(shell.id))
        .sort((a, b) =>
          a.latestRunRequestedAt === b.latestRunRequestedAt
            ? 0
            : String(b.latestRunRequestedAt ?? "") < String(a.latestRunRequestedAt ?? "")
              ? -1
              : 1,
        )
        .slice(0, limit)
        .map((shell) => ({
          threadId: shell.id,
          projectId: shell.projectId,
          title: shell.title,
          status: shell.status,
          branch: shell.branch,
        }));
    }).pipe(asTeammateError("Could not list threads.", caller.teammate.id));

  // ------------------------------------------------------------------ worker settlement

  const workerOutcome = (status: string): WorkerOutcome =>
    status === "completed" ? "completed" : status === "failed" ? "failed" : "stopped";

  const onWorkerSettled = (entry: TeammateThreadLink, runId: string, status: string) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(entry.teammateId);
      if (teammate === null) return;
      const shell = yield* shellOf(entry.threadId);
      const item = entry.itemId === null ? null : yield* store.getItem(entry.itemId);
      const outcome = workerOutcome(status);
      const title = shell?.title ?? "Worker";
      if (item !== null && outcome !== "completed") {
        yield* touchItem(item, {
          status: "needsYou",
          question:
            outcome === "failed"
              ? "A worker couldn't finish this. Retry it, change the plan, or drop it?"
              : "A worker was stopped before finishing. Resume it or drop it?",
        });
      }
      if (outcome === "completed") {
        happyUntil.set(teammate.id, Date.now() + HAPPY_MS);
        yield* Effect.sleep(HAPPY_MS + 100).pipe(Effect.andThen(notifyChanged), Effect.forkDetach);
      }
      yield* addNotice({
        teammateId: teammate.id,
        kind: outcome === "completed" ? "workDone" : "couldntFinish",
        title: item?.title ?? title,
        itemId: item?.id ?? null,
        threadId: entry.threadId,
      });
      yield* notifyChanged;
      yield* postToHome(
        teammate,
        `worker:${runId}:${status}`,
        workerNotice({
          outcome,
          threadId: entry.threadId,
          title,
          itemTitle: item?.title ?? null,
          summary: shell?.latestVisibleMessage?.text ?? null,
          error: shell?.lastError ?? null,
        }),
      );
    });

  const onWorkerBlocked = (entry: TeammateThreadLink, requestId: string) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(entry.teammateId);
      if (teammate === null) return;
      const shell = yield* shellOf(entry.threadId);
      const item = entry.itemId === null ? null : yield* store.getItem(entry.itemId);
      if (item !== null && item.status !== "needsYou") {
        yield* touchItem(item, {
          status: "needsYou",
          question: "A worker is waiting for your answer or approval.",
        });
      }
      yield* addNotice({
        teammateId: teammate.id,
        kind: "needsYou",
        title: item?.title ?? shell?.title ?? "A worker needs you",
        itemId: item?.id ?? null,
        threadId: entry.threadId,
      });
      yield* notifyChanged;
      yield* postToHome(
        teammate,
        `worker-blocked:${requestId}`,
        workerNotice({
          outcome: "needsYou",
          threadId: entry.threadId,
          title: shell?.title ?? "Worker",
          itemTitle: item?.title ?? null,
          summary: shell?.latestVisibleMessage?.text ?? null,
          error: null,
        }),
      );
    });

  const once = (key: string) => {
    if (seenEvents.has(key)) return false;
    seenEvents.add(key);
    if (seenEvents.size > 1_000) {
      const oldest = seenEvents.values().next().value;
      if (oldest !== undefined) seenEvents.delete(oldest);
    }
    return true;
  };

  const stopLookAround = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* shellOf(threadId);
      if (shell === null) return;
      const uuid = yield* randomUuidV4;
      yield* threads.interruptThread({
        projectId: shell.projectId,
        commandId: CommandId.make(`teammate:look-stop:${uuid}`),
        threadId,
        reason: "A look-around cannot wait for an approval.",
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not stop a blocked look-around", { threadId, cause }),
      ),
    );

  const handleEvent = (event: OrchestrationV2DomainEvent) =>
    Effect.gen(function* () {
      if (event.type !== "run.updated" && event.type !== "runtime-request.updated") return;
      const entry = linkIndex.get(event.threadId);
      if (entry === undefined) return;
      if (event.type === "runtime-request.updated") {
        if (entry.kind === "look-around" && isBlockingRequest(event.payload)) {
          // A look-around must never sit on an approval prompt: end the run; the next slot retries.
          yield* stopLookAround(entry.threadId);
          return;
        }
        if (
          entry.kind === "worker" &&
          isBlockingRequest(event.payload) &&
          once(`blocked:${event.payload.id}`)
        ) {
          yield* onWorkerBlocked(entry, event.payload.id);
        } else {
          yield* notifyChanged;
        }
        return;
      }
      const status = event.payload.status;
      if (TERMINAL_RUN_STATUSES.has(status) && once(`run:${event.payload.id}:${status}`)) {
        if (entry.kind === "worker") yield* onWorkerSettled(entry, event.payload.id, status);
        else if (entry.kind === "look-around") yield* archiveThread(entry.threadId, "look");
      }
      yield* notifyChanged;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Teammate event handling failed", { threadId: event.threadId, cause }),
      ),
    );

  // ------------------------------------------------------------------ start

  const loadLinks = store.listThreadLinks.pipe(
    Effect.tap((links) =>
      Effect.sync(() => {
        for (const entry of links) linkIndex.set(entry.threadId, entry);
      }),
    ),
  );
  yield* loadLinks.pipe(Effect.orElseSucceed(() => []));

  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, handleEvent).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Teammate event stream failed", { cause })),
    ),
  );
  yield* scheduler.register("teammate-look-around", runDueLooks);

  return TeammateService.of({
    snapshot,
    subscribe,
    create,
    update,
    delete: deleteTeammate,
    openHome,
    updateItem,
    startSuggestion,
    dismissSuggestion,
    listFacts,
    forgetFact,
    lookAroundNow,
    getSoul,
    setSoul,
    isTeammateThread,
    resolveCaller,
    remember,
    forget,
    addItem,
    setItem,
    listItems,
    suggest,
    startWorker,
    workerStatus,
    messageWorker,
    listProjects,
    listThreads,
  });
});

export const layer = Layer.effect(TeammateService, make);

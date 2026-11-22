import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * Teammates ("Notch"): long-lived AI managers with a name, a SOUL.md (personality) and a
 * MEMORY.md (facts). A teammate chats in a home thread, hands code work to ordinary worker
 * threads, tracks them as items, and proposes "Up Next" suggestions on a schedule.
 */

const makeId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export const TeammateId = makeId("TeammateId");
export type TeammateId = typeof TeammateId.Type;
export const TeammateItemId = makeId("TeammateItemId");
export type TeammateItemId = typeof TeammateItemId.Type;
export const TeammateSuggestionId = makeId("TeammateSuggestionId");
export type TeammateSuggestionId = typeof TeammateSuggestionId.Type;
export const TeammateMemoryFactId = makeId("TeammateMemoryFactId");
export type TeammateMemoryFactId = typeof TeammateMemoryFactId.Type;

export const TEAMMATE_NAME_MAX_LENGTH = 64;
export const TEAMMATE_SOUL_MAX_LENGTH = 20_000;
export const TEAMMATE_DEFAULT_NAME = "Notch";

const TeammateName = TrimmedNonEmptyString.check(Schema.isMaxLength(TEAMMATE_NAME_MAX_LENGTH));

/** The brand logo variant ids (`TabsLogoVariant` in `@tabs/shared/tabsBrand`). */
export const TeammateFinish = Schema.Literals([
  "signature",
  "blue-white",
  "mono",
  "ivory-ink",
  "blue-ink",
]);
export type TeammateFinish = typeof TeammateFinish.Type;
export const DEFAULT_TEAMMATE_FINISH: TeammateFinish = "signature";

export const TeammateLookAroundPreset = Schema.Literals([
  "every4h",
  "every2h",
  "twiceDaily",
  "mornings",
]);
export type TeammateLookAroundPreset = typeof TeammateLookAroundPreset.Type;

export const TeammateLookAround = Schema.Struct({
  enabled: Schema.Boolean,
  preset: TeammateLookAroundPreset,
  /** What the teammate should pay attention to; empty means general upkeep. */
  focus: Schema.String.check(Schema.isMaxLength(2_000)),
  maxSuggestions: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  /** When looking around was last turned on; a slot before it is never caught up. Server-set. */
  since: Schema.optional(IsoDateTime),
});
export type TeammateLookAround = typeof TeammateLookAround.Type;

export const TeammateNotify = Schema.Struct({
  needsYou: Schema.Boolean,
  workDone: Schema.Boolean,
  couldntFinish: Schema.Boolean,
});
export type TeammateNotify = typeof TeammateNotify.Type;

export const DEFAULT_TEAMMATE_LOOK_AROUND: TeammateLookAround = {
  enabled: false,
  preset: "every4h",
  focus: "",
  maxSuggestions: 3,
};
export const DEFAULT_TEAMMATE_NOTIFY: TeammateNotify = {
  needsYou: true,
  workDone: true,
  couldntFinish: true,
};

/**
 * One teammate. SOUL.md lives on disk (read it with `teammates.soul.get`); it is not part of
 * this record so a snapshot stays small.
 */
export const Teammate = Schema.Struct({
  id: TeammateId,
  name: TeammateName,
  finish: TeammateFinish,
  /** null falls back to the text-generation model, then the default thread model. */
  modelSelection: Schema.NullOr(ModelSelection),
  /** Default project for workers and the home chat; null uses the Scratch project. */
  projectId: Schema.NullOr(ProjectId),
  paused: Schema.Boolean,
  lookAround: TeammateLookAround,
  notify: TeammateNotify,
  /** Set once `teammates.openHome` has created the chat. */
  homeThreadId: Schema.NullOr(ThreadId),
  lastLookAroundAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Teammate = typeof Teammate.Type;

export const TeammateItemStatus = Schema.Literals([
  "todo",
  "working",
  "needsYou",
  "done",
  "dropped",
]);
export type TeammateItemStatus = typeof TeammateItemStatus.Type;

export const TeammateItem = Schema.Struct({
  id: TeammateItemId,
  teammateId: TeammateId,
  title: Schema.String,
  detail: Schema.String,
  status: TeammateItemStatus,
  workerThreadIds: Schema.Array(ThreadId),
  /** What the teammate needs from the owner; set while `status` is "needsYou". */
  question: Schema.NullOr(Schema.String),
  link: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TeammateItem = typeof TeammateItem.Type;

export const TeammateSuggestionStatus = Schema.Literals(["open", "started", "dismissed"]);
export type TeammateSuggestionStatus = typeof TeammateSuggestionStatus.Type;

export const TeammateSuggestion = Schema.Struct({
  id: TeammateSuggestionId,
  teammateId: TeammateId,
  title: Schema.String,
  why: Schema.String,
  /** The prompt a worker runs if the suggestion is accepted. */
  ask: Schema.String,
  link: Schema.NullOr(Schema.String),
  status: TeammateSuggestionStatus,
  createdAt: IsoDateTime,
});
export type TeammateSuggestion = typeof TeammateSuggestion.Type;

export const TeammateMemoryFact = Schema.Struct({
  id: TeammateMemoryFactId,
  teammateId: TeammateId,
  text: Schema.String,
  topic: Schema.NullOr(Schema.String),
  /** Where the fact came from: "owner" (said in chat), "teammate", or "look-around". */
  source: Schema.String,
  createdAt: IsoDateTime,
});
export type TeammateMemoryFact = typeof TeammateMemoryFact.Type;

export const TeammateMood = Schema.Literals([
  "idle",
  "thinking",
  "working",
  "needsYou",
  "happy",
  "error",
  "sleeping",
]);
export type TeammateMood = typeof TeammateMood.Type;

export const TeammateActivity = Schema.Struct({
  teammateId: TeammateId,
  mood: TeammateMood,
  /** Short human text for the mood ("Working on 2 tasks"), absent when idle. */
  label: Schema.optional(Schema.String),
  /** Home chat turns plus look-around turns currently running. */
  thinkingCount: NonNegativeInt,
  /** Worker threads currently running. */
  workingCount: NonNegativeInt,
  needsYouCount: NonNegativeInt,
});
export type TeammateActivity = typeof TeammateActivity.Type;

export const TeammateNoticeKind = Schema.Literals(["needsYou", "workDone", "couldntFinish"]);
export type TeammateNoticeKind = typeof TeammateNoticeKind.Type;

/**
 * Something worth a toast. The server only emits a notice the teammate's `notify` preferences
 * allow, and keeps the latest few in every snapshot; clients toast each unseen `id` once.
 */
export const TeammateNotice = Schema.Struct({
  id: TrimmedNonEmptyString,
  teammateId: TeammateId,
  kind: TeammateNoticeKind,
  title: Schema.String,
  itemId: Schema.NullOr(TeammateItemId),
  threadId: Schema.NullOr(ThreadId),
  at: IsoDateTime,
});
export type TeammateNotice = typeof TeammateNotice.Type;

/** One consistent view of everything teammates own. The subscribe stream emits these. */
export const TeammatesSnapshot = Schema.Struct({
  teammates: Schema.Array(Teammate),
  items: Schema.Array(TeammateItem),
  suggestions: Schema.Array(TeammateSuggestion),
  activity: Schema.Array(TeammateActivity),
  /** The latest notices, oldest first. Toast each `id` once per client session. */
  notices: Schema.Array(TeammateNotice),
  /**
   * Thread ids of every thread a teammate owns that is not a normal user chat: home threads and
   * look-around threads. Hide these from the regular sidebar.
   */
  hiddenThreadIds: Schema.Array(ThreadId),
});
export type TeammatesSnapshot = typeof TeammatesSnapshot.Type;

export class TeammateError extends Schema.TaggedError<TeammateError>()("TeammateError", {
  message: Schema.String,
  teammateId: Schema.optional(TeammateId),
  cause: Schema.optional(Schema.Defect()),
}) {}

// ---------------------------------------------------------------- RPC payloads

export const TeammatesListInput = Schema.Struct({});
export type TeammatesListInput = typeof TeammatesListInput.Type;

export const TeammatesCreateInput = Schema.Struct({
  /** Defaults to "Notch", "Notch 2", ... */
  name: Schema.optional(TeammateName),
  /** Seeds SOUL.md; defaults to the starter template. */
  soul: Schema.optional(Schema.String.check(Schema.isMaxLength(TEAMMATE_SOUL_MAX_LENGTH))),
  finish: Schema.optional(TeammateFinish),
  modelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
});
export type TeammatesCreateInput = typeof TeammatesCreateInput.Type;

export const TeammatePatch = Schema.Struct({
  name: Schema.optional(TeammateName),
  finish: Schema.optional(TeammateFinish),
  modelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  paused: Schema.optional(Schema.Boolean),
  lookAround: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      preset: Schema.optional(TeammateLookAroundPreset),
      focus: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
      maxSuggestions: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
      ),
    }),
  ),
  notify: Schema.optional(
    Schema.Struct({
      needsYou: Schema.optional(Schema.Boolean),
      workDone: Schema.optional(Schema.Boolean),
      couldntFinish: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type TeammatePatch = typeof TeammatePatch.Type;

export const TeammatesUpdateInput = Schema.Struct({
  id: TeammateId,
  patch: TeammatePatch,
});
export type TeammatesUpdateInput = typeof TeammatesUpdateInput.Type;

export const TeammatesDeleteInput = Schema.Struct({ id: TeammateId });
export type TeammatesDeleteInput = typeof TeammatesDeleteInput.Type;
export const TeammatesDeleteResult = Schema.Struct({ id: TeammateId });
export type TeammatesDeleteResult = typeof TeammatesDeleteResult.Type;

export const TeammatesMutationResult = Schema.Struct({ teammate: Teammate });
export type TeammatesMutationResult = typeof TeammatesMutationResult.Type;

export const TeammatesOpenHomeInput = Schema.Struct({ id: TeammateId });
export type TeammatesOpenHomeInput = typeof TeammatesOpenHomeInput.Type;
export const TeammatesOpenHomeResult = Schema.Struct({
  teammateId: TeammateId,
  threadId: ThreadId,
  projectId: ProjectId,
});
export type TeammatesOpenHomeResult = typeof TeammatesOpenHomeResult.Type;

export const TeammateItemPatch = Schema.Struct({
  title: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  status: Schema.optional(TeammateItemStatus),
  question: Schema.optional(Schema.NullOr(Schema.String)),
  link: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TeammateItemPatch = typeof TeammateItemPatch.Type;
export const TeammatesItemsUpdateInput = Schema.Struct({
  id: TeammateItemId,
  patch: TeammateItemPatch,
});
export type TeammatesItemsUpdateInput = typeof TeammatesItemsUpdateInput.Type;
export const TeammatesItemsUpdateResult = Schema.Struct({ item: TeammateItem });
export type TeammatesItemsUpdateResult = typeof TeammatesItemsUpdateResult.Type;

export const TeammatesSuggestionsStartInput = Schema.Struct({ id: TeammateSuggestionId });
export type TeammatesSuggestionsStartInput = typeof TeammatesSuggestionsStartInput.Type;
export const TeammatesSuggestionsStartResult = Schema.Struct({
  suggestion: TeammateSuggestion,
  item: TeammateItem,
  workerThreadId: ThreadId,
});
export type TeammatesSuggestionsStartResult = typeof TeammatesSuggestionsStartResult.Type;

export const TeammatesSuggestionsDismissInput = Schema.Struct({ id: TeammateSuggestionId });
export type TeammatesSuggestionsDismissInput = typeof TeammatesSuggestionsDismissInput.Type;
export const TeammatesSuggestionsDismissResult = Schema.Struct({
  suggestion: TeammateSuggestion,
});
export type TeammatesSuggestionsDismissResult = typeof TeammatesSuggestionsDismissResult.Type;

export const TeammatesMemoryListInput = Schema.Struct({ teammateId: TeammateId });
export type TeammatesMemoryListInput = typeof TeammatesMemoryListInput.Type;
export const TeammatesMemoryListResult = Schema.Struct({
  facts: Schema.Array(TeammateMemoryFact),
});
export type TeammatesMemoryListResult = typeof TeammatesMemoryListResult.Type;

export const TeammatesMemoryForgetInput = Schema.Struct({ id: TeammateMemoryFactId });
export type TeammatesMemoryForgetInput = typeof TeammatesMemoryForgetInput.Type;
export const TeammatesMemoryForgetResult = Schema.Struct({ id: TeammateMemoryFactId });
export type TeammatesMemoryForgetResult = typeof TeammatesMemoryForgetResult.Type;

export const TeammatesLookAroundNowInput = Schema.Struct({ id: TeammateId });
export type TeammatesLookAroundNowInput = typeof TeammatesLookAroundNowInput.Type;
export const TeammatesLookAroundNowResult = Schema.Struct({
  /** "started" launched a look-around turn; "busy" one is already running. */
  status: Schema.Literals(["started", "busy"]),
  threadId: Schema.NullOr(ThreadId),
});
export type TeammatesLookAroundNowResult = typeof TeammatesLookAroundNowResult.Type;

export const TeammatesSoulGetInput = Schema.Struct({ id: TeammateId });
export type TeammatesSoulGetInput = typeof TeammatesSoulGetInput.Type;
export const TeammatesSoulGetResult = Schema.Struct({ id: TeammateId, soul: Schema.String });
export type TeammatesSoulGetResult = typeof TeammatesSoulGetResult.Type;
export const TeammatesSoulSetInput = Schema.Struct({
  id: TeammateId,
  soul: Schema.String.check(Schema.isMaxLength(TEAMMATE_SOUL_MAX_LENGTH)),
});
export type TeammatesSoulSetInput = typeof TeammatesSoulSetInput.Type;
export const TeammatesSoulSetResult = TeammatesSoulGetResult;
export type TeammatesSoulSetResult = typeof TeammatesSoulSetResult.Type;

import {
  OrchestratorMcpFailure,
  ProjectId,
  TeammateItemId,
  TeammateItemStatus,
  ThreadId,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as TeammateService from "../../../teammates/TeammateService.ts";

export const TEAMMATE_ACTIONS = [
  "remember",
  "forget",
  "item_add",
  "item_set",
  "item_done",
  "item_list",
  "worker_start",
  "worker_status",
  "worker_message",
  "list_projects",
  "list_threads",
  "suggest",
] as const satisfies ReadonlyArray<TeammateService.TeammateAgentAction>;

export const TeammateParameters = Schema.Struct({
  action: Schema.Literals(TEAMMATE_ACTIONS),
  /** remember: the fact. forget: words of the fact to remove. worker_message: the message. */
  text: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
  /** item_add, item_set, suggest, worker_start: a short title. */
  title: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  link: Schema.optional(Schema.String),
  question: Schema.optional(Schema.String),
  status: Schema.optional(TeammateItemStatus),
  itemId: Schema.optional(TeammateItemId),
  all: Schema.optional(Schema.Boolean),
  /** worker_start: the full instructions for the worker. */
  prompt: Schema.optional(Schema.String),
  projectId: Schema.optional(ProjectId),
  newWorktree: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(Schema.String),
  threadId: Schema.optional(ThreadId),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  /** suggest */
  why: Schema.optional(Schema.String),
  ask: Schema.optional(Schema.String),
});

export const TeammateTool = Tool.make("teammate", {
  description:
    "Teammate chats only (others are refused). Workers default to a new git worktree on the repo default branch in git projects; pass newWorktree:false to run in place. Actions: remember{text,topic?}, forget{text}; item_add{title,detail?,link?}, item_set{itemId,status?,title?,detail?,question?,link?} (status todo|working|needsYou|done|dropped; needsYou takes a one-line question), item_done{itemId}, item_list{all?}; worker_start{prompt,title?,projectId?,itemId?,newWorktree?,baseRef?}, worker_status{threadId?}, worker_message{threadId,text}; list_projects, list_threads{limit?}; suggest{title,why,ask,link?}. A look-around may only suggest and read.",
  parameters: TeammateParameters,
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext, TeammateService.TeammateService],
})
  .annotate(Tool.Title, "Work as a teammate")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

/** The actions a look-around may use: they only read, or add a suggestion for the owner to accept. */
export const TEAMMATE_LOOK_ACTIONS = [
  "suggest",
  "item_list",
  "worker_status",
  "list_projects",
  "list_threads",
] as const satisfies ReadonlyArray<TeammateService.TeammateAgentAction>;

export const TeammateLookParameters = Schema.Struct({
  action: Schema.Literals(TEAMMATE_LOOK_ACTIONS),
  title: Schema.optional(Schema.String),
  why: Schema.optional(Schema.String),
  ask: Schema.optional(Schema.String),
  link: Schema.optional(Schema.String),
  threadId: Schema.optional(ThreadId),
  all: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});

/**
 * The read-only face of the teammate tool, for look-around runs. It is annotated read-only so every
 * provider pre-approves it (Claude's read-only allowlist, Codex's read-only hint), which is what
 * lets a look-around run without an approval prompt. It can only list things and add a suggestion
 * to the owner's Up Next list, which the owner still has to accept.
 */
export const TeammateLookTool = Tool.make("teammate_look", {
  description:
    "Teammate look-around: read and suggest only. Actions: suggest{title,why,ask,link?} adds a next step to the owner's Up Next list; item_list{all?}; worker_status{threadId?}; list_projects; list_threads{limit?}.",
  parameters: TeammateLookParameters,
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext, TeammateService.TeammateService],
})
  .annotate(Tool.Title, "Look around as a teammate")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const TeammateToolkit = Toolkit.make(TeammateTool, TeammateLookTool);

/** Every tool name the teammate toolkit registers. They show only in teammate chats. */
export const TEAMMATE_TOOL_NAMES: ReadonlySet<string> = new Set([
  TeammateTool.name,
  TeammateLookTool.name,
]);

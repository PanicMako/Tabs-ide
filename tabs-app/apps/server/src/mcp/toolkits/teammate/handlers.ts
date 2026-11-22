import { OrchestratorMcpFailure, TeammateError } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as TeammateService from "../../../teammates/TeammateService.ts";
import { TeammateToolkit, type TeammateParameters } from "./tools.ts";

type Input = typeof TeammateParameters.Type;

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const fromTeammateError = (error: TeammateError | OrchestratorMcpFailure) =>
  error instanceof TeammateError ? invalid(error.message) : error;

const need = <T>(value: T | undefined, name: string, action: string) =>
  value === undefined || (typeof value === "string" && value.trim() === "")
    ? Effect.fail(invalid(`${action} needs ${name}.`))
    : Effect.succeed(value);

/** Runs one action as the teammate that owns the calling thread. Pure over the service. */
export const runTeammateAction = (
  service: TeammateService.TeammateService["Service"],
  threadId: Parameters<TeammateService.TeammateService["Service"]["resolveCaller"]>[0],
  input: Input,
) =>
  Effect.gen(function* () {
    const caller = yield* service.resolveCaller(threadId, input.action);
    switch (input.action) {
      case "remember": {
        const text = yield* need(input.text, "text", "remember");
        return { ok: true, ...(yield* service.remember(caller, { text, topic: input.topic })) };
      }
      case "forget": {
        const text = yield* need(input.text, "text", "forget");
        return { ok: true, ...(yield* service.forget(caller, text)) };
      }
      case "item_add": {
        const title = yield* need(input.title, "title", "item_add");
        const item = yield* service.addItem(caller, {
          title,
          detail: input.detail,
          link: input.link,
        });
        return { ok: true, item };
      }
      case "item_set": {
        const itemId = yield* need(input.itemId, "itemId", "item_set");
        const item = yield* service.setItem(caller, {
          itemId,
          status: input.status,
          title: input.title,
          detail: input.detail,
          question: input.question,
          link: input.link,
        });
        return { ok: true, item };
      }
      case "item_done": {
        const itemId = yield* need(input.itemId, "itemId", "item_done");
        const item = yield* service.setItem(caller, { itemId, status: "done" });
        return { ok: true, item };
      }
      case "item_list":
        return { ok: true, items: yield* service.listItems(caller, input.all === true) };
      case "worker_start": {
        const prompt = yield* need(input.prompt, "prompt", "worker_start");
        const started = yield* service.startWorker(caller, {
          prompt,
          title: input.title,
          projectId: input.projectId,
          itemId: input.itemId,
          newWorktree: input.newWorktree,
          baseRef: input.baseRef,
        });
        return { ok: true, ...started };
      }
      case "worker_status":
        return { ok: true, workers: yield* service.workerStatus(caller, input.threadId) };
      case "worker_message": {
        const target = yield* need(input.threadId, "threadId", "worker_message");
        const text = yield* need(input.text, "text", "worker_message");
        yield* service.messageWorker(caller, { threadId: target, text });
        return { ok: true };
      }
      case "list_projects":
        return { ok: true, projects: yield* service.listProjects };
      case "list_threads":
        return { ok: true, threads: yield* service.listThreads(caller, input.limit ?? 20) };
      case "suggest": {
        const title = yield* need(input.title, "title", "suggest");
        const why = yield* need(input.why, "why", "suggest");
        const ask = yield* need(input.ask, "ask", "suggest");
        return {
          ok: true,
          ...(yield* service.suggest(caller, { title, why, ask, link: input.link })),
        };
      }
    }
  }).pipe(Effect.mapError(fromTeammateError));

const run = (input: Input) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    if (scope.thread === undefined) {
      return yield* Effect.fail(invalid("The teammate tool needs a teammate's own chat."));
    }
    const service = yield* TeammateService.TeammateService;
    return (yield* runTeammateAction(service, scope.thread.threadId, input)) as Record<
      string,
      unknown
    >;
  });

export const layer = TeammateToolkit.toLayer({
  teammate: (input) => run(input),
  teammate_look: (input) => run(input),
});

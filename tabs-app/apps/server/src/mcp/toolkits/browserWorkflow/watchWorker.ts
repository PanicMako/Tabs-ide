import {
  BrowserWorkflowHostResult,
  type EnvironmentId,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../../config.ts";
import { ServerEnvironment } from "../../../environment/ServerEnvironment.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { PreviewAutomationBroker } from "../../PreviewAutomationBroker.ts";
import { listBrowserWorkflowWatches, makeBrowserWorkflows } from "./workflow.ts";

const decodeResult = Schema.decodeUnknownEffect(BrowserWorkflowHostResult);
type WatchThread = Pick<
  OrchestrationV2ThreadShell,
  "archivedAt" | "deletedAt" | "providerInstanceId"
>;

export const pollBrowserWorkflowWatches = (
  stateDir: string,
  environmentId: EnvironmentId,
  getThread: (threadId: ThreadId) => Effect.Effect<WatchThread | null, unknown>,
  broker: Pick<PreviewAutomationBroker["Service"], "invoke">,
) =>
  Effect.gen(function* () {
    const watches = yield* Effect.tryPromise(() =>
      listBrowserWorkflowWatches(stateDir, environmentId),
    );
    yield* Effect.forEach(
      watches,
      ({ workflowId, threadId }) =>
        Effect.gen(function* () {
          const thread = yield* getThread(threadId);
          const workflows = makeBrowserWorkflows(
            stateDir,
            { environmentId, threadId },
            (request, tabId) => {
              if (!thread || !request.target) return Promise.resolve(undefined);
              return Effect.runPromise(
                broker
                  .invoke({
                    scope: {
                      environmentId,
                      capabilities: new Set(["preview"]),
                      requestNamespace: `browser-workflow-watch:${workflowId}`,
                      thread: {
                        threadId,
                        // This is a read-only host routing identity. There is no provider turn.
                        providerSessionId: `browser-workflow-watch:${workflowId}`,
                        providerInstanceId: thread.providerInstanceId,
                      },
                      issuedAt: Date.now(),
                      client: undefined,
                    },
                    operation: "browserWorkflow",
                    tabId,
                    input: request,
                    updateCurrentTab: false,
                    workflowHostKey: request.target.hostKey,
                  })
                  .pipe(
                    Effect.flatMap(decodeResult),
                    Effect.orElseSucceed(() => undefined),
                    // Cancel this sample without evicting a busy browser connection.
                    Effect.timeoutOption("5 seconds"),
                    Effect.map(Option.getOrUndefined),
                  ),
              );
            },
          );
          if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) {
            yield* Effect.tryPromise(() => workflows.unwatch(workflowId));
            return;
          }
          yield* Effect.tryPromise(() => workflows.pollWatch(workflowId));
        }).pipe(Effect.catch(() => Effect.logDebug("Browser workflow watch sample unavailable"))),
      { concurrency: 3, discard: true },
    );
  });

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const { environmentId } = yield* (yield* ServerEnvironment).getDescriptor;
    const orchestrator = yield* OrchestratorV2;
    const broker = yield* PreviewAutomationBroker;
    yield* pollBrowserWorkflowWatches(
      config.stateDir,
      environmentId,
      orchestrator.getThreadShell,
      broker,
    ).pipe(
      Effect.catch(() => Effect.logWarning("Browser workflow watches could not be read")),
      Effect.repeat(Schedule.spaced("30 seconds")),
      Effect.forkScoped,
    );
  }),
);

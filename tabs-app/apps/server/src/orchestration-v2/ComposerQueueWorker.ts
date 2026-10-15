import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Orchestrator from "./Orchestrator.ts";

// Runs and attachments already live in the V2 event log. The environment's
// scheduler owns delivery, independently of browser connections. Queue holds
// from Stop or restart recovery remain authoritative in the orchestrator.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler.Scheduler;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* scheduler.register("composer-queue", orchestrator.resumeQueuedRuns.pipe(Effect.asVoid));
  }),
);

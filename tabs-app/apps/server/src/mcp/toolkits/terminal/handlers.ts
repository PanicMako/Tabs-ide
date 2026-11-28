import { OrchestratorMcpFailure } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import { TerminalManager } from "../../../terminal/Manager.ts";
import { requireMcpCapability, requireThreadScope } from "../../McpInvocationContext.ts";
import { TerminalInputToolkit } from "./tools.ts";

export const layer = TerminalInputToolkit.toLayer({
  terminal_input: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireMcpCapability("orchestration").pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "This credential cannot request terminal input.",
            }),
        ),
      );
      const { thread } = yield* requireThreadScope(scope, "terminal_input");
      const manager = yield* TerminalManager;
      return input.action === "propose"
        ? yield* manager.proposeAgentInput(thread, input)
        : yield* manager.getAgentInputStatus(thread, input.requestId);
    }),
});

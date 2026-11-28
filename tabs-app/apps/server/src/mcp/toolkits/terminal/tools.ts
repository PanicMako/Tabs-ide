import {
  OrchestratorMcpFailure,
  TerminalAgentInputProposal,
  TerminalAgentInputRef,
  TerminalAgentInputResult,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { TerminalManager } from "../../../terminal/Manager.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

export const TerminalInputToolkit = Toolkit.make(
  Tool.make("terminal_input", {
    description:
      "Propose one printable input for a terminal instance in your thread. A user must review it before any input is sent. Use status with the returned requestId to check the outcome. Set pressEnter only if the user should also approve sending Enter.",
    parameters: Schema.Union([
      Schema.Struct({ action: Schema.Literal("propose"), ...TerminalAgentInputProposal.fields }),
      Schema.Struct({ action: Schema.Literal("status"), ...TerminalAgentInputRef.fields }),
    ]),
    success: TerminalAgentInputResult,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext, TerminalManager],
  }).annotate(Tool.Destructive, false),
);

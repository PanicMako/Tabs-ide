import type { AuthSessionId, DeviceComparisonInput, DeviceServiceState } from "@tabs/contracts";
import type { DispatchDeviceReturn } from "./AgentDeviceControl.ts";
import type { Run } from "./DeviceComparisonRun.ts";
import type { McpThreadCaller } from "../mcp/McpInvocationContext.ts";

export interface ActionArgs<I extends DeviceComparisonInput, R extends Run | undefined = Run> {
  readonly input: I;
  readonly run: R;
  readonly state: DeviceServiceState;
  readonly sessionId: AuthSessionId | undefined;
  readonly caller: McpThreadCaller | undefined;
  readonly dispatchReturn: DispatchDeviceReturn | undefined;
  readonly agentSource: boolean;
}

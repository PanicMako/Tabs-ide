import type * as Effect from "effect/Effect";

import type { ProviderAdapterV2Error } from "../../../orchestration-v2/ProviderAdapter.ts";

export type FigmaMcpToolName = "whoami" | "create_session" | "use_figma";

/** A provider-owned connection to the named Figma MCP server. */
export interface FigmaMcpConnection {
  readonly list: () => Effect.Effect<unknown, ProviderAdapterV2Error>;
  readonly call: (
    name: FigmaMcpToolName,
    args: Readonly<Record<string, string>>,
  ) => Effect.Effect<unknown, ProviderAdapterV2Error>;
}

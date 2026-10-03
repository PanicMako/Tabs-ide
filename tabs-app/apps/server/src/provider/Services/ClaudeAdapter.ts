/**
 * ClaudeAdapter — shape type for the Claude provider adapter.
 *
 * Historically this module exposed a `ServiceMap.Service` tag so consumers
 * could inject the adapter through the Effect layer graph. The driver
 * model ({@link ../Drivers/ClaudeDriver}) bundles one adapter per
 * instance as a captured closure instead, so the tag is gone — we only
 * retain the shape interface as a naming anchor for the driver bundle.
 *
 * @module ClaudeAdapter
 */
import type { ProviderAdapterError } from "../Errors";
import type { ProviderAdapterShape } from "./ProviderAdapter";

/**
 * ClaudeAdapterShape — per-instance Claude adapter contract. Carries
 * a branded driver kind as the nominal discriminant.
 */
export interface ClaudeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly steerTurn?: NonNullable<ProviderAdapterShape<ProviderAdapterError>["steerTurn"]>;
  readonly stopTask?: NonNullable<ProviderAdapterShape<ProviderAdapterError>["stopTask"]>;
  readonly backgroundTask?: NonNullable<
    ProviderAdapterShape<ProviderAdapterError>["backgroundTask"]
  >;
  readonly steerSubagent?: NonNullable<ProviderAdapterShape<ProviderAdapterError>["steerSubagent"]>;
  readonly listCommands?: NonNullable<ProviderAdapterShape<ProviderAdapterError>["listCommands"]>;
  readonly listSkills?: NonNullable<ProviderAdapterShape<ProviderAdapterError>["listSkills"]>;
  readonly listAgents?: NonNullable<ProviderAdapterShape<ProviderAdapterError>["listAgents"]>;
  readonly getComposerCapabilities?: NonNullable<
    ProviderAdapterShape<ProviderAdapterError>["getComposerCapabilities"]
  >;
}

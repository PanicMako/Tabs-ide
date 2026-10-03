/**
 * CopilotAdapter — shape type for the GitHub Copilot provider adapter.
 *
 * @module CopilotAdapter
 */
import type { ProviderAdapterError } from "../Errors";
import type { ProviderAdapterShape } from "./ProviderAdapter";

/**
 * CopilotAdapterShape — per-instance Copilot adapter contract.
 */
export interface CopilotAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

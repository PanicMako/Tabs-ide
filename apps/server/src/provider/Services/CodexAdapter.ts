/**
 * CodexAdapter — shape type for the Codex provider adapter.
 *
 * Historically this module exposed a `ServiceMap.Service` tag so consumers
 * could inject the adapter through the Effect layer graph. The driver
 * model ({@link ../Drivers/CodexDriver}) bundles one adapter per
 * instance as a captured closure instead, so the tag is gone — we only
 * retain the shape interface as a naming anchor for the driver bundle.
 *
 * @module CodexAdapter
 */
import type { ProviderAdapterError } from "../Errors";
import type { ProviderAdapterShape } from "./ProviderAdapter";

/**
 * CodexAdapterShape — per-instance Codex adapter contract. Carries
 * a branded driver kind as the nominal discriminant.
 */
export interface CodexAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

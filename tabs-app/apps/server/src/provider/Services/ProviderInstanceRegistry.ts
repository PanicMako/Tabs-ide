/**
 * ProviderInstanceRegistry — the single Effect service in the new model.
 *
 * Owns a `Map<ProviderInstanceId, ProviderInstance>` produced by running
 * registered driver factories against `ServerSettings.providerInstances`.
 * The registry watches settings; when an instance's config changes (or
 * the entry disappears), the registry tears down the affected instance's
 * scope and rebuilds — that's the entire hot-reload story.
 *
 * What rest-of-server reads from here:
 *   - `getInstance(instanceId)` — for routing turn/session calls.
 *   - `listInstances` — for snapshot aggregation in `ProviderRegistry`.
 *   - `listUnavailable` — `ServerProvider` shadows for instances whose
 *     driver is not registered in this build (rollback / fork tolerance).
 *   - `streamChanges` — coalesced "registry mutated" pings so consumers
 *     can re-pull lists or re-broadcast.
 *
 * @module provider/Services/ProviderInstanceRegistry
 */
export {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "../ProviderInstanceRegistry.ts";

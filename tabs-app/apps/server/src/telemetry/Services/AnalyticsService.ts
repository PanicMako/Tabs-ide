import * as Context from "effect/Context";
/**
 * AnalyticsService - Basic pseudonymous telemetry capture contract.
 *
 * Provides best-effort daily adoption markers. Caller properties and other
 * operational events are not delivered.
 *
 * @module AnalyticsService
 */
import { Effect, Layer } from "effect";

export interface AnalyticsServiceShape {
  /**
   * Queue a permitted daily usage marker for best-effort delivery.
   */
  readonly record: (
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void, never>;

  /**
   * Flush queued telemetry.
   */
  readonly flush: Effect.Effect<void, never>;
}

export class AnalyticsService extends Context.Service<AnalyticsService, AnalyticsServiceShape>()(
  "tabs/telemetry/Services/AnalyticsService",
) {
  static readonly layerTest = Layer.succeed(AnalyticsService, {
    record: () => Effect.void,
    flush: Effect.void,
  });
}

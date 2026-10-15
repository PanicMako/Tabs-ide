import {
  defaultInstanceIdForDriver,
  KiloSettings,
  ProviderDriverKind,
  type OrchestrationV2ProviderCapabilities,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HostProcessEnvironment } from "@tabs/shared/hostProcess";

import * as ServerConfig from "../../config.ts";
import * as OpenCodeRuntime from "../../provider/opencodeRuntime.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as ProviderEventLoggers from "../../provider/ProviderEventLoggers.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import * as ProviderAdapter from "../ProviderAdapter.ts";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "../ProviderAdapterDriver.ts";
import {
  makeOpenCodeAdapterV2,
  OpenCodeProviderCapabilitiesV2,
  type OpenCodeAdapterV2Options,
} from "./OpenCodeAdapterV2.ts";

export const KILO_PROVIDER = ProviderDriverKind.make("kilo");
export const KILO_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(KILO_PROVIDER);
const DEFAULT_KILO_SETTINGS = Schema.decodeSync(KiloSettings)({});

export const KiloProviderCapabilitiesV2: OrchestrationV2ProviderCapabilities = {
  ...OpenCodeProviderCapabilitiesV2,
};

export interface KiloAdapterV2Options extends Omit<
  OpenCodeAdapterV2Options,
  "driver" | "capabilities"
> {
  readonly settings: KiloSettings;
}

export function makeKiloAdapterV2(
  options: KiloAdapterV2Options,
): ProviderAdapter.ProviderAdapterV2Shape {
  return makeOpenCodeAdapterV2({
    ...options,
    driver: KILO_PROVIDER,
    capabilities: KiloProviderCapabilitiesV2,
  });
}

export type KiloAdapterV2DriverEnv =
  | OpenCodeRuntime.OpenCodeRuntime
  | IdAllocator.IdAllocatorV2
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig;

export const KiloAdapterV2Driver: ProviderAdapterDriver<KiloSettings, KiloAdapterV2DriverEnv> = {
  driverKind: KILO_PROVIDER,
  configSchema: KiloSettings,
  defaultConfig: (): KiloSettings => DEFAULT_KILO_SETTINGS,
  create: Effect.fn("KiloAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<KiloSettings>) {
      const hostEnvironment = yield* HostProcessEnvironment;
      const openCodeRuntime = yield* OpenCodeRuntime.OpenCodeRuntime;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const serverConfig = yield* ServerConfig.ServerConfig;
      return makeKiloAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        runtime: openCodeRuntime,
        idAllocator,
        serverConfig,
        ...(providerEventLoggers.native === undefined
          ? {}
          : { nativeEventLogger: providerEventLoggers.native }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: KILO_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Kilo v2 adapter.",
              cause,
            }),
        ),
      ),
  ),
};

export const layer: Layer.Layer<ProviderAdapter.ProviderAdapterV2, never, KiloAdapterV2DriverEnv> =
  Layer.effect(
    ProviderAdapter.ProviderAdapterV2,
    Effect.gen(function* () {
      const hostEnvironment = yield* HostProcessEnvironment;
      const openCodeRuntime = yield* OpenCodeRuntime.OpenCodeRuntime;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const serverConfig = yield* ServerConfig.ServerConfig;
      return makeKiloAdapterV2({
        instanceId: KILO_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_KILO_SETTINGS,
        environment: hostEnvironment,
        runtime: openCodeRuntime,
        idAllocator,
        serverConfig,
        ...(providerEventLoggers.native === undefined
          ? {}
          : { nativeEventLogger: providerEventLoggers.native }),
      });
    }),
  );

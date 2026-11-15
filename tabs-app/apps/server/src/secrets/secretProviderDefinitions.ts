import { builtInSecretProviderDefinitions } from "@tabs/shared/secretProviders/registry";

import * as OnePasswordDriver from "./onePasswordDriver.ts";

/** In the shared registry's order. */
export const BUILT_IN_SECRET_PROVIDER_DRIVER_LIST = [OnePasswordDriver.driver] as const;

export const secretProviderDefinitions = builtInSecretProviderDefinitions;

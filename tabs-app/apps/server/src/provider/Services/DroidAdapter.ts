import { ProviderDriverKind } from "@tabs/contracts";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface DroidAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: ProviderDriverKind;
}

import { ProviderDriverKind } from "@tabs/contracts";

import type { ProviderAdapterError } from "../Errors";
import type { ProviderAdapterShape } from "./ProviderAdapter";

export interface DroidAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: ProviderDriverKind;
}

import * as Effect from "effect/Effect";

import Migration0023 from "./023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0033 from "./033_ProjectionThreadsSettled.ts";
import Migration0034 from "./034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./036_ProjectionThreadsPinned.ts";
import Migration0037 from "./037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./040_ProjectionProjectFaviconPath.ts";
import Migration0042 from "./042_ProjectionThreadLinkedPullRequest.ts";
import Migration0043 from "./043_ProjectionThreadsUnsettledAt.ts";

/**
 * Existing Tabs installations may already have applied auth migration 041.
 * Effect's migrator advances by the latest numeric id, so migrations inserted
 * below that version would otherwise be skipped. Re-run the idempotent T3
 * schema and backfill steps at a new version to bring those databases forward.
 */
export default Effect.gen(function* () {
  yield* Migration0023;
  yield* Migration0024;
  yield* Migration0025;
  yield* Migration0026;
  yield* Migration0027;
  yield* Migration0028;
  yield* Migration0029;
  yield* Migration0030;
  yield* Migration0033;
  yield* Migration0034;
  yield* Migration0035;
  yield* Migration0036;
  yield* Migration0037;
  yield* Migration0038;
  yield* Migration0039;
  yield* Migration0040;
  yield* Migration0042;
  yield* Migration0043;
});

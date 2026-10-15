import * as Effect from "effect/Effect";

import AuthClientConnection from "./041_AuthSessionClientConnection.ts";
import ThreadLifecycle from "./044_CatchUpThreadLifecycle.ts";
import PullRequestLinks from "./045_ProjectionThreadPullRequests.ts";
import RemoveRedundantIndexes from "./055_RemoveRedundantProjectionIndexes.ts";
import SnapshotLookupIndexes from "./019_ProjectionSnapshotLookupIndexes.ts";
import AutomaticSettlementTimestamps from "./046_RepairAutomaticSettlementTimestamps.ts";
import AutoSettleDisabledAt from "./053_ProjectionThreadsAutoSettleDisabledAt.ts";

// Preserve the published Tabs ledger. These upstream repairs were not in
// that lineage; applying them at a new id also repairs existing installations.
export default Effect.gen(function* () {
  yield* AuthClientConnection;
  yield* ThreadLifecycle;
  yield* PullRequestLinks;
  yield* SnapshotLookupIndexes;
  yield* AutomaticSettlementTimestamps;
  yield* AutoSettleDisabledAt;
  yield* RemoveRedundantIndexes;
});

# Pull-request watch reactor — batch226

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete652line wholly new source read. Selected orchestrator2265-2310/9930 and runtime test2923-2942 inspected; no broad rerun.

Two-minute sweep, grouped project/PR reads, fingerprint/status/activity gating, rate-limit pause vs8fail stop, pagination completeness, watch-start guarding, cache cleanup and four concurrent groups reviewed. Orchestrator checks same watch and inactive state under thread lock, then records mutation before dispatching wake. This is stronger ordering evidence than helper tests alone, but durable atomicity/rollback still requires integration proof.

Potential P2 missed edited tail comment: readRemarks caches pages beyond first per thread using only commentCount. An edit to an older comment leaves count unchanged; when activity is reread after30minutes, condition tail.count !== count is false, so cached editedAt/body remains old. Reactor promises forced reread for edits, but tail cache has no time/fingerprint invalidation. Runtime fingerprint test asserts another activity call after30minutes, not refreshed paginated tail edits. This is concrete source-path contradiction; native/mocked diagnostic pending before claiming reproduced behavior. Restart or count change refreshes tails.

No production edits; full audit remains incomplete.

## Batch227 reproduced P2 tail edit loss

Actual PullRequestWatchReactor under real Effect/TestClock and Node crypto, mocked host/projection/dispatch: first sweep pages a2-comment review thread; second after11minutes changes only tail comment body/editedAt. Activity read twice, page read once, one wake total, editedDelivered=false. Diagnostic expected page refresh and failed1test2.93s, session51303exit1. Count-change control adds third comment: activity2/pages2/wakes2/editedDelivered=true,1test passed2.71s session64973exit0. This isolates count-key cache invalidation as cause, without a live hosted account. Logs /tmp/tabs-audit-pr-tail-edit.log and /tmp/tabs-audit-pr-tail-control.log.

Fixture archived fixtures/auditPrTailEdit.test.ts; restore at apps/server/src/orchestration-v2/auditPrTailEdit.test.ts to run relative imports. Set TABS_AUDIT_TAIL_CONTROL=1 for control. No production source edits. Confirmed P2: edits to comments beyond first page can remain unseen until count changes or server restart, despite scheduled activity rereads.

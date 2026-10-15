# Boot service source review

Batch320: Complete1001-line source reviewed. Native manager plans, prerequisite probes, pinned-version verification, durable state/unit writes, pending-update/downgrade checks, restart ownership and recovery traced. start=false checks share a state file with the launcher without a common lock; the post-write read only detects an intervening write that has already occurred. Actual concurrent launcher behavior remains unverified. No new confirmed blocker assigned.

Focused tests invoked;837-line test source remains unreviewed. No real service installed, stopped or restarted.

Batch321: Complete837-line test source reviewed;38 tests passed915ms/exit0, log /tmp/tabs-audit-boot-service.log. Real temporary files and rename failures, but all process commands and reported runtime versions mocked. No download allowed. Covers manager rendering, prerequisite refusal/repair, downgrade after simulated stop, pending-update refusal, restart marker, foreign-home restart ownership, PATH handling and recovery command attempts. No simultaneous start=false/remote update test, actual service health or rollback after unit/state replacement. macOS status current does not probe loaded/running launchd state.

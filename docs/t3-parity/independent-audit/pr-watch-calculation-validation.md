# Pull-request watch calculation — batch225

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete220line new calculation/291line tests reviewed; initial message-function truncation recovered130-225. Node24 targeted Vitest terminal exit0; exact test count/duration in /tmp/tabs-audit-pr-watch.log.

Tests cover prompt failure while other checks pending, rerun/head-change reset, required gate growth, optional gate nonrepeat, old passedChecks fallback, unread conversation retry, same-timestamp late ID and edits, own-account exclusion, conflict unknown preservation, comment wake limit/reset and message notification. List/snippet limits10/200 implemented; no direct oversize assertion. Pure fixtures establish comparison behavior, not hosted check retrieval or actual waking.

Failure identity uses check.name, so same-name multiple jobs collapse notification memory; actual host guarantees/collision impact pending. Missing viewer falls back to PR author by documented assumption and test, which may suppress author replies when actual agent account differs but host lacks viewer. No real host payload proves this case yet. Date.parse assumes timestamp data supplied valid by upstream contracts; malformed host timestamps not tested here.

No production edits; full audit incomplete.

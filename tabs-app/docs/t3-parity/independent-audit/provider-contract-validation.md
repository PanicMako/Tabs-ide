# Provider contract — batch235

Complete230line current source/full modified hunks reviewed. Model/attachment/policy imports now reference split contract modules, previously reviewed. New feedback upload input carries thread ID and optional nonblank reason; output feedback ID, failure message excludes raw cause. Existing824test contract evidence reused.

Feedback RPC registration, selected V2 ws handler and Codex adapter forwarding inspected. Handler checks thread/session and optional runtime capability, wraps failures as typed errors. Active web source search found no uploadFeedback caller. Native upload/session behavior remains unverified; earlier shipped legacy entrypoint discrepancy remains unresolved. Reason has no schema length cap; no actual harmful behavior established. No production changes.

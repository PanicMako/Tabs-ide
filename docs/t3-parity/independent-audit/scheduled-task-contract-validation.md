# Scheduled task contracts — batch232

Complete wholly new339line schema and52line tests reviewed. Contracts824test evidence reused. Tests distinguish legacy positive sub-minute rows from writable minimum60000ms and reject zero. Selected Schedule.nextScheduledRunAt clamps legacy execution to60000ms, matching read/write compatibility intent. Fixed-time parser matches schema; weekdays are set semantics with empty/omitted meaning daily. Selected existing assertions cover weekday matching and grace windows; full Schedule test/source not claimed reviewed in this batch.

Webhook persisted read model omits signing secret, while mutation supports secret or one-use secretRef. Selected ScheduledTaskService upsert chooses ref when supplied, retains stored secret on replay, and rejects signature configuration lacking a secret. Signature header validation and webhook runtime remain separate scope. Read model contains endpoint token and delivery request data intentionally; prior error-log credential exposure and shipping-entrypoint findings remain unresolved.

Schema permits duplicate weekday entries and unbounded title/prompt/missingFields arrays. Their runtime impact is not established by this contract review. No production changes.

# Provider runtime changed contracts — batch216

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete236-addition/82-deletion diff reviewed in bounded1-89/90-265/266-end ranges. All changed hunks read; unchanged1211line file context not credited as fully read. Existing824contract test pass reused.

Adds permission/elicitation request types, compaction counts/threshold/cost, complete/partial/unavailable main-agent token usage, CUA tool attribution/icon metadata, task linkage/typed usage/status patches and error code. User-input option descriptions now allow empty text. Removes unused event-type enum and compatibility aliases; source search finds remaining names only in backup directory, no active callers in selected search.

Task status removes inProgress in favor of running and broader lifecycle vocabulary. Selected runtimeTaskList helper maps both legacy inProgress and in_progress to running. It maps other statuses to pending; whether it receives new full lifecycle statuses needs producer tracing before calling this a defect. TaskRunHandles sessionUrl shape permits any nonblank string and relies on adapter sanitation per comment; selected server/client-runtime search did not locate sanitation, broader driver search pending. Complete usage schema requires input/output but does not enforce subset relationships. These declarations do not prove adapter correctness.

No production edits. Full audit incomplete.

## Batch217 producer follow-up

Complete runtimeTaskList helper/test source and full tiny modifieddiff inspected. ClaudeTrackedTaskStatus restricts tracked tasks to pending/in_progress/completed; readTrackedTaskStatus enforces this. claudeTrackedTasksPayload normalizer therefore need not preserve failed/waiting statuses on that path. Todo raw unknown statuses retain inherited pending fallback. Selected ClaudeAdapter2522/2573 consumers locate legacy task-list events. Prior broader lifecycle concern is not an established failure. Active apps/packages source search finds sessionUrl only in the contract; there is no located producer or URL consumer, so absent sanitizer is currently dormant rather than proven unsafe navigation. No extra tests run.

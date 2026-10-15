# Git contract tests — batch241

Complete169line current test and full42add82delete test diff reviewed. Existing824test contract evidence reused. New tests verify missing isOnPullRequestHead defaults true and explicit false survives. Selected schemas confirm the default, optional worktree newRefName/baseRefName and stacked action ID.

Removed assertions covered repository-operation discriminator rejection, release workflow fields, PR file metadata, PR list bounds/continuation/capabilities. WebSocket tests retain positive repository/release envelope coverage but do not replace the removed negative assertions. Thus broad green suite does not prove the same fork contract coverage as before. Runtime defects are not inferred merely from removed tests.

Large git.ts diff output truncated; only beginning/end and selected schema ranges were read. Full669add728delete schema review remains pending and receives no completed ledger credit. No production changes.

## Batch242 source continuation

Current git.ts285–645 reviewed in bounded ranges (ref/worktree inputs, local/remote status, stream variants, PR preparation/default head, stacked action results, pull result, errors, progress variants). Ref list limits200 and query256; counts nonnegative. Branch/worktree refs remain nonblank rather than Git-syntax schemas; downstream Git validation/native prior checks apply. Stacked result step metadata is optional independently of status, so wire decode alone cannot prove successful operations. Error schemas retain generic detail and opaque cause; prior process-boundary sanitization evidence remains separate from all caller error propagation. Remaining source1–284 and646–1374/full removed hunks still pending; no full-file completion credit.

## Batch243 source continuation

Current git.ts646–1010 fully read in bounded ranges. Legacy repository operation union, release/fetch/stage/discard/stash/merge/rebase/hunk/worktree/branch/history/review/status schemas remain present. Opaque strings and arrays have limited bounds; no production exploit inferred from schemas alone. ReviewFindingCategory declares three tags but finding.category is String, retaining wider legacy categories. Actual Bun decode checks reject remove_remote lacking name and PR list limit201, confirming the removed negative assertions still describe valid behavior today (exit0). No full git file credit;1–284 and1011–1374 plus complete diff remain pending.

## Batch244 source continuation

Current git.ts1011–1374 fully read. Includes account status/switch/logout, amend/undo/revert/cherry-pick/tags, watched branch status, PR capabilities/mutation/create, diff/history/conflict/stash/workflow results, and restored type exports. PR mutation input is broad rather than action-discriminated: action-specific required fields must be enforced by handlers. PR list limit200/query256 and create body100000/title512 bounded. Workflow limit/maxCandidates are plain optional Number; actual handling remains separate scope. Restored type exports refer directly to current schema Type and preserve names rather than weakening schema decoding. Source1–284 and full deleted-hunk semantic comparison remain pending; no full-file credit.

## Batch245 source completion/export inventory

Opening1–284 now read, completing1374line current source across242–245. PR aggregate includes optional provider/checks/reviews/files/stack; unknown closed variant values still reject rather than forward-drop in these arrays. Current GitCommandFailureReason excludes raw stderr and marks recognized tags, previously traced process boundary remains relevant. Regex comparison of old/current export names finds no removed names and one added GitCommandFailureReason. This proves name preservation only; full deleted-hunk schema comparison remains pending. Current source review ledger explicitly preserves that limitation.

## Batch246 declaration comparison

TypeScript module was unavailable; no install attempted. Text declaration extraction/normalization isolates8changed declarations, no removed declarations,1added GitCommandFailureReason. Complete87line isolated comparison reviewed: optional failure reason/message suffix; PR head default; lazy capability schema avoids moved declaration initialization; export visibility; thread/project linkage; ref refresh flag; optional draft/activity and branch stats. All other extracted declaration bodies compare equal after comment/whitespace/type-export removal. This is a text comparison, not AST or behavior equivalence proof; imported schema changes were separately reviewed and runtime coverage limits remain. Current source plus isolated modifications now have review evidence without claiming full application correctness.

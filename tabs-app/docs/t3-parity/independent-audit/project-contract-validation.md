# Project contract changed hunks — batch238

Full264add2delete diff reviewed; selected read/write context inspected. Unchanged portions of562line file are not claimed fully read. Existing contracts824test evidence reused. New schemas include project mutations/snapshots, icons/scripts, immediate directory listing, scratch/new project responses. Search limit constants become private; active source search finds no external consumers.

Project monogram schema permits32code units; selected ProjectCommands enforces at most2graphemes, matching the documented command-boundary constraint. Legacy lucide monograms decode into monogram icons; future icon kinds decode null. Synthetic actual Bun probe: ReceivedProjectIcon future-kind decodes null, but encoding that null directly fails Expected Declaration. Surrounding project fields use NullOr, so no active project roundtrip defect established here; caller use must determine impact.

Read contract explicitly permits absolute external paths; write remains documented workspace-relative. Earlier confirmed write symlink escape finding remains unresolved, and schema alone does not enforce filesystem containment. Full project command/runtime review remains separate scope. No production changes.

## Batch239 follow-up

Actual Bun decode/encode through NullOr(ReceivedProjectIcon) and full Project both return null for future icons and encode successfully (exit0). All active schema uses found are wrapped in NullOr, including project shell. The direct inner-schema encode failure does not establish an active project roundtrip defect; this concern is resolved for observed consumers.

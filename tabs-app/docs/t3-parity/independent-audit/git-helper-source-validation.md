# Shared Git helper review

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete git422/test343 and full modified diff read, truncation recovered. Test file newly added. Batch180 shared85files1176tests pass reused.

Assertions exercise remote URL forms/intentional port dropping, Azure SSH alias conversion, nested groups, origin config inline comments/quotes/header casing/line continuations, temporary ref variants and UUID v4 matcher, remote-only status bootstrap and local-field preservation, and static/semantic/custom generated names. Tests are pure; they do not actually call Git to validate ref names. New sanitizer and dedupe helper lack direct assertions in this file. Case-insensitive remote normalization and explicit port loss predate changes; not new Forgejo isolation regression proof.

Production callers traced: TextGenerationOperations111–129 generated branch formatting; V2ThreadLaunch306–330 temporary name from UUID; GitVcsDriverCore3320 and BranchToolbarBranchSelector97 use shared dedupe. No app caller found for sanitizeNewRefName or applyGitStatusStreamEvent. Legacy ChatView uses its own local temporary-name helper, so V2 generator presence is not proof its behavior reaches that UI.

sanitizeNewRefName comment says only ASCII whitespace is changed, while trim also removes Unicode whitespace at edges; no consumer or user-facing failure established. Static prefix retains underscores, including leading underscores; actual Git validation remains necessary. Temporary generator assumes callback supplies at least8hex, true of inspected UUID caller. Dedupe retains non-origin remotes and matches local names case-sensitively; branch namespace conflicts are left to actual Git operation. No new independently confirmed defect in this helper batch.

Production unchanged. Full inventory audit remains incomplete.

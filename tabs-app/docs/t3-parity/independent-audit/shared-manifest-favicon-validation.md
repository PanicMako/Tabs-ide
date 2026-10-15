Batch189 — shared manifest and favicon

HEAD unchanged at bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete 462-line manifest, all modified manifest hunks, and both new 97-line favicon files read. Initial combined output truncation recovered with separate complete diff and manifest tail.

Native filesystem check: all 108 exports have existing import/type targets, with no mismatched targets. New YAML and extension-api dependencies inspected; this does not establish package build or dependency-version compatibility. Reused batch180 shared suite: 85 files, 1,176 tests passed.

Favicon fallback uses page origin, provider image URL and GitHub theme table. Public-provider helper delegates private/reserved-host exclusion to hostClassification, whose complete current source was also inspected as a dependency. Tests cover listed private hosts, unsupported origins, public host/port, theme variants and provider URL fallback. Data URLs accepted without MIME validation; actual image behavior not executed. Browser/Codex analogy in source comments is not independent evidence. No app or other package consumers of the new favicon exports found in searches, so these pure helper tests do not prove visible tool icons.

No production changes. Full audit remains incomplete.

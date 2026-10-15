# Review and source-control contracts — batch234

Complete review.ts91/sourceControl.ts188 lines and changed hunks read. Contracts824test evidence reused. Review adds per-file preview selector, complete optional stats, and old/new content request/result. Schema does not restrict paths to repository; existing native Git file-content diagnostics already cover outside absolute paths, symlinks, binary and size limits, and remain authoritative for that implementation. No repeat run needed. Source stats counts use Number rather than nonnegative integers; no malformed producer established.

Source control adds Forgejo and optional draft/closedAt/mergedAt. Active mappings found in Forgejo, GitLab and Azure adapters; optional fields preserve old payload decoding. Timestamp fields are nullable strings rather than validated dates. Hosted CLI behavior and full adapter review remain separate scope. No production changes.

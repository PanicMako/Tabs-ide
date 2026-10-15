Tool activity review — batch188

Complete toolActivity.ts (448 lines), its full modified diff, and new test file (135 lines) reviewed. Reused fresh batch180 shared-suite evidence: 85 files and 1,176 tests passed.

Classification prioritizes explicit item type and request kind over tool names; removes title-based read/search guessing. Structured paths have depth and result-count bounds. Empty update input preserves previous nonempty input. New Claude Skill and CUA title helpers inspected. Tests cover classification, labels, paths, input merge and Skill presentation; direct CUA title and bound assertions are absent.

ACP makeToolCallState supplies canonical item type, data and fallback detail to presentation; mergeToolCallState uses shared data merge. Codex V2 dynamic projection passes tool name and arguments to dynamicToolTitle. Claude V2 gives explicit read/search labels priority, then dynamic title and supplied presentation. These selected callers establish source integration, not native provider execution. Array traversal may scan many entries without producing paths; no demonstrated failure was established.

No production changes. Full audit remains incomplete.

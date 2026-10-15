# Environment contracts — batch208

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete293line source/99line new tests and194-addition/13-deletion diff inspected; truncated first diff portion recovered separately. Existing824contract test pass reused.

Protocol2 constants, optional capability expansion, forward-compatible machine/install descriptors, updater variants, worktree submodule modes and repository-origin grouping reviewed. Removed definitions were relocated (ThreadEnvMode/EnvironmentConnectionState), not removed from exports.

Tests cover missing/recognized/future or malformed installation data, missing/true required-worktree/pull-request/upload/server-resolved-context capabilities, and generic upload limit preservation. They establish codec compatibility only. Grouping helpers, machine fallback and most new capability flags lack direct assertions in this file.

ServerEnvironment217-250 advertises protocol2 and many capabilities as true; update fields are conditional. Producer declaration is not proof that all advertised behavior is shipped or correct. Selected web/shared search found no repositoryGrouping helper or protocol-version/serverResolvedCommandContext consumers; broader connection modules and runtime compatibility remain open, alongside earlier shipped-entrypoint findings. No new production failure established in this contract review.

No production edits or repeated test run. Full audit remains incomplete.

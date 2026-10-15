# Worktree MCP contract — batch233

Complete128line new schema reviewed, including recovered truncated failure-code tail. Existing contracts824 passing evidence reused. Input requires nonblank branch, optional baseRef/path/setup/origin and continuationPrompt capped120000 characters. Path regex accepts POSIX, Windows drive/UNC forms across clients; selected service additionally calls host Path.isAbsolute, so cross-platform wire acceptance does not alone permit relative native paths. Selected schema tests assert four absolute forms, three relative forms, missing/blank branch, blank continuation. Length boundary lacks direct selected assertion.

Result variants distinguish setup and continuation failure from successful handoff. Status attached/path fields are not cross-constrained by schema; actual service mapping remains separate review. Branch syntax relies on downstream Git operations rather than this nonblank schema. No production changes and no full service runtime claim.

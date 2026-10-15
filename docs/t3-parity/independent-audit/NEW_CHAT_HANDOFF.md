# Continue the Tabs Antigravity audit and production repairs

Work in this existing checkout:
`/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06/tabs-app`

The user requests an independent audit of every Antigravity change, excluding Labs, and authorized fixing production blockers. Do not trust the walkthrough or mark production ready based on narrow tests. The user needs fast closeout and low usage: prioritize actual blockers, avoid repetitive status-only turns and unrelated polish. Do not restart the audit or create another checkout. Preserve all existing dirty changes. No merge, push, or deployment has occurred.

First read current repository instructions and these existing artifacts:

- `docs/t3-parity/independent-audit/production-decision.md`
- `docs/t3-parity/independent-audit/production-repair-status.json`
- `docs/t3-parity/independent-audit/progress.md` (latest entries supersede old status)
- `docs/t3-parity/independent-audit/file-review.json` and `scope.json`
- Review requirements: checkout parent `docs/ANTIGRAVITY_T3_PARITY_GOAL_PROMPT_2026-10-06.md`

Current production decision: HOLD. The exhaustive audit is incomplete. Older remaining lists and test counts are stale; inspect current sources and terminal logs before relying on them.

## Recent verified changes

- Grok legacy adapter now calls graceful process-group termination before closing its scope. Test polling uses a live clock. Grok adapter/support 26 tests pass, and server typecheck passed at that point.
- Empty HTTP compression layer replaced by `HttpCompression.ts` using existing beta-compatible NodeStream APIs for Brotli/gzip/deflate. HTTP 30 tests pass including GET roundtrips, encoding exclusions, HEAD without body reads, opt-outs, and cancellation cleanup. Implementation server typecheck passed.
- Maintenance resolution preserves mise ownership and targets npm installation prefixes. Bounded shell-launcher inspection prevents wrongly updating renamed mise launchers. Standalone Codex updates use the resolved executable and shared CODEX_HOME, which the command runner forwards. Maintenance fixtures now use actual path resolution; a stale version-cache fixture key was corrected.
- Managed Codex setup now selects existing `makeManagedCodexProvider`, fixing the previously disconnected managed account controller/V2 adapter. Legacy startup supplies CodexInstallation and ModelManifest. Full Codex/maintenance/runner/resolution: 44 tests pass. Latest server implementation typecheck passed after namespace-import correction.
- All 13 skipped CLI startup cases restored. Tests use temporary default homes and deterministic offline HTTP responses, preserving bootstrap precedence. Latest full CLI suite: **16/16 pass**, 61.22 seconds. Log `/tmp/tabs-all-cli-startup-offline-tests.log`. Process is terminal; no CLI test rerun is needed unless code changes warrant it.

Earlier repairs and qualifications are recorded in production-repair-status.json: development authentication, canonical write containment, preview migration, Companion routing, extension MCP gateway, secret-answer race, forward-compatible schemas, transcript streaming, Git timestamp/cache handling, host power monitoring, atomic writes and other fixes. Preserve those changes. Concurrent filesystem ancestor replacement races and real secondary PTY acceptance were not proven resolved.

## Actual remaining blockers

1. Shipped index/main/wsServer startup remains legacy. Browser wsNativeApi/root/readModel still use legacy snapshots and domain events; shell/thread V2 subscriptions are no-ops. Modern server accepts V2 commands and streams. Integrate protocol, projections, controls and runtime together; simply flipping the entrypoint previously produced incompatibility.
2. Composer queue remains browser-owned. Implement server-owned durable queue with schedules, attachments, migration of existing local entries and user controls. Do not implement only unscheduled followups.
3. Modern extension MCP gateway has focused mock/injected-service tests, but production layer assembly and SDK HTTP roundtrip still need verification. Companion terminal props route selected environments, but actual secondary terminal lifecycle needs verification.
4. OpenCode2 dependencies target Effect rc.112 while app catalog is beta.78. `bun run check:effect-versions` fails because both versions resolve. Published protocol invokes unavailable Schema.TaggedError and newer Context APIs. This requires coordinated compatibility work, not a one-line version edit or hiding collection failures.
5. Other server failures and remaining exhaustive original audit coverage. Last full baseline was 146 failed / 7353 passed / 39 skipped plus ten collection errors, before later repairs; this is NOT the current exact count.
6. Final repository formatting/typecheck/full suites and packaged startup/restart acceptance after the remaining integration changes.

## Immediate next investigated failures

`/tmp/tabs-next-failure-classification.log` shows:

- `claudeModelOptions.test.ts`: prompt-injected `ultrathink` produces undefined SDK effort instead of model-default high. Current compiler resolves raw effort and normalizes it; inspect catalog semantics before repairing. No change to this compiler was made yet.
- `open.test.ts`: fixture expects Antigravity command `agy`, implementation returns `antigravity-ide`; Cursor fixture lacks implementation's `--classic`. Determine actual intended product behavior rather than blindly changing either side.
- `cli/triagePrompt.test.ts`: canonical PLAYBOOK path missing inside tabs-app; examine repository nesting and intended artifact location.

Tests run from `apps/server` using `bun scripts/test.ts <paths>`. Node default is 26; Bun 1.3.14. Existing logs listed above are local and may expire. No known process remains live from the latest CLI run; check authoritative process state if uncertain.

Give the user a concise, evidence-backed result: fixed items, remaining blockers, and an honest production decision. Do not promise a short ETA for the larger integration work. If unable to finish, preserve a concrete reviewable handoff instead of claiming completion.

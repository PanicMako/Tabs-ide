# Research addendum for the Antigravity Goal Mode handoff

This supplements [the initial comparison](/Users/rushil.dev/Desktop/tabs/tabs-app/docs/T3_COMPARISON_2026-10-06.md) with the user's expanded requirements: complete non-mobile parity, a T3-style side panel inside Agents, and actual provider usage ingestion. Upstream remains pinned to `76d3c96fd5b89cca2c06aeaceaea16100c75084a`; `main` was checked again and still points there.

## Agents side panel

T3's [right-panel state](/Users/rushil.dev/Desktop/tabs/t3code-main/apps/web/src/rightPanelStore.ts) includes browser, terminal, diff, files/file previews, individual PRs, and linked PRs, keyed by environment/thread. Its [tab UI](/Users/rushil.dev/Desktop/tabs/t3code-main/apps/web/src/components/RightPanelTabs.tsx) provides multiple surfaces, close/close-others/close-to-right/close-all, browser mute state, and panel layout controls. Files have search, lazy directory loading, refresh, context actions, and drag-to-composer mentions. The [file preview](/Users/rushil.dev/Desktop/tabs/t3code-main/apps/web/src/components/files/FilePreviewPanel.tsx) supports source/editing, line reveal/comments, rendered Markdown, delimited tables, HTML/PDF, images, audio, video, and attachments.

Tabs' [WorkspaceShell](/Users/rushil.dev/Desktop/tabs/tabs-app/apps/web/src/components/WorkspaceShell.tsx) already hosts chat, a terminal drawer, browser tools, Git tools, and Code-OSS, but not this combined per-thread tabbed companion panel. The requested feature is therefore an additional entry point and layout inside Agents. It must reuse the existing service owners and keep the top-level Browser, Code, Git, and Terminal controls available. Copying T3's Electron webview implementation would conflict with Tabs' native `WebContentsView` ownership.

## Usage is broader than provider labels

Tabs' [provider presentation table](/Users/rushil.dev/Desktop/tabs/tabs-app/apps/web/src/components/usage/usageProviders.ts) already includes Antigravity and several other providers. However, [UsageService.resolveTranscriptDirs](/Users/rushil.dev/Desktop/tabs/tabs-app/apps/server/src/usage/UsageService.ts:129) resolves only Claude and Codex directories. Thus the initial report's statement that usage tracking is present needs qualification: presentation, pricing, runtime token events, and subscription limits do not establish complete historical coverage.

T3's [usage service](/Users/rushil.dev/Desktop/tabs/t3code-main/apps/server/src/usage/UsageService.ts) adds configured-instance roots, Grok completed-turn history, OpenCode SQLite/legacy JSON, Antigravity conversation metadata, and Cursor account usage. The [Antigravity reader](/Users/rushil.dev/Desktop/tabs/t3code-main/apps/server/src/usage/antigravityUsageReader.ts) opens SQLite read-only and decodes protobuf usage metadata. It does not infer tokens by counting conversation text.

The [usage guide](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/user/usage.md) and [usage contract](/Users/rushil.dev/Desktop/tabs/t3code-main/packages/contracts/src/usage.ts) also cover source coverage status, account/source deduplication across environments, timezone-aware buckets, cache categories, provider-reported versus estimated costs, speed premiums, model remapping, custom prices, and partial saves to selected environments. The handoff requires those behaviors where the selected provider supplies real data.

Antigravity historical tokens/cost and Antigravity subscription quota are separate requirements. The source does not justify inventing a quota API. The implementation must show actual quota data only when available and mark it unavailable otherwise.

## Additional non-mobile details to include

- [Question attachments](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/user/question-attachments.md): per-question draft/files, remote uploads, retry behavior, persisted history and cleanup.
- [Thread sidebar](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/user/thread-sidebar.md): server-owned active order, cross-section drag/drop, undo, working section, per-thread auto-settle override, custom snooze, projectless threads, background submission, and multi-model worktrees.
- [Terminal history](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/user/terminal.md): bounds by both line count and bytes. Tabs' current [terminal manager](/Users/rushil.dev/Desktop/tabs/tabs-app/apps/server/src/terminal/Layers/Manager.ts) has a line-oriented history cap; byte bounds and long-line behavior need explicit comparison.
- [Updating](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/user/updating.md): protocol incompatibility refusal, host-specific update paths, opt-in restart continuation, and provider update-all behavior.
- [Provider internals](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/internals/providers.md): OpenCode 1.x/2.x runtime selection and ownership, per-thread MCP isolation, Antigravity profile/installer leases, explicit rather than probe-driven auth, and managed ChatGPT callback ownership.
- [Preview automation contract](/Users/rushil.dev/Desktop/tabs/t3code-main/packages/contracts/src/previewAutomation.ts): resize, appearance and video recording in addition to ordinary browser interaction. Step-based issue recording in Tabs is useful but is not video recording.
- [Keyboard focus](/Users/rushil.dev/Desktop/tabs/t3code-main/docs/user/keyboard-focus.md): palette/model-picker shortcut precedence and preventing a late terminal startup from stealing composer focus.
- Existing Tabs environment-theme code was found at [environmentTheme.ts](/Users/rushil.dev/Desktop/tabs/tabs-app/apps/server/src/environmentTheme.ts). It should be compared and extended only where needed, rather than listed as wholly missing.

## Isolation and delivery

The inspected Tabs checkout is on `main` at `117643e40e33ee3a897bd00571186f9c674c25a7`. Existing worktrees for Extensions/Exchange, audits, Code-OSS sync, and updater work are separate ongoing work. None is an appropriate destination for this parity task. The handoff proposes a new dedicated branch/worktree; it has not been created by Codex.

The two research documents and original archive backup are local artifacts. No product source or dependency versions were changed. No application was launched, and no provider-backed test results are claimed.

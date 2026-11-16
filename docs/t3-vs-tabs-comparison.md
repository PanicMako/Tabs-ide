# T3 Code vs Tabs: what T3 does better

Compared `t3code-main/` against `tabs-app/` (same paths, `@t3tools` renamed to `@tabs`).
The two have diverged heavily: of ~900 shared source files only 34 are identical, and T3 Code
has ~25 extra packages (`provider-*`, `source-control-*`, `secret-provider-*`). A line-by-line
port is not realistic. This lists what I verified in the code.

Confidence: **Verified** = I read both sides and the behavior differs. **Seen in T3 only** = the
guard exists in T3 and the matching lines are absent in Tabs, but I did not reproduce the bug.

## Already fixed in Tabs (this session)

1. **Successful commands shown as failed** (Verified, the bug you hit).
   `WireProjection.ts` / `turnItemActivities.ts`. Tabs flagged a command failed whenever its
   output text contained "ENOENT", "no such file", "exit code 2", etc., even with exit code 0.
   T3 trusts the exit code and only reads text when there is none. Ported, with a test.
2. **Failure-text scan cost** (Verified). `toolOutput.ts`: T3 rejects most outputs with one
   cheap regex before running the full set. Ported (same results, existing tests pass).
3. **Failed steps hid their reason** (Tabs-only gap). The work log now shows the error text.

## Ported in the follow-up pass (goal mode)

Server and shared logic only. No Tabs UI was changed or replaced with T3's.

4. **Network/UNC path guard** (security). `isNetworkPath` in `shared/path.ts`; enforced in
   `WorkspaceFileSystem.resolveReadTarget` (a share path is allowed only inside the workspace
   root) and `AssetAccess.finalizeAbsoluteMediaFileAsset` (treated as missing). Tested.
5. **Restart-loop guard**. `RestartContinuation.ts` stops continuing a run after 3 chained
   continuations inside 5 minutes. Tested both ways (long chain stops, short chain continues).
6. **Hung stop**. `EffectWorker.ts` gives a `delegated-tasks.stop` effect 30 s, then falls through
   to the normal retry/fail path instead of blocking its thread.
7. **ACP null clearing**. `mergeToolActivityData` now drops fields the provider sends as `null`
   and clears `rawInput` on `rawInput: null`, while keeping Tabs' partial-input merge. Tested.

Checked and **not needed**: `processRunner.ts` already escalates SIGTERM to SIGKILL; Windows
drive and reserved-name helpers already exist in Tabs (`filePathDisplay.ts`, `path.ts`).

8. **Safer "Continue" prompt**. After a crash or restart the agent is told its last action may
   have finished or still be running, and to check before repeating anything that changes state.
   Exported as `CONTINUE_PROMPT` so tests no longer hardcode the text.
9. **Idle flush for streamed text**. `assistantStreaming.ts` now holds text it has not yet shown
   and delivers it whole after 1.2 s of quiet, so words written just before a long tool call no
   longer look lost. It never shrinks text already shown. `RunExecutionService.ts` runs the flush
   from a timer fiber under a lock, so ordering against routing and snapshots is unchanged. I tried
   merging a tick stream first; it reordered ingestion and broke two replay fixtures, so I did not
   keep it. Tested at the filter level; there is no run-service-level test for the timer.

10. **Microphone test** (UI, from T3's Voice settings). A "Test your microphone" row records five
    seconds with a level meter, flags a silent take, and plays it back. Rebuilt in Tabs' own style
    (neutral hairline surfaces, existing radius tokens, no accent colors) with a plain analyser
    instead of T3's audio worklet. Local only; nothing is sent anywhere.

11. **Pull-request watch protects a thread from auto-settling** (from T3's settlement rules).
    `isPullRequestWatchTask` is now shared, and `ThreadSettlementService` no longer settles a
    thread with an active watch, which would silently drop a reviewer's later comments. Tested.
    T3's other settlement differences (open-link handling, snooze wake rules, keep-PR setting,
    guest requests) are policy changes rather than bug fixes, so I left Tabs' rules as they are.

Reviewed against T3 and **not applicable**: wallpaper chat, Agent theme, the studio color picker
and Labs' Agent theme row have no T3 counterpart (zero matches in T3's web app), so there was
nothing to compare or copy. T3's voice consent grants and dictate-and-submit shortcut belong to
its cloud voice and frozen-composer design, which Tabs' local-only dictation does not have.
Tried and reverted: replacing the restart's polling wait with an event-stream wait; it needs a new
`EventSink` dependency in about ten test layer setups for little gain.

Deliberately **not ported**, with reasons: T3's thread-settlement rules and `ProviderTurnControl`
settle-awaiting (they depend on T3-only event-stream services; Tabs already treats a released
session as stopped and has a client "Force stop" button), and the ~25 extra T3 packages
(providers, source control, secrets), each of which is its own project.

## UI: kept Tabs' own look, adopted only the useful ideas

T3 has no frosted wallpaper chat, Labs, Agent theme page, studio color picker or Tabs' work-log
box, so none of those were touched or swapped for T3's. Ideas adopted, drawn in Tabs' style:

- A running step names what it is doing in Tabs' voice ("Running", "Scribbling", "Reading",
  "Hunting", "Tinkering") with three quiet turn-taking dots, replacing a bare "In progress".
  The dots stand still under reduced motion.
- A failed step shows its reason (T3 shows failure detail; Tabs showed none) and a tap expands
  the clamped error to the whole text.
- Failure state is decided from the exit code first (see item 1), so successful reads no longer
  show a red failure in the box.

Not changed: the wallpaper glass, Labs layout, Agent theme page and picker from earlier today.

## Agent reliability: in T3, missing in Tabs (remaining)

| # | Area | What T3 does | Where (T3) | Confidence |
|---|------|--------------|-----------|-----------|
| 1 | Restart loop | A turn that keeps crashing the server stops being auto-continued after a bounded chain inside a time window; Tabs would restart it forever | `orchestration-v2/RestartContinuation.ts` | Verified |
| 2 | Hung stop | A stop that hangs gives up and falls to retry/fail; otherwise a running effect blocks its thread and its lease is never reclaimed | `orchestration-v2/EffectWorker.ts` | Seen in T3 only |
| 3 | Unconfirmed stop | When the provider never confirms a stop, the UI offers "Force stop"; interrupt/restart against an already-released session no longer fails and retries 5x | `orchestration-v2/ProviderTurnControlService.ts` | Seen in T3 only |
| 4 | Process timeouts | Helpers that ignore SIGTERM no longer block timeouts or graceful shutdown; sync spawn throws become typed spawn failures | `processRunner.ts` | Seen in T3 only |
| 5 | Event batching | Batches never mix with run-lifecycle changes; a failed child run can no longer leave its parent task "running" | `orchestration-v2/EventSink.ts` | Seen in T3 only |
| 6 | Completion bookkeeping | Survives a missed live run update, including capture retries; retries reuse message ids so follow-ups are not duplicated | `orchestration-v2/EffectWorker.ts` | Seen in T3 only |
| 7 | Thread settling | Never settles a thread while a guest is waiting, a watch would be dropped, or a run was interrupted (snooze protection); invalidates caches on merge | `orchestration-v2/ThreadSettlementService.ts` | Seen in T3 only |
| 8 | Checkpoint rollback | Does not reserve checkpoints for turns that touch no files, which stalled turn starts | `orchestration-v2/CheckpointRollbackService.ts` | Seen in T3 only |
| 9 | ACP tool input | `null` clears a field and an empty `rawInput` keeps the old one; Tabs keeps the first non-empty object and merges deeper | `shared/src/toolActivity.ts` | Verified |

## Security and path handling

- **UNC / network paths (Windows)**: T3 has `isNetworkPath` and rejects `\\host\share` and
  `//host/share` before any file read, preview, markdown image or link opens. On Windows a UNC
  path makes the OS sign in to that host with the user's NTLM credentials, so an agent-authored
  path could leak a hash. Tabs has no equivalent. T3 uses it in 10 places (workspace file system,
  asset access, HTML render, guest attachments, markdown links/images, file metadata, `ws.ts`).
  **Recommended next port**; I held back only because it touches many call sites. (Verified)
- Windows drive handling: T3 treats a bare `C:` as "current directory on C", not the root, and
  strips the `/C:/` prefix browsers add to file URLs; its workspace-relative path helper also
  rejects `repo/../x` escapes. Tabs lacks these. (Verified)

## Streaming and UI

- **Assistant text streaming**: T3 delivers text at Markdown boundaries (list fences at any
  indent, CommonMark blank lines, ATX headings, partial list markers) so lists and headings do
  not flicker while streaming. Tabs' `assistantStreaming.ts` is about half the size. (Seen in T3 only)
- **Work-group scroll anchoring**: T3 has a binary-search anchor (`work-log/scrollAnchor.ts`) so
  expanding or collapsing a tool group does not jump the page during a fling. Tabs has its own
  `timelineScrollAnchoring.ts`; not compared for behavior.
- **Work-log presentation**: T3 splits this into `work-log/*` (command labels, embedded scripts,
  item detail, tool presentation). Tabs does it inside `session-logic.ts` + `WorkLogGroup.tsx`.

## Features T3 has that Tabs does not (not bugs)

`send_to_user` tool and message rendering, MCP app references (`mcpApp.ts`), Computer Use /
JS-REPL tool surfaces, OpenCode Code Mode result handling, `preview_recording_stop`, guest
access, ~25 provider and source-control packages (Azure DevOps, Bitbucket, Forgejo, GitLab,
Kiro, Muse, Pi, Grok, 1Password secrets).

## What Tabs has that T3 lacks

Extensions and Exchange, Labs (wallpapers, voice input, agent theme), Antigravity auth,
Code-OSS integration, the editorial settings, marketing site. Do not overwrite these when
syncing.

## Suggested order

1. UNC/network-path guard (security, Windows).
2. Restart-loop guard and hung-stop / force-stop handling (reliability).
3. Port T3 providers or source-control packages one at a time, as wanted.

Items 2 to 6 above are drawn from T3's own code comments; before porting each one, reproduce
it in Tabs first, because several depend on T3-only services and would not drop in unchanged.


## Provider parity pass (2026-11-14)

Ported from T3 into Tabs' own structure (in-server drivers, Tabs UI), each with tests:

- **Kiro** and **fx** providers: settings, ACP launch, status probe, v2 adapter, driver, skills
  discovery (fx), web settings entries. Kiro has native steering, fork-from-turn, held cancel and
  `/compact`; fx has its mode/model/effort handling and sub-agent reply recovery.
- **Shared ACP adapter hooks** (`AcpAdapterV2.ts`): `ignoreSessionUpdate`, `modelOptionArrivesLate`,
  `ownedModelOptionIds`, `sessionConfigForPolicy`, `cancelAfterPromptStarts`, `compactSession`,
  `forkFromTurn`, native `steering`, plus `allowUnlistedValue` and `configOptionChanges` on the
  session runtime and `activeSteeringAcceptsAttachments` in the capabilities contract.
- **Provider installation gate**: session opens, text generation and provider updates share one gate
  so an update waits for running work and holds back new work. Optional service, so unit layers
  that never install providers run unchanged.
- **Update-required models**: Claude and Codex models the installed CLI is too old for are kept out
  of the list and named in a plain notice in the model picker.
- **Document attachments**: docx/xlsx/pptx/odt/ods/odp/rtf/epub/ipynb text is extracted in an
  isolated worker process to a `<file>.txt` sidecar and referenced in the prompt. Adds `saxes` and
  `character-entities` to the server dependencies.
- **Model manifest** synced to T3's data in full (Codex models with minimum CLI versions, Claude
  Fable 5.2 and Haiku 5.5 with fixed 1M context, newer Antigravity models, compatibility policies
  for Kiro, Muse and fx). Ultracode is now a toggle derived from the manifest's effort level, with
  the old "ultracode" effort still read as xhigh plus the toggle.
- **Antigravity**: prompt-outcome watcher (a quota or API error the stop reason hid now fails the
  turn and restarts the agent), edit-location patches so edit diffs land on the right lines, and
  served-read repair for the agent's never-completed `client_view_file` calls.
- **Project settings override sweep** on startup.

- **ACP prompt inactivity timeout** (enabled for Antigravity at 15 minutes): a prompt silent that
  long with no open tool, approval or subagent fails and the agent is replaced. Tested with the
  test clock against the mock agent.
- **Antigravity native child work**: a "Subagent work" button on Antigravity subagent threads opens
  a read-only view of the batch's children (new `orchestration.getNativeChildWork` RPC, query
  service, session-log reader, dialog in Tabs' own style).

- **Antigravity** attachment prompt (native image, audio, PDF, text and linked video, gated on what
  the agent advertised) and per-turn token usage.
- **Pi and Muse usage tracking**: their session logs now count in Usage, with Pi's `--session-dir`
  and Muse's discovered home both scanned.
- **Codex managed token broker**: Codex now asks the Tabs server for each ChatGPT token through
  `auth.command` and a private socket, so no token sits in its environment, renewals reach running
  sessions, and a replaced sign-in is refused. Tested end to end through a real helper subprocess.
- **Secret providers**: a 1Password account can be added under Providers; a provider instance's
  environment variable can then hold `op://vault/item/field`, read by the server when the instance
  starts (unreadable secrets keep the instance unavailable instead of falling back to another
  credential). Settings carry a "Check a secret" action that re-reads fresh and refreshes dependent
  instances. References are stored as written; nothing from the vault is stored. The OpenRouter,
  Factory Droid and Antigravity API keys accept a reference too.

Not ported, and why:

- T3's `provider-core` / `ProviderHost` layering and the `provider-*` package split: Tabs keeps
  providers in the server; moving them is a refactor, not a feature.
- GitCafe and Cursor Origin pull-request pages are ported (`GitCafePullRequestProvider`,
  `OriginPullRequestProvider` and their JSON mappings, registered in the pull-request registry,
  with T3's mapping and provider tests for GitCafe). Left out because Tabs' `PullRequestProvider`
  contract has no place for them: changed-path paging (`getDiffFilePaths`), repository label and
  author search, @-mentions, reference sigils, per-remark edit permission and the resume-position
  list cursor (listings continue by row count here). The GitCafe source-control provider and Cursor
  Origin's are ported too, with discovery, detection and presentation. Origin's project identity
  carries its cursor.com web URL. None of it has run against the real git.cafe or Origin APIs, GitCafe's
  optional token saved in Settings is ported as `gitcafe.token` (secret store, redacted for
  clients, Source Control settings row), and it accepts a secret-provider reference (paste `op://...`, kept in the secret store behind a
  marker and read from the provider on each use).
- Secret references for device tokens (Tabs has none). Source-control tokens (GitCafe, and
  Bitbucket in Source Control settings) accept references; cloud speech keys accept a
  reference: paste `op://...` in the voice key field and the keychain keeps the reference). The
  environment variable editor exists for custom agents (Variables on each row: typed value or secret
  reference, hide toggle); built-in providers still take theirs from `settings.json`.
- Antigravity managed-release selection and T3's usage-limit reader drivers: Tabs has its own
  implementations that were not compared line by line.
- Nothing here was run against real Kiro, fx, Antigravity, Codex or 1Password installs.

## Pull-request author search

`pullRequests.authorCandidates` (contract, scope, service, WebSocket handler) and
`searchRepositoryAuthors` on the GitHub (gh REST) and GitCafe providers are in place, with a
service test. Tabs' pull-request panel still talks to the older `git.*` calls and does not consume
the `pullRequests.*` RPCs at all (labels, reviewers and author candidates have no panel UI), so
the remaining T3 pull-request features (label and author menus, @-mention and `#` reference
composers, per-remark edit permission, resume-position cursors, changed-path paging) need the
panel rebuilt on those RPCs first. Forgejo, GitHub and GitCafe answer it.

Update: the pull-request panel now reads the host's names through `NativeApi.pullRequests`
(`authorCandidates`, `labelCandidates`, `reviewerCandidates`): the reviewer and label fields offer
the host's names as options, and typing `author:` in the search field offers authors. The panel
itself was not rebuilt on the `pullRequests.*` calls; its data path stays on `git.*`. Still not
ported: per-comment editing (Tabs' `git.*` layer has no comment edit), @-mention and `#` reference
composers, resume-position cursors and changed-path paging.

Comment editing: conversation comments in the pull-request panel have an Edit action backed by
`NativeApi.pullRequests.updateComment` (the existing `pullRequests.updateComment` RPC and each
host's `updateComment`). Tabs' git layer carries no per-comment edit permission, so the control
shows on every conversation comment and the host refuses other people's edits with a toast, where
T3 hides it from a per-comment `canEdit`.

@-mention and `#` composers: the "Add review feedback" box in the pull-request panel completes
`@login` and `#123` from the host (`pullRequests.authorCandidates` and the new
`pullRequests.referenceCandidates`, with T3's trigger logic ported as
`@tabs/shared/pullRequestComposerTrigger`). GitHub answers both (`gh api` user and issue search);
`!` merge-request references and mentions on the other hosts are not wired yet, and the comment
edit box is a plain textarea.

Resume-position cursors and changed-path paging are ported: a provider page may carry
`resumeAfter`, which the service threads through the continuation cursor (GitCafe and Cursor
Origin use it, with tests), and `getDiffFilePaths` pages exact changed paths (GitCafe) with the
service guarding `diffFileContents` so file contents are only served for paths the change request
changes (it falls back to parsing the diff for hosts without `getDiffFilePaths`).

Pull-request panel on Forgejo, GitCafe and Cursor Origin: the git layer behind the GitHub-style
panel only knows GitHub, GitLab, Azure DevOps and Bitbucket, so a repository on one of these
hosts is listed through the server's pull-request service (`HostPullRequestsPanel`): state
filters, and per pull request the description, labels and reviewers, the conversation with edit
for the viewer's own comments, merge/close/reopen/ready/draft/update-branch as the host permits,
and a comment box completing `@` mentions (GitCafe and Forgejo also). Each pull request also has Files (a
slice-at-a-time diff via the new `pullRequests.diff` call) and Checks tabs, and Forgejo completes `#`
references. Review is covered too: review threads with reply and
resolve (where the host allows them), line comments added from the Files tab and held until the
review is submitted, and Submit review with the verdicts the host permits. Mention and `#`
completion match T3's per-host support for GitCafe, Forgejo and Cursor Origin (Cursor Origin
completes none).

Mentions and references per host now match T3: GitHub and GitLab complete `@` and `#`/`!` (GitLab
through `glab api` project users, issues and merge requests), GitCafe and Forgejo complete `@`,
and Cursor Origin, Bitbucket and Azure DevOps complete nothing, as in T3.

Decision: the package split is skipped. Providers, source-control hosts and secret providers stay in
`apps/server` rather than moving into T3-style workspace packages. The move changes no behavior,
touches hundreds of imports and can only be checked with typecheck, tests and the build, so the
risk is not worth a layout that users never see. The GitHub-style panel likewise stays on the git
layer, with the missing features added to it, and the newer hosts use the server's pull-request
service directly.

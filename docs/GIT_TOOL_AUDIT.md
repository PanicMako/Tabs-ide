# Git Tool Audit: Tabs, T3 Code, and Synara

Date: 2026-09-04

## Executive assessment

Tabs has the broadest standalone Git workspace of the three applications. It covers changes, inline and full diffs, conflict resolution, branches, divergence, history, pull requests, tags, stashes, accounts, repository settings, worktrees, and AI-assisted summaries. T3 Code and Synara expose fewer general Git-client workflows, but both have substantially deeper pull-request models and review experiences.

The current Tabs implementation is therefore a strong base. Its provider-neutral PR model and native detail/mutation workflow now cover most of the read/write surface from the reference applications, but it is not yet a replacement for their code-review experience. Earlier correctness gaps included remote panels calling the local API, fabricated PR comments, timer-based commit-message generation, and false authentication success; those are corrected in the implementation history below.

## Capability comparison

| Area                     | Tabs                                                                                                                                                                    | T3 Code                                                                       | Synara                                                          | Assessment                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Working-tree operations  | Rich staging, unstaging, discard, hunk/diff, conflicts, commit/amend/push                                                                                               | Basic repository actions                                                      | Basic repository actions                                        | Keep Tabs                                             |
| Branches and divergence  | Branch CRUD, merge/rebase, watched divergence, worktrees                                                                                                                | Basic branch/checkout integration                                             | Basic branch/project integration                                | Keep Tabs; harden command execution                   |
| History                  | Search, details, reset, revert, cherry-pick, AI summary                                                                                                                 | Limited compared with Tabs Git tool                                           | Limited compared with Tabs Git tool                             | Keep Tabs                                             |
| Stashes and tags         | First-class panels and actions                                                                                                                                          | Not comparable in breadth                                                     | Not comparable in breadth                                       | Keep Tabs                                             |
| Provider/account support | GitHub/GitLab full review adapters; Azure DevOps core adapter; Bitbucket Cloud list/detail/diff/review adapter                                                          | GitHub, GitLab, Azure DevOps, Bitbucket PR providers                          | Deep hosted-PR service and repository inventory                 | Core four-provider routing complete                   |
| PR list                  | Current-branch/repository list, state filters, load-more pagination, draft/review/check/merge metadata                                                                  | Rich filters, pagination, draft/review/check metadata                         | Rich list, project context, pinning, stack metadata             | Core pagination parity; advanced organization remains |
| PR detail                | Native Summary, Code, Checks, Commits, and Activity tabs; actors, labels, reviewers, comments/reviews                                                                   | Native summary, checks, commits, code, timeline, actors, labels, reviewers    | Native summary, checks, code, timeline, comments, stack context | Core detail parity; reactions/organization remain     |
| Review interaction       | Comments, approve/request-changes, reviewer/label edits, provider-backed inline threads, selectable diff lines, reactions, GFM rendering, plus separate local AI review | Inline annotations, comments, reactions, reviewer selection, Markdown editing | Comments, Markdown, review timeline and code inspection         | Core interaction parity                               |
| PR merge                 | Typed GitHub/GitLab mutation plus provider-declared actions and merge methods                                                                                           | Typed provider capabilities and merge methods                                 | Typed PR operations and capabilities                            | Core capability-aware mutation parity                 |
| Tests                    | Good lower-level Git coverage; sparse Git-panel/PR interaction coverage                                                                                                 | Extensive PR service, provider, and UI tests                                  | Extensive PR service, cache/recovery, and browser tests         | Add contract and interaction coverage                 |

## Findings by priority

### P0 — fixed in this change

1. **Remote action misrouting.** `GitToolV2` resolved an environment-specific API, but child panels independently called the global `readNativeApi()`. A remote status view could therefore perform mutations against the primary environment. All Git panels and modals now consume the API selected by `GitToolV2`, and the provider is cleared during an environment switch.

2. **Fabricated PR comments.** The PR panel generated a successful GitHub Actions comment after a timer without querying any provider. The comments affordance has been removed until real timeline data exists.

3. **False authentication success.** The device-auth modal closed after an unsuccessful or failed verification. It now remains open, reports the real failure, and closes only after the environment reports GitHub authentication.

4. **Placeholder AI presented as real AI.** Commit-message buttons used file names after an artificial delay. They now invoke the real diff-summary operation. The static review-rule template is now labeled “Use suggested rules” instead of “Improve with AI.”

### P1 — next implementation slice

1. **Provider-neutral PR domain — core completed.** Tabs carries provider identity, draft state, author, labels, review decision, mergeability, aggregate and individual checks, commits, comments, reviews, reviewers, body, change totals, bounded pagination, and a provider-authored capability object.

2. **Native PR detail workspace — provider-backed review surface completed.** Summary, Code, Checks, Commits, and Activity use accessible tab semantics and real provider data. GitHub and GitLab patches are normalized through one bounded contract with explicit binary/omitted and truncation states. Positioned discussions, replies, inline creation, and GitLab resolution are wired to provider APIs; GitHub resolution is capability-gated because its REST review-comment identity cannot resolve GraphQL review threads. Preserve Tabs' existing local AI Review panel as a complementary workflow.

3. **Typed PR mutation — all four providers routed.** The repository remote selects GitHub, GitLab, Azure DevOps, or Bitbucket before list, detail, creation, or mutation. CLI adapters pass literal argument arrays; Bitbucket uses structured JSON over authenticated HTTPS. Azure advertises no diff or comment controls because its current CLI surface cannot fulfill them, while its provider-backed auto-complete state, strategy selection, enable, disable, and title/description editing workflows are exposed. Bitbucket supports paginated lists/conversations, escaped provider-side search, provider diffs, comments, verdicts, inline replies, resolution, partial title/description updates, and reviewer mutations that resolve workspace-member UUIDs while preserving the existing reviewer set.

4. **Eliminate shell interpolation — completed.** Worktree paths, release titles/notes, workflow refs/versions, remote names/URLs, branch names, tags, and reset targets now cross typed schemas and execute as literal process argument arrays. The remaining terminal shortcuts use fixed commands only (for example `git merge --abort` and `gh auth login`).

5. **Environment-scoped Git UI state — completed.** Panel drafts, selected commits/files, collapsed state, excluded branches, summaries, audit state, and review badges are keyed by `(environmentId, cwd)`, preventing equal remote and local paths from colliding.

### P2 — quality and performance

1. **Mount only the active panel — completed.** Inactive Git panels no longer retain queries, effects, or provider polling.
2. **Complete change counts — completed.** The sidebar badge deduplicates staged, unstaged,
   untracked, and conflicted paths, so a conflicted file represented in multiple status groups is
   counted once.
3. **Accessible navigation and actions — completed.** The source-control rail uses linked
   tab/tabpanel semantics with roving keyboard focus, segmented views expose selection state, and
   icon-only Git actions have contextual accessible names and toggle state where applicable.
4. **Panel interaction coverage — completed for critical transitions.** Browser tests exercise
   loading/setup gates, destructive discard and force-push confirmations, unsuccessful
   authentication staying open, error-boundary recovery, an injected remote environment handling
   an actual diff action, and provider-backed pull-request state-filter transitions.
5. **Provider capability gating — completed for GitHub and GitLab.** The server declares diff, creation, action, verdict, and merge-method support; the renderer hides unsupported controls, and the manager rejects unsupported mutations independently.

## Recommended port strategy

Use Tabs as the host and port the PR domain in three vertical slices:

1. **Read-only core parity — completed.** User-controlled PR-list pagination, provider-backed PR file/diff data, and the Code tab use bounded typed transport. Advanced search and reference-app organization remain optional enhancements.
2. **Review interaction parity — completed for GitHub and GitLab:** provider-backed inline discussions, selectable old/new diff lines, replies, resolution, reactions, GFM descriptions/comments, review submission, and reviewer management work through typed provider capabilities.
3. **Core mutation parity — completed:** an explicit provider-capability contract gates create, merge-method, close/reopen, label, reviewer, and review actions in both renderer and server.

T3 Code is the stronger reference for multi-provider contracts, review filters, annotations, reactions, and merge capabilities. Synara is the stronger reference for stack context, repository inventory, project pinning/recovery, request coalescing, and its cohesive docked PR workflow. Tabs should port those strengths without replacing its more capable general Git workspace.

## Release gate

The Git tool now routes the four T3 providers through real adapters, including provider-aware local/worktree preparation instead of unconditionally invoking GitHub. GitHub/GitLab have reactions and rich review collaboration; Bitbucket has real search, diffs, inline collaboration, pull-request text editing, and reviewer assignment; Azure has capability-gated list/detail/create, lifecycle/reviewer/edit actions, and provider-backed auto-complete. Provider differences remain capability-gated instead of presenting controls backed by mock or unsupported behavior.

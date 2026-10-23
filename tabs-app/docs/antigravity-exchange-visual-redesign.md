# Antigravity / Claude: Tabs Exchange visual redesign and role discoverability

Paste everything below into one Antigravity task. Use Claude as the implementation model.

---

You are implementing a bounded redesign of the existing Tabs Exchange. Codex owns architecture, independent review, repair, and eventual integration. Your deliverable is a tested, reviewable staging implementation, not a public launch. Do not claim completion merely from screenshots or passing unit tests.

## 1. Workspace and baseline: mandatory before implementation

Your permitted write workspace is:

`/Users/rushil.dev/.codex/worktrees/tabs-exchange-claude-ui/tabs`

Work ONLY on `codex/tabs-exchange-claude-ui` there. The application directory is `tabs-main`. This is the NEW branch created specifically for this Claude/Antigravity assignment. Do not edit, commit, reset, stash, clean, merge, or run modifying setup commands in any other Codex worktree or the main checkout. Do not switch to `main` or `codex`, and do not touch the older Antigravity branch. Do not merge any PR, deploy, publish npm packages, or enable production submissions.

The current implementation to redesign is available READ-ONLY at:

`/Users/rushil.dev/.codex/worktrees/tabs-extensions-testing/tabs/tabs-main`

Baseline arrangement, prepared on October 3, 2026:

- Your new branch starts from a frozen copy of the current Exchange staging implementation, including its previously untracked Astro frontend, SDK 1.7, and reviewer/operator modules. The Codex testing worktree remains dirty and unchanged by the snapshot process.
- The frozen comparison base is `codex/tabs-exchange-ui-baseline`. This local reference must stay at its original snapshot commit. Do not add redesign commits to it.
- The snapshot deliberately excludes unrelated changes to `apps/desktop/src/linuxAppImageUpdater.ts`, `apps/marketing/src/components/ConceptTwoRefined.astro`, and `apps/marketing/src/styles/concepts.css`. Do not import or alter them.
- The old Antigravity branch has SDK 1.5 and no dedicated Astro Exchange frontend. Existing draft PR #6 (`https://github.com/PanicMako/Tabs-ide/pull/6`) targets the older `codex/tabs-extensions-exchange` branch. Leave both untouched.

First report your branch, SHA, dirty files, and `git rev-parse codex/tabs-exchange-ui-baseline`. Confirm the new workspace contains `apps/exchange/frontend`, SDK 1.7, `reviewerRoles.ts`, and the homepage WITHOUT the rejected illustration. If anything is missing or the base has moved unexpectedly, report `BASELINE_REQUIRED`; do not implement against stale source, silently rebuild the backend, or copy arbitrary dirty Codex files. Preserve any new work you find in your own workspace.

Create a NEW draft PR with head `codex/tabs-exchange-claude-ui` and base `codex/tabs-exchange-ui-baseline`. This produces a redesign-only diff; do not include the whole frozen baseline as new redesign work. These references are initially local. You may push these TWO newly created references to the configured project remote to create the requested draft PR, after confirming an existing remote reference is absent or exactly matches the local baseline. Never force-push or overwrite a conflicting reference. If GitHub permissions or a conflicting remote ref prevent this, return local SHAs and the exact blocker. Never substitute `main`, `codex`, the dirty testing branch, or the older extensions branch as the PR base. Codex will review the redesign-only diff before any integration into the testing branch.

## 2. Objective and non-negotiable visual direction

Redesign EVERY existing Exchange screen so it feels like the same product as Tabs marketing Concept One, while preserving working flows, real data, authentication, security, SDK documentation, and canonical URLs.

The current site feels generic and inconsistent. Fix composition, typography, spacing, hierarchy, controls, interaction states, and responsive behavior—not just colors or one hero. Use a restrained, deliberate editorial design. The marketing page is inspiration, not a requirement to copy irrelevant marketing content into a working marketplace.

Chosen design rules:

- Marketplace home and catalog are discovery-first. NO large decorative workspace illustration, faux application window, floating stickers, or ornamental hero consuming search space. The recently added homepage illustration was explicitly rejected and removed.
- Illustrations are allowed only when they EXPLAIN something: a documentation diagram showing package → review → signed publication, a profile-isolation diagram, or a genuinely useful developer onboarding example. Place each beside the exact content it explains; caption it and provide equivalent accessible text. Do not recreate the rejected illustration elsewhere as decoration.
- Keep the existing extension puzzle mark from `frontend/src/lib/extensionMark.ts`; do not generate a new logo.
- Use the bundled DM Sans Variable for UI/body and Instrument Serif italic selectively for editorial headings. Keep labels, status, permissions, code, tables, and destructive actions easy to scan. Verify fonts actually load; declaring an unavailable family is not sufficient.
- Use Concept One's off-white surfaces, ink text, Tabs blue `#3259ed`, and restrained peach/green supporting panels. NO linear, radial, or conic gradients, neon/glass effects, excessive shadows, or generic AI-looking decoration.
- Reuse shared corner tokens: `--radius: 28px` for surfaces and `--control-radius: 999px` for compact controls. Do not sprinkle different numeric radii through pages. Inputs/buttons/dropdowns should have rounded ends; panels should feel intentionally related.
- Preserve the custom cursor's touch/coarse-pointer/reduced-motion behavior. It must not obscure inputs or replace keyboard focus. Do not add a cursor library or duplicate cursor system.
- Use short, purposeful entry/hover/selection transitions, preferably 160–500ms. No infinite motion, scroll hijacking, artificial delays, or animation that hides data/actions. Respect `prefers-reduced-motion`; all functionality works with motion disabled.
- Footer remains the marketing-style blue editorial footer. Keep `Tabs` on the left and `Exchange` on the right on ONE baseline, with a small deliberate inter-word gap and narrow viewport gutters. Use the existing measured fit-to-width mechanism; no text stretching, horizontal overflow, clipping, or wrapping the words onto separate rows. Do not restore the game.
- Preserve visible but restrained keyboard focus. Do not remove outlines to make the page look sleek.
- Use the existing custom dropdown controller, fixing/reusing it if necessary. Keep native underlying form values, labels, keyboard behavior, disabled states, and validation. No unlabeled clickable-div dropdowns or browser-native alert/confirm/prompt.

## 3. Read these references before editing

Paths below are relative to the CURRENT read-only `tabs-main` source; inspect the corresponding baseline files in your own workspace after baseline preparation.

Primary aesthetic reference:

- `apps/marketing/src/components/ConceptOne.astro`
- `apps/marketing/src/styles/concept-one.css`
- `apps/marketing/src/components/ProjectSketch.astro`
- `apps/marketing/src/components/ConceptOneWorkflow.astro`
- `apps/marketing/src/components/FooterSignature.astro`
- `apps/marketing/src/components/CustomCursor.astro`
- `apps/marketing/src/layouts/Layout.astro`
- `apps/marketing/src/components/download/ConceptOneDownload.astro`
- `apps/marketing/src/components/changelog/ConceptOneChangelog.astro`

Current Exchange implementation:

- `apps/exchange/frontend/src/layouts/Exchange.astro` and `Account.astro`
- `apps/exchange/frontend/src/styles/exchange.css`
- ALL files under `apps/exchange/frontend/src/pages`, `scripts`, and `lib`
- `apps/exchange/frontend/src/lib/customSelect.ts`, `wordmarkSize.ts`, `accountNavigation.ts`
- `apps/exchange/frontend/src/scripts/custom-select.ts`, `wordmark.ts`, `account.ts`, `api.ts`
- `apps/exchange/src/frontend.ts` for canonical route mapping and private frontend handling
- `apps/marketing/src/lib/extension-docs.ts` and Markdown renderers; preserve generated contract references
- `packages/extension-api/src/index.d.ts`, `packages/extension-cli`, and release build/verifier scripts

Product/security references:

- `AGENTS.md`
- `docs/exchange-experience-redesign.md`
- `docs/exchange-staging-acceptance.md`
- `docs/exchange-ecosystem-readiness.md`
- `docs/exchange-reviewer-hierarchy.md`
- `docs/extensions.md`, `docs/exchange.md`, `docs/exchange-registry-api.md`
- `apps/exchange/src/auth.ts`, `reviewerRoles.ts`, `config.ts`, `server.ts`, `schema.sql`
- `apps/exchange/src/public-openapi.json`

Open VSX at `/Users/rushil.dev/Desktop/tabs/openvsx-main` is READ-ONLY workflow inspiration. Borrow discoverability, clear resources/account navigation, publisher onboarding, and status clarity. Do not import its code, branding, .vsix protocol, or copy its site one-to-one. This assignment does not authorize an upstream audit or a registry rewrite.

## 4. Required pages and observable behavior

Inventory every page first. Do not finish after polishing `/`.

### Public discovery

- `/`: compact editorial introduction, prominent real search, Explore and Build links, genuine discovery/publishing guidance. No fake featured extensions, ratings, download counts, or placeholder buttons.
- `/extensions`: clear search/category/sort/result layout, readable extension cards, real reviewed icons and fallback marks, loading/empty/error/reconnect states. Keep 200ms debounce, cancellation, URL query/category/sort state, back/forward/refresh restoration, cursor pagination, and honest “loaded” counts.
- `/extensions/:namespace/:name`: identity, verified publisher meaning, overview/README, compatibility, permissions, external billing disclosure, reviewed screenshots, support/privacy, version selector/history, and clear Install in Tabs instructions. Current listing must not wait for all version history. Keep safe Markdown and packaged-only images. A browser download is NOT trusted installation.
- `/resources`: actual documentation, support/contributing/security information. Do not invent sponsor programs, working groups, service status guarantees, or links that do not exist.
- `/publisher-terms`: preserve actual terms and experimental status; no automatic consent.

### Developers and documentation

- `/developers`: a novice can find the experimental SDK/CLI download, compatibility/status, quickstart, desktop-loading guide, and publishing guide immediately.
- ALL `/docs/extensions/*`, including registry API: strong reading hierarchy, mobile guide navigation, breadcrumbs, section-level search, copy controls, stable heading links, and previous/next navigation. Typography must be comfortable for long reading, not marketing-sized body text.
- Add useful inline diagrams only for actual documented concepts. Diagrams must match implemented behavior and be understandable without animation or color. Do not invent APIs, npm-published packages, or hot reload.
- Keep generated references and exact runnable commands intact. Preserve staged tarball distribution; users should not need to clone Tabs. Use real SDK/version labels, not hardcoded fictional release availability.

### Publisher workspace

- `/publish`: orderly prerequisites → namespace → package → progress → accepted submission. Browser uploads never require CLI tokens. Preserve one-package `.tabsext` selection, 25 MiB limit, accessible drag/drop alternative, inspected identity, server-authoritative checks, cancellation, duplicate feedback, and uncertain-timeout status lookup before retry.
- `/account`: account identity, role and pending actions; clear links to namespaces, submissions, tokens, and authorized review/operator workspaces.
- `/account/namespaces`: creation, memberships, known-account invitations, acceptance/decline/cancel/removal with reasons, last-owner protection; do not confuse namespace ownership with registry administration.
- `/account/extensions`: readable submission and release management; real lifecycle states and useful empty/error states.
- `/account/tokens`: labeled scopes/namespaces, show-once secret, copy instructions, expiration/revoke; never reveal existing token plaintext or log secrets.
- `/account/submissions/:id`: timeline, scan results, reviewer reasons, correction/appeal, published listing link. Distinguish uploaded, scanning, awaiting review, rejected, approved awaiting signed publication, published, and revoked. Preserve five-second active polling, pause when hidden, stop on terminal states.

### Review and operator workspace

- `/admin`: clear queue/workspace for inspecting quarantined submissions, manifest, scans, capabilities/diffs, publisher history, appeals, and exact-digest decisions. Preserve authenticated archive download for complete independent inspection. Existing inline previews are bounded; label omissions instead of pretending every file was inspected. Never execute uploaded code or render submitted HTML in the admin origin.
- `/admin/security`: organized existing publisher-verification and blocked-digest operations, reasons, audit history, and consequences. Keep current backend authority; do not silently introduce new roles or broaden reviewer privileges.
- `/admin/reviewers`: discoverable operator-only people/access management with current identity/role, known GitHub username, grant/revoke choice, reason, explicit confirmation, assignment list, and audit actor/time/reason. Use existing role service rather than building another account system.

## 5. Role hierarchy: exact decisions, not your invention

Current backend foundation is IMPLEMENTED, but its navigation/acceptance is incomplete:

1. **Operator / super user**: bootstrapped ONLY through `EXCHANGE_OPERATOR_GITHUB_IDS` using explicitly configured numeric GitHub IDs. Can review and grant/revoke reviewer access for known accounts. There is NO browser “make me super admin” or automatic first-user promotion. Do not assign a real account yourself.
2. **Reviewer**: current `actor.admin === true` provides existing review/security operations. May inspect quarantined submissions and exact archives and make exact-digest decisions. Cannot assign reviewers/operators, obtain signing keys, or bypass signed publication.
3. **Publisher namespace owner**: manages only that namespace and its owner/contributor invitations/members; ownership does NOT give registry review access.
4. **Publisher contributor**: contributes/releases within current authorized membership; cannot administer registry roles.
5. **Public reader**: sees published catalog only. Private instances additionally require current allowlisted authentication.

“Sub-users” means delegated reviewer accounts using their own GitHub sign-in, not child passwords, impersonation, recursive administrator creation, or a new login provider. Reviewers may not delegate further. New reviewers must first sign in to this Exchange, so the server can resolve their known GitHub account. Tell the operator clearly when that prerequisite is unmet.

Existing endpoints:

- `GET /v1/me` supplies current identity and `admin`/`operator` flags.
- `GET /v1/operator/reviewers` lists operator-visible assignments/history.
- `POST /v1/operator/reviewers` accepts `{login, action: "grant" | "revoke", reason}` with session, origin, and CSRF checks.

Add an accessible account popover/navigation using actual current roles: Account, Namespaces, Submissions, CLI tokens; Review queue only for `admin === true`; Reviewer access only for `operator === true`. Include a visible role description in the account overview. Hiding a link is not authorization: preserve server checks on every privileged request. On 401/403, discard privileged content and give reconnect/permission guidance; never retain stale authority.

Keep grant confirmation explicit and keyboard accessible; prevent double submission and automatic retry. Unknown mutation outcome requires refreshing assignments/audit before retry. Revocation affects current sessions on their next privileged request. Publisher/read tokens never become administrative credentials. Keep configured legacy reviewers distinct from operators.

Document operator bootstrap, delegated reviewer onboarding, and revocation without exposing secrets. Explain that `http://127.0.0.1:4323` is STATIC PREVIEW: it cannot prove real GitHub sign-in or admin authorization. Live sign-in needs the same-origin Exchange API, PostgreSQL/storage, a real GitHub OAuth app, and a matching callback. Do not “fix” sign-in by creating fake production login or storing role flags in localStorage. Use isolated fixtures only when clearly labeled as tests.

## 6. Scope and invariants

Allowed redesign files: Exchange frontend components/layouts/styles/scripts/libs/pages, their focused tests, and required operator/developer UX documentation. Add shared presentation primitives rather than page-by-page duplicates. Do not change the marketing site's accepted Concept One design. Do not change backend auth, role policy, package format, review gates, signing, sandbox, desktop installer, or database schema for cosmetic convenience. Report a genuine backend gap to Codex rather than inventing endpoints.

Preserve same-origin credentials/CSRF, private-registry no-store behavior, safe Markdown, immutable identities/digests, exact-digest review, signed TUF installation, profile/project isolation, current release compatibility, and disabled public publishing. Never print credentials. Never run submitted packages during review. No native alert/confirm/prompt. No external paid UI services or framework rewrite.

Before replacing UI, map each existing selector/event/API behavior to its replacement. Keep working flows intact, including asynchronous forms, disabled fieldsets, form validation, focus restoration, cancellation, stale-response guards, back/forward cache, and listener/request cleanup.

## 7. Verification and checkpoints

Implement in reviewable commits:

1. Baseline verification + page/state inventory + shared tokens/typography/header/footer/controls.
2. Public discovery and detail pages.
3. Developer/docs reading experience and useful diagrams.
4. Publisher pages and all lifecycle/error states.
5. Role-aware account navigation + reviewer/operator screens.
6. Browser/accessibility verification and handoff.

For every page, inspect desktop and mobile at 390px and 1440px, plus 200% zoom. Check overflow, heading wrapping, focus visibility, keyboard tab order, custom dropdown arrows/Home/End/Enter/Escape/Tab, file selection without dragging, live-region messages, and reduced motion. Capture actual screenshots after rendering settles; include empty, loading, denied, error, and populated states. Do not fabricate screenshots or data.

Required automated coverage: homepage remains search-first/no illustration; fonts are bundled/loaded; shared corner/no-gradient constraints; single-baseline footer fit; dropdown values/validation; role-specific navigation for anonymous/publisher/reviewer/operator; no operator links for malformed/truthy role flags; access loss clears privileged UI; grant confirmation/cancel/focus; one mutation per confirmation; documentation nav/search/copy/anchors; stale-response protection and lifecycle cleanup.

Run commands from your own `tabs-main`:

```sh
bun run --cwd apps/exchange build:web
bun run --cwd apps/exchange check:web
bun run --cwd apps/exchange verify:docs
bun run --cwd apps/exchange test
bun x turbo run test --concurrency=2
vp check
vp run typecheck
```

If a command is missing because your baseline is old, that is `BASELINE_REQUIRED`, not permission to delete the test. Do not pass `--concurrency=2` through to Vitest; it is a Turbo flag. Do not silently skip integration or stalled suites. Distinguish DOM mocks, browser API fixtures, PostgreSQL/S3 tests, real Electron, and live GitHub OAuth. Unit-test role fixtures are not evidence of live account provisioning. Do not grant real security-sensitive access for screenshots.

## 8. Final output to the user and Codex

Leave all work on your Antigravity branch, with no merge/deployment/publication. Create a DRAFT PR against the approved testing baseline once available, or report the exact unavailable-base/GitHub-permission blocker and local SHAs.

Return ONE walkthrough containing:

- baseline provenance and commit SHAs; PR URL/base/head, if created;
- all changed files and which requirements each implements;
- before/after screenshots grouped by page, desktop/mobile and error/role states;
- exact commands, exit codes, failures, retries, and existing warnings/skips;
- browser walkthrough for search, docs, publish, account, reviewer and operator flows;
- role matrix and bootstrap instructions; no real IDs/secrets;
- actual-vs-mocked verification and all missing external credentials;
- remaining gaps and regressions; no unsupported “production ready” claims.

Codex will independently inspect the full diff and verify behavior. Your narrative and screenshots do not substitute for correct code. Do not weaken tests, hide failures, or merge your own work.

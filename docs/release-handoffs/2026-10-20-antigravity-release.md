# Antigravity handoff: ship the next Tabs desktop release

The human has authorised publishing the completed Exchange work and a new GitHub
desktop release. They explicitly want Antigravity, not Codex, to babysit the
GitHub Actions builds and release. Do the work, diagnose failures, and finish
with verified download links. Do not just return a plan or start a workflow and
call it complete.

## Verified starting point

- Repository: https://github.com/PanicMako/Tabs-ide
- Human workspace: /Users/rushil.dev/Desktop/tabs
- Source branch: codex/settings-study-surface
- Committed source baseline: db7d9260f6fa889d5523be4f862c5014cd54f558
- Latest shipped desktop release checked on 20 October 2026: v2.0.0.
- Proposed next release: v2.0.1. Recheck tags/releases before choosing it; never
  overwrite v2.0.0, reuse an existing tag for different bytes or delete releases.
- Existing Antigravity worktree /Users/rushil.dev/.codex/worktrees/tabs-exchange-antigravity/tabs
  is on codex/tabs-exchange-antigravity at 5d50bf1f9. It is NOT the new source.
  Do not reset or overwrite it. Inspect its status before any use.
- Create a separate clean worktree and branch codex/release-2.0.1 from the source
  baseline above (or its verified descendant containing this handoff). Do not
  write in Codex's dirty checkout or change main as a shortcut. If the proposed
  branch exists, inspect/reuse it safely or choose a distinct codex/ branch.

Read applicable AGENTS.md instructions, tabs-app/docs/release.md,
the skills under .agents/skills/tabs-release-babysitter/SKILL.md and
.agents/skills/tabs-release-notes/SKILL.md, .github/workflows/release.yml,
build-desktop.yml, deploy-marketing.yml and tabs-app/docs/code-oss-release-handoff.md.
When interacting with Cloudflare, use cf CLI unless that project has a Wrangler
configuration file. No destructive Git commands, stash clearing or forced pushes.

## Capture the desktop work before releasing

The original workspace has uncommitted desktop extension improvements under
apps/web inside tabs-app. These are NOT in the baseline commit. Inspect the
complete diff and the new InstalledExtensionToolIcon.tsx. They cover extension
installation/manage UI, package logos, tool surface, workspace toolbar visibility
and remembering the selected extension when switching projects. Preserve the
human's checkout. Transfer only those relevant changes into your isolated branch,
review them, run their tests and commit them there. Do not silently release the
old desktop UI or include unrelated MOBILE_APP_CONTEXT.md, prototypes/ or
extensions/ content. Never copy .env files, credentials, signing backups or private
user content. If the diff changes while transferring, reconcile rather than
replacing the human's work.

The Exchange/SDK baseline already contains agent instructions, AGENTS.md starters,
automatic host light/dark styling, private user reports, publisher verification,
publisher terms/privacy dated 2026-10-20 and renewed agreement acceptance.
Canonical policy sources: tabs-app/docs/exchange-publisher-terms.md and
exchange-privacy-policy.md. legal-drafts/ is historical, not live policy content.
Public contact: tabsappinbox@gmail.com. Public operator name: PanicMako (Rushil).
Do not invent company information or claim universal legal compliance.

## Build and release

1. Audit the final release diff against the previous shipped tag. Bump the desktop
   version consistently using the repository's existing process. Preserve the
   beta update channel. Write truthful .github/release-notes/v2.0.1.md and the
   matching CHANGELOG.md entry; update matching marketing fallback data if present.
   Distinguish the separately deployed Exchange site from shipped desktop changes.
   Run the release-notes validator. Do not claim signing/notarization that did not
   happen or improvements that were not included in the actual release commit.
2. Run focused tests for the imported desktop changes, relevant browser tests,
   workspace tests, vp check and vp run typecheck. Existing Exchange baseline:
   517 tests passed, 24 opt-in real-service tests skipped; 16 packages typechecked;
   Astro check and build passed. Those results are a baseline, not proof of your
   changed desktop. Never weaken tests or label skipped/mocked tests as live checks.
3. Open/update a reviewable draft PR against codex/settings-study-surface documenting
   the imported changes, version and exact checks. No merge into main as a shortcut.
   Publish only the audited release branch SHA using the existing workflows. The
   human has authorised this desktop release; use the ordinary new-version path,
   not the special replacement_release_id/replacement_tag_sha mechanism.
4. Build all four desktop platforms with build-desktop.yml. Use the successful
   artifact_run_id for the documented native packaged smoke tests, then release.yml
   so the reviewed artifacts are reused. Prefer dispatch over combining a tag push
   and dispatch that could create duplicate runs. Publish as Latest for this new
   patch release using make_latest=true, retaining the configured beta channel.
   Confirm current workflow inputs rather than assuming old example commands.
5. Follow every Actions job until completion. Diagnose and fix actual failures in
   small commits. Never retry unchanged failures indefinitely. Preserve extension
   sandboxing, signature/digest validation, pinned official root, update keys,
   review requirements, credentials and project-scoped permissions. Do not bypass
   Gatekeeper, signing verification, quality gates or native smoke checks. Missing
   credentials must be reported precisely without printing secret values.
6. Verify the GitHub release is published at the intended tag/SHA with all macOS
   architectures, Linux and Windows installers, update manifests, blockmaps and
   checksums/signatures required by the existing workflow. No silently missing
   platform. Check version/architecture and packaged startup using native CI.
7. Finish the marketing website release-data refresh/deployment using the existing
   deploy-marketing.yml flow. That workflow builds trusted default-branch code;
   if branch changes are needed for marketing, prepare a reviewed PR and explicitly
   report the integration dependency rather than claiming they deployed. Verify
   https://buildwithtabs.com actually offers the new release and correct platform
   downloads, and existing auto-update metadata remains consistent.

## Exchange deployment context and launch checks

Render service: srv-db8fd8u7bikc73930ncg (tabs-exchange-api).
Origin: https://exchange.buildwithtabs.com.
Deployment branch codex/exchange-deployment is an app-only projection, NOT the
root monorepo and NOT a valid desktop release source.
Policy deployment projection: f909718153f00e5dc4b013175b098d8ce4a8baa6.
Recheck the current deployment status and source before changing it. Codex completed the website launch: both policies return 200, /v1/registry
reports publishingEnabled=true and reviewRequired=true, and the publisher UI
requires explicit acceptance of 2026-10-20. Do not trigger unnecessary deploys.
Independently verify /publisher-terms, /privacy, /developers and
/v1/registry. Public submissions must still require sign-in, the exact current
terms version, namespace permission, quotas, scans, manual review and a signed
release. Never make reviewer access public or autoapprove packages. Test using
an authorised disposable account/package only; no fabricated public reports.

## Return evidence

Give the human the final branch/SHA, PR, workflow run links, GitHub release URL,
per-platform artifact links, website verification, tests actually run, and any
remaining limitations. Distinguish implemented, tested, deployed and unverified.
Stop and explain a concrete blocker if it cannot be resolved within authorised
scope; do not fabricate credentials, confirmations, legal facts or successful tests.

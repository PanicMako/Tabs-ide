---
name: tabs-release-babysitter
description: Monitor and finish a Tabs GitHub desktop release and website deployment, diagnosing failed Actions jobs, applying scoped fixes, and verifying all published artifacts and live site updates. Use whenever asked to babysit or complete a Tabs release.
---

# Tabs Release Babysitter

Work from the repository root and treat GitHub Actions, the GitHub release, and the live production website (`https://buildwithtabs.com/`) as authoritative. The outcome is a successful release with complete desktop installers and an updated, live marketing website and changelog—not merely a green preflight or partial desktop build.

## Safety and scope

- Confirm the repository, target version, branch, and release run before mutating anything.
- Require explicit user authorization before pushing commits, dispatching/rerunning workflows, creating tags, or publishing a release. An invocation that explicitly asks you to finish the release and authorizes those actions is sufficient.
- Preserve unrelated uncommitted work. Never use `git add -A`, destructive checkout/reset commands, or broad stashing. Stage only exact files changed for a verified failure.
- Do not merge stale, demo, unrelated-history, or experimental branches merely because they are unmerged.
- Stop and ask only for missing credentials that cannot be retrieved, an irreversible ambiguous decision, or a conflict with user-owned edits that cannot be safely isolated.
- Before drafting or reviewing release notes, read [Tabs release notes](../tabs-release-notes/SKILL.md) and follow its editorial review. Ensure `.github/release-notes/<tag>.md` exists in the release commit. Do not use a generated `Full Changelog` link as the note body, and do not list failed CI attempts, reruns, or fixes that were not delivered in the tagged build.

## Workflow

1. Inspect `git status --short --branch`, remotes, the latest release-workflow runs, and the requested tag/release state.
2. Before making a new tag, identify the previous stable tag and review the changes in that version range. Follow the linked Tabs release-notes skill, author `.github/release-notes/<tag>.md`, update `CHANGELOG.md`, run the release-note validator, and review the rendered copy. Commit the notes with the intended release changes before creating the tag.
3. If a matching desktop release run is active, follow that exact run. Do not dispatch a duplicate.
4. Wait for job transitions with `gh run view` or `gh run watch`. Avoid repeated full local builds while CI is already executing them.
5. On failure, retrieve only failed-job logs first. Identify the earliest causal error; warnings and downstream suite failures are not separate root causes.
6. Classify the failure:
   - For a transient network/runner failure, rerun failed jobs once without changing code.
   - For a deterministic code, test, packaging, or workflow defect, reproduce the narrowest useful slice, implement the real fix, run focused validation, commit exact files, push, and dispatch a fresh release from the new commit.
   - Never weaken production behavior or assertions just to make CI green.
7. Continue until all platform builds, publication, and finalization succeed.
8. **Babysit the Website Deployment**:
   - Once the desktop release publishes, automatically track the `Deploy Tabs website` workflow (`deploy-marketing.yml`).
   - If the website deployment fails (e.g. invalid Vercel secrets, path resolution, or build output issues), diagnose the failure, resolve the root cause, re-dispatch the workflow, and monitor it to green.
   - Do NOT stop or report complete until the website deployment completes with `success` and the live site reflects the new release.
9. Verify that the production site at `https://buildwithtabs.com/` (and its changelog at `https://buildwithtabs.com/changelog`) is live and serving the new version string, download assets, and release notes.

## Completion proof

Before declaring success, verify all of the following:

- Release workflow conclusion is `success` and its head SHA is the intended pushed commit.
- The expected version tag and GitHub release exist and point to the intended commit.
- macOS arm64 and x64, Linux x64, and Windows x64 application artifacts are present.
- All desktop installers (.dmg, .exe, .AppImage) must be self-contained bundled ("fat") installers that include `tabs-code-oss` directly inside (`Resources/tabs-code-oss` on macOS, `resources/tabs-code-oss` on Linux/Windows). Standard releases must NEVER ship thin installers that rely on on-demand downloads or external runtime zips.
- Update manifests and blockmaps required by the workflow are present.
- The release is marked latest/prerelease consistently with its semantic version.
- The `Deploy Tabs website` workflow conclusion is `success`.
- `https://buildwithtabs.com/` and `https://buildwithtabs.com/changelog` are reachable over HTTP 200 and display the newly released version tag, release notes, and matching download links.

Return the release URL, desktop workflow URL, website deploy workflow URL, live website URL, final commit SHA, and a compact artifact summary. Mention any preserved local uncommitted work.

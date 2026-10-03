---
name: tabs-release-notes
description: Write or review reader-facing Tabs IDE changelog entries and GitHub release notes. Use when preparing a Tabs release, editing CHANGELOG.md, or correcting published release copy.
---

# Tabs release notes

Release notes are for someone deciding whether to install or update Tabs. Describe what they can do now, what changed in their workflow, and any action they must take. Keep the wording factual and grounded in the commits between the previous shipped tag and the target tag; do not turn a prompt, plan, test, or intended behavior into a shipped claim.

## Where the copy goes

- For a new release, write `.github/release-notes/<tag>.md` before tagging. The release workflow publishes that file as the GitHub Release body; the website displays it.
- Update the matching entry in `CHANGELOG.md` to agree with the release notes. If the marketing fallback in `tabs-app/apps/marketing/src/data/changelogData.ts` has the same tag, keep its headline and summary consistent too.
- When correcting an already-published release, distinguish editing repository files from editing the live GitHub Release body. Updating a file alone will not change the live page. Confirm authority before changing the published release, and verify the website after the change.

## Editorial review

1. Identify the previous shipped release and verify every claimed change against code, tests, or release artifacts in that version range. Omit uncertain claims.
2. Lead with a short, concrete headline and one or two sentences about the user-visible result. Under `### What changed`, use concise bullets naming the feature or fix and its practical effect.
3. Write `### Upgrade notes` only when users must act, compatibility changes, or availability differs by platform. Do not add a generic “seamless update” claim.
4. Remove implementation and process narration unless it explains a real user-facing change: internal class names, schema/IPC details, test coverage, CI retries, layout implementation, “production-grade,” and exaggerated guarantees are not release notes.
5. Use Markdown, not raw HTML. Read the rendered page as a user would. If a sentence sounds like a development task or promise instead of a shipped benefit, rewrite or omit it.

Run `node scripts/validate-release-notes.mjs .github/release-notes/<tag>.md` from the repository root, then have a human-quality review of the final rendered GitHub and website copy. The validator catches obvious structure and wording mistakes; it cannot prove a claim was shipped.

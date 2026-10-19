# Exchange launch status — 20 October 2026

The operator authorised finalising and publishing the policies, opening
submissions, and a new GitHub desktop release, with Antigravity responsible for
babysitting the desktop release.

## Published and checked

- Source commit: db7d9260f6fa889d5523be4f862c5014cd54f558.
- Render app-only projection: f909718153f00e5dc4b013175b098d8ce4a8baa6.
- Render service: srv-db8fd8u7bikc73930ncg.
- Policy deployment: dep-dbb8m6igjjms739hkl60.
- Public-submission configuration deployment: dep-dbb8nr6i0phs73fvtb5g.
- https://exchange.buildwithtabs.com/publisher-terms returns 200 with version
  2026-10-20 and the supplied operator/contact details.
- https://exchange.buildwithtabs.com/privacy returns 200 with the same contact.
- /v1/registry reports publishingEnabled=true, namespaceManagementEnabled=true,
  authentication=anonymous-read, and reviewRequired=true.
- /healthz returns 200 with ok=true.
- Signed-in Publish UI says Open for submissions and shows the current terms
  2026-10-20 unchecked. No agreement was accepted or package uploaded by Codex.
- Ordinary sign-in, namespace authority, quotas, scans, manual review and signed
  publication remain enforced. Only the existing official-service publishing
  feature flag changed; self-hosted configuration defaults remain disabled.

## Validation

- Exchange: 517 passed, 24 optional real-service tests skipped (104 files passed,
  3 skipped). The skipped external integrations are not claimed as live checks.
- Workspace typecheck: 16 packages passed.
- vp check: 0 errors, 662 existing warnings.
- Astro check: 0 errors, warnings or hints; portal/developer bundle build passed.
- The previous 2026-09-24 acceptance is explicitly rejected by the updated
  agreement test. Acceptance records are not silently migrated to the new terms.
- Code OSS precommit hook executed; changes are outside its checkout. Workspace
  formatting/lint checks and git diff --check passed for the scoped changes.

## Desktop release handoff

No GitHub desktop release was created or monitored by Codex in this launch step.
See release-handoffs/2026-10-20-antigravity-release.md. Existing human desktop edits
remain untouched in the original workspace and must be audited/transferred before
the next release. Current shipped version is v2.0.0; v2.0.1 was available when
checked. Antigravity must recheck before tagging.

## Operational limits

The supplied Gmail address is published; inbox delivery was not tested by sending
mail. The operator must monitor it and the private User reports queue. Requests
and retention are handled under the published criteria; this task does not claim
an automated erasure system or universal legal compliance. Historical drafts
are archived and are not the live policies.

# Review Desk: the operator workflow

## Daily review

Open /admin. The reviewer workspace has its own sidebar, separate from publisher
setup. Pending packages are shown first. Search applies to the bounded queue
already loaded; refresh checks for new work. Approved versions are available in
the Show filter, and publication has its own sidebar entry.

1. Select a package in the queue. Only that package's inspector is constructed;
   opening a package or changing selection never sends a review decision.
2. Open code review to browse the submitted source and leave local draft notes.
   Review scan findings/requested access before deciding. A scan is not a safety
   guarantee. Keep the exact package fingerprint in view.
3. Optionally choose Copy for AI review. It copies a bounded summary by default.
   AI review options lets you explicitly include limited code previews and read
   the full prompt before sharing. Clipboard failure opens selectable text.
4. Read the AI report as advice. Confirm the actual evidence and manual checks.
   Record a truthful reason, confirm the displayed fingerprint, and choose an
   explicit decision. AI output never approves, rejects, revokes or publishes.
5. Confirmed approval exposes Next: publish the approved release. An operator
   follows that link, unlocks the existing signing backup locally, checks the
   release plan, and explicitly signs/publishes. Signing keys never go to chat.

Confirmed revocation exposes a corresponding signed-restriction next step.
Unknown network outcomes require refreshing and checking history, not an
automatic retry. Decisions remain bound to the original digest and server state.

## Where to find other work

- Publish approved: /admin/releases — signing and publication, operator only.
- User reports: /admin/reports — private concerns and recorded responses.
- Publishers & safety: /admin/security — Verify publishers, package restrictions.
- Review team: /admin/reviewers — grant/revoke reviewer roles, operator only.
- Service health, History, Appeals: the review queue's task tabs and sidebar links.
- Publisher workspace: return link for your own namespace/submission setup.

Navigation labels do not grant permissions. API authorisation, CSRF controls,
scan/review requirements and signed publication have not been relaxed.

## AI-copy boundary

The copy action makes no request to any AI service. It excludes credentials,
reviewer form inputs and signing keys; known secret patterns are redacted, but
redaction is not comprehensive. Inspect before sharing. Source snippets and all
publisher-supplied text remain untrusted evidence. The prompt asks for coverage,
findings with references, suspected injection, remaining manual checks and an
advisory conclusion; it grants no tool execution or publishing authority.

Summary/diff previews are not a full archive audit. The destination chat's own
limits and data practices apply. No claim of unlimited chat, API-equivalent
privacy, universal malware detection or guaranteed injection prevention is made.
Existing public policies were not changed by this UI task.

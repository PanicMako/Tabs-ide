# Tabs Exchange — policy review pack

Prepared 19 October 2026; revised 20 October 2026 for worldwide availability. These documents are proposals for proofreading, not
published terms, a compliance certification, or a substitute for qualified legal
review. Public submissions should remain on the current account-only pilot until
the final policy text, operator details, and operational commitments are approved.

Read these two documents:

1. [Publisher terms](publisher-terms.md)
2. [Privacy policy](privacy-policy.md)

## What “operator” means in plain language

The operator is the real person or registered organisation responsible for the
service and for receiving complaints. “Tabs” is the product name; a GitHub handle
alone does not answer who is responsible. Open VSX names its actual operating
organisation, Eclipse Foundation AISBL, in its publisher agreement. That does not
mean Tabs should use Eclipse's name, Belgian legal form, or location.

Tabs and Exchange are intended for worldwide use, without a general country or
nationality exclusion. Your earlier mention of India described where you live;
it did not establish the service's legal operator or choose governing law. The
revised drafts leave the operator's establishment and governing law unselected.
Global availability, operator location, governing law, and data-storage locations
are separate questions. A globally available service can still have an operator
and a governing-law clause in one country, with mandatory local rights preserved.

If you personally operate the service, candidate wording to have checked is
“[your full legal name], operating Tabs Exchange.” If a company operates it, use
its actual registered name. Do not choose a fictitious foreign operator or a
“global jurisdiction.” Free worldwide access does not guarantee availability
where law, network access, or infrastructure providers prevent it.

One monitored inbox can initially cover support, privacy and legal requests.
For example, `support@your-domain` is a naming suggestion, not an existing address.
Do not publish a made-up address. Reports in Review Desk help with extension
concerns but do not replace a reachable contact for privacy or legal requests.

## Decisions you need to make

| Item                | Draft position                                                       | What remains                                                                                           |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Operator identity   | Real individual/entity; country unconfirmed                          | Full legal name and appropriate address disclosures                                                    |
| Public contact      | One monitored inbox is sufficient as an initial operational proposal | Create and test the inbox; identify the responsible contact                                            |
| Public availability | Submission still requires scans, review and signed release           | Approve final terms/privacy notice before opening                                                      |
| Licensing           | Publisher supplies a licence; no automatic MIT conversion            | Confirm this policy and enforce during review                                                          |
| Verification        | Identity/ownership check; never a security guarantee                 | Confirm acceptable proof and operator review process                                                   |
| Reports             | Private reviewer queue; ordinary support goes to publisher           | Define triage ownership and escalation                                                                 |
| Retention           | Explain actual purposes and exceptions                               | Set implementable deletion/log/backup schedules; code currently does not provide all cleanup workflows |
| Requests            | Access/correction/deletion/grievance via monitored contact           | Manual handling procedure, applicable response times and legal exceptions                              |
| Children            | No compliant child-account flow is claimed                           | Decide age policy and have it reviewed before public launch                                            |
| Governing law       | Unselected; worldwide audience                                       | Counsel to check venue, mandatory rights, and applicability                                            |
| Liability           | No arbitrary rupee cap or compulsory arbitration added               | Review the balanced draft before choosing stronger restrictions                                        |
| International data  | Providers/locations must be disclosed accurately                     | Confirm production regions, provider arrangements, and backups                                         |

## What was checked in the application

- GitHub numeric ID and login are stored; the GitHub OAuth token is used for the
  sign-in identity request and is not persisted by the registry account code.
- Website sessions have a seven-day validity, OAuth attempts ten minutes, and CLI
  publishing tokens thirty days. Expiry does not establish database deletion.
- Namespace roles, invitations, agreement version/acceptance, reviewer decisions,
  verification evidence and release history are database records.
- Packages/README/images become public only through approved signed publication;
  quarantine/review evidence is not a public catalog.
- New reports contain the reporter identity, extension/version, category, details,
  timestamps and private reviewer notes. Notes are not automatically forwarded.
- Reviewed Exchange frontend has no advertising or behavioural-analytics SDK.
  Hosting/network providers can still receive request metadata. Do not claim
  “we collect no data” or that every infrastructure log stays in India.
- Documented deployment uses Render, Neon, Cloudflare R2 and GitHub. Confirm the
  live configuration and each provider's retention/transfer arrangements.
- No automatic account-erasure/retention system has been established by this
  policy-writing task. The drafts explicitly avoid inventing one.

## Primary research and how it was used

- [Open VSX Publisher Agreement, v1.1](https://www.eclipse.org/legal/documents/eclipse-openvsx-publisher-agreement.pdf)
  and [registry FAQ](https://www.eclipse.org/legal/open-vsx-registry-faq/): useful
  structural comparisons for an identified operator, publisher responsibilities,
  licence/distribution permission, and distinct publisher-support/reporting paths.
  Tabs' draft is original, tailored to its own review/signing system. It does not
  import Open VSX's automatic MIT fallback or corporate details.
- [Eclipse privacy policy](https://www.eclipse.org/legal/privacy/): comparison for
  explaining who handles data, purposes, providers and contact information.
  Tabs must describe its own actual data and infrastructure rather than reuse it.
- [Chrome Web Store user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq):
  supports a clear account of collection, use, disclosure, requests and retention,
  plus meaningful disclosures for sensitive processing. No claim of Chrome
  policy compliance or affiliation is made.
- [Mozilla add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/):
  reference for clear feature descriptions, necessary permissions and avoiding
  unexpected data collection. Tabs remains responsible for its own policy choices.
- [MeitY's official DPDP Rules 2025 and enforcement-timeline materials](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit):
  India-specific primary starting point. Commencement is phased; this pack does
  not assert all provisions are already operative or that a template achieves
  compliance. Qualified counsel should check which data-protection, intermediary,
  consumer, grievance and cross-border duties apply to this service at launch.

## Approval and publication sequence

1. Proofread the two drafts and change the proposed business policies.
2. Fill operator, contact and effective-date fields; resolve each bracketed item.
3. Obtain legal review for the actual operator and markets served and make sure operational promises can be
   performed, especially requests, retention, children and incident response.
4. Replace the live placeholder with the approved text and publish the privacy
   notice. Increment the agreement version; do not silently carry over consent
   from the development placeholder.
5. Test that existing and new publishers explicitly accept the new version before
   submitting; keep the separate scan/review/signing checks.
6. Open the publishing flag for everyone and verify the public registry response
   plus a non-pilot publisher's flow. Do not upload a real person's package merely
   to test without authorisation.

The drafts remain local review material; they are not inserted into the current
acceptance form or labelled legally final.

## Worldwide availability research — 20 October 2026

- [Open VSX publisher agreement](https://www.eclipse.org/legal/documents/eclipse-openvsx-publisher-agreement.pdf)
  selects Belgian law and Brussels courts. This illustrates that an international
  registry can identify a specific governing law; it is not a reason to copy that
  jurisdiction into Tabs' terms.
- [EDPB territorial-scope guidance](https://www.edpb.europa.eu/documents/guideline/guidelines-32018-on-the-territorial-scope-of-the-gdpr-article-3-version-adopted_en)
  explains that offering services to people in the EU can bring a non-EU operator
  within GDPR scope. Mere website accessibility is not alone enough; targeting
  and the actual processing matter. Charging no fee does not itself avoid scope.
- The final review should assess applicable regional privacy, consumer,
  children, content/reporting, and legally required trade restrictions. This pack
  does not assert compliance in every country or promise unrestricted service
  despite legal or provider constraints.

These are Exchange publisher/privacy drafts, not a complete worldwide legal
pack for every desktop Tabs feature. No live policy or publishing flag was
changed by this revision.

## Consolidated candidate — 20 October 2026

The publisher terms now combine the operator's supplied Claude draft with the
implementation-based draft. Tabs is described as personally run, free at the
Exchange level and intended for worldwide use. There is no exclusive governing-law
or court selection in this candidate; applicable conflict-of-laws rules can
still determine which law/court applies. Omitting a clause does not remove law.

Kept or added: plain language, reviewable code, leaked-secret response, copyright
complaints, ability to discontinue a hobby service, and general notice/severability
wording. Corrected the claim that Tabs can revoke a third-party secret: Tabs can
restrict the package, while the credential holder must rotate the secret.
Did not adopt an unverified 30-day closure commitment, unrestricted takedowns “for
any reason”, a broad publisher defence/indemnity duty, or a blanket no-liability
promise. No automatic acceptance of replacement terms is implied.

The copyright paragraph is a general reporting process, not a statutory DMCA
counter-notice procedure. [US Copyright Office guidance](https://copyright.gov/512/)
explains the specific designation and notice/counter-notice requirements; do not
claim those protections without establishing the required process.

This section supersedes earlier table proposals about choosing a governing-law
clause or describing the operator as an unspecified company. The operator has
confirmed a personal hobby project. Remaining publication details: actual full
name, a working monitored public email, effective date and any required address
or responsible-contact disclosures. Privacy retention, request handling and age
controls still need operational confirmation as described above. A qualified
legal review remains advisable before relying on this internationally.

No live agreement, acceptance record or publishing configuration was changed.

## Confirmed public contact — 20 October 2026

The operator supplied a screenshot of the newly created Gmail account
`tabsappinbox@gmail.com` and authorised its use for Tabs. This replaces earlier
email placeholders. Public operator identity: PanicMako (also known as Rushil).
The screenshot establishes the supplied address; inbound delivery has not been
tested by this task. Both policy candidates now use this address for support,
reports, privacy requests and legal notices. Publication and public submissions
have not been enabled by this contact update.

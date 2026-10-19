# Tabs Exchange Privacy Policy

**REVIEW DRAFT — not a published privacy notice. Prepared 19 October 2026; revised 20 October 2026 for worldwide availability.**

Proposed version: `2026-10-20-review-2`

Effective date: **[SET AFTER APPROVAL]**

Operator: **PanicMako (also known as Rushil)**, an individual running Tabs Exchange as a personal hobby project

Privacy/grievance contact: **tabsappinbox@gmail.com — PanicMako (also known as Rushil)**

Contact/service address: **[CONFIRM APPLICABLE ADDRESS DISCLOSURES]**

This notice concerns the Tabs Exchange website, publisher portal, registry API,
and review/reporting service at https://exchange.buildwithtabs.com. It does not
serve as a complete privacy policy for every feature of the Tabs desktop app or
for independently operated third-party extensions. An extension publisher must
explain its own practices where relevant.

This service is intended for people worldwide. This notice applies to the
Exchange activities described here regardless of a user's country. Applicable
privacy rights and our obligations can differ by location, the operator's
establishment, and how services are offered; free access does not by itself
remove those obligations. **[ASSESS REGIONAL NOTICE, REPRESENTATIVE, REQUEST,
AND INTERNATIONAL-TRANSFER REQUIREMENTS BEFORE GLOBAL PUBLIC LAUNCH.]**

## 1. Information involved in using Exchange

**Browsing and downloads.** Hosting and network providers receive ordinary web
request information such as an IP address, request path, browser/client details,
time, and response information. Search and package requests reach the registry.
The extent and retention of provider logs must be confirmed before this draft
is published. The reviewed Exchange frontend does not include advertising
trackers or a third-party behavioural-analytics SDK.

**Signing in.** GitHub handles authentication. The Exchange stores your GitHub
numeric account ID and login name. It uses the GitHub authorisation exchange to
read that identity; the current registry code does not store the GitHub OAuth
access token as a persistent account credential. We do not receive your GitHub
password. GitHub has its own privacy practices.

**Security and account records.** We store sign-in session and anti-forgery token
hashes, session expiry information, publisher-token metadata/hashes, namespace
membership, invitations, roles, and agreement-version acceptance records. We
also record reviewer-access and publisher-verification decisions and their
supporting reasons/proof links.

**Submitting an extension.** We receive your package, manifest, version,
description, README, images, licence/disclosure information, support/source/privacy
links, scan evidence, and submission/review/appeal history. Package contents may
include personal data if you put it there; avoid uploading unnecessary personal
information or secrets.

**Reports and communications.** A private report includes your signed-in GitHub
identity, the extension/version, reason, details, timestamps, and status. Authorised
reviewers can add private investigation/decision notes. Information you send in a
support, privacy, or legal request is also processed to handle that request.

## 2. Why the information is used

We use information to authenticate users; create and manage publisher identities;
record agreement acceptance; operate submission, scanning, review and signed
publication; deliver packages and compatibility information; investigate security,
identity and policy concerns; administer access; maintain service integrity and
backups; answer requests; and meet applicable legal obligations.

We do not use submitted private packages or private reports for unrelated
advertising or AI-model training. Copying the developer page's agent instructions
does not send your idea to a coding-agent provider through the Exchange. If you
paste those instructions, code, or reports into another service, that disclosure
is your separate action under that service's terms.

The legal basis or other legal justification for particular processing depends
on the law that applies. Account/service delivery, security, a legal obligation,
or a specifically obtained consent may be relevant; this draft does not claim
that one blanket consent permits every use. Where a consent is legally required,
provide a meaningful choice and a way to withdraw it. Operator/legal review must
map these grounds to the final implementation and applicable commencement dates.

## 3. What becomes public and what stays restricted

Approved, signed releases and their listing materials, package identity,
versions, digests and relevant verification information are public on a public
registry. Downloaders can retain copies, and public content can be copied or
indexed by others. Removing a listing cannot reliably recall those copies.

Quarantined submissions, account sessions/tokens, private reports, reviewer notes,
and internal decision evidence are not public catalog information. The service
restricts them to the relevant authorised account/team members, reviewers,
operators, and necessary infrastructure providers. Review history visible to a
publisher can differ from confidential internal evidence.

We may disclose the minimum information reasonably needed to investigate a
concern or explain a decision to an affected publisher. Reports are not
automatically forwarded to publishers. Do not promise absolute reporter anonymity:
authorised staff and legally required recipients may need identifying information.

## 4. Service providers and other disclosures

The currently documented hosting arrangement uses Render for the registry
service, Neon for PostgreSQL data, Cloudflare R2 for object storage, and GitHub
for sign-in and source/release integration. These providers process the data
necessary to perform their services and may process technical/security data
under their own terms. Confirm actual production configuration, contracts,
subprocessors, and locations before publication; a provider name is not a
promise that data remains in one country.

We may also disclose information where required by a valid legal process, to
protect people or service security, or to establish or defend legal rights.
Where permitted, requests should be assessed for validity and disclosures limited
to what is necessary. A business transfer affecting personal data would require
appropriate safeguards and notice where the law requires it.

The Exchange does not sell personal information or run an advertising data
brokerage in the reviewed implementation. We do not claim that every external
publisher or infrastructure provider has identical practices.

## 5. Cookies and local storage

The website uses an OAuth-state cookie during sign-in, an HttpOnly session cookie,
and a readable anti-forgery cookie for authenticated requests. Current configured
validity is approximately ten minutes for an OAuth attempt and seven days for a
website session. Signing out clears the session cookies and invalidates that
session. Cookies may also be used by infrastructure for security or delivery;
confirm those providers' actual behaviour.

CLI publishing tokens currently expire after thirty days and can be revoked;
that expiry is not a promise that their metadata or associated audit history is
immediately deleted. The Exchange stores token hashes rather than the reusable
secret value in its database.

The portal may store non-secret interface preferences in your browser. You can
clear browser storage or block cookies, but sign-in and publisher actions may
then stop working. Do not add non-essential trackers under this notice without
updating disclosures and obtaining any required consent.

## 6. Retention and deletion

Different records serve different purposes. Account and membership records are
needed while the account/publisher relationship remains active. Public release
artifacts, security evidence, agreement acceptance and decision history may need
to remain for integrity, investigation, disputes, licence duties, or legal
requirements after an account stops publishing. Reports should be retained only
as long as needed for their investigation and justified follow-up.

Expiry of a login or token disables access; it does not necessarily erase the
database row. Backups and provider logs have their own lifecycle. This draft does
not invent automatic deletion periods: **[CONFIRM AND IMPLEMENT A RETENTION
SCHEDULE FOR ACCOUNTS, QUARANTINE, REPORTS, LOGS, AND BACKUPS BEFORE PUBLIC LAUNCH.]**

You can request account closure or deletion through the privacy contact. We may
verify identity and explain any information that must be retained. Requests
should be assessed record by record; do not promise immediate deletion of signed
history, every backup, or copies already distributed to others.

## 7. Your choices and requests

Use the privacy contact above to ask what personal information we hold, request
correction or deletion, raise a grievance, or withdraw a consent where applicable.
Depending on the law in force and your location, you may have additional rights
such as access to information, a copy, objection/restriction, nomination, or a
complaint to a competent authority. We will assess the applicable rights and any
exceptions rather than require you to waive them.

Please identify the account and request without sending passwords, authentication
tokens, or unnecessary identity documents. We may request proportionate evidence
to prevent someone else changing or deleting your data. **[CONFIRM RESPONSIBLE
CONTACT, REQUEST PROCEDURE, AND APPLICABLE RESPONSE/ESCALATION DEADLINES.]**

## 8. Security and international processing

The service uses HTTPS, hashed session/publishing credentials, access controls,
CSRF protection, bounded package handling, and restricted reviewer interfaces.
These measures reduce risk; they cannot guarantee perfect security. If a breach
occurs, we will investigate and make notifications required by the laws that
apply. We do not promise a regulatory deadline without confirming the relevant
law and incident circumstances.

Infrastructure or authorised personnel may process data in countries other than
your own or the operator's country. Where
applicable law requires restrictions, contracts, or transfer safeguards, those
must be established and reflected in the final notice. **[VERIFY ACTUAL STORAGE,
BACKUP, SUPPORT-ACCESS REGIONS, AND TRANSFER ARRANGEMENTS.]**

## 9. Children and changes

The publisher service is intended for people with capacity to enter the publisher
agreement. This draft does not establish a compliant under-18 account flow or
claim that age verification exists. **[DECIDE WHETHER ALL SIGNED-IN EXCHANGE USE
WILL BE 18+ AND IMPLEMENT THE APPROPRIATE NOTICE/CONTROLS; OBTAIN REVIEW OF THE AGE AND PARENTAL-CONSENT RULES
APPLICABLE IN THE MARKETS SERVED BEFORE SERVING CHILDREN.]**

We will show a dated notice when this policy changes and provide additional
notice or choices where required. A materially new processing purpose should
not be hidden in an unrelated extension update. Contact **tabsappinbox@gmail.com**
with questions about this notice.

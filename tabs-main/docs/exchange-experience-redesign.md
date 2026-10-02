# Exchange experience redesign

User direction, 2026-10-02: deepen the marketplace experience using Open VSX's
workflow organization, match Tabs marketing aesthetics, replace the current
extension mark with the supplied rounded puzzle silhouette with inset corner,
and add an optional footer game. This supplements, not replaces, staging
security and integrated acceptance requirements.

## Design decisions

Documentation refinement: rounded blue-tinted section search, breadcrumb
current-page labeling, selected guide pills, and styled keyboard-accessible
copy controls. Search index parsing validates section fields and local links;
invalid JSON or shape returns recovery guidance without parser diagnostics.
Browser search for `profile` produced 12 anchored section results; clearing it
restored the guide. The 390px page had no horizontal overflow and a single-column
layout. The generated reference remains intact. This verifies navigation and
search, not execution of every documented SDK example or a VoiceOver audit.

Publishing refinement: separate labeled identity and package sections, retain
one disabled-until-eligible fieldset, and show scan/review/signed-publication
guidance alongside the form. A real local fixture reviewer without namespace
membership remained unable to upload. Browser inspection confirmed one form,
disabled prerequisites, and a 390px single-column layout without horizontal
overflow. No new package was submitted in this visual check. Developer cards
use Concept One's blue/peach/mint family and link to actual built guides.

Latest refinement (2026-10-02): the user's Concept One request supersedes the
earlier uniform 12px corner choice. Shared Exchange controls now use a 999px
pill token; content surfaces use one 28px token so multiline content remains
readable. The header has no bottom rule or active-link underline. All Exchange
pages receive the blue closing section and pale-blue oversized wordmark,
adapted from Concept One's actual footer. Exchange reuses the marketing custom
cursor, including its text-entry, touch, keyboard, and reduced-motion fallback.
The game remains unmounted and no gradients were added. Account desktop and
390px layouts were visually inspected; the mobile document had no horizontal
overflow. This is a shared-shell pass, not proof of every authenticated screen's
visual or accessibility acceptance.

- Keep Tabs-native packages and the existing same-origin account/review services.
  Do not import Open VSX code or claim VS Code package compatibility.
- Use marketing typography, spacing, palette, border treatment, restrained
  motion, and oversized footer signature. Product screens must remain readable
  and task-focused rather than becoming promotional hero sections.
- Recreate the supplied mark as a small code-native SVG using currentColor,
  preserving the rounded silhouette and inset corner. Use it consistently for
  Exchange branding and generic extension fallbacks, not in place of publisher
  package icons. Verify both light/dark contrast and small-size legibility.
- Provide prominent search, Extensions, Developers, Docs, Publish, and account
  access. Add an accessible Resources disclosure with documentation,
  contribution guidance, security reporting, and instance support.
- Resource destinations must be real and instance-configurable. Do not invent
  a sponsor program, working group, status service or vulnerability address.
  A security-reporting guide must explain private reporting and avoid soliciting
  vulnerability details in public issues.
- Homepage: search first, editorial collections only when actually curated,
  newest signed releases, and clear developer onboarding. Never fabricate
  popularity, downloads, ratings, publisher verification, or sample inventory.
- Detail pages: strong identity header, version and compatibility, README,
  reviewed screenshots, permissions, release history, and install guidance.
- Publisher account: focused profile, namespaces, releases/submissions and
  tokens; guided publishing prerequisites and lifecycle rather than a large
  collection of unrelated forms. Reviewer controls remain separate.
- Documentation: audience landing pages, navigable topic hierarchy, section
  search, practical tutorials, SDK reference, publishing/management, operator
  and client integration guides, troubleshooting and contribution instructions.
  Only document commands/APIs backed by executable verification.

## Footer game

### Deferred by user, 2026-10-02

The user explicitly set all game work aside for their later redesign. Neither
website footer currently renders the runner or tile puzzle. Preserve their source
as unaccepted staging work; do not continue game implementation or acceptance
until requested. This does not pause the overall marketplace goal.

Current design constraints: one 12px corner-radius token for all Exchange controls
and surfaces; no gradients; oversized blue Exchange footer signature matching
the marketing site's visual scale and baseline treatment. Keep instance-custom
names supported without forcing official branding.

### Revised direction, 2026-10-02

After viewing the live buildwithtabs.com homepage, match its current Headspace /
Edition Two design: #fbfcfe background, #3259ed blue, #202b44 ink, #636c7b muted,
centered oversized sans headline and blue italic Instrument Serif accent.
Do not add the marketing site's introductory loading screen to task-oriented
Exchange pages. Local font distribution and licensing need verification before
declaring typography parity; Georgia remains the explicit serif fallback.

The user now prefers a Chrome-Dino-like runner over the implemented tile puzzle.
Replace the Exchange puzzle with 'Lose the window shuffle': a small Tabs workspace
travels forward, jumps over scattered-window/context-switching obstacles, and
collects Code / Agents / Git / Browser tool pickups. It is a playful metaphor,
not a claim about measured productivity. Keep an opt-in start, keyboard and touch
jump, pause/restart, visibility auto-pause, bounded animation timing, and no
tracking/network/audio. Reduced-motion mode must offer an untimed step-based
version, not merely slower unavoidable animation. Share the component with the
marketing footer rather than duplicating rules or importing one app's private UI
into the other. The existing tile puzzle is a staging predecessor, not this
revised game's accepted implementation.

Use an opt-in short 'Connect the tools' puzzle below the oversized signature:
a small grid of tool tiles that can be rearranged to connect an input to an
output. No autoplay, audio, remote calls, account requirement, tracking,
leaderboard or dependency on the publishing workflow. Load game code only on
interaction. Support keyboard selection/movement, visible focus, reset, a
plain-text instruction/status region, reduced motion, and touch controls.
Keep it on the marketplace/marketing footer, not account, reviewer or docs
pages where it would distract from the user's task. Treat the marketing footer
addition as separately scoped styling work while preserving existing links.

## Delivery and acceptance

1. Inspect Open VSX navigation/profile/publish/documentation source and existing
   Tabs marketing tokens; record concrete workflow gaps before redesigning.
2. Shared mark, visual tokens, responsive navigation/resources and footer.
3. Marketplace home/catalog/detail and focused account/publishing polish.
4. Documentation depth and resource/contribution/security reporting guides.
5. Optional game, then browser desktop/mobile/keyboard and contrast verification.
6. Re-run publishing/review/private-registry security regressions and complete
   the existing signed-install/update/rollback acceptance. A polished mock or
   screenshot is not a completed marketplace.

All work stays on codex/tabs-extensions-testing. No merge, deployment or npm
publication. Retain existing dirty work and security boundaries.

# Account token layout checkpoint

The focused token screen now groups labeled fields in a pastel rounded panel,
with pill-shaped actions and separate CLI guidance. Existing token selectors,
secret hiding, expiry, membership checks, and revocation logic are unchanged.
The local registry fixture rendered the authenticated page; keyboard Tab moved
from the label field to the access selector. A 390px viewport initially exposed
an overflowing CLI code block. Shared code blocks now scroll inside their
container; a fresh browser check measured both viewport and document at 390px.
The one-time secret remained hidden. No token was created during this check.
Four design regression tests and the web build pass. Workspace typecheck passed
16/16 tasks; hygiene reports zero errors and existing warnings. This is not a
VoiceOver audit or a full-workspace test pass.

## Concept One shared-control refinement

Read the actual Concept One component and its footer overrides: its signature
uses inherited sans-serif lettering and deliberately hides the generic orbital
decoration. Keep that treatment, the solid blue footer, and the deferred game.
Native reviewer actions and file-picker buttons now share the pill control
token. Namespace panels have scoped vertical spacing, reviewer sections have
rounded surfaces, and the account navigation exposes its current-page state.
Keyboard focus indicators and disabled controls remain intact.

The desktop static-preview check confirmed a 999px action radius, no header
bottom border, the #3259ed footer, current-account semantics, and no horizontal
overflow. This check covered signed-out rendering, not authenticated account
content or VoiceOver. Six design tests passed; the full workspace suite passed
18/18 tasks, typecheck passed 16/16, and vp check passed with zero errors and
426 existing warnings. The initial terminal-output check encountered a Vite+
stdout panic; the redirected retry exited successfully.

Astro generated the page assets, but the combined web build failed while
preserving an immutable developer-release archive collision. Existing release
files were retained; this remains a build-readiness issue, not a passed build.

## Developer-release collision repair

The preceding build failure was investigated rather than bypassed. The two
conflicting gzip objects expanded to identical tar bytes, but their compressed
bytes differed. Release identity now includes the build runtime's version map
alongside the existing source recipe and package digests, so Node and Bun
compression outputs do not reuse an immutable release URL. Collision checks
remain strict; no previously archived object was overwritten.

The generated conflicting release directory was moved intact to
`.test-data/developer-releases-collision-20261003` for recovery. The original
immutable archive remains in `apps/exchange/developer-releases`.
Two successive Bun Exchange builds exited successfully with the same release
identity and digest. Running the release builder with Node also succeeded and
produced a different release identity. Two identity regression tests passed.
The full workspace test run passed 18/18 tasks; vp check passed with zero errors
and 426 existing warnings. This supersedes the archive-collision build blocker,
not the remaining staging acceptance and external launch gates.

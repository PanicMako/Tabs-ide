# Tabs concept gallery and release delivery

Five complete landing pages live at `/#concept-1` through `/#concept-5`. The fixed number rail switches pages; browser back/forward and deep links work. `/download` offers the four published desktop targets. The site is static Astro, with no React runtime or animation dependencies.

## Run and verify

From `tabs-main`:

```sh
bun install --filter @tabs/marketing
cd apps/marketing
bun run dev
bun run sync:releases
bun run test
bun run typecheck
bun run build
bun run preview --port 4174
```

`sync:releases` contacts GitHub, validates the latest stable release, checks all four installer names, fetches the Windows and Linux YAML manifests, and verifies their version and referenced installer names. It writes a sanitized snapshot used for server-rendered HTML. Network failures or incomplete releases fail the sync rather than deploying a misleading snapshot. The committed starting snapshot is v1.3.1, published September 5, 2026.

## What happens when v1.3.2 (or any later stable version) ships?

1. The existing Release Desktop workflow builds and publishes the binaries and updater metadata to `PanicMako/Tabs-ide`.
2. `.github/workflows/deploy-marketing.yml` runs on website pushes to main, manual dispatch, release publication, and successful Release Desktop completion. The completion trigger is necessary because GitHub does not trigger a `release` workflow for releases created by `GITHUB_TOKEN`. It checks out the trusted default branch, never downloaded workflow artifacts or a pull request head.
3. The workflow reads GitHub's `/releases/latest` endpoint, validates its assets and manifests, rebuilds the static release history, and deploys to Vercel.
4. Visitors also fetch `/releases/latest` on page load. The version, current release row, and download links update from the response. Clicking a platform download checks again, so an open browser tab can obtain a newer release. No version is interpolated into an invented asset name: URLs come from `browser_download_url`.
5. On API error, timeout, or malformed data, download buttons open GitHub's `/releases/latest` page. A status message distinguishes the saved history from a live lookup. Without JavaScript, the published build snapshot remains usable.

Only stable releases are accepted. Mobile, unknown, and ARM user agents do not get guessed x64 binaries. Browsers commonly report an Intel-like user agent on Apple Silicon; macOS therefore uses the explicit Apple Silicon/Intel chooser. Explicit architecture links are always available. A missing platform asset falls back to the release page. No public browser token is used. Browser GitHub API rate limits remain a reason a visitor can be sent to GitHub instead of directly to a binary.

## Windows and Linux in-app updates

This functionality already exists in the desktop app and was retained, not replaced:

- `apps/desktop/src/main.ts`: `configureAutoUpdater`, checks 15 seconds after startup and every four hours, plus a menu action; `autoDownload=false`, `autoInstallOnAppQuit=false`, stable channel, no downgrades.
- `updateMachine.ts` and `updateState.ts`: availability, progress, retry and installation state.
- `scripts/build-desktop-artifact.ts`: electron-builder writes the GitHub provider configuration into `app-update.yml`, using `TABS_DESKTOP_UPDATE_REPOSITORY` or CI's `GITHUB_REPOSITORY`.
- Root `.github/workflows/release.yml`: publishes the Windows NSIS installer, `.exe.blockmap`, `latest.yml`, Linux AppImage, and `latest-linux.yml`.

Packaged Windows NSIS installations and Linux apps running from the AppImage check for a newer version and expose download and restart/install actions. Merely publishing a release does not silently interrupt or replace a running app. Linux extracted/unpackaged builds are not eligible; the AppImage location must be writable. Windows does not require Apple signing; Windows code signing is recommended for identity, signature checks and SmartScreen reputation. Linux AppImage updates use manifest integrity hashes, not Apple notarization.

The v1.3.1 metadata and referenced installer names were verified live. Desktop unit tests pass. Installing a subsequent release on real Windows and Linux machines has not been exercised in this task. For a release acceptance test, install the older packaged version on each OS, publish a newer stable release with correct manifests, check availability, download, restart/install, and verify the running version and user data. Include a failed-network retry and an unwritable AppImage path.

## macOS: notarization, not monetization

The normal supported direct-distribution update path needs a Developer ID-signed app and signed update, with notarization for Gatekeeper-friendly distribution. A free Apple developer account does not provide Developer ID distribution certificates. Apple Developer Program membership is normally USD 99 per year (or local currency); eligible nonprofit organizations, accredited educational institutions and government entities can request a waiver. A free app is not automatically eligible for a waiver.

You can build and distribute a manually downloaded Mac app without paid membership, but an ad-hoc signature is not Developer ID signing and cannot provide Apple's supported Developer ID update identity. Tabs does not bypass Gatekeeper. Its preview channel can update an ad-hoc build only after independently authenticating the release with the embedded Tabs Ed25519 public key.

Unsigned macOS preview releases publish both architecture ZIPs plus an Ed25519-signed Tabs update manifest. The desktop verifies the manifest and ZIP digest before an atomic in-place update. This provides update authenticity but does not replace Developer ID signing, notarization, or stable Apple code identity; first installation still requires explicit Gatekeeper approval. Production migration should configure Developer ID signing and notarization, validate both architectures, and test a signed-to-signed update before describing the macOS release as fully supported.

Sources: [Apple Developer ID](https://developer.apple.com/developer-id/), [Apple membership comparison](https://developer.apple.com/support/compare-memberships/), [fee waivers](https://developer.apple.com/help/account/membership/fee-waivers), [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [electron-builder v26 auto-update](https://www.electron.build/v26/docs/features/auto-update/).

## Vercel setup

Create/select a Vercel project for this website. The workflow builds locally and packages `dist` using Vercel's Build Output API, so the Vercel project does not need to build the Electron monorepo. Disable a duplicate Vercel Git auto-deployment integration if you use this workflow as the sole deployment owner.

Add exactly these repository Actions secrets (Settings → Secrets and variables → Actions):

| Secret              | Where to get the value                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`      | Vercel account settings → Tokens; create a token authorized for the target project/team                                               |
| `VERCEL_ORG_ID`     | Target Vercel team/account settings → General → Team ID; alternatively the `orgId` in `.vercel/project.json` created by `vercel link` |
| `VERCEL_PROJECT_ID` | Vercel project settings → General → Project ID; alternatively `projectId` in `.vercel/project.json`                                   |

The normal built-in `GITHUB_TOKEN` is provided by Actions; no separate GitHub secret needs to be added for the public release lookup. No credentials are embedded in the client, build snapshot, or repository. After the workflow is on the default branch and the three secrets are configured, run “Deploy Tabs website” once to publish. Thereafter pushes and completed releases deploy automatically. No remote deployment was attempted as part of this local implementation.

Vercel Hobby is for personal, non-commercial use. A landing page promoting a paid product, business, or commercially intended Tabs distribution belongs on a suitable commercial plan (typically Pro). The repository alone does not establish whether Tabs is a personal project or commercial business; the owner must choose accordingly.

Sources: [Vercel GitHub Actions](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [GitHub Releases API](https://docs.github.com/en/rest/releases/releases).

## Design research and verified product claims

The visual pass followed the user's correction to study live Awwwards work, instead of the initial proposed directions. References inspected on September 5, 2026:

- [Awwwards winning websites](https://www.awwwards.com/websites/): large editorial composition, dimensional scenes and interaction-led product storytelling.
- [Illoca by Unseen Studio](https://www.awwwards.com/sites/illoca), [live site](https://illoca.unseen.co/): an expanding scene, scroll-driven reveals and hands-on feature presentation. Borrowed the principle of a product story expressed spatially, not its artwork or branding.
- [Sharplink by Studio Freight](https://www.awwwards.com/sites/sharplink), [live site](https://www.sharplink.com/): oversized type and spatial page transitions.
- [Linear](https://linear.app/) and [Cursor](https://cursor.com/): current developer-product positioning and product-grounded narratives.

All scenes are original procedural canvas/CSS artwork. Concept 1 has a pointer-responsive portal, 2 tactile selectable provider cards, 3 continuous ribbons and sticky narrative, 4 a rotating point-cloud sculpture and kinetic typography, and 5 organic forms and floating windows. No captured third-party artwork is shipped. The product tour uses captures from the Tabs development app and lets visitors switch among Code, Agents, Server, Git, Browser, and Testing, as well as light and dark presentation. Its Diagnostics chapter covers the implemented resource, process, I/O, trace, support-bundle, and AI Diagnose surfaces. Motion respects system reduced-motion settings and the rail's pause button; offscreen canvases stop rendering and visible scenes are capped at 30fps and 1.5 device pixel ratio. Native scrolling is preserved. Google Fonts uses display=swap, with system fallbacks.

Product evidence: `apps/server/src/provider/builtInDrivers.ts` registers Codex, Claude, Cursor, Copilot, Grok, OpenCode, Kilo, Antigravity, Droid, OpenRouter and Gemini; the actual drivers use a mix of ACP and native APIs/SDKs. The site deliberately does not claim they all speak ACP, that providers are free, that every provider exposes identical features, that existing conversation history can seamlessly move across every provider, or that all 11 integrations were end-to-end tested in v1.3.1. Current source registration supports the integration list; individual provider credentials/setup and service availability still apply. Code OSS, Terminal, Git, Browser and Agent are grounded in the workspace implementation. No invented adoption statistics, customer logos, benchmark wins, release feature notes, or roadmap promises are used.

## September 6 design revision

All five concepts now end with an original, full-width **Tabs IDE** typographic signature. The reference supplied by the user informed the scale only. The treatments use dimensional shadows, tilted orbital type, an italic serif, an outlined industrial face, and a soft serif landscape. Footer navigation links to Downloads, the separate `/changelog` page, and GitHub. Motion supports reduced-motion preferences and the global pause control.

UI icons are rendered from `lucide-react` at build time, with no React client runtime. Provider logos are the same SVG components used by `apps/web/src/components/Icons.tsx`; refresh the committed assets with `bun scripts/sync-brand-assets.ts`.

`public/product/tabs-git.png` and `tabs-agents.png` were captured directly from the current Tabs development server on September 6, 2026. They show the real Git overview and provider picker. The old T3 screenshot is not referenced by the landing pages. These are development captures, not a claim that every feature shown shipped in v1.3.1.

Capture setup used an isolated `/tmp/tabs-marketing-capture` profile. A clean database launch encounters an existing duplicate-column error in catch-up migration 44. For this disposable profile only, migrations 1–43 were applied successfully and the redundant catch-up marked complete. No application migration code or user database was changed. This clean-install migration issue remains separate from the landing page work.

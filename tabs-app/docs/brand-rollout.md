# Tabs logo rollout audit

Audited 25 October 2026. This records local source changes, not a published release or deployment.

The four vector treatments and variant registry live in `packages/shared/src/tabsBrand.ts`. The fifth treatment uses the supplied raster in `assets/prod/tabs-blue-ink-master.png`. Desktop sizing is documented in [app-icon-sizing.md](app-icon-sizing.md). Regenerate derived assets from the `tabs-app` directory with:

```sh
bun scripts/generate-tabs-brand.ts
```

## Updated in local source

| Surface                                                                     | Source or generated asset                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| macOS application, Finder, Dock and installer app icon                      | `apps/desktop/resources/icon.icns`, `icon.png`, `icon.iconset/`                                            |
| Windows app and installer                                                   | `apps/desktop/resources/icon.ico`                                                                          |
| Linux app and launcher                                                      | `apps/desktop/resources/icon.png`                                                                          |
| Runtime System/Dark/Light/Custom choices                                    | `apps/desktop/resources/brand/`, desktop preference handling                                               |
| App brand mark, onboarding and theme gallery                                | `apps/web/src/components/TabsBrandMark.tsx`, `public/onboarding/`, Themes settings                         |
| Web app browser icons and touch icon                                        | `apps/web/public/` and `public/brand/`                                                                     |
| Marketing header/footer, downloads, community and changelog logo components | `apps/marketing/src/components/TabsLogo.astro`                                                             |
| Marketing intro                                                             | `apps/marketing/src/components/PageLoader.astro`                                                           |
| Marketing browser and touch icons                                           | `apps/marketing/public/`                                                                                   |
| Website Open Graph and Twitter share preview                                | `apps/marketing/public/brand/social-card.png`, `SeoHead.astro`                                             |
| Exchange header and browser/touch icons                                     | `apps/exchange/frontend/src/layouts/Exchange.astro`, `public/`                                             |
| GitHub root README logo                                                     | Already references `tabs-app/apps/desktop/resources/icon.png`; the asset at that path is replaced locally  |
| Packaging regeneration                                                      | `scripts/build-desktop-artifact.ts`, `scripts/lib/icon-assets.ts` use the new canonical production artwork |

## Requires publishing, restarting, or a separate account setting

- Commit and push the branding changes for the GitHub README image to change on the remote default branch.
- Build and install a new desktop release. The installed `/Applications/Tabs.app` version 2.0.4 still contains its previous icon. Source changes do not rewrite installed releases or old release downloads.
- Restart the local desktop development launcher. Its cached `.electron-runtime/Tabs (Dev).app` still contains the previous icon; the launcher checks icon modification time and refreshes that bundle on the next launch.
- Deploy the marketing site and Exchange for public pages and browser icons to update. Existing browsers may retain cached favicons.
- In GitHub repository Settings > General > Social preview, upload `assets/prod/tabs-social-card.png`. This account setting does not follow the README or website metadata automatically.
- If the GitHub owner/profile avatar is intended to represent Tabs, update that avatar separately with `apps/desktop/resources/icon.png`. A repository does not have an independent profile avatar.
- Update any externally managed listings, social avatars, pinned posts, press kits and announcement images. Those accounts and inventories have not been audited here; access to the repository does not imply access to them.
- Replace current marketing/README screenshots and videos when recaptured from the rebuilt app. Replacing logo files does not change pixels baked into existing media. Historical release screenshots should remain faithful to their release.

## Audit limits

The audit covered product source references, generated logo assets, README paths, package generation, and the installed and cached development macOS bundles. It compared tracked product images against the prior canonical icon files. It did not certify every screenshot pixel, public listing, profile or third-party cache. Provider logos, third-party extension icons, and vendored upstream branding are separate identities.

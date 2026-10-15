# Settings contract review — partial

Partial2521-line source review; full1473-added464-removed diff and1121-line tests remain pending. Selected client defaults, server settings, provider map/patches, Bitbucket and usage-source structures read. Existing824-test contract results reused.

## Confirmed forward-compatibility gap

settings.ts1795 says entries this build cannot decode round-trip untouched. Actual UsageLimitSourceConfig1327 has literal kind cliproxy, and1796 records that strict schema directly. Actual Bun decode diagnostic from packages/contracts exited0: cliproxy accepted/stored; future-hub rejected. No real credential used. First attempt from app root lacked effect resolution; corrected package-root run supplied evidence.

Selected serverSettings718–816 shows settings decode failure uses defaults and marks the file untrusted; it deliberately preserves the original file and skips automatic rewriting/folding. This contradicts unknown-source round-trip behavior and makes other valid settings unavailable during that load. It does not prove an existing supported cliproxy configuration fails today. No future real provider or installed older build was tested.

## Credential trace

Selected serverSettings145–210 redacts sensitive instance environment values, quota management keys and Bitbucket tokens for clients. Selected680–718 moves inline Bitbucket tokens to secret store, retaining inline values on store failure;1028–1068 treats redaction marker as preserve and empty as removal. Selected test267–303 asserts disk excludes sample tokens, client redaction and clearing. These assertions were read, not freshly run; complete transaction/rollback and native secret store integration remain open. Broader provider config API-key fields are outside this selected redaction proof.

No production changes. Prior public provider-enabled helper mismatch remains separately recorded in export-dispatch-contract-validation.md.

## Batch264 client defaults and provider settings

Complete181–866 read: client font bounds/defaults, snapshot shortcut schemas/helpers, notification/quit modes, preview defaults, appearance, favorites, model preferences, composer/sidebar flags, local client defaults, token-rate bounds, provider form annotations, Codex/Claude/Cursor/Grok settings. Legacy quit booleans decode to canonical mode and encode as strings; selected tests475–510 assert both directions. Retired sidebar beta keys are deliberately dropped/reset to new default; selected610–629 assertions match that intent. These are explicit preference migrations, not evidence that UI behavior was visually verified.

Selected web state/settings135–155 shows ClientSettingsSchema is used to hydrate persisted local storage, so the transforms reach current client state. Full loader/component behavior remains open. Cursor whole settings retain old binaryPath/apiEndpoint, while patch transform removes these two properties; test references901–927 explicitly cover retention vs dropped patch fields. This distinction is intentional in source, but legacy editing UI compatibility remains to be traced. Existing824 contract test result reused; no fresh test run or production edits.

## Batch265 providers/background/cleanup

Complete867–1317/1351–1580 read;1318–1350 already covered. Provider forms include Antigravity OAuth/API/Vertex modes, Pi, ACP registry/local distribution, OpenCode, Copilot, Kilo, Droid, OpenRouter and Gemini. Codex/Claude enabled defaults differ from most opt-in providers. UI annotations describe password/plaintext/secure storage but do not implement storage; previously traced environment/Bitbucket redaction cannot establish these provider-specific claims. Native provider credential behavior remains unverified.

Background overrides use duration schemas without local range checks; actual background policy validation from earlier evidence must be distinguished from these declarations. Storage retention bounds1–3650 days; null represents disabled retention. Project override keys are type-coupled to their schema. WorktreeCleanup schema permits null, while the explicit nullable override helper list excludes it; searches of active web/server-settings/shared-project-settings sources found no helper caller, so no active UI failure is established. Git AI caller/history counts are plain numbers; server GitManager forwards them to RepoContextService. Bounds/execution of that service remain open.

No new confirmed runtime defect from this source pass. Broad824 contract evidence reused; no production edits.

## Batch266 current-source completion

Remaining1661–1744/1871–1947/2013–2521 read; previous batches cover all other current ranges. Complete current2521-line source read; Labs-only settings encountered as adjacent schema declarations remain outside behavioral audit. Full old/current semantic comparison and tests still pending.

Patches distinguish whole provider-instance map replacement, per-entry quota-source/rate/alias updates and per-project override entry replacement. Client patches use canonical quit modes. Project workspace schemas/defaults and browser partition resolver read; actual Chromium partition isolation/native persistence not verified here. Arbitrary project/process/embed IDs are nonempty strings, not safe path encodings; consumer requirements must be checked before alleging collisions.

Text export inventory identifies five formerly public names now private: four default constants and makeProviderSettingsSchema. Search apps/packages current TypeScript callers excluding settings.ts found none. External consumers remain unknown.57 new export names. Extracted464 removed lines saved to settings-removed-source.txt for direct next-pass review; inventory is not reading credit. Existing824 passing contract result reused; no production edits.

## Batch267 removed settings and upgrade regression

All464 removed source lines directly read in three bounded ranges. Added declarations already covered in current source; semantic removal pass complete. Full test source review remains pending.

Confirmed P2 client settings migration regression: old code-font range max24 with unbounded Schema.Int decoding becomes10–18-bounded schema; old prompt10–24/interface10–22 likewise narrow. Actual Bun diagnostic exits0: fontSizeCode13 with notificationMode sound decodes; size24 rejects whole object. Selected hooks/useLocalStorage30–45 decodes whole stored object without per-field fallback; state/settings135–159 catches failure and assigns DEFAULT_CLIENT_SETTINGS, resetting unrelated preferences in memory. Persisted file overwrite was not demonstrated. A24px preference was formerly supported, so narrowing without clamping/migration affects valid existing data. Native UI reproduction remains unrun.

Removed WriteOnlyProviderSecretString previously encoded provider credentials empty. Current actual ServerSettings decode/encode with a synthetic Droid API key retains it (boolean output only, exit0). This confirms changed encoder behavior; actual client/disk exposure still requires complete producer/storage path review. Provider-specific secure-storage descriptions must not be accepted from annotations.

Attribution correction: old removed usage-source structure also uses literal cliproxy. The unknown-kind rejection predates this diff; the new untouched-round-trip comment contradicts existing strict behavior. Classify as an unfulfilled compatibility promise, not a newly introduced decoder regression.

No production edits, real credentials or new redundant broad tests.

## Batch268 full settings test review

Complete1121 current test lines and all283 removed original-base lines read.885 added lines covered in current source. Suite verifies response/runtime defaults, retention bounds, custom model old/new forms, Claude compaction bounds, notification/diff/composer/snapshot/quit/sidebar preferences, provider map/enable flags, worktree inheritance/future fallback, Cursor legacy preservation, style normalization and environment icons. Existing824 contract test pass reused.

Removed tests include typography/defaults, write-only provider-secret encoding, browser partition defaults/isolation, persisted Testing tool decoding, onboarding/resume-page defaults and some animation/analytics assertions. Some replaced defaults/tests are intentional; deletion alone does not prove a runtime failure. No remaining test loads an old-valid24px font alongside unrelated preferences, so passing tests miss the independent batch267 regression. Removing write-only-secret assertion aligns with the encoder's changed retention; native confidentiality still needs producer/storage review.

The enabled-helper assertions import directly from settings.ts, retaining the previously demonstrated public-index helper mismatch. They cannot prove callers importing the public root observe the same fork-driver default.

Settings source and test changed content now reviewed; application/packaged/native secrets/UI remain unverified. No production changes.

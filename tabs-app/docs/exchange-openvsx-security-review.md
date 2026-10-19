# Extension review: Open VSX comparison

Reviewed 2026-10-19 against the local `openvsx-main` reference and Tabs Exchange source. This is a source review, not a certification of a deployed scanner configuration.

## What Open VSX actually does

The [official scanning guide](https://github.com/eclipse-openvsx/openvsx/wiki/Extension-Scanning) describes operator-configured secret detection, file-hash blocklists and namespace similarity checks during publication. Checks can be monitoring-only or enforced. This is not a claim that every extension receives a human source audit.

The local reference also contains a configurable remote-scanner framework:

- `openvsx-main/server/src/main/java/org/eclipse/openvsx/scanning/PublishCheckRunner.java`: records check results and distinguishes required errors from optional failures and enforced findings from monitoring findings.
- `ExtensionScanService.java`: validation, scanner jobs, rejected/error/quarantine state transitions.
- `ExtensionScanCompletionService.java`: waits for scanners, keeps required errors and enforced threats from activating the extension, records administrator overrides.
- `RemoteScannerProperties.java`: external scanner request/poll/result configuration, required/enforced switches, timeouts and concurrency.
- `BlocklistCheckService.java`: computes file SHA-256 hashes and compares them with recorded blocked file decisions. Renaming a known-bad file does not change its content hash.
- `SecretDetectorConfig.java`: configurable secret rules, including optional Gitleaks rule generation.
- `webui/src/components/scan-admin/common/file-table.tsx`: administrative file decisions are identified by filename and hash; it is not proof that the source is comprehensively analyzed.

Reading this source does not reveal which remote engines or policies the public Open VSX deployment currently enables. The registry framework and a working malware engine are separate things.

## What Tabs currently covers

`apps/exchange/src/scan.ts` blocks known-malicious package/file hashes, native executable signatures and suffixes, selected secret patterns and storage schema downgrades. It warns about dynamic code, nested archives, bundled dependencies, impersonation and access changes. `worker.ts` verifies the archive and package identity, compares a prior approved release, runs dependency advisory checks and generates bounded diffs. Failures produce blocking scan-failed evidence. Human approval and signed publication remain separate.

This is limited static coverage. There is no general antivirus, comprehensive JavaScript behavioral analysis, maintained malware-signature engine or runtime detonation service in this pipeline. A novel JavaScript keylogger, credential thief, obfuscated loader, or delayed malicious update may not match its current rules. A passing scan must never be described as malware-free. Dependency advisories only cover supported declared dependencies; a clean hash means identity, not safety.

## Review changes implemented

- Files now open into a readable, inert unified-diff view with previous/submitted line coordinates and omission explanations.
- Reviewers can explicitly request the actual submitted UTF-8 file from the verified archive, up to 384 KiB, paged in 200-line sections. This works independently of diff availability.
- The source endpoint requires reviewer access, an exact package digest and an exact archive member path. It reuses the package validator, verifies archive and manifest identity, caps concurrent reads at two, cleans up temporary files and returns private no-store JSON without permissive CORS.
- Code is rendered using text nodes, never HTML, Markdown, an iframe or code execution. Direction-control characters are made visible. Source retrieval does not send anything to an AI or modify a review decision.
- Binary/oversized/removed files require independent inspection of the exact downloaded archive. Missing previews are not a security clearance.

## Recommended next security layer

1. Add a scanner adapter and explicit per-check evidence: engine/rule version, archive digest, started/completed timestamps, coverage, findings and error state.
2. Run a maintained malware engine plus JavaScript-aware static checks in an isolated worker. Inspect obfuscation, credential access, dynamic loading and suspicious data flows; findings need human context rather than blanket bans on benign keyboard events.
3. Mark required checks fail-closed: timeout, unavailable service, partial extraction, missing engine or stale evidence keeps the package quarantined. Do not merely add another warning to the current passed flag.
4. Enforce the same evidence requirements on the review API and signing path. Treat old scans without required evidence as needing a new scan, not implicitly passed.
5. Re-scan every version and maintain revocation/blocklist propagation. Preserve capability/network/runtime isolation; registry scanning cannot replace runtime restrictions.
6. For any external scanning service, decide package confidentiality, retention and data-sharing policy before enabling uploads. No packages were uploaded to an external scanner by this change.

These items are a recommended implementation sequence, not features delivered by the source-reader update. Neither static scanners nor human/AI review can guarantee the absence of malware.

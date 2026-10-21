# Tabs release follow-up — 2026-10-21

## Scope and source

The `codex/release-reconciliation` branch combines the prior startup and reliability
fixes with the actual published v2.0.1 commit, b481ad4ab6a84d873990a74cd098aff46446385a.
The release's extension management and per-project tool UI are preserved. The only
merge conflict was the marketplace byline, where the released layout retains the
shared verified-publisher badge. Configured shortcut labels remain dynamic.

PR: https://github.com/PanicMako/Tabs-ide/pull/40

The primary checkout's 42 modified web files and other untracked user work were
not replaced or staged. Work happened in the existing managed validation worktree.

## Exchange production repair

The existing Render service `tabs-exchange-api` now uses a protected non-root
signer file. Its targets, snapshot and timestamp keys were validated against the
live pinned root before transfer. The encrypted backup, password and root private
key were never uploaded. Other environment variables and the hosting plan were
preserved.

The first image built but startup rejected Render's symbolic-link secret mount.
The startup wrapper now accepts a mount resolving to a regular file and copies it
into a private runtime file before the existing key validation. The regression
suite exercises both a read-only file and a symbolic-link mount.

Successful production deployment: `dep-dbc2j43bc2fs73b2ebl0`, application projection
commit `57d98762064d1b7761cdc255926fd87313cca793` from source `c83dd4845`.
The deployment branch advanced without force and its history was preserved.

A fresh trust store using the root shipped in Tabs verified the live metadata and
an anonymous download of `panicmako.relay` 0.1.0 (196,283 bytes). Timestamp metadata
advanced from expired version 1 to version 2, expiring 2026-10-22T02:57:31.813Z.
Repeated reads retained version 2. The server renews before serving the timestamp
when renewal is due; a sleeping server does not depend on a cron wakeup.

A separate fresh Electron profile discovered, prepared, installed and opened Relay
through the normal desktop bridge. Its isolated extension view loaded from
`tabs-extension://panicmako.relay/dist/index.html`. No registry login was supplied.
The final run had zero renderer exceptions and zero console errors. A macOS
sandbox helper diagnostic was still emitted by the development Electron binary.

The public registry reports anonymous reads, publishing enabled, namespace
management enabled and review required. Each new version still needs manual
approval; renewal only retains already published approved packages. This does not
make metadata expiry or root rotation optional.

## Website production repair

The previous website workflow failed because its Vercel token was invalid. The
local CLI login could refresh and deploy, but could not create a new automation
token (HTTP 403). The operator replaced the GitHub `VERCEL_TOKEN` secret directly.
No token was sent through chat.

A local prebuilt deployment restored the published v2.0.1 site and matched all six
built pages exactly. The subsequent official website workflow succeeded with the
replacement secret, including its own production comparison:
https://github.com/PanicMako/Tabs-ide/actions/runs/39536407247

Production: https://buildwithtabs.com/ and https://buildwithtabs.com/changelog

The checked-in release snapshots were refreshed from GitHub's published history;
they include v2.0.1 and its verified installer/update asset links. No unpublished
2.0.2 release is advertised by these files.

## Exchange policy follow-up

Real-browser checks exposed 25 static inline style attributes rejected by the
portal's strict policy, plus blocked bundled fonts. The existing declarations
moved to the shared stylesheet; fonts are permitted only from the same origin.
The asset route also serves the existing WOFF fallback with the correct type.
The design and controls were preserved.

All 544 Exchange tests and frontend/backend type checks pass. A browser serving
the actual built portal with production headers reports zero policy violations
on developer, catalog, extension detail and account pages. The developer field
initializes, remains editable and spans its intended width. Live checks confirm
zero inline style attributes, the same-origin font policy and HTTP 200 with
`font/woff2` for the bundled font.

Production deployment: `dep-dbc31g9srm7s739frab0`, projection commit
`1945ee266b2cb8fa4c2c3c5d88f2fcfee209ff69` from source `f861a0b2e`.

## Startup follow-up

Optional legacy MCP SDK and browser-automation protocol imports now happen on
first use. Existing MCP protocol and extension AI compatibility tests pass.

Fresh Electron acceptance exposed an intermittent startup race: renderer OAuth
requests could begin before the backend bound its port, producing two Chromium
connection-refused console errors and entering the reconnect schedule. A trusted
async desktop bridge call now waits for the loopback listener before renderer
authentication. Probes remain in the main process, use no credentials, and have a
15-second deadline. The HTTP startup guard still holds early requests until
normal authenticated routes are installed. Older desktop bridges retain the
existing path because the new method is optional.

The regression tests use real loopback sockets, including a delayed listener and
a backend that never starts. Transport tests prove authentication does not begin
until readiness resolves. The final live Relay Electron acceptance has zero
renderer exceptions and zero console errors. A separate fresh development-server
launch also recorded zero renderer exceptions and zero console errors, without a
reload. Its development-only Electron policy warning remains visible.

The performance pass preserved the original airport loading screen without a
minimum duration. The later operator-requested animation completion and 500 ms
exit are documented below; they intentionally change the presentation timing.

### Timing evidence

Before optional MCP deferral: three clean fresh profiles, median 2,262 ms
(range 2,154–2,454 ms). After: median 2,209 ms (range 2,191–2,725 ms).
This 53 ms difference is within run-to-run variation and is not a claimed large
speedup. Separate profiles and compile caches were used, with the compiled
embedded Code-OSS runtime explicitly enabled. An earlier baseline overlapped a
typecheck, reached 5,568 ms and is retained separately rather than mixed into this
comparison. After the listener fix, five fresh profiles reached interaction at 3,148, 2,116,
2,139, 2,147 and 2,282 ms (median 2,147 ms). All five samples are retained, including
the slower first launch. Local builds, typechecks and tests had finished before
this run. Timings collected under test/build load are not used as benchmarks.

Four subsequent launches reusing a disposable profile and its cache reached
interaction at 2,032, 2,220, 2,183 and 2,191 ms (median 2,187 ms). The initial fresh
launch in that sequence was 3,126 ms and is retained in the raw log. Warm and fresh
results are close; no separate warm-launch speedup is claimed from this pass.
An instrumented diagnostic trace still identifies module loading and Effect schema
construction as substantial work; profiler timings are separate from benchmarks.

A synthetic populated profile with 500 draft threads and a Git repository of
10,000 tracked files reached interaction at 2,978, 2,125 and 2,319 ms (median
2,319 ms). This used the actual built backend, fresh processes and separate
compile caches. It did not start provider turns or copy private user data, and
does not represent long active conversation histories or slower hardware.

The actual arm64 candidate DMG from build run 39537093292 was mounted read-only
and copied to a disposable installation. With the packaged runtime (no source
runtime override), three fresh-profile launches reached interaction at 20,311,
2,101 and 2,224 ms (median 2,224 ms). All samples are retained. The first launch
after copying the app did not report the first splash paint until 19,349 ms;
that paint was 531 ms into renderer timing, placing most of the delay before
renderer startup. Later splash paints were at 1,067 and 983 ms from process
spawn. The cause of that first-install delay is not established by this probe;
OS validation and filesystem caching are possibilities, not verified diagnoses.
Console timing output was enabled for observation. These are not reboot-cold
measurements, nor proof of startup performance on other hardware. The disposable
installation and test profiles were removed afterward.

The requested approximately half-second startup has not been demonstrated. The
20-second first packaged launch is an additional unresolved release concern. The
existing probe also still reaches its two-second backend shutdown deadline while
its renderer remains open; it then cleans up its disposable process group.

## Validation and candidate

The integrated baseline passed all 18 workspace test tasks, all 16 typecheck tasks,
the desktop build and all 168 browser tests. The optional MCP change passed 24
focused protocol tests; mounted-secret renewal passed 17 focused tests. Updated
marketing release snapshots passed all 39 marketing tests.

After the listener fix, all 16 typecheck tasks, the desktop build, 9 focused
desktop tests, 32 focused auth/transport tests and all 168 browser tests pass.
The final full workspace regression run passed all 18 tasks, including 7,561
server, 1,690 web, 648 desktop and 544 Exchange tests. `vp check` reports zero
errors and 661 existing warnings. No Code-OSS source changed; the application uses
its own formatter/linter. The isolated Code-OSS hook lacks a build dependency;
the primary Code-OSS checkout's hygiene command was run separately and found no
staged Code-OSS files applicable to that check.

Current desktop candidate source: `641b9252b03c621689817e504343e0762de5a057`.
Four-platform build and installer smoke checks, labelled 2.0.2 and using 2.0.1 for
upgrade acceptance:
https://github.com/PanicMako/Tabs-ide/actions/runs/39537093292

Packaged Linux launch and stable-backend acceptance passed:
https://github.com/PanicMako/Tabs-ide/actions/runs/39539726603

The first Linux smoke attempt passed runtime checks but failed while deleting a
profile that the terminating backend was still writing. The harness now waits for
its owned process group, force-stops remaining test processes and bounds cleanup
retries. The rerun passed without weakening the runtime assertions.

Both macOS DMGs passed architecture and deep signature checks, launched their
bundled editor services and returned stable backend descriptors:
https://github.com/PanicMako/Tabs-ide/actions/runs/39540386589

All four platform build jobs and their installer checks completed successfully.
Windows acceptance passed the initial 2.0.1 installation, locked-process upgrade
to the candidate, shortcut repair, unrelated-process preservation and launch of
the upgraded bundled editor backend. The initial install took 355 seconds, upgrade
486 seconds and shortcut-repair reinstall 481 seconds on the hosted runner;
these are installation durations, not application launch timings. The macOS
signature checks establish
ad-hoc signature integrity; they do not establish Developer ID notarization.
Through commit b0ae9d06a the desktop application sources were byte-identical to
the candidate build commit; later changes described below modify the web startup
presentation and are not included in those previously tested installer binaries.

The earlier candidate run was cancelled when the listener fix changed the source.
A successful preflight is not a substitute for finished platform artifacts.
No new tag or GitHub release has been published. No Apple Developer ID signing
identity or Apple/Windows CI signing credentials were found in the checked Mac
keychain or repository/environment secret names. Existing ad-hoc signing and
updater signatures must not be described as Apple notarization or Windows
publisher signing.

## Requested animation handoff

The operator subsequently requested that startup always finish the selected loader
sequence before a slower upward reveal. The airport board now has a 1,750 ms
minimum, derived from the last tile's 250 ms base, seven 160 ms stagger steps and
380 ms settled highlight. The existing glass option gets one 6,750 ms cycle.
Both paths use a 500 ms upward curtain exit once the backend is ready. Backend
loading and module imports continue concurrently; a slow or failed backend keeps
the loader and existing error/status presentation visible.

Reduced-motion preferences bypass the decorative hold and slide, with settled
airport letters. The early shell and fallback loader share the timing logic.
Backend readiness telemetry remains independent of this deliberate visual wait.
The airport design, fonts and palette are preserved. No new installer or release
was published for this presentation change; the measurements above describe the
previous candidate rather than a new performance result.

Validation for this handoff: seven focused timing/lifecycle tests, both Chromium
startup browser tests, all 1,693 web tests and all 16 workspace typecheck tasks
pass. The browser verifies settled airport letters before the exit begins and a
computed 500 ms transition. Formatter/linter checks report zero errors and the
same 661 existing warnings. The complete workspace test command also passed all
18 tasks (including 7,561 server tests, with 35 existing skips).

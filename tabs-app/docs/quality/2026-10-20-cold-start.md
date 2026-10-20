# Cold-start performance follow-up

## Result and scope

This pass targets process launch to a usable workspace. The original airport loading screen and its exit behavior are unchanged. It does not claim a 0.5-second full startup or production certification on other hardware.

Matched local measurements use the same checkout location, executable, probe and machine for the prior committed source and the optimized source. The initial five-sample comparison below omits the embedded Code-OSS runtime; a separate runtime-enabled comparison follows. Each build has five fresh-profile launches and five repeat launches after priming one disposable profile. Build and test processes were stopped during measurement. The probe records the existing `workspace-interactive` signal; its backend shutdown grace matches the desktop's two-second limit. All profile, cache and repository fixtures are disposable.

| Process-to-interactive measurement      | Before                              | After                               |
| --------------------------------------- | ----------------------------------- | ----------------------------------- |
| Fresh-profile samples                   | 3.959, 2.970, 3.123, 3.152, 3.051 s | 2.995, 2.309, 2.380, 2.295, 2.267 s |
| Fresh-profile median                    | 3.123 s                             | 2.309 s                             |
| Repeat samples, excluding priming       | 2.288, 2.150, 3.214, 2.915, 2.173 s | 2.781, 2.310, 2.233, 2.888, 2.077 s |
| Repeat median                           | 2.288 s                             | 2.310 s                             |
| Fresh-profile median splash first paint | 0.967 s                             | 0.732 s                             |

The cold median improved by approximately 26%. Repeat-launch results are essentially unchanged at this sample size; this pass does not claim a warm-launch improvement. System/native-entry variability remains visible in the sample ranges. These are local source-build results, not signed installer benchmarks. A separately observed first-ever launch of a newly copied Electron executable took 7.294 seconds, including 2.260 seconds before JavaScript entry; it is not concealed in the matched medians or attributed to application JavaScript.

With the compiled embedded Code-OSS runtime explicitly enabled, an additional matched three-sample comparison measured 3.464, 2.752 and 2.786 seconds before (median **2.786 seconds**), versus 2.772, 2.028 and 2.161 seconds after (median **2.161 seconds**, approximately 22% faster). After the final package compatibility and native-loader changes, five further fresh-profile launches measured **3.499, 2.224, 2.159, 2.223 and 2.317 seconds**, median **2.224 seconds** (approximately 20% below that baseline). The final confirmation uses five samples against the earlier three-sample baseline, rather than claiming a new matched five-pair experiment. Its splash first-paint median was 0.896 seconds. These launches initialize the embedded runtime but do not open an editor tab or restore a large existing workspace.

## Changes

- Desktop starts backend module loading before Electron readiness. The bootstrap pipe waits for both shell resolution and complete port/token/broker configuration. Electron metrics and power APIs still wait for readiness; telemetry cleanup also handles a child exiting before readiness.
- The server's desktop entry registers only the existing server flags. Other invocations retain the full CLI. The public index no longer eagerly re-exports the entire CLI implementation, which also restores the intended ACP fast path. A smaller CLI alone did not produce a measurable gain in preliminary samples; the reported gain is for the combined changes.
- Server and desktop builds bundle Effect and its platform runtime instead of resolving and compiling hundreds of separate dependency files. OpenCode's Effect schema consumers are included in the server bundle to preserve a coherent runtime. Native modules and vendor packages needing their disk layout remain external.
- The patch parser and OpenCode SDK are bundled for both output formats because their packages expose ESM-only entry points. All four built CLI entry points (index/bin, ESM/CommonJS) pass a real `--help` launch. The native file finder remains external and loads only when a workspace index is requested; import failures retain a typed workspace error. This preserves its binary assets and avoids a CommonJS startup failure.
- Runtime Effect imports use explicit module paths. Most of the larger source diff is this mechanical import change.
- The schema-only contracts package declares that unused modules have no side effects. This enables tree shaking instead of evaluating unrelated schemas during desktop startup. Before bundling the runtime, this reduced the desktop application bundle from 1,949,191 to 1,540,850 bytes. The final desktop bundle is larger because it now includes the previously external runtime; that file size is not presented as a final total-size reduction.
- Both generations of Claude provider probes and the V2 query runner use the existing shared lazy SDK loader. Importing their modules no longer imports the SDK. SDK-load errors retain their operation-specific error mapping, and cancelled probes check their abort signal before creating a query.
- macOS/Linux no longer serialize the compile cache during readiness. Scoped signal handlers persist it before shutdown teardown can block, and a scope finalizer covers ordinary closure. Windows retains the startup flush because the desktop uses forced process-tree termination there. Tests simulate held finalizers followed by forced termination and verify persistence before teardown, plus signal-listener cleanup. Windows/Linux native startup timings were not measured on this Mac.

## Validation

The final full workspace unit run passed all 18 tasks: server 7,561 tests (35 existing skips), web 1,681, desktop 634 and shared 1,185. Browser coverage passed 167 tests across 51 files. The native-loader change also passed 48 focused workspace search, entries and diff tests, including a fresh-process import-isolation and typed-failure test.

All 16 workspace type-check tasks passed again on the final source after the native-loader change. The final `vp check` passed with zero errors and 661 existing warnings. The isolated checkout excludes the user's separate web UI edits.

The final built-server RPC acceptance runs passed for ESM and CommonJS output, including native workspace file search through the CommonJS bundle. They also passed bootstrap/authentication, staging/unstaging, branch checkout, diff, local-remote commit/push/pull, tag metadata, option-injection rejection, terminal listing and support-bundle export. Real process tests also cover compile-cache persistence, SDK import isolation and CLI dispatch.

A fresh development-server audit initializes Code-OSS 1.140.0 and checks that its native IPC listener is registered. The final build audit recorded zero renderer exceptions and zero console errors, and verified the original airport grid is present before the main workspace import finishes. This controlled hold verifies appearance, not performance. Electron's development CSP and native sandbox warnings remain visible; they are not counted as renderer errors.

The benchmark's shutdown deadline was reached by both baseline and optimized builds with an open renderer connection. This is reported separately from readiness, and disposable process groups are always cleaned up. Unix cache persistence now runs on the shutdown signal before potentially held finalizers, rather than depending on that deadline being avoided.

## Remaining boundaries

Full startup still exceeds 0.5 seconds. Backend schema/runtime initialization, remaining dependency compilation, shell/environment preparation and native process launch still consume time. A first visible window and a fully usable workspace are different observed milestones; the measurements above do not substitute one for the other.

The user's separate uncommitted settings/extension UI changes are preserved and excluded from the isolated source measurements. No release was published. Signed macOS/Windows/Linux installer and upgrade acceptance, plus startup on large existing workspaces and slower machines, remain release gates.

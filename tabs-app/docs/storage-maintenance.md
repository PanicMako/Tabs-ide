# Local storage: diagnosis and maintenance

## 2026-10-22 incident

The Data volume initially had only **230 MiB available**. Code OSS compilation could fail with ENOSPC without installing any new application: source refreshes, dependency installs, compilation, local artifact validation and build caching all write substantial data.

Approximate measurements during the audit (nested totals must not be added together):

| Location                             |                                Size | Meaning                                                                               |
| ------------------------------------ | ----------------------------------: | ------------------------------------------------------------------------------------- |
| `~/Desktop/tabs`                     |              100 GiB before cleanup | Main repository, its local worktrees and build products                               |
| `~/Desktop/tabs/.worktrees`          |                    65 GiB initially | Old release, sync and integration checkouts, including duplicated dependencies/builds |
| `~/.codex/worktrees`                 |                              36 GiB | Additional retained source worktrees                                                  |
| `~/.colima`                          |                              27 GiB | Container virtual-machine storage; untouched                                          |
| `~/.gemini`                          |                              22 GiB | Gemini/Antigravity data; untouched                                                    |
| `~/Library/Application Support/tabs` |                              10 GiB | Mostly persistent native editor/browser partitions                                    |
| `~/Desktop/tabs/.turbo/cache`        |                               4 GiB | Old generated compressed build cache; cleaned                                         |
| Trash                                | 12.38 GB in the supplied screenshot | Terminal access denied; personal Trash left untouched                                 |

The largest editor partition contained about 1.3 GiB of HTTP cache and 0.5 GiB of generated JavaScript cache; IndexedDB was only about 10 MiB there. This is a separate cache-management concern, not permission to delete entire partitions. Tabs was running during the audit, so its live profiles were preserved.

System Data is a catch-all category for files that do not fit a more specific category, including third-party data. It is not a single 294 GB system folder. The category is not a reliable attribution of all those bytes to macOS or Tabs. See [Apple's storage explanation](https://support.apple.com/en-us/102624). Actual free space was checked using `df -h /System/Volumes/Data`. No Data-volume APFS snapshots or Time Machine local snapshots were listed by the available checks.

## Cleanup performed

Removed only known generated/disposable files:

- Old 2.0.0 DMG/ZIP files in the 1.142 sync worktree.
- Old temporary 2.0.0 installers and runtime archives under `/private/tmp`.
- Aged, generated Turbo cache archives/manifests in the root repository and `tabs-app/` (the final maintenance pass removed another 396 files totaling 2.60 GB).
- Ignored `node_modules` directories and obsolete 1.3.28 installers in the inactive 1.140 sync worktree. Reinstall its dependencies before building that old worktree again.

About **22.6 GB of files/dependencies were removed** by this audit. Physical reclaimed space differs because APFS clones/hardlinks share data and other activity continued during cleanup. Some old main-checkout installers disappeared concurrently; those deletions are not attributed to this audit. Free space rose from 230 MiB to 30.2 GiB after the final cleanup.

No worktree, Git history, source modification, installed application, browser profile, cookies, login, IndexedDB, conversation history, Docker volume or personal Trash was removed. In particular, the old 1.140 sync worktree contains an uncommitted `tabs-code-main/build/gulpfile.compile.ts`; removing the whole worktree would have discarded that file. The current 1.143 upgrade worktree was preserved.

## Why a successful release does not remove local installers

The local artifact builder copies finished files into `release/` and deliberately leaves them available for upload, review and installation. Its temporary staging directory is scoped and cleaned by default; `--keep-stage` or `TABS_DESKTOP_KEEP_STAGE=true` deliberately retains staging. Force-killed processes may also leave temporary directories.

GitHub Actions uploads/retains its own runner artifacts; it cannot clean files on this Mac. A release becoming available on GitHub is not a local cleanup signal. Moving files to Trash also does not reclaim disk space until Trash is emptied.

## Reusable conservative cleanup

From `tabs-app/`:

```bash
bun run storage:audit
bun run storage:clean
```

Both scan only Git-registered worktrees of this repository. The audit is a preview. The clean command permanently removes eligible generated files rather than sending them to Trash:

- Only ignored, regular Turbo cache files and recognized installer filenames in known build-output directories are considered.
- Files must be at least seven days old by default (`--days=14` can increase retention).
- The latest stable release's installer is preserved.
- Other installers require a published GitHub release, a matching uploaded filename/size and a SHA-256 digest. Cleanup hashes the local installer before deletion. Drafts, unpublished artifacts, mismatches and files without verifiable digests are preserved.
- If GitHub or `gh` is unavailable, all installers are preserved. Aged build-cache cleanup can still proceed.
- Files modified after scanning, directories and symlinks are skipped. Source, dependencies, profiles, worktree checkouts, databases and Trash are outside this command's deletion scope.

This is an explicit maintenance command, not an automatic post-build deletion hook. Do not delete installers merely because a build finished: upload/verification may still be pending. Do not enable recursive cleanup of worktrees without reviewing their dirty and untracked files and preserving recoverable work.

Before a Code OSS sync/build, check `df -h /System/Volumes/Data` and allow additional headroom for dependency installation, compiled runtime output, localization/extension bundles, package staging and final archives. Avoid starting simultaneous full runtime builds when space is low. Review old worktree retention after each completed integration; retain source safely and remove only verified generated output when a checkout is no longer used.

## Follow-up: why Documents shows 250.64 GB

A second measurement found the actual `~/Documents` folder was only **5.8 MiB** (mostly TypeWhisper recordings). The Storage screen's Documents category is not the same as that folder. It groups files from other locations too; [Apple defines it as home-folder files not included in other categories](https://support.apple.com/en-sg/guide/mac-help/syspf5a64aa6/mac). Its increase from about 75 GB to 250 GB while System Data fell from about 294 GB to 96 GB strongly suggests classification was refreshed; it does not demonstrate 175 GB of new personal documents. The filesystem measurements below identify real locations; they cannot assign every file to Apple's categories precisely.

Current allocated sizes, in GiB (nested entries overlap):

| Location                    |   GiB | Contents and cleanup assessment                                                                                                               |
| --------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/Desktop`                 | 108.6 | Mostly development projects, not office documents                                                                                             |
| `~/Desktop/tabs`            |  82.8 | Active checkout plus retained worktrees, dependencies and generated builds                                                                    |
| `~/Desktop/tabs/.worktrees` |  61.0 | Includes 1.143 sync 12.3, 1.142 sync 12.1, 1.140 sync 7.2, release-2.0.2 5.7, and other integrations; review source before removing checkouts |
| `~/.codex/worktrees`        |  36.0 | Ten additional development worktrees; source can be valuable, build products are often rebuildable                                            |
| `~/Desktop/Passes`          |  17.9 | Includes 13.4 GiB in `build/`; build outputs are a strong candidate after confirming no build is using them                                   |
| `~/Desktop/.git`            |   4.8 | A separate Desktop-level Git repository, mostly packed history; not disposable cache                                                          |
| `~/.colima`                 |  27.0 | Container virtual-machine disks; may include databases and test images, not safe to blanket-delete                                            |
| `~/.gemini`                 |  21.8 | Includes Antigravity IDE brain/artifacts 8.9 GiB, conversations 7.6 GiB, and recording/backups; saved agent work, not just cache              |
| `~/.cache`                  |   6.6 | Includes runtime downloads, uv and Puppeteer caches                                                                                           |
| `~/.npm-custom-cache`       |   4.8 | npm download cache; rebuildable                                                                                                               |
| `~/Downloads`               |   2.6 | Primarily game/Intern-batch-08/ThrottleClan directories at measurement time                                                                   |

No additional personal files, worktrees, caches or profiles were deleted during this follow-up audit.

### The 10 GiB Tabs profile

Almost all of the profile is in **38 persistent editor/browser partitions**, created separately for projects. Aggregate breakdown:

| Partition data                     |   GiB |
| ---------------------------------- | ----: |
| HTTP asset cache (`Cache`)         | 5.909 |
| Compiled JavaScript (`Code Cache`) | 3.589 |
| WebStorage                         | 0.371 |
| Service Worker                     | 0.121 |
| IndexedDB                          | 0.024 |
| Local Storage                      | 0.008 |

Thus **about 9.5 GiB is HTTP/JavaScript cache**. Project isolation duplicates large editor assets across partitions; different runtime revisions can add further cache entries. These files are regenerated and are cleanup candidates through Electron's cache APIs, separately from cookies, IndexedDB, local storage and service-worker data. This audit did not remove a live profile or implement periodic cache eviction. Persistent cache retention still needs its own lifecycle policy; installer cleanup alone will not solve it.

### Downloaded installer cleanup in Tabs

The installed macOS app now offers a custom **Move the installer to Trash?** dialog when the exact current-version/current-architecture DMG exists in Downloads. It runs only for a packaged app launched from `/Applications/Tabs.app` or `~/Applications/Tabs.app`, never from a mounted DMG or a development build. **Keep installer** remembers the choice for that filename. On request, the main process checks the published GitHub asset's filename, size and SHA-256 digest, then moves the unchanged verified file to Trash using Electron. Offline/unverifiable/renamed/older/unpublished installers are left alone. The renderer cannot supply an arbitrary deletion path. Trash is never emptied automatically. This change requires a rebuilt application; it does not retrofit the currently installed binary.

### Live build storage swing observed

During this follow-up an `hdiutil` process had its working directory in the 1.143 sync worktree. Temporary packaging directories under macOS's per-user temporary folder briefly measured **11.3 GiB for `tabs-desktop-mac-stage-*`**, **4.1 GiB for `tabs-dmg-root-*`**, and **4.1 GiB for `tabs-updater-zip-validation-*`**. The latter two disappeared and staging shrank while the checks ran, consistent with normal scoped cleanup. These are live measurements, not persistent totals, and APFS sharing means their logical/allocated totals need not equal unique physical bytes. They were not deleted by this audit. Free space dropped from about 30 GiB to 21 GiB during packaging, before cleanup progressed.

Installer cleanup was validated with 648 desktop unit tests, 1,689 web unit tests, two browser interaction tests, workspace typechecking and formatting/lint checks (zero errors; existing warnings remain). A physical installation/Trash operation was not performed on this Mac as part of testing.

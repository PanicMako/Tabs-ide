# Actual desktop acceptance handoff

This checklist concerns the isolated development desktop and private real-account
registry. Unit tests and direct broker calls do not mark these steps accepted.
Record visible results, version/digest, keyboard focus, and errors at each step;
never record token values or screenshots that expose them.

## Resume the existing instance

The development app is
`apps/desktop/.electron-runtime/Tabs.app` in this worktree. It shares bundle ID
`com.tabs.app` with `/Applications/Tabs.app`; do not select the installed app by
mistake. Bring the development window forward and open **Settings → Extensions**.
The current instance uses dedicated acceptance data, not the normal desktop
profile. Do not restart or replace it merely because computer observation timed
out.

The **Registry connection** section must report `https://localhost:9443`.
Its initial root pin is
`0a9971222d8ea180550a16b9f10bb3d616b27e4b699ce2d771bc5f822be753be`.
The process already trusts the dedicated local CA. Do not bypass a browser TLS
warning, disable certificate checks, or substitute the rotated clone's root.

## Connect without sharing the secret

The owner completes credential creation and entry. At
`http://localhost:8787/account/tokens`, choose **Read private registry**, give it
an acceptance-only label, and create the token. This is read access only; no
publisher namespace is required. Copy its once-visible value directly into
**Private registry read token** in desktop Settings and choose **Save read
credential**. Do not paste it into chat, a URL, a screenshot, a command log, or a
tracked file. The desktop must clear the entry and report **A read credential is
saved**. Confirm persistence after an explicitly planned relaunch, and that the
stored value is never displayed again.

## Install, use, and isolate data

1. In discovery, search for `Workspace note` by `panicmako-local-test`.
   The actual latest signed version is `1.0.2`, SHA-256
   `a389b193dfffedb7cc12e85424345f5656c8988e9af8d1d5fb13123ebd84385d`.
   Rejected `1.0.0` must not appear as installable.
2. Choose **Review & install**. Verify the manifest, registry, package digest,
   requested access, and focus on the review heading. Cancel once and verify
   focus returns to the originating control. Only confirm installation after
   the user approves the exact package and requested access.
3. New installs must remain disabled until projects and access are chosen.
   Use **Extension enabled** and **Project overrides** to select a disposable
   acceptance project; another project must remain excluded. Grants that add
   privileged access require the user's confirmation at the point of grant.
4. In **Profiles & Permissions**, create/select Work and Personal profiles.
   Store distinct note contents through the real extension view. Switch profiles
   and projects, then reopen them: data must remain isolated according to the
   selected shared or project-isolated storage scope. A label alone is not proof
   of isolation. Never use production account credentials for this sample.

## Update and recovery

The current catalog offers the latest version; it does not expose an older-version
installation picker. Installing `1.0.2` alone cannot prove an update from `1.0.1`.
A real update exercise needs a legitimately installed older signed version or a
subsequent reviewed, signed local release. Record both package digests and the
before/after note contents. Use **Check for updates**, **Review update**, and
**Install verified package**; confirm preserved enablement only when no new
capability, network host, or AI-callable command was added.

Rollback is currently automatic if an update's first activation fails, not a
manual rollback button in Settings. Source `extensionViewManager.ts` retains the
verified checkpoint until successful activation, then commits the update. Actual
acceptance must demonstrate a failed first activation and restoration of the
previous package and data in the native app. Existing tests simulate this, but
a successful update or signed-metadata rollback rejection is not evidence of
native package/data rollback. Prepare a bounded, reviewed local failure exercise
before performing it; do not corrupt a user's installed package or bypass digest
verification.

## Revoke, disconnect, and uninstall

Revoke the acceptance read token from the owner account, then refresh discovery
in the native app. Protected access must fail with reconnection guidance without
mislabeling installed packages as revoked. Disconnect via **Disconnect registry
credential** and verify OS persistence is removed. Any replacement token is again
created and entered by the owner.

Choose **Uninstall** and first cancel to verify focus restoration. Then exercise
**Uninstall and retain data** and verify removal of tool availability while
retained profile data can be recovered by a later verified reinstall. The separate
**Uninstall and delete local data** path needs explicit confirmation immediately
before deletion; test only the inventoried disposable acceptance data. It does
not promise secure erasure of disk history or backups.

## Evidence still required

Actual native installation, permissions, project/profile isolation, update,
automatic first-load rollback, uninstall, and OS credential persistence remain
unaccepted until the visible walkthrough is completed. Windows cleanup and a
screen-reader walkthrough are separate required checks. This local procedure
neither provisions production hosting nor authorizes deployment or public
submissions.

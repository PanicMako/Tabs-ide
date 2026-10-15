# Symlink and project-path audit

Full symlink49/path75/path test60 and testing symlink probe source read. Path full base diff adds portable project-name slug generation. Probe is a dependency review, not original change completion credit. Fresh path6 plus independent real filesystem symlink2 passed8/8,221ms exit0. Archived SymlinkTargetAudit.test.ts restores to packages/shared/src for relative imports. Controls prove a relative dangling target via a symlinked parent resolves to its canonical destination and a two-link cycle fails.

ServerSettings1229 uses the resolver before its atomic writer; ManagedProjectFolders388 uses the new slug. Full atomic write cancellation/race behavior is not proven by these helper controls. Existing Windows-drive tests assert normalization as designed; actual Windows native path behavior and symlink privileges were not exercised. No production changes.

Correction: the selected serverSettings1229 call is watchLinkTarget, used to follow the symlink destination for filesystem events; this call does not prove the atomic writer itself resolves the link. Writer integration remains open.

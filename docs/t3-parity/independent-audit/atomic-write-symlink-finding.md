# Atomic writer does not implement new symlink-preservation tests

Complete writer25/test185 source review. New original suite6failed1passed (289ms exit1). Four real filesystem cases expect preserved ordinary/dangling/relative symlinks and rejection of cycles; current writer directly renames onto supplied path. Missing-file creation passes. Two mock unreadable-link/cleanup-failure cases also fail; their fixture setup does not independently prove those production failure conditions.

Independent AtomicSymlinkAudit.test.ts uses NodeFS observations and actual Effect writer:1failed1 (220ms exit1). After writing through a link, lstat reports a regular file, original destination still reads before, replacement file reads after. Fixture cleans temporary directory and is archived; restore to apps/server/src for relative import. Writer bytes match exact original base117643e40e33ee3a897bd00571186f9c674c25a7, so this is an inherited defect and missing implementation of new tests, not a newly introduced writer regression.

serverSettings670 passes settingsPath directly to writer; its separate shared resolver is used for target watching at1229 and cannot preserve the link during save. No actual configured user settings were modified. Production unchanged. Temp cleanup failure/cancellation and native Windows semantics remain open.

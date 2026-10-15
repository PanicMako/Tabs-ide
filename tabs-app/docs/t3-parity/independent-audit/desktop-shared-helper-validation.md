# Desktop shared helpers

HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9. Four complete new files174lines read. Fresh5/5,122ms exit0. Socket helper hashes state directory to24hex characters; Unix directory includes UID and supplied tempDir; Windows namedpipe path generated. Tests verify simulated Unix length/separation and Windows shape, not native sockets/permissions. Long tempDir itself remains unbounded; no runtime failure established.

Bootstrap HMAC helper derives12-hour windows and accepts previous/current/next with timing-safe comparison after equal-length guard. Actual tests prove rotation, expiry, forward skew tolerance and wrong-secret/short rejection. Source comments' lifetime assumes desktop/backend time relation; large clock drift behavior not tested. No production helper consumer found in scoped source search, so shipping rotation cannot be accepted from these tests. Address helper does have CLI app consumer at212; desktop counterpart remains to audit.

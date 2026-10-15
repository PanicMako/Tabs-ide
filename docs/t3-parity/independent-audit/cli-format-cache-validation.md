# CLI auth formatting and compile cache

Batch326: Complete four files343 lines reviewed. Focused test command exit0; log /tmp/tabs-audit-cli-format-cache.log. Issuance shows credentials intentionally; pairing URL uses fragment, listings whitelist metadata. Pair-list test fixture secret-credential but assertion checks absence of secret-pairing-token, so it does not protect fixture secret leakage. Static listing code does omit secret fields. Plain pairing expiry interpolates DateTime object rather than explicit formatter; usability behavior requires direct rendering. Metadata/labels render verbatim, terminal escaping not covered.

Compile cache flush best effort. Tests use actual Node subprocess killed by SIGKILL and inspect files for enabled vs disabled NODE_COMPILE_CACHE. This proves current Node file persistence; Windows desktop packaged startup remains separate.

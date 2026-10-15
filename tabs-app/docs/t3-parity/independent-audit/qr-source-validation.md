# QR and startup access review

HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9 unchanged. Complete new qrCode985/startupAccess148/test79 read. QR license notice retained; algorithm source covers sizing, numeric/alphanumeric/UTF8 byte segments, Reed-Solomon error correction, function patterns, masks, penalty selection, and ECC block tables. No direct QR test file found. No upstream identity or standards-compliance conclusion based on its own comments.

Fresh startupAccess7/7tests passed1.20s. They verify host selection, actual-bound-port extraction, token in fragment, presence of terminal glyphs/line count and output copy. They do not decode QR content. Real app consumers confirmed: serverRuntimeStartup573–605 headless branch and cli/pair166–190. These selected ranges are not full-file review credit. Terminal renderer packs two rows per glyph and defaults margin2; camera/terminal-font/scaling/quiet-zone compatibility remains unverified.

Independent Node24 diagnostic generated full QR matrices for a pairing URL, 256-byte synthetic token URL and Hindi/emoji string. Existing OpenCV decoder is running under tool session37246; no result yet, so no decode-pass claim. Temporary matrices /tmp/tabs-audit-qr-matrices.json contain synthetic values only. Re-poll this exact live session before any restart.

Native interface selection uses first external IPv4 then IPv6; source-only VPN/link-local selection compatibility not established. Startup pairing issuance/remote connection live behavior remains unverified. All original files are new against base; complete current reads cover new-file diff. Production unchanged; full audit incomplete.

Decoder completion supersedes pending status: session37246 terminalexit1. Version4 pairing URL and version3 Hindi/emoji recovered exactly. Version13 long synthetic URL was not detected; inability of this decoder to detect does not establish generator invalidity. Diagnostic assertion all3 failed. Longer payload interoperability remains unverified; no live handle remains.

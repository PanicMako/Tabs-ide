# Review index timestamp compatibility defect

Confirmed on HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9 with Node24.18.0 and installed @effect/platform-node-shared beta.78. Existing Coretest fractional1700000000.9999 cases fail for both split-index variants: tracked same-size edit disappears. Integer cases pass.

GitVcsDriverCore.ts prepareReviewIndex copies index timestamp using Math.floor(mtime.value.getTime()/1000). Its comment assumes Node FileSystem stat truncates bigint timestamps. Installed NodeFileSystem.ts makeFileInfo486–515 forwards stat.mtime and stat516–522 uses NFS.stat without bigint options. Node diagnostic ordinary stat dateMs1700000001000 versus bigint dateMs1700000000999 for same actual mtimeNs1700000000999900102. Thus floor yields nextsecond1700000001 rather than1700000000.

Independent actual Git fixture matrix recorded in review-index-timestamp-diagnostic.json. Original index diff detects tracked edit and original bytes stay unchanged. Private index with exact fractional timestamp or correct floor detects it; next-second timestamp omits it in both split variants. This establishes timestamp mechanism, beyond existing test failure. Temporary repos removed by scoped context; no production changes.

prepareReviewIndex byte-identical pinned upstream76d3c96fd5b89cca2c06aeaceaea16100c75084a; defect is compatibility with installed Effect version, not new upstream algorithm. Impact: diff preview can falsely omit same-size tracked edits when index timestamp rounds across a second boundary and Git trusts matching stat metadata (fixture disables trustctime to isolate). Real-world incidence/platform scope and shipped legacy integration remain unverified. Full parser/runtime acceptance not implied.

# Theme import/export and preview

Complete import/export493/test252 and preview145 source. Fresh13/13,194ms exit0; full source/test diffs show change adds sectionFont/supportingFont preservation to import/export/recovery. Added font roundtrip passes. Actual ThemeImportExportModal imports parser/exporter and calls48/64, but native browser interaction/font loading remains unverified.

Preview geometry/color mixing source reviewed; no direct app shared import found and no dedicated suite executed. Loose OKLCH parser matches prefix and numeric dotted fields without full validity check; malformed-input impact not independently reproduced. Import/export existing parser casts tokenOverrides/border without full runtime value schema; malformed alpha/diff scheme roundtrip concerns do not arise from new font diff and are not classified as new defects. No production changes.

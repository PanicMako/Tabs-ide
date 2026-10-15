Batch190 — shared test coverage

HEAD unchanged. Complete assistantCitations.test.ts349, semver.test.ts82, t3ProjectFile.test.ts94 and t3ProjectFile.ts45 read, including full citation modified diff. Also read complete semver.ts and tabsProjectFile.ts dependencies. Reused batch180 shared 85-file/1,176-test pass.

Citation test changes are runner and branded-constructor migration plus formatting; assertions retain legacy bytes, exact Unicode data, bounded selectors/comments, malformed links, provider JSON and escaped text. These are serialization assertions, not actual provider instruction-isolation proof.

Semver tests cover supported comparators, shorthand, zero-major caret bounds, prerelease ordering, malformed lexical fallback and stringified remote execution. They do not cover hyphen-containing prerelease parsing already recorded elsewhere, full SemVer compatibility or native remote startup.

Project-file tests import ./t3ProjectFile.ts directly and exercise the schema builder, JSONC and defaults. Public @tabs/shared/t3ProjectFile export instead maps to ./src/tabsProjectFile.ts; that module exports parse/codec aliases but no buildT3ProjectFileJsonSchema. Thus passing local builder tests do not validate the public module surface. No production schema-builder caller found in apps/scripts/packages search, so no demonstrated current app failure. The public export/relative-module distinction is a coverage gap; both existing file targets pass batch189 existence checks.

Full audit remains incomplete; no production edits.

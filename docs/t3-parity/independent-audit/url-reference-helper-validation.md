# URL, media, terminal and thread-reference helper audit

Full source review of seven files. Existing three suites passed 36/36 (915ms, exit0). Existing changeRequestUrl tests do not cover the newly added Forgejo branch. Independent archived ForgejoUrlAudit.test.ts passed 1/1 (119ms, exit0), checking HTTP port preservation, unequal-port link rejection, repository derivation and sibling routes. Restore to packages/shared/src to run its relative import.

GitHub media uses exact HTTPS credential-host allowlists and canonicalizes away supplied ports/userinfo. Source inspection does not prove authenticated fetch or redirect safety; those are separate server obligations. No dedicated githubMedia suite executed. Terminal labels are consumed by server Manager. No production app import of threadReference or nextTerminalId was found in this search, so passing helper tests do not establish client use. No production edits.

Batch203 — model selection and capability contracts

HEAD unchanged. Complete63line selection/new124line tests and304line model source read, model truncation recovered. Full selection diff and model changed source/removed hunks inspected. Reused contracts824test pass.

Selection migrates legacy provider to instanceId only when explicit instanceId absent, validates wire schema after intermediate cast, and encodes canonical instance form. Tests assert built-in/fork IDs, explicit precedence, canonical encoding, malformed ID rejection and legacy option-map normalization. This resolves the earlier191 concern about valid decoded object maps reaching array-only equality: decoding normalizes them. Raw draft state bypassing codecs still needs caller evidence.

Option arrays have no uniqueness check; duplicate IDs allowed. Legacy map normalization trims keys/values and drops non-string/non-boolean values. Equality order with duplicate IDs and values true versus string true can be sensitive because comparator stringifies values; actual producer impact unverified. Capability legacy fields now optional, custom entry supports name/capabilities, constants and alias changes inspected. Model dispatch availability not verified against external providers; source strings are not claims those models exist. Removed capability defaults require consumers to tolerate undefined; shared helper compatibility already reviewed.

No production edits; full audit incomplete.

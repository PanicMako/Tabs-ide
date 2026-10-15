# Provider policy contracts — batch215

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete84line wholly new providerPolicy source reviewed. Runtime source1211lines was accidentally included in initial combined read and truncated: it is not credited as complete. Only first100 runtime diff lines inspected; remaining source/diff pending.

Approval/sandbox/runtime/interaction/request/delivery enums, optional approval warning and question attachment payload reviewed. Schema caps attachment arrays per question but not total questions/flattened attachments. Selected ThreadMessageIntake59 validates flattened Object.values attachments before claims, resolving aggregate-cap concern on V2 command path. Earlier intake cleanup finding remains applicable. Codex MCP elicitation has acceptAlways conversion callers/tests, inventory only here; no complete adapter review credited.

No direct providerPolicy test file. Existing contract824test pass reused as suite evidence, not proof of all provider-specific policy mappings. Default full-access is declared; requested approval semantics across providers require caller validation.

No production edits. Full audit incomplete.

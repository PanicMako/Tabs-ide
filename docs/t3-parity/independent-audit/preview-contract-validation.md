# Preview contract changes — batch250

Full44added0deleted preview.ts hunks reviewed. Adds discrete zoom ladder0.25–5, appearance system/light/dark defaults, optional profile ID on open/session; viewport/epoch/revision changes are comments only. Existing824test evidence reused. Profile frozen-at-open comment describes required runtime behavior, not proof of Electron partition correctness. Consumer inventory collected; full native preview integration remains separate scope. Unchanged354line file not credited fully.

previewAutomation.ts has117add21delete; initial diff read truncated and remains pending. No completion credit for partial automation read. Labs excluded. No production changes.

## Batch251 automation changed hunks

Full117add21delete diff now read in2bounded ranges without truncation. Adds setColorScheme request/result/operation, optional open background toggle, optional liveTabs with visibility,120second recording-stop constant, generalized capability error metadata, and four recording transfer errors. Error text claims desktop copies persist,50MiB limit and deadline; schemas/messages alone cannot prove lifecycle behavior. URL validation remains trimmed/nonempty/max2048; updated descriptions are guidance, not protocol enforcement. Consumer inventory collected. Unchanged953line source not fully credited.

## Batch252 preview handler source

Complete240line MCP handler reviewed. Capability gate precedes broker invocation; set appearance forwards setColorScheme. normalizePreviewOpenInput treats show as alias, preserves omitted open for desktop preference, defaults reuse true (contract description defaulttrue is not unconditional handler behavior). Recording stop requests transferToEnvironment true with120second broker timeout. Claim validates decoded artifact, pending attachment ID, thread segment, resolved attachment paths, actual file type/size equality and<=50MiB, then renames. Overlapping stop can accept already claimed final file after NotFound. Filesystem stat/rename atomicity and native upload/copied-source lifetime need diagnostic/native proof; no defect established merely from source. Desktop-copy preservation remains unverified. No production changes.

## Batch253 handler test validation

Complete test source reviewed. Node24 targeted suite7pass1.37s, session68939exit0, log/tmp/tabs-audit-preview-handlers.log. Real temporary filesystem with six-byte synthetic video verifies concurrent/repeated claims return identical retained path, wrong-thread/path rejection, mismatch leaves pending file, complete upload moves file, older desktop returns update-required error. This is not encoded media or Electron/network upload;50MiB boundary/deadline/preserved desktop source are not exercised.

## Batch254 tool registration/tests

Complete277line new tools and77line tests reviewed; Node24 targeted2pass1.24s session71814exit0. Tests enumerate toolkit parameter object schemas, descriptions, tabId, no root union, navigate description composition and exact action object results. Evaluate wraps arbitrary value in object; snapshot and standard toolkits separated. Tests do not assert annotation safety or live provider/schema acceptance. Navigate is marked Destructive false despite navigation losing page state; annotation-only concern, actual consumer policy impact unverified. Snapshot save/includeImage options are documented here but special response handling is outside previously read simple handler; need trace serializer before claiming screenshot-save behavior. No production changes.

## Batch255 screenshot serializer trace

Selected McpHttpServer310–360/403–507 reviewed. Dedicated snapshot serializer reads original save/includeImage after simple handler strips them from broker operation; save writes decoded bytes under browserArtifactsDir with safe hostname/time/UUID filename. save+includeImage false returns only URL/path; otherwise bounded metadata plus optional image. This resolves missing-source handling concern from batch254. Selected tests365–418 assert artifact directory/name/bytes, unsaved absence, path-only response. Tests use synthetic png bytes, not rendered screenshot proof. Whole McpHttpServer source/test file not credited and tests not rerun here. No production changes.

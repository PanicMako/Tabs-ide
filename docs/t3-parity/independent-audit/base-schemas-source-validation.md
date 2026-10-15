Batch200 — foundational schemas

HEAD unchanged. Complete396line source and247line new tests read. Changed additions inspected in current source, all removed diff lines and hunk headers inspected. Reused fresh batch19956file824test pass.

Nonblank filter rejects whitespace before make/encode, preserving trimmed wire roundtrip. Branded makeUnsafe remains deliberate unchecked cast. New IDs and client metadata literals inspected. Generic forward-compatible arrays decode through codecs and drop invalid elements; encode failures become holes serialized as null. Tagged unions preserve unknown tags as class instances and reject malformed known members/unknown encoding; union arrays drop unknowns only. Optional/nullable/omitted-null helpers probe raw values then pass encoded representation into downstream codecs.

Tests assert transformed DateTime/defaults, invalid generic element dropping, JSON holes, unknown tagged class identity, known malformed rejection and plain encoding. Three property checks for30schemas run500cases each with padded Unicode whitespace and make/decode/encode stability; SecretRef is newly defined but absent from enumerated property list. Optional/nullable/omitted-null helpers and hasUnknownUnionTag have no direct assertions in this file. Caller inventory includes settings, orchestration and provider contracts. Transport and application semantics need caller review; no new failure established.

No production edits; full audit incomplete.

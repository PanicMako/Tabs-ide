Batch201 — application events and assets

HEAD unchanged. Four complete files576lines reviewed; asset full modified diff recovered after initial output truncation. Fresh contracts824test evidence reused.

Application events define separate project aggregate/payload union and optional origin/provider metadata. Tests assert created-event decoding with omitted newer fields and reject thread aggregate. They do not assert cross-consistency of aggregateId and payload.projectId; schema itself does not compare them. Producer/event-store behavior needs review before calling this a failure. IsoDateTime remains a string alias, so dates are not validated here. Persistence event store and V2 project store imports establish contract usage only.

Assets add media/draft workspace resources, attachment filename/MIME/disposition, tool-output/native-app/GitHub media variants, dimensions and upload/delete contracts. Paths and metadata bounded; GitHub URL is merely bounded nonempty string at this layer, delegated to server validation already reviewed in AssetAccess. Tests cover supported image/file upload kinds, unsupported image MIME, empty/oversized bytes. New resource variants, metadata limits and image dimension schemas have no direct assertions in this file. Shared resource includes device screenshot example but excluded Labs review remains excluded.

No production edits; full audit incomplete.

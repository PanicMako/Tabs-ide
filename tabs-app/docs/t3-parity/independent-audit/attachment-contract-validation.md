Batch202 — attachment contracts

HEAD unchanged. Complete282line new source and82line new tests read, fresh contracts824test pass reused. Snapshot metadata is part of shared attachment contract; native device/Labs implementation remains excluded.

Known image/file schemas carry individual limits; unknown type preserves base fields but excludes exact known tags. Files may carry pasted-text source. Total helper caps100attachments and80MiB image bytes including generic attachments with supported raster MIME. Upload file schema disallows every image/ MIME whereas signed generic-file upload schema accepts SVG as a file (batch201); differing transport policies require consumer review. No demonstrated user failure established. PersistChatAttachmentsInput array has no aggregate schema bound; validation depends on service implementation.

Tests cover unknown kind decoding, known over-limit file and invalid image MIME rejection, serialized accessibility tree size and raster helper. No direct100/80MiB helper assertions, upload file MIME, IDs or data URL bounds. Accessibility total node/string filter executes after recursive schema decoding; no predecode depth limit here. Native deep nesting diagnostic not run, no confirmed denial-of-service claim. Selected ws legacy persist implementation and V2 AttachmentClaims limit callback read. Full attachment transport integration remains unverified.

No production edits; full audit incomplete.

# Relay response errors

Batch304: Complete83-line source and149-line tests;16 tests passed311ms/exit0. Success leaves body available; non-success decodes only protected typed relay errors, otherwise avoids raw response body and includes sanitized cf-ray.401/403 and most4xx stop retries;408/429/5xx unavailable retries. Transport wrapper only emits error category, not request/cause. CloudLink consumers traced at873/1276 and retry helper314, Connect unlink previously traced.

Tests use in-memory Web Response objects, not live relay requests or slow bodies. schemaBodyJson decode has no timeout here; enclosing caller determines deadline. Typed reasons are contract enums while traceId is TrimmedNonEmptyString and displayed directly; this is not evidence of complete terminal-output sanitization. No confirmed credential leak asserted. No external requests performed.

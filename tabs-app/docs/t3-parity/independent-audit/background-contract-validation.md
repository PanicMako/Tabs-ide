# Background contracts — batch228

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete108line current source/18line new tests and full modifieddiff reviewed. Existing824contract tests reused.

Only production changes replace five Schema.DateTimeUtc fields with shared DateTimeUtc union (UTC object or UTC-from-string): host updatedAt, report observedAt, lease updatedAt/expiresAt and policy updatedAt. Remaining fields inherited. Tests trim/bound clientID128 and reject blank/129; do not directly assert new timestamp forms. Prior baseSchemas date tests separately cover shared union but not background integration.

Selected BackgroundPolicy180 clamps supplied TTL to minimum1second/maximum configured lease cap using server-time updatedAt; arbitrary timestamp expiry is not trusted. NaN/Infinity schema behavior and native host-power collection not exercised here. Mobile/device Labs excluded from task; only common host/client contract examined.

No production edits; full audit incomplete.

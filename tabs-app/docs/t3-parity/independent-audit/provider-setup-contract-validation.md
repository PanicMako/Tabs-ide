# Provider setup and usage contracts — batch231

Complete providerSetup.ts255 lines, tests53 lines, providerUsageLimits.ts168 lines and full changed hunks reviewed. Existing contracts824 passing tests reused. Tests cover16 credential fields, invalid/oversized fields, unknown auth method/interaction/owner dropping. They do not directly assert callback/handoff, terminal response dimensions/output offsets, or transferred profile identity matching.

Transferred profile schema alone permits differing registration/credential client IDs and arbitrary issuer; selected CodexChatGptAuth.importProfile explicitly rejects client mismatch, unexpected discovered issuer, missing required scope, expired credentials, then validates ID token before persistence. Therefore schema permissiveness alone is not an established import vulnerability. Whole auth service/live OAuth remains separate scope. Return/callback URL strings require consumer validation rather than providing protocol/origin guarantees at this schema layer; prior callback review retained.

Usage change adds optional credentialFingerprint. Selected OpenCode producer hashes the opencode-go namespace and API key using SHA-256. No active web source consumer found by field search; that does not prove application account-switch behavior. No production changes.

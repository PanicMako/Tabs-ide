# MCP credential registry — batch222

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete273line current source across221/222,181line tests and66-addition49-deletion source diff reviewed. Targeted Node24 Vitest6tests passed1.40s; session61006exit0, log /tmp/tabs-audit-mcp-registry.log.

SHA256 lookup over random32byte bearer token, random provider namespace, synchronized issue/touch/resolve/revoke and24hour sliding liveness reviewed. Tests use real Node crypto plus injected clock/fake HTTP server, cover resolve/thread revoke, grants, IPv4/wildcard/unbracketed IPv6 endpoints, expiry, repeated touch and unrelated-thread expiry. Test title only-token-hash does not inspect state, although implementation stores tokenHash rather than raw token.

Explicit capabilities replace browserToolsAvailable fallback; callers passing contradictory values need separate review before policy failure claim. Per-provider-session/revokeAll/global acquire-release helpers and real listening socket address/layer wiring are not exercised. Already bracketed IPv6 names would be double-bracketed by current helper, unlike old guard, but bound HttpServer's actual hostname format is not established as bracketed, so no active runtime defect claimed.

No production edits; full audit remains incomplete.

## Batch223 issuance/layer follow-up

HEAD unchanged. Selected ProviderSessionManager443-500 obtains browser/device settings and builds matching explicit capability set. Credential reuse checks both grants against current settings, rotates otherwise under per-thread prepare lock. This resolves contradictory browser boolean/capability concern for that V2 caller. Legacy ProviderService217 passes neither setting nor explicit grant and receives registry defaults; selected search finds no browser setting handling there, but shipped registry hookup remains separate and no active violation established. Server1037-1057 composition supplies HttpServer outside registry and runtime layers, supporting bound-port endpoint availability in V2 source; no real listener execution performed. Earlier entrypoint split remains open.

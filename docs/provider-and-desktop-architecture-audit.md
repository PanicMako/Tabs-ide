# Tabs provider and desktop architecture audit

Date: September 14, 2026

## Decision

Tabs does not need a total architecture rewrite. Its shell, loopback backend, provider adapters, and isolated Code-OSS views are useful boundaries. The severe development slowdown came from lifecycle and startup-work problems inside those boundaries: stale process trees, a production contracts build on every launch, repeated full-catalog WebSocket broadcasts, large synchronous diagnostic serialization/writes, and too many warm editor sessions.

The implemented direction is progressive readiness with strict process ownership:

1. Paint a static shell animation before JavaScript loads.
2. Hydrate the renderer independently of provider health probes.
3. Connect the backend and publish cached provider inventory.
4. Refresh only enabled providers with bounded concurrency.
5. Create Code-OSS sessions on demand and retain at most two warm sessions.
6. Terminate every dev child and provider runtime when its owner exits.

## Provider architecture

The eleven built-in drivers intentionally use different transports:

| Driver      | Current Tabs integration                                       | Local captured state               |
| ----------- | -------------------------------------------------------------- | ---------------------------------- |
| Antigravity | Google's native ACP binary, with a legacy interactive fallback | Ready, authenticated               |
| Claude      | Claude-specific SDK/CLI adapter                                | Disabled                           |
| Codex       | Codex app-server integration                                   | Ready, authenticated               |
| Copilot     | Native ACP stdio                                               | Ready, authenticated               |
| Cursor      | Native ACP stdio                                               | Installed; `agent about` timed out |
| Droid       | Native ACP output mode                                         | Disabled                           |
| Gemini      | Direct Gemini API provider                                     | Installed; API key missing         |
| Grok        | Native ACP stdio via `grok --no-auto-update agent stdio`       | Ready, authenticated               |
| Kilo        | Local HTTP SDK server                                          | Disabled                           |
| OpenCode    | Local HTTP SDK server                                          | Ready, authenticated               |
| OpenRouter  | Direct API provider                                            | Installed; API key missing         |

These statuses distinguish configuration from implementation failure. A disabled provider should do no startup work; an installed provider with a missing API key should remain visible with an actionable warning; a CLI timeout should not remove other providers.

OpenCode officially exposes `opencode acp`, but the production Tabs adapter currently uses the OpenCode HTTP SDK. Kilo's current CLI reference describes `kilo acp` as a server command with host/port options, so it must not be assumed to have OpenCode's stdin-owned lifecycle. Any transport migration needs provider-specific authenticated journey tests before cutover.

## Antigravity safety and parity

Tabs resolves the official managed Antigravity ACP artifact, launches it with an isolated per-instance profile, scrubs ambient Google/Gemini credential aliases, and validates browser authorization URLs. This is the strongest supportable integration posture, but it is not a promise about Google's future account policy.

The reviewed implementation ports behavior rather than copying T3 Code wholesale:

- bounded protocol payload normalization;
- native question and permission-option projection;
- security-warning propagation;
- size- and MIME-bounded attachments;
- correct subagent lifecycle semantics;
- preservation of interactive resume data.

Tabs' contracts and orchestration model differ from T3 Code, so direct directory replacement would be unsafe.

## Resource-contention fixes

- Desktop Turbo startup uses `--only` for desktop and web, removing the approximately 15-second contracts build from the dev critical path.
- Provider startup probing uses concurrency 2 and 15-second per-source bounds.
- Complete provider arrays are coalesced for 100 ms before WebSocket broadcast; the periodic refresh has one publication path.
- WebSocket logs retain channel/request metadata and payload shape, not entire model/skill catalogs or user content.
- General server log lines are capped at 4,096 characters.
- Failed telemetry delivery backs off exponentially from 5 seconds to a 5-minute ceiling rather than creating a one-request/one-error-per-second loop.
- Code-host diagnostics use a 256 KiB queue and an 8 KiB per-detail bound before asynchronous writes.
- Warm Code-OSS sessions are capped at two, and detached views remain background-throttled.
- OpenCode local servers close after 30 seconds idle and use owned process-group teardown.
- Dev cleanup is limited to processes whose current working directory belongs to this checkout.

## Readiness telemetry

Only observed milestones are emitted:

- shell first paint;
- renderer hydration;
- backend connection ready;
- provider inventory available;
- Code-host session ready;
- provider update received.

No synthetic eight-stage claim or fabricated timing is retained.

## Remaining work that should not block this fix

- Add CI cold/warm startup budgets on representative macOS hardware.
- Investigate Cursor's local `agent about` timeout independently of the other providers.
- Consider deferring optional Code-OSS extensions after measuring their activation cost; preserve a user override.
- Evaluate OpenCode ACP only as a deliberate migration with resume, permissions, cancellation, and authenticated end-to-end tests. Evaluate Kilo against its own current transport contract rather than reusing OpenCode assumptions.

## Primary references

- [Agent Client Protocol overview](https://agentclientprotocol.com/)
- [OpenCode ACP documentation](https://opencode.ai/v2/docs/cli/acp/)
- [Kilo CLI reference](https://kilo.ai/docs/code-with-ai/platforms/cli-reference)
- [xAI Grok headless and ACP usage](https://docs.x.ai/build/cli/headless-scripting)
- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [VS Code extension activation guidance](https://code.visualstudio.com/api/references/activation-events)

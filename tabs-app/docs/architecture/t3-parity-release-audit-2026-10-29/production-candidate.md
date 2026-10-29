# Production candidate provenance

This candidate is based on published Tabs 2.1.0 (`3f6cca778d1225080d6247cb63714cca3758d369`) and integrates the scoped T3 parity patch. Its provider-context and MCP descriptor measurements therefore use candidate-specific values; the earlier 2.0.0 audit snapshot is not a suitable exact ratchet for this source tree.

## Context and MCP descriptor budget

`apps/server/src/provider/AgentContextBudget.test.ts` measures the provider-facing Claude and Codex context plus both the advertised MCP tool list and complete registered tool descriptors. `agentContextBudget.json` records the candidate measurements:

| Measurement                                     | 2.0.0 audit baseline | 2.1.0 candidate | Change |
| ----------------------------------------------- | -------------------: | --------------: | -----: |
| Claude system append                            |          4,174 bytes |     8,000 bytes | +3,826 |
| Codex additional context                        |          6,245 bytes |    10,071 bytes | +3,826 |
| MCP tool names, descriptions, and input schemas |         73,118 bytes |    73,547 bytes |   +429 |
| Complete registered MCP descriptors             |        170,787 bytes |   171,228 bytes |   +441 |

The shared `T3_CODE_ORCHESTRATION_INSTRUCTIONS` grew by 3,826 UTF-8 bytes. The added material gives explicit guidance for child delegation versus top-level thread creation, selecting and preparing workspaces, launch retry behavior, lazy MCP tool discovery, ACP fallback, and showing visuals. Both providers include this shared orchestration guidance, which accounts for the identical context increase.

The candidate preserves the 2.1.0 behavior of returning the complete provider catalog when `orchestrator_capabilities` is called without query controls. It also restores opt-in `search`, `limit`, `offset`, and `includeAll` controls, plus per-provider `totalModels`, `hasMoreModels`, and `nextOffset` metadata. Pages are capped at 100 models; explicit `includeAll: true` returns every model matching the search. Compared with the interim full-catalog candidate measured above, these controls and response fields add 498 bytes to the advertised tool list and 694 bytes to the complete registry. The current total is 429/441 bytes above the historical 2.0.0 budget, respectively; the exact current measurements are ratcheted rather than allowing an unbounded increase.

These values are serialized descriptor and instruction bytes, not model token counts or a claim about actual provider prompt billing. The separate configured-provider evaluation reports provider usage where the adapter exposes it.


## Integration scope and verification

The former audit branch used a 2.0.0 working snapshot. Current main contains 740 subsequent commits. This candidate starts at the published 2.1.0 commit and applies only T3 changes relative to `54cf362ec`, plus the small prerequisites required by that feature set. It does not import the 735-file dirty baseline snapshot. Production version, CodeOSS 1.143 sources, dependency locks, deployment workflows and release identity are unchanged.

The port preserves the current toolbar and closed-by-default card, restores the workspace controls' panel presentation, retains remote worktree-base selection, and carries repository identity through typed legacy/V2 project mapping. Review also added active-run preparation before branch creation, focus restoration on card close, and capability-gated family reads for older remote servers. Snapshot-only idle-child omission retains live lifecycle updates so clients do not keep stale child state; a focused regression covers that behavior.

Current local evidence: workspace typechecks passed across16packages, the full suite passed all18tasks (server7592passed/35skipped), the desktop/server/web build passed4tasks, the main Chromium matrix passed8files/49tests, and native precommit hygiene passed with no native changes. The final late UI guard regressions passed separately and are included in the 49-test browser run. An additional PR-card browser check and the final combined typecheck are running before the build-only remote CI dispatch.

The current-release live tool evaluation independently read only its disposable profile's projection rows. It verified available Codex/GPT-6 Luna discovery, rejection of invalid project-list input, and a valid recovery result containing exactly its own project. No user database, credentials, raw tool outputs or prompts were copied. The call predates the optional capability-query fields; unchanged no-argument compatibility is separately covered by service/registry tests. Historical schema measurements are labeled accordingly.

Remote authorization is restricted to pushing the repair branch and running non-publishing installer builds/smoke checks. Main merges, release tags, release publication and website deployment remain outside authorization. Installer CI results and exact tested commit/run IDs will be recorded after those jobs complete.

# CLI triage findings

Batch296: Full279-line command,218-line prompt and74-line test reviewed. Vitest3 passed1 failed208ms/exit1. Parity test requires tabs-app/.github/triage/PLAYBOOK.md, absent in authoritative checkout; rg found no playbook under root or app .github.

Prompt explicitly calls upstream pingdotgg/t3code the repository, asks to fetch its latest main playbook, clones upstream release tag/main, searches upstream issues and offers upstream issue creation. Tabs-specific changes cannot be diagnosed accurately from an upstream-only clone; fork issue filing is misrouted. References: triagePrompt.ts15,39,49,95,125,202. This is a concrete unadapted fork behavior, independent of whether a human agent later notices the mismatch. No network fetch/post or agent launch performed.

Command writes machine paths/context and prompt into timestamped userdata scratch; only explicitly names secrets directory without reading it. Child has error/exit listeners but no Effect interruption cleanup; real lifecycle and shell escaping remain unverified. PID liveness alone is not daemon identity proof. Tests cover template strings, not interactive launch.

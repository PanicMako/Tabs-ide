# Current production-candidate work

User requires continuing until prerelease validation is complete. Production publication is forbidden. User explicitly authorized pushing ONLY remote `codex/t3-parity-audit-repairs` and dispatching the non-publishing Build Desktop Installers workflow on all four platforms; necessary build-only retries/smoke are in scope. No merge into main, tags, release or deployment.

Current active worktree: `/Users/rushil.dev/.codex/worktrees/t3-parity-production-candidate/tabs`, local branch `codex/t3-parity-production-candidate`, based on production/main `3f6cca778d1225080d6247cb63714cca3758d369` (Tabs2.1.0, CodeOSS1.143.0). Push candidate HEAD to the authorized remote branch name using ordinary non-force refspec. The old audit worktree remains at `/Users/rushil.dev/.codex/worktrees/t3-parity-repairs/tabs` (branch codex/t3-parity-audit-repairs; old2.0.0 snapshot; DO NOT SHIP).

Critical discovery: old audit head80010ca1c diverged740commits from currentmain. Its earlier release recommendation was premature for currentproduction. Only the scoped T3 diff from baseline54cf362ec to old workingtree was ported (115files), NOT the735-file dirty baseline snapshot. Added minimal baseline prerequisites required by T3: new workspace components, sharedbody/provider snapshot helpers/exports, compact MCPschema helper, environmentselector/PRcheckout hook, ProjectScripts/OpenIn panel presentation, typed repositoryidentity+V2/legacy mapping, and capability model search/paging. Workflows, native sources, productionidentity/version and dependency lockfiles are unchanged from2.1.0.14conflicts resolved with semanticpreservation.

Tasks/current evidence:

- Dependencies: `bun install --frozen-lockfile` passed currentlock. Rootcommands from tabs-app.
- Typecheck all16passed at `/tmp/t3-production-typecheck.log` before latest capability paging+focus fixes. Need final rerun.
- Builddesktop/server/web4passed `/tmp/t3-production-build.log` beforelatestcapabilitysource; finalrebuildneeded.
- Fullsuite `/tmp/t3-production-full-tests.log`:17/18passed; onlyAgentContextBudget failed old2.0ratchet. Other server7586passed35skipped. Ratchet nowfixed separately; fullsuite rerunneeded afterfinalsource.
- GitManager/MCP/controlread+schemahelper focused146passed; sharedbody4passed; repoidentity+environmentselector7passed.
- Frontend agent is resolvingcurrentbrowserfixture issues; foundrealEscape focusrestorationbug and fixedChatHeader; isolatedHeader4/scripts5/card1 passed, combinedrunpending.
- MCP agent restoredmissingpaged/searchable discovery supportingexplicitsearch/limit/offset/includeAll=false; noargmustpreserve2.1fullcatalog. Focusedselector/service/toolkit/budget19passed. New exactbudgets8000/10071/73547/171228. +3826sharedproductioninstructionbytespreserved. Servertscpending. No moremodelcallsnecessary.
- One fresh configuredCodex/GPT6Luna currentcandidate toolrun completed, actualresultsverifiedfromONLYownprofile `userdata/statev2.sqlite` dynamic_toolrows:11providersinclCodex/Luna, invalidlimit0schemafailure, validlimit5exactownproject. Actualusagecaptured, no secrets/rawpayloadsrecorded. Correctedharnessandtool-use-live.jsonstaged. Log `/tmp/t3-production-tool-use-live.log`. This run precedednewoptionalcapabilityqueryfields; noargbehaviorpreservedbytests.
- Visualagent owns5productionfrontendfiles+2missingbaselinehelpers+OpenInPicker andrelatedbrowserfixtures; currentlycombinedbrowserrun. Agent`transport_verification` GPT6Luna.
- Agent`mcp_matrix` GPT6Luna ownsMCPservice/capabilitypagingcontracts/handler/helper/tests/budgetdoc, runningservertsc. Earlier7MCP/Gitconflictfilesstaged.
- Agent`paging_verification` GPT6Luna implementingNEW opt-in isolated history-live-benchmark script +JSON only:10ksettledshell actualElectronUIrendercomparisons iffeasible. No modelcalls/prodchanges. Prior typedidentity/mapping+7tests staged.
- Needstage remainingprecisefiles, format/check, finaltests/typecheck/build, inspectdiff, commitcandidate, pushauthorizedbranch, dispatchall4build-onlyCI (gh CLI; connectorhasnoworkflowdispatch tool). CurrentauthPanicMako repo/workflow permsavailable. Repo public.
- Buildworkflow `.github/workflows/build-desktop.yml` onlybuilds/uploadsGitHub artifacts (contentsread/actionsread). Productionmarketingtriggeronlymain/release/ReleaseDesktop completion, notthisworkflow. Releaseworkflowtriggerstags/manual. Don'truneitherrelease/deploy.
- AfterbuildCIall4green, run buildworkflow smoke-onlymode using `artifact_run_id=<buildID>` and smoke_platforms win-x64,linux-x64,mac asappropriate; inspectactualpackagedfatCodeOSS/installerassets. Existingbuildwindowsinline upgrade smoke included. Needrecordexactrun/head/artifactmatrix.
- Oldfullauditreport+native/liveproofarehistorical; currentREADMEtophasexplicitbaselinecorrection. Currentproductioncandidate.md should containcurrentproof/limits andbudgets; production-work-plan.mdisprogressnotfinalverdict.
- No push/remoteCI has happened yet at this checkpoint. No originalusercheckout or Antigravitycheckout changed. Keep oldauditworktree forprovenance; don'tarchiveit whileignorednativebuild/evidence needed.

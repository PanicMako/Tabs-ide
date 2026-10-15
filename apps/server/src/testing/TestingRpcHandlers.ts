import { TestingRpcs, TestingRequestError, WS_METHODS } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { TestingService } from "./TestingService.ts";

const group = RpcGroup.make(...TestingRpcs);
const invoke = (method: () => unknown) =>
  Effect.tryPromise({
    try: async () =>
      Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(await method()))),
    catch: (cause) =>
      new TestingRequestError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });

export const testingRpcHandlers = (service: TestingService) =>
  group.of({
    [WS_METHODS.testingGetStatus]: (input) => invoke(() => service.getStatus(input)),
    [WS_METHODS.testingGetLocatorLibrary]: (input) =>
      invoke(() => service.getLocatorLibrary(input)),
    [WS_METHODS.testingSetDiscoveryExperience]: (input) =>
      invoke(() => service.setDiscoveryExperience(input)),
    [WS_METHODS.testingGetCaseIdPolicy]: (input) => invoke(() => service.getCaseIdPolicy(input)),
    [WS_METHODS.testingSetCaseIdPolicy]: (input) => invoke(() => service.setCaseIdPolicy(input)),
    [WS_METHODS.testingGetTestInventory]: (input) => invoke(() => service.getTestInventory(input)),
    [WS_METHODS.testingStartLocatorDiscovery]: (input) =>
      invoke(() => service.startLocatorDiscovery(input)),
    [WS_METHODS.testingNavigateLocatorDiscovery]: (input) =>
      invoke(() => service.navigateLocatorDiscovery(input)),
    [WS_METHODS.testingCaptureLocatorPage]: (input) =>
      invoke(() => service.captureLocatorPage(input)),
    [WS_METHODS.testingFinishLocatorDiscovery]: (input) =>
      invoke(() => service.finishLocatorDiscovery(input)),
    [WS_METHODS.testingCancelLocatorDiscovery]: (input) =>
      invoke(() => service.cancelLocatorDiscovery(input)),
    [WS_METHODS.testingReviewLocatorEntry]: (input) =>
      invoke(() => service.reviewLocatorEntry(input)),
    [WS_METHODS.testingUpdateLocatorPage]: (input) =>
      invoke(() => service.updateLocatorPage(input)),
    [WS_METHODS.testingSetLocatorPageSelection]: (input) =>
      invoke(() => service.setLocatorPageSelection(input)),
    [WS_METHODS.testingDeleteLocatorPage]: (input) =>
      invoke(() => service.deleteLocatorPage(input)),
    [WS_METHODS.testingUpdatePageObjectCode]: (input) =>
      invoke(() => service.updatePageObjectCode(input)),
    [WS_METHODS.testingPreviewLocatorRepositoryWrite]: (input) =>
      invoke(() => service.previewLocatorRepositoryWrite(input)),
    [WS_METHODS.testingApplyLocatorRepositoryWrite]: (input) =>
      invoke(() => service.applyLocatorRepositoryWrite(input)),
    [WS_METHODS.testingPreviewLocatorSync]: (input) =>
      invoke(() => service.previewLocatorSync(input)),
    [WS_METHODS.testingResolveLocatorSync]: (input) =>
      invoke(() => service.resolveLocatorSync(input)),
    [WS_METHODS.testingDisconnectLocatorFolder]: (input) =>
      invoke(() => service.disconnectLocatorFolder(input)),
    [WS_METHODS.testingIndexLocatorFolder]: (input) =>
      invoke(() => service.indexLocatorFolder(input)),
    [WS_METHODS.testingVerifyLocators]: (input) => invoke(() => service.verifyLocators(input)),
    [WS_METHODS.testingImportUserStory]: (input) => invoke(() => service.importUserStory(input)),
    [WS_METHODS.testingStartAuthCapture]: (input) => invoke(() => service.startAuthCapture(input)),
    [WS_METHODS.testingFinishAuthCapture]: (input) =>
      invoke(() => service.finishAuthCapture(input)),
    [WS_METHODS.testingStartExploration]: (input) => invoke(() => service.startExploration(input)),
    [WS_METHODS.testingImportWorkbook]: (input) => invoke(() => service.importWorkbook(input)),
    [WS_METHODS.testingListCases]: (input) => invoke(() => service.listCases(input)),
    [WS_METHODS.testingCreateCase]: (input) => invoke(() => service.createCase(input)),
    [WS_METHODS.testingReviewCase]: (input) => invoke(() => service.reviewCase(input)),
    [WS_METHODS.testingDeleteCase]: (input) => invoke(() => service.deleteCase(input)),
    [WS_METHODS.testingUpdateCaseGroup]: (input) => invoke(() => service.updateCaseGroup(input)),
    [WS_METHODS.testingCreateCaseGroup]: (input) => invoke(() => service.createCaseGroup(input)),
    [WS_METHODS.testingDeleteCaseGroup]: (input) => invoke(() => service.deleteCaseGroup(input)),
    [WS_METHODS.testingGenerateScenarios]: (input) =>
      invoke(() => service.generateScenarios(input)),
    [WS_METHODS.testingClearGraph]: (input) => invoke(() => service.clearGraph(input)),
    [WS_METHODS.testingGenerateTests]: (input) => invoke(() => service.generateTests(input)),
    [WS_METHODS.testingListGenerationJobs]: (input) =>
      invoke(() => service.listGenerationJobs(input)),
    [WS_METHODS.testingCancelGenerationJob]: (input) =>
      invoke(() => service.cancelGenerationJob(input)),
    [WS_METHODS.testingReadArtifact]: (input) => invoke(() => service.readArtifact(input)),
    [WS_METHODS.testingRunTests]: (input) => invoke(() => service.runTests(input)),
    [WS_METHODS.testingCancelExecutionRun]: (input) =>
      invoke(() => service.cancelExecutionRun(input)),
    [WS_METHODS.testingListExecutionRuns]: (input) =>
      invoke(() => service.listExecutionRuns(input)),
    [WS_METHODS.testingDecideHealingProposal]: (input) =>
      invoke(() => service.decideHealingProposal(input)),
    [WS_METHODS.testingCreateSchedule]: (input) => invoke(() => service.createSchedule(input)),
    [WS_METHODS.testingListSchedules]: (input) => invoke(() => service.listSchedules(input)),
    [WS_METHODS.testingGenerateReport]: (input) => invoke(() => service.generateReport(input)),
    [WS_METHODS.testingGetTraceability]: (input) => invoke(() => service.getTraceability(input)),
    [WS_METHODS.testingDraftBug]: (input) => invoke(() => service.draftBug(input)),
    [WS_METHODS.testingGetGraphExplorer]: (input) => invoke(() => service.getGraphExplorer(input)),
    [WS_METHODS.testingTriageFailure]: (input) => invoke(() => service.triageFailure(input)),
  });

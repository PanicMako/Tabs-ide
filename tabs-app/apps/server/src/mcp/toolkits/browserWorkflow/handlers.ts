import { isDeepStrictEqual } from "node:util";
import {
  BrowserWorkflowHostResult,
  type BrowserWorkflowReport,
  BrowserWorkflowStage,
  OrchestratorMcpFailure,
  PartnerCenterStatusAuthorization,
  StoreSubmissionId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerSecretStore } from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { hasActiveMcpPreviewSession } from "../../McpSessionRegistry.ts";
import { PreviewAutomationBroker } from "../../PreviewAutomationBroker.ts";
import { getPartnerCenterSubmissionStatus, PartnerCenterError } from "./partnerCenter.ts";
import { readPartnerCenterConnection } from "./partnerCenterConnection.ts";
import { PreviewWorkflowToolkit } from "./tools.ts";
import {
  BrowserWorkflowError,
  makeBrowserWorkflows,
  readBrowserWorkflowResult,
} from "./workflow.ts";

const decodeResult = Schema.decodeUnknownEffect(BrowserWorkflowHostResult);
const failure = (message: string) =>
  new OrchestratorMcpFailure({
    code: "invalid_request",
    message,
  });

export const layer = PreviewWorkflowToolkit.toLayer({
  preview_partner_center_status: ({ workflowId, applicationId }) =>
    Effect.gen(function* () {
      const scope = yield* Invocation.requireThreadMcpCapability("preview").pipe(
        Effect.mapError((error) => failure(error.message)),
      );
      const requireActiveSession = Effect.suspend(() =>
        hasActiveMcpPreviewSession(scope.thread)
          ? Effect.void
          : Effect.fail(failure("This provider session no longer owns the Partner Center lookup.")),
      );
      const config = yield* ServerConfig.ServerConfig;
      const broker = yield* PreviewAutomationBroker;
      const saved = yield* Effect.tryPromise({
        try: () =>
          readBrowserWorkflowResult(
            config.stateDir,
            { environmentId: scope.environmentId, threadId: scope.thread.threadId },
            { workflowId, stage: "ready_to_upload" },
          ),
        catch: () => failure("Open the saved Partner Center workflow in its original thread."),
      });
      if (
        !URL.canParse(saved.definition.url) ||
        new URL(saved.definition.url).origin !== "https://partner.microsoft.com" ||
        !Schema.is(StoreSubmissionId)(saved.definition.resourceId)
      )
        return yield* failure(
          "Choose a saved Partner Center workflow with its exact Store submission ID.",
        );
      const credential = yield* readPartnerCenterConnection.pipe(
        Effect.mapError((error) => failure(error.message)),
      );
      if (!credential)
        return yield* failure("Connect Partner Center in Tabs Browser Profiles settings.");
      const { tenantId, clientId } = credential;
      const input = {
        workflowId,
        target: saved.target,
        definition: saved.definition,
        applicationId,
        tenantId,
        clientId,
      };
      let connectionId: string | undefined;
      yield* requireActiveSession;
      const checked = yield* broker
        .invoke({
          scope,
          tabId: saved.target.tabId,
          workflowHostKey: saved.target.hostKey,
          operation: "partnerCenterStatus",
          updateCurrentTab: false,
          input,
          onConnection: (id) => {
            connectionId = id;
          },
        })
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(PartnerCenterStatusAuthorization)),
          Effect.mapError(() =>
            failure("Open and approve access to the original Partner Center draft."),
          ),
        );
      const submissionId = saved.definition.resourceId;
      const { approval } = checked;
      if (
        approval.workflowId !== workflowId ||
        approval.applicationId !== applicationId ||
        approval.submissionId !== submissionId ||
        approval.tenantId !== tenantId ||
        approval.clientId !== clientId
      )
        return yield* failure(
          "The Partner Center approval is for a different submission or connection.",
        );
      if (checked.status === "approval_required")
        return { status: "approval_required", workflowId, applicationId, submissionId } as const;

      const checkConnection = readPartnerCenterConnection.pipe(
        Effect.mapError((error) => failure(error.message)),
        Effect.flatMap((current) =>
          current?.tenantId === tenantId &&
          current.clientId === clientId &&
          current.clientSecret === credential.clientSecret
            ? Effect.void
            : Effect.fail(failure("The Partner Center connection changed. Request a new lookup.")),
        ),
      );
      const requireConnectionId = connectionId;
      if (!requireConnectionId)
        return yield* failure("Open the original desktop browser before checking Store status.");
      const checkLookup = Effect.gen(function* () {
        const latest = yield* broker
          .invoke({
            scope,
            tabId: saved.target.tabId,
            workflowHostKey: saved.target.hostKey,
            requireConnectionId,
            operation: "partnerCenterStatus",
            updateCurrentTab: false,
            input: { ...input, verifyApprovalId: approval.id },
          })
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(PartnerCenterStatusAuthorization)),
            Effect.mapError(() =>
              failure("The approved Store draft changed. Review the lookup again."),
            ),
          );
        if (latest.status !== "approved" || !isDeepStrictEqual(latest.approval, approval))
          return yield* failure("The approved Store draft changed. Review the lookup again.");
        yield* checkConnection;
        yield* requireActiveSession;
      });
      const secrets = yield* ServerSecretStore;
      const beforeSubmission = checkLookup.pipe(Effect.provideService(ServerSecretStore, secrets));
      yield* checkConnection;
      yield* requireActiveSession;
      const receipt = yield* Effect.tryPromise({
        try: (signal) =>
          getPartnerCenterSubmissionStatus(
            {
              credential,
              approvedTarget: {
                applicationId: approval.applicationId,
                submissionId: approval.submissionId,
              },
              target: { applicationId, submissionId },
            },
            {
              signal,
              beforeSubmission: async (lookupSignal) => {
                try {
                  await Effect.runPromise(beforeSubmission, { signal: lookupSignal });
                } catch {
                  if (lookupSignal.aborted)
                    throw new PartnerCenterError(signal.aborted ? "cancelled" : "timeout");
                  throw new PartnerCenterError("lookup-approval-changed");
                }
              },
            },
          ),
        catch: (error) =>
          failure(
            error instanceof PartnerCenterError
              ? error.message
              : "The Partner Center lookup failed.",
          ),
      });
      yield* checkLookup;
      const { status: storeStatus, packageVersions } = receipt;
      return {
        status: "verified",
        evidence: "connector",
        workflowId,
        browserStage: saved.stage,
        applicationId,
        submissionId,
        storeStatus,
        observedAt: new Date().toISOString(),
        ...(packageVersions ? { packageVersions: packageVersions.slice(0, 50) } : {}),
      } as const;
    }),
  preview_workflow: (input) =>
    Effect.gen(function* () {
      const scope = yield* Invocation.requireThreadMcpCapability("preview").pipe(
        Effect.mapError((error) => failure(error.message)),
      );
      const config = yield* ServerConfig.ServerConfig;
      const broker = yield* PreviewAutomationBroker;
      if (input.action === "arm") {
        if (!input.tabId || !input.profileId || !input.definition)
          return yield* failure(
            "Arming a browser workflow requires tabId, profileId and definition.",
          );
      } else if (!input.workflowId) {
        return yield* failure("Use the workflowId returned when this browser workflow was armed.");
      }
      if (input.action === "watch" && !input.until) {
        return yield* failure("Choose the lifecycle stage to watch for.");
      }

      const run = () =>
        Effect.tryPromise({
          try: (signal) => {
            let connectionId: string | undefined;
            const workflows = makeBrowserWorkflows(
              config.stateDir,
              {
                environmentId: scope.environmentId,
                threadId: scope.thread.threadId,
              },
              (request, tabId) =>
                Effect.runPromise(
                  broker
                    .invoke({
                      scope,
                      tabId,
                      operation: "browserWorkflow",
                      input: request,
                      updateCurrentTab: false,
                      ...(request.definition.readOnly && request.target
                        ? { workflowHostKey: request.target.hostKey }
                        : {}),
                      onConnection: (id) => {
                        connectionId = id;
                      },
                      ...(connectionId === undefined ? {} : { requireConnectionId: connectionId }),
                    })
                    .pipe(
                      Effect.flatMap(decodeResult),
                      Effect.orElseSucceed(() => undefined),
                    ),
                  { signal },
                ),
            );
            if (input.action === "arm") {
              return workflows.arm({
                tabId: input.tabId!,
                profileId: input.profileId!,
                definition: input.definition!,
              });
            }
            const id = input.workflowId!;
            if (input.action === "watch") return workflows.watch(id, input.until!, input.refresh);
            if (input.action === "unwatch") return workflows.unwatch(id);
            return workflows.advance(
              id,
              input.action === "check" && input.refresh ? "refresh" : input.action,
              input.action === "check" ? input.until : undefined,
            );
          },
          catch: (cause) =>
            failure(
              cause instanceof BrowserWorkflowError
                ? cause.message
                : "The workflow journal could not be read or saved. Check the draft before retrying.",
            ),
        });

      if (input.action !== "check" || !input.until) return yield* run();
      const deadline = Date.now() + (input.timeoutMs ?? 15_000);
      const stages = BrowserWorkflowStage.literals;
      let last: BrowserWorkflowReport | undefined;
      while (Date.now() < deadline) {
        // A monitoring deadline cancels this read without timing out and evicting
        // the desktop broker connection used by other browser operations.
        const sample = yield* run().pipe(Effect.timeoutOption(Math.max(1, deadline - Date.now())));
        if (Option.isNone(sample)) break;
        last = sample.value;
        if (
          last.phase === "approval_required" ||
          last.phase === "manual_submit" ||
          last.phase === "paused" ||
          last.phase === "unobservable" ||
          (last.phase !== "uncertain" &&
            stages.indexOf(last.lastVerified.stage) >= stages.indexOf(input.until))
        ) {
          return last;
        }
        const remaining = deadline - Date.now();
        if (remaining > 0) yield* Effect.sleep(Math.min(1000, remaining));
      }
      if (!last) return yield* failure("No browser observation completed before the check ended.");
      return {
        ...last,
        reason: last.reason ?? `This check ended before the page showed ${input.until}.`,
      };
    }),
});

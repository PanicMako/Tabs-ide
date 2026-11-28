import {
  BrowserWorkflowDefinition,
  BrowserWorkflowReport,
  BrowserWorkflowStage,
  BrowserWorkflowTarget,
  OrchestratorMcpFailure,
  PartnerCenterStatusApproval,
  StoreApplicationId,
  StoreSubmissionId,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as ServerConfig from "../../../config.ts";
import { ServerSecretStore } from "../../../auth/ServerSecretStore.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { PreviewAutomationBroker } from "../../PreviewAutomationBroker.ts";

export const PreviewWorkflowToolkit = Toolkit.make(
  Tool.make("preview_workflow", {
    description:
      "Track a draft's visible lifecycle status or guard Upload and a consequential Submit. Arm with the exact tabId, profileId and definition. " +
      "For the draft URL, use the URL returned by preview_status on the original approved tab or supply the exact draft URL. " +
      "Use preview_snapshot with findText for exact visible draft ID, status and breakpoint values. Use each matched selector for its field. An ambiguous or unobservable result needs review before arming. " +
      "For a status or receipt page, set definition.readOnly to true and supply one or more distinct exact visible status labels. Omit all action selectors and the breakpoint. " +
      "For read-only workflows, use check with optional refresh, enter, watch or unwatch. For a guarded workflow, provide submitSelector, breakpoint and labels for uploaded, submitted, certified and published. " +
      "For Upload, provide states.ready_to_upload and exactly one selector. Use uploadSelector for the button that uploads a staged file. " +
      "Use uploadInputSelector for the exact empty file input on a site that uploads on file selection. " +
      "Report an unobservable condition and correct selectors of the same kind before rearming. Keep the workflowId. " +
      "On approval_required, direct the user to approve the matching action on the original draft. " +
      "With uploadInputSelector, have the user choose a file and approve it in the browser, then call upload. File selection stays in the browser. " +
      "On manual_submit, direct the user to submit on the original draft and check its status. Agent Submit requires a site submission key. " +
      'Upload and Submit recheck approval and breakpoint. Check observes the page status and reconciles uncertain dispatch only from a later status on the same draft. If an action stays uncertain, ask the user to choose "It sent" or "It didn\'t send" in the work log; the agent cannot release it. ' +
      "Watch with until checks the original approved draft after this turn. Unwatch stops it. " +
      "Resume after review, a clear condition and approval. Enter reopens the original result.",
    parameters: Schema.Struct({
      action: Schema.Literals([
        "arm",
        "upload",
        "submit",
        "check",
        "resume",
        "enter",
        "watch",
        "unwatch",
      ]).annotate({
        description: "Choose what to do with the browser workflow.",
      }),
      tabId: Schema.optional(BrowserWorkflowTarget.fields.tabId).annotate({
        description: "For arm, the exact attached browser tab ID.",
      }),
      profileId: Schema.optional(BrowserWorkflowTarget.fields.profileId).annotate({
        description: "For arm, the profile ID from the user's tab attachment.",
      }),
      definition: Schema.optional(BrowserWorkflowDefinition).annotate({
        description:
          "For arm, the draft URL, identity and status selectors, exact labels and workflow mode.",
      }),
      workflowId: Schema.optional(BrowserWorkflowReport.fields.workflowId).annotate({
        description: "The ID returned by arm. Required for every subsequent action.",
      }),
      until: Schema.optional(BrowserWorkflowStage).annotate({
        description:
          "The lifecycle stage to wait for with check or watch. Required for watch. For a read-only workflow, map the goal in states if the saved stage has yet to reach it.",
      }),
      refresh: Schema.optional(Schema.Boolean).annotate({
        description:
          "For check or watch when status is static, allow a GET refresh of the approved draft.",
      }),
      timeoutMs: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30_000 })),
      ).annotate({
        description: "Maximum wait for check with until. Defaults to 15 seconds.",
      }),
    }),
    success: BrowserWorkflowReport,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext, PreviewAutomationBroker, ServerConfig.ServerConfig],
  })
    .annotate(Tool.Title, "Track a browser result")
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Destructive, true),
  Tool.make("preview_partner_center_status", {
    description:
      "Read one Microsoft Store submission through the configured Partner Center connection. Use the saved workflow ID for the exact open Partner Center draft or read-only receipt and its Store application ID. Ask the user to approve this separate lookup in the browser when approval is required. The receipt reports the raw Store status and time.",
    parameters: Schema.Struct({
      workflowId: PartnerCenterStatusApproval.fields.workflowId,
      applicationId: StoreApplicationId,
    }),
    success: Schema.Union([
      Schema.Struct({
        status: Schema.Literal("approval_required"),
        workflowId: PartnerCenterStatusApproval.fields.workflowId,
        applicationId: StoreApplicationId,
        submissionId: StoreSubmissionId,
      }),
      Schema.Struct({
        status: Schema.Literal("verified"),
        evidence: Schema.Literal("connector"),
        workflowId: PartnerCenterStatusApproval.fields.workflowId,
        browserStage: BrowserWorkflowStage,
        applicationId: StoreApplicationId,
        submissionId: StoreSubmissionId,
        storeStatus: Schema.String,
        observedAt: Schema.String,
        packageVersions: Schema.optional(
          Schema.Array(
            Schema.Struct({
              version: Schema.String,
              fileStatus: Schema.Literals(["None", "PendingUpload", "Uploaded", "PendingDelete"]),
            }),
          ),
        ),
      }),
    ]),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      McpInvocationContext,
      PreviewAutomationBroker,
      ServerConfig.ServerConfig,
      ServerSecretStore,
    ],
  })
    .annotate(Tool.Title, "Verify Microsoft Store status")
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Readonly, true),
);

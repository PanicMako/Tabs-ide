import {
  FigmaAttachmentId,
  FigmaCanvasAuthorization,
  FigmaCanvasTarget,
  FigmaFrameSpec,
  FigmaNodeId,
  FigmaOperationId,
  OrchestratorMcpFailure,
  PreviewTabId,
  type FigmaCanvasBrowserRequest,
  type FigmaCanvasReceipt,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { Tool, Toolkit } from "effect/unstable/ai";
import { isDeepStrictEqual } from "node:util";

import { ServerConfig } from "../../../config.ts";
import { ProviderSessionManagerV2 } from "../../../orchestration-v2/ProviderSessionManager.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { PreviewAutomationBroker } from "../../PreviewAutomationBroker.ts";
import { FigmaConnectorError, makeFigmaMcp } from "./figmaMcp.ts";
import { buildFigmaFrameProbe, buildFigmaFrameScript } from "./frameScript.ts";
import { figmaCanvasJournal, figmaOperationId } from "./journal.ts";

export const FigmaCanvasToolkit = Toolkit.make(
  Tool.make("preview_figma_frame", {
    description:
      "Create one editable Figma frame with an editable text layer. Use the exact tab ID, profile ID and saved attachment ID from an attached Figma Design parent node. Uses the official signed-in Figma connection named figma in the originating Codex profile. The browser displays a one-use approval for this frame. Retry the same request to check an uncertain write and recover the verified frame.",
    parameters: Schema.Struct({
      tabId: PreviewTabId,
      profileId: FigmaCanvasTarget.fields.profileId,
      attachmentId: FigmaAttachmentId,
      frame: FigmaFrameSpec,
    }),
    success: Schema.Union([
      Schema.Struct({
        status: Schema.Literals(["approval_required", "uncertain"]),
        operationId: FigmaOperationId,
        reason: Schema.String,
      }),
      Schema.Struct({
        status: Schema.Literal("verified"),
        operationId: FigmaOperationId,
        frameNodeId: FigmaNodeId,
        textNodeId: FigmaNodeId,
        verifiedAt: Schema.String,
      }),
    ]),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      Invocation.McpInvocationContext,
      PreviewAutomationBroker,
      ProviderSessionManagerV2,
      ServerConfig,
    ],
  })
    .annotate(Tool.Title, "Create an editable Figma frame")
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Destructive, true),
);

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const decodeTarget = Schema.decodeUnknownSync(FigmaCanvasTarget);
const decodeAuthorization = Schema.decodeUnknownSync(FigmaCanvasAuthorization);

export const layer = FigmaCanvasToolkit.toLayer({
  preview_figma_frame: (input) =>
    Effect.gen(function* () {
      const scope = yield* Invocation.requireThreadMcpCapability("preview").pipe(
        Effect.mapError((error) => failure(error.message)),
      );
      const config = yield* ServerConfig;
      const broker = yield* PreviewAutomationBroker;
      const sessions = yield* ProviderSessionManagerV2;
      const operationScope = yield* Effect.scope;

      return yield* Effect.tryPromise({
        try: async (signal) => {
          let connectionId: string | undefined;
          const requestBrowser = (request: FigmaCanvasBrowserRequest, hostKey?: string) =>
            Effect.runPromise(
              broker.invoke({
                scope,
                operation: "figmaCanvas",
                tabId: input.tabId,
                input: request,
                updateCurrentTab: false,
                onConnection: (id) => {
                  connectionId = id;
                },
                ...(connectionId ? { requireConnectionId: connectionId } : {}),
                ...(hostKey ? { workflowHostKey: hostKey } : {}),
              }),
              { signal },
            );
          const inspect = async (hostKey?: string) => {
            try {
              return decodeTarget(
                await requestBrowser(
                  {
                    action: "inspect",
                    attachmentId: input.attachmentId,
                    profileId: input.profileId,
                  },
                  hostKey,
                ),
              );
            } catch {
              throw new FigmaConnectorError(
                "Open the exact attached Figma Design parent node and approve its browser profile.",
              );
            }
          };
          const target = await inspect();
          if (
            target.tabId !== input.tabId ||
            target.profileId !== input.profileId ||
            target.attachmentId !== input.attachmentId
          )
            throw new FigmaConnectorError("The current Figma attachment differs from the request.");
          const connection = await Effect.runPromise(
            sessions
              .figmaMcpConnection(scope.thread)
              .pipe(Effect.provideService(Scope.Scope, operationScope)),
            { signal },
          );
          if (!connection)
            throw new FigmaConnectorError(
              "Open the approved Figma attachment in a running Codex thread with a Figma connection.",
            );
          const owner = { environmentId: scope.environmentId, threadId: scope.thread.threadId };
          const operationId = figmaOperationId(owner, target, input.frame);
          const journal = figmaCanvasJournal(config.stateDir, operationId);
          const mcp = makeFigmaMcp(connection, signal);
          const email = await mcp.whoami();
          const known = await journal.state(owner, email);
          if (known && !isDeepStrictEqual(known.target, target))
            throw new FigmaConnectorError("Open the exact original Figma attachment.");
          const scriptInput = { ...input.frame, parentNodeId: target.nodeId, operationId };
          const report = ({
            frameNodeId,
            textNodeId,
            verifiedAt,
          }: {
            frameNodeId: string;
            textNodeId: string;
            verifiedAt: string;
          }) => ({ status: "verified", operationId, frameNodeId, textNodeId, verifiedAt }) as const;
          const checkTarget = async () => {
            if (!isDeepStrictEqual(await inspect(target.hostKey), target))
              throw new FigmaConnectorError("The approved Figma file or parent node changed.");
          };
          let reserved = known !== undefined;
          try {
            let approval: (typeof FigmaCanvasAuthorization.Type)["approval"] | undefined;
            if (!known) {
              const approved = { target, operationId, email, frame: input.frame };
              let decision: typeof FigmaCanvasAuthorization.Type;
              try {
                decision = decodeAuthorization(
                  await requestBrowser({ action: "authorize", ...approved }, target.hostKey),
                );
              } catch {
                throw new FigmaConnectorError(
                  "Review the Figma frame in its exact attached browser tab.",
                );
              }
              const { id: _id, ...receipt } = decision.approval;
              if (!isDeepStrictEqual(receipt, approved))
                throw new FigmaConnectorError(
                  "The approval belongs to a different Figma frame or account.",
                );
              if (decision.status === "approval_required")
                return {
                  status: "approval_required",
                  operationId,
                  reason: "Review the account, parent and frame in the attached Figma tab.",
                } as const;
              approval = decision.approval;
            }
            const runScript = await mcp.open(target.fileKey, email);
            const probe = () =>
              runScript(buildFigmaFrameProbe(scriptInput), false, target.nodeId, checkTarget);
            let placed: Awaited<ReturnType<typeof runScript>> | undefined;
            if (approval) {
              const granted = approval;
              placed = await runScript(
                buildFigmaFrameScript(scriptInput),
                true,
                target.nodeId,
                async () => {
                  const acquired = await journal.reserve(owner, target, email);
                  reserved = true;
                  if (!acquired)
                    throw new FigmaConnectorError(
                      "An earlier Figma write is awaiting verification.",
                    );
                  const ready = await requestBrowser(
                    { action: "dispatch", approval: granted },
                    target.hostKey,
                  ).catch(() => false);
                  if (ready !== true) {
                    await journal.clearUnsentReservation();
                    reserved = false;
                    throw new FigmaConnectorError(
                      "Browser control changed. Request a fresh Figma approval.",
                    );
                  }
                },
              );
            }
            const observed = await probe();
            if (!observed || (approval && !isDeepStrictEqual(placed, observed)))
              throw new FigmaConnectorError(
                "Figma did not independently confirm the editable frame.",
              );
            await checkTarget();
            const matchingReceipt = (receipt: FigmaCanvasReceipt) =>
              receipt.frameNodeId === observed.frameNodeId &&
              receipt.textNodeId === observed.textNodeId;
            if (known?.receipt) {
              if (!matchingReceipt(known.receipt))
                throw new FigmaConnectorError("The verified Figma frame or text changed.");
              return report(known.receipt);
            }
            const receipt = { target, ...observed, verifiedAt: new Date().toISOString() };
            if (await journal.saveReceipt(receipt)) return report(receipt);

            // Concurrent recovery may already have published the same receipt.
            const saved = (await journal.state(owner, email))?.receipt;
            if (!saved || !matchingReceipt(saved))
              throw new FigmaConnectorError("The Figma receipt changed during verification.");
            return report(saved);
          } catch (error) {
            if (reserved)
              return {
                status: "uncertain",
                operationId,
                reason: known?.receipt
                  ? "Tabs could not reverify the saved Figma result. Check the frame and text in the approved parent."
                  : "Frame creation is awaiting a verified result. Recheck the same operation in the approved Figma parent before requesting another write.",
              } as const;
            throw error;
          }
        },
        catch: (error) =>
          failure(
            error instanceof FigmaConnectorError
              ? error.message
              : "The Figma connection or operation journal was unavailable.",
          ),
      });
    }).pipe(Effect.scoped),
});

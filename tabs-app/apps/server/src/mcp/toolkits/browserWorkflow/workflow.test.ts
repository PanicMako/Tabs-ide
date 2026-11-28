import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  BrowserWorkflowBrowserRequest,
  BrowserWorkflowDefinition,
  BrowserWorkflowReport,
  EnvironmentId,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type BrowserWorkflowPageResult,
  type BrowserWorkflowHostResult,
  type BrowserWorkflowReceipt,
  type BrowserWorkflowStage,
} from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { expect, test, vi } from "vitest";

// Exercise the desktop implementation on the page. Its DOM types belong to the desktop project.
const guestModule = new URL("../../../../../desktop/src/browserWorkflowPage.ts", import.meta.url);
type LocalUpload = { name: string; type: string; base64: string };
const {
  browserWorkflowPageScript,
}: {
  browserWorkflowPageScript: (
    definition: BrowserWorkflowDefinition,
    submit: boolean,
    statusOnly?: boolean,
    approval?: { currentId?: string; nextId?: string },
    action?: "upload" | "submit",
    localUpload?: LocalUpload,
  ) => string;
} = await import(guestModule.href);
import { startBrowserSubmission } from "../../../../scripts/fixtures/browserSubmission.ts";
import * as ServerConfig from "../../../config.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Broker from "../../PreviewAutomationBroker.ts";
import { pollBrowserWorkflowWatches } from "./watchWorker.ts";
import {
  listBrowserWorkflowWatches,
  makeBrowserWorkflows,
  readBrowserWorkflowResult,
  reconcileBrowserWorkflowSubmission,
  resolveBrowserWorkflowPending,
} from "./workflow.ts";

const environmentId = EnvironmentId.make("workflow-test-env");
const threadId = ThreadId.make("workflow-test-thread");
const tabId = PreviewTabId.make("agents-surface-draft");
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "workflow-test", version: "1.0.0" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "workflow-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

// Generic MCP registration captures the ambient context. Name the services this
// fixture supplies so each simulated broker restart gets a new scoped layer.
const mcpLayer = McpHttpServer.layerPreviewToolkit.pipe(
  Layer.provideMerge(McpHttpServer.layerMcpServer),
  Layer.provideMerge(Broker.layer),
) as Layer.Layer<
  McpServer.McpServer | Broker.PreviewAutomationBroker,
  unknown,
  ServerConfig.ServerConfig | Layer.Success<typeof NodeServices.layer>
>;

const call = (args: object, session: string, thread = threadId) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server.callTool({ name: "preview_workflow", arguments: args }).pipe(
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provideService(Invocation.McpInvocationContext, {
        environmentId,
        thread: {
          threadId: thread,
          providerSessionId: session,
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        requestNamespace: session,
        capabilities: new Set(["preview"] as const),
        client: undefined,
        issuedAt: 0,
      }),
    );
  });

const decodeReport = Schema.decodeUnknownSync(BrowserWorkflowReport);
const decodeRequest = Schema.decodeUnknownSync(BrowserWorkflowBrowserRequest);
const report = (result: typeof McpSchema.CallToolResult.Type) => {
  expect(result.isError, JSON.stringify(result.content)).toBe(false);
  return decodeReport(result.structuredContent);
};

const serve = (
  page: Page,
  profileId: string,
  options: {
    dropAfterSubmit?: boolean;
    missFirstStatusOnlyRead?: boolean;
    turnWarningOnBeforeSubmit?: boolean;
    isSubmissionApproved?: () => boolean;
    resolveCurrentDraft?: boolean;
    onRequest?: (request: BrowserWorkflowBrowserRequest) => void;
    localUpload?: LocalUpload;
  } = {},
) =>
  Effect.gen(function* () {
    let dropped = false;
    let missStatusOnlyRead = options.missFirstStatusOnlyRead;
    const cdp = yield* Effect.promise(() => page.context().newCDPSession(page));
    const broker = yield* Broker.PreviewAutomationBroker;
    const connected = yield* Deferred.make<void>();
    const clientId = "workflow-test-host";
    const stream = yield* broker.connect({
      clientId,
      environmentId,
      supportedOperations: ["browserWorkflow"],
    });
    yield* stream.pipe(
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          if (event.type === "connected") {
            yield* broker.focusHost({
              clientId,
              environmentId,
              connectionId: event.connectionId,
              focused: false,
              liveTabs: [{ threadId, tabId, workflowHostKey: `desktop-${profileId}` }],
            });
            yield* Deferred.succeed(connected, undefined);
            return false;
          }
          expect(event.request.operation).toBe("browserWorkflow");
          expect(event.request.tabId).toBe(tabId);
          const input = decodeRequest(event.request.input);
          if (options.localUpload) expect(event.request.input).toEqual(input);
          options.onRequest?.(input);
          expect(input.workflowId !== undefined).toBe(input.target !== undefined);
          const target = {
            projectId: "test-project",
            tabId,
            profileId,
            hostKey: `desktop-${profileId}`,
          };
          const response = {
            clientId,
            connectionId: event.connectionId,
            requestId: event.request.requestId,
          };
          if (
            profileId !== input.profileId ||
            (input.target && input.target.hostKey !== target.hostKey)
          ) {
            yield* broker.respond({
              ...response,
              ok: false,
              error: { _tag: "PreviewAutomationExecutionError", message: "Wrong profile." },
            });
            return false;
          }
          if (input.statusOnly && missStatusOnlyRead) {
            missStatusOnlyRead = false;
            yield* broker.respond({
              ...response,
              ok: false,
              error: { _tag: "PreviewAutomationExecutionError", message: "Receipt unavailable." },
            });
            return false;
          }
          const current = new URL(page.url());
          const resolvedDraftUrl =
            options.resolveCurrentDraft &&
            input.phase === "inspect" &&
            !input.target &&
            input.definition.url !== current.href &&
            input.definition.url === current.origin + current.pathname
              ? current.href
              : undefined;
          const definition = resolvedDraftUrl
            ? { ...input.definition, url: resolvedDraftUrl }
            : input.definition;
          const dispatch = input.phase === "submit" || input.phase === "upload";
          if (dispatch) expect(options.isSubmissionApproved?.()).toBe(true);
          const approvalId =
            options.localUpload && input.workflowId && !input.statusOnly
              ? `upload-${input.workflowId}`
              : undefined;
          const pageResult = yield* Effect.promise(async () => {
            if (
              input.phase === "enter" ||
              input.phase === "refresh" ||
              (input.phase === "monitor" && input.refresh)
            )
              await page.goto(input.definition.url);
            if (options.turnWarningOnBeforeSubmit && input.phase === "submit") {
              await page.evaluate(
                `document.querySelector("#replacement").textContent = "Replace existing build"`,
              );
            }
            const { frameTree } = await cdp.send("Page.getFrameTree");
            const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
              frameId: frameTree.frame.id,
              worldName: "tabs-workflow-test",
            });
            const { result } = await cdp.send("Runtime.evaluate", {
              expression: browserWorkflowPageScript(
                definition,
                dispatch,
                input.statusOnly,
                approvalId ? { currentId: approvalId, nextId: approvalId } : undefined,
                input.phase === "upload" ? "upload" : "submit",
                input.phase === "upload" ? options.localUpload : undefined,
              ),
              contextId: executionContextId,
              returnByValue: true,
            });
            return result.value as BrowserWorkflowPageResult;
          });
          const { disposition, observation, reason, submitControlBinding } = pageResult;
          if (options.dropAfterSubmit && disposition === "dispatched" && !dropped) {
            dropped = true;
            // The guest has activated Submit. End the real broker stream without a reply.
            return true;
          }
          const submissionApproved =
            input.workflowId &&
            !input.statusOnly &&
            observation?.breakpoint === "clear" &&
            (observation.stage === "ready_to_upload"
              ? observation.uploadAvailable &&
                (!options.localUpload || submitControlBinding === "retained")
              : observation.submitAvailable) &&
            options.isSubmissionApproved?.();
          yield* broker.respond({
            ...response,
            ok: true,
            result: {
              disposition,
              observation,
              reason,
              target,
              ...(submissionApproved && { submissionApproved }),
              ...(resolvedDraftUrl &&
                disposition === "observed" &&
                observation && {
                  resolvedDraftUrl,
                }),
            },
          });
          return false;
        }),
      ),
      Stream.takeUntil((drop) => drop),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* Deferred.await(connected);
  });

const journalOwner = { environmentId, threadId };
const journalTarget = {
  projectId: "test-project",
  tabId,
  profileId: "Work",
  hostKey: "desktop-work",
};
const journalDefinition = {
  url: "https://fixture.test/draft/42",
  identitySelector: "#draft-id",
  resourceId: "42",
  statusSelector: "#status",
  submitSelector: "#submit",
  states: {
    uploaded: "Uploaded",
    submitted: "Submitted",
    certified: "Certified",
    published: "Published",
  },
  breakpoint: { selector: "#replacement", clearText: "Clear", pauseText: "Replacing" },
};
const armJournal = { ...journalTarget, definition: journalDefinition };
const uploadStates = { ...journalDefinition.states, ready_to_upload: "Ready to upload" };
const readOnlyDefinition = {
  url: journalDefinition.url,
  identitySelector: journalDefinition.identitySelector,
  resourceId: journalDefinition.resourceId,
  statusSelector: journalDefinition.statusSelector,
  readOnly: true,
  states: { uploaded: "Uploaded" },
} satisfies BrowserWorkflowDefinition;
const readJournal = (directory: string, workflowId: string) =>
  readFile(join(directory, "browser-workflows", `${workflowId}.json`), "utf8");

function status(
  stage: Exclude<BrowserWorkflowStage, "ready_to_upload">,
): BrowserWorkflowHostResult {
  return {
    target: journalTarget,
    disposition: "observed",
    submissionApproved: true,
    observation: {
      stage,
      statusText: journalDefinition.states[stage],
      breakpoint: "clear",
      submitAvailable: stage === "uploaded",
    },
  };
}

test.each([
  ["another origin", journalDefinition.url, "https://other.test/draft/42?view=details"],
  ["another path", journalDefinition.url, "https://fixture.test/draft/43?view=details"],
  [
    "an explicit query",
    journalDefinition.url + "?view=summary",
    journalDefinition.url + "?view=details",
  ],
  ["an explicit fragment", journalDefinition.url + "#summary", journalDefinition.url + "#details"],
  ["an explicit empty query", journalDefinition.url + "?", journalDefinition.url + "?view=details"],
  ["another protocol", journalDefinition.url, "ftp://fixture.test/draft/42?view=details"],
  ["a noncanonical URL", journalDefinition.url, "https://fixture.test:443/draft/42?view=details"],
  [
    "embedded credentials",
    journalDefinition.url,
    "https://name:pass@fixture.test/draft/42?view=details",
  ],
  ["a protected parameter", journalDefinition.url, journalDefinition.url + "?%74oken=private"],
  ["a session parameter", journalDefinition.url, journalDefinition.url + "?__session=private"],
  ["a signed URL", journalDefinition.url, journalDefinition.url + "?X-Amz-Signature=private"],
  ["a form-encoded key", journalDefinition.url, journalDefinition.url + "?api+key=private"],
  ["a credential fragment", journalDefinition.url, journalDefinition.url + "#access_token=private"],
  [
    "a credential in a hash route",
    journalDefinition.url,
    journalDefinition.url + "#/edit?%63ode=private",
  ],
  [
    "an opaque credential fragment",
    journalDefinition.url,
    journalDefinition.url + "#" + "a".repeat(24),
  ],
  ["an oversized URL", journalDefinition.url, journalDefinition.url + "?view=" + "a".repeat(2048)],
  ["a missing query and fragment", journalDefinition.url, journalDefinition.url],
])("refuses to save a host resolution with %s", async (_case, url, resolvedDraftUrl) => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-draft-resolution-"));
  try {
    const definition = { ...journalDefinition, url };
    const browser = vi.fn(async () => ({ ...status("uploaded"), resolvedDraftUrl }));
    const workflows = makeBrowserWorkflows(directory, journalOwner, browser);
    const arm = workflows.arm({ ...armJournal, definition });
    await expect(arm).rejects.toThrow(/draft (URL|without)/);
    expect(browser.mock.calls).toEqual([
      [{ phase: "inspect", profileId: "Work", definition }, tabId],
    ]);
    expect(existsSync(join(directory, "browser-workflows"))).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a draft URL that exceeds the contract limit after normalization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-draft-length-"));
  try {
    const url = journalDefinition.url + "?view=" + "é".repeat(400);
    const isDraftUrl = Schema.is(BrowserWorkflowDefinition.fields.url);
    expect(isDraftUrl(url)).toBe(true);
    expect(isDraftUrl(new URL(url).href)).toBe(false);
    const browser = vi.fn(async () => status("uploaded"));
    const workflows = makeBrowserWorkflows(directory, journalOwner, browser);
    await expect(
      workflows.arm({ ...armJournal, definition: { ...journalDefinition, url } }),
    ).rejects.toThrow("The draft URL is too long after normalization.");
    expect(browser).not.toHaveBeenCalled();
    expect(existsSync(join(directory, "browser-workflows"))).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires exactly one upload selector only when ready_to_upload is defined", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-upload-definition-"));
  try {
    const workflows = makeBrowserWorkflows(directory, journalOwner, async () => {
      throw new Error("Unexpected browser inspection for an invalid definition.");
    });
    const staged = { uploadSelector: "#upload" };
    const direct = { uploadInputSelector: "#package" };
    for (const overrides of [
      staged,
      direct,
      { ...staged, ...direct },
      { states: uploadStates },
      { states: uploadStates, ...staged, ...direct },
    ]) {
      await expect(
        workflows.arm({ ...armJournal, definition: { ...journalDefinition, ...overrides } }),
      ).rejects.toThrow("Provide exactly one of uploadSelector and uploadInputSelector");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates the definition for each mode before inspecting the tab", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-definition-"));
  try {
    const browser = vi.fn(async () => status("uploaded"));
    const workflows = makeBrowserWorkflows(directory, journalOwner, browser);
    for (const overrides of [
      { uploadSelector: "#upload" },
      { uploadInputSelector: "#package" },
      { submitSelector: "#submit" },
      { breakpoint: journalDefinition.breakpoint },
    ]) {
      await expect(
        workflows.arm({ ...armJournal, definition: { ...readOnlyDefinition, ...overrides } }),
      ).rejects.toThrow("Read-only workflows must omit action selectors and the breakpoint.");
    }
    for (const states of [{}, { uploaded: "Uploaded", submitted: "Uploaded" }]) {
      await expect(
        workflows.arm({ ...armJournal, definition: { ...readOnlyDefinition, states } }),
      ).rejects.toThrow("distinct, exact label");
    }
    const { states, submitSelector, breakpoint, ...location } = journalDefinition;
    for (const definition of [
      { ...location, states, breakpoint },
      { ...location, states, submitSelector },
      { ...location, states: { submitted: "Submitted" }, submitSelector, breakpoint },
    ]) {
      await expect(workflows.arm({ ...armJournal, definition })).rejects.toThrow(
        "Guarded workflows require a submit selector, a breakpoint and labels",
      );
    }
    expect(browser).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([
  ["read-only", readOnlyDefinition, journalDefinition],
  ["guarded", journalDefinition, readOnlyDefinition],
] as const)(
  "keeps the original %s mode when re-arming the same journal",
  async (_mode, first, next) => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-mode-"));
    try {
      const browser = vi.fn(async () => status("uploaded"));
      const workflows = makeBrowserWorkflows(directory, journalOwner, browser);
      const armed = await workflows.arm({ ...armJournal, definition: first });
      // The observed stage normally requires Submit, and the host claims it is approved.
      expect(armed.phase).toBe(first === readOnlyDefinition ? "verified" : "ready");
      if (first === readOnlyDefinition) {
        expect(armed.result.readOnly).toBe(true);
        expect(browser).toHaveBeenCalledExactlyOnceWith(
          { phase: "inspect", profileId: "Work", definition: first },
          tabId,
        );
        expect(armed.breakpoint).toBeUndefined();
      } else {
        expect(armed.result).not.toHaveProperty("readOnly");
      }
      const before = await readJournal(directory, armed.workflowId);
      browser.mockClear();
      await expect(workflows.arm({ ...armJournal, definition: next })).rejects.toThrow(
        "Keep its original mode.",
      );
      expect(browser).toHaveBeenCalledExactlyOnceWith(
        { phase: "inspect", profileId: "Work", definition: next },
        tabId,
      );
      expect(await readJournal(directory, armed.workflowId)).toBe(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("corrects a direct upload selector on the same journal and waits for browser approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-direct-upload-"));
  try {
    const definition = { ...journalDefinition, states: uploadStates };
    const initial = { ...definition, uploadInputSelector: "#missing-input" };
    const corrected = { ...definition, uploadInputSelector: "#package" };
    const staged = { ...definition, uploadSelector: "#upload" };
    const requests: BrowserWorkflowBrowserRequest[] = [];
    let approved = false;
    let uploaded = false;
    const browser = async (
      request: BrowserWorkflowBrowserRequest,
    ): Promise<BrowserWorkflowHostResult | undefined> => {
      requests.push(request);
      if (request.workflowId) {
        const saved = await readBrowserWorkflowResult(directory, journalOwner, {
          workflowId: request.workflowId,
          stage: "ready_to_upload",
        });
        expect(request.target).toEqual(saved.target);
        expect(request.definition).toEqual(saved.definition);
        if (request.phase === "upload") {
          expect(approved).toBe(true);
          expect(saved.pendingAction).toBe("upload");
          return undefined;
        }
      }
      if (uploaded) return { ...status("uploaded"), submissionApproved: false };
      return {
        target: journalTarget,
        disposition: "observed",
        submissionApproved: !request.statusOnly && approved,
        observation: {
          stage: "ready_to_upload",
          statusText: uploadStates.ready_to_upload,
          breakpoint: request.statusOnly ? "irrelevant" : "clear",
          submitAvailable: false,
          uploadAvailable: request.definition.uploadInputSelector !== initial.uploadInputSelector,
        },
      };
    };
    const workflows = makeBrowserWorkflows(directory, journalOwner, browser);
    const arm = (definition: BrowserWorkflowDefinition) =>
      workflows.arm({ ...armJournal, definition });
    const first = await arm(initial);
    const { workflowId } = first;
    expect(first).toMatchObject({
      phase: "unobservable",
      reason: expect.stringContaining("empty HTML file input"),
    });
    expect(requests.splice(0)).toEqual([
      { phase: "inspect", profileId: journalTarget.profileId, definition: initial },
    ]);
    const beforeCorrection = await readJournal(directory, workflowId);
    expect(JSON.parse(beforeCorrection)).toMatchObject({
      definition: initial,
      awaitingPreflight: true,
      pending: false,
    });
    await expect(arm(staged)).rejects.toThrow("original draft and selectors");
    expect(await readJournal(directory, workflowId)).toBe(beforeCorrection);
    expect(requests.splice(0)).toEqual([
      { phase: "inspect", profileId: journalTarget.profileId, definition: staged },
    ]);

    const proposed = await arm(corrected);
    expect(proposed).toMatchObject({
      workflowId,
      phase: "approval_required",
      reason: "On the original draft, choose a file and approve the upload in the browser.",
    });
    const inspection = {
      phase: "inspect",
      profileId: journalTarget.profileId,
      definition: corrected,
    };
    const targeted = { ...inspection, target: journalTarget, workflowId };
    expect(requests.splice(0)).toEqual([inspection, targeted]);
    const afterCorrection = await readJournal(directory, workflowId);
    expect(JSON.parse(afterCorrection)).toMatchObject({ definition: corrected, pending: false });
    expect(JSON.parse(afterCorrection)).not.toHaveProperty("awaitingPreflight");
    for (const changed of [initial, staged]) {
      await expect(arm(changed)).rejects.toThrow("original draft and selectors");
    }
    expect(await readJournal(directory, workflowId)).toBe(afterCorrection);
    expect(requests.splice(0)).toEqual([
      { ...inspection, definition: initial },
      { ...inspection, definition: staged },
    ]);
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({
      phase: "approval_required",
      reason: proposed.reason,
    });
    expect(requests.splice(0)).toEqual([{ ...targeted, statusOnly: false }]);
    expect(JSON.parse(await readJournal(directory, workflowId))).toMatchObject({ pending: false });

    approved = true;
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({ phase: "uncertain" });
    const pending = await readJournal(directory, workflowId);
    expect(JSON.parse(pending)).toMatchObject({ pending: true });
    const restarted = makeBrowserWorkflows(directory, journalOwner, browser);
    expect(await restarted.advance(workflowId, "upload")).toMatchObject({ phase: "uncertain" });
    expect(await readJournal(directory, workflowId)).toBe(pending);
    uploaded = true;
    expect(await restarted.advance(workflowId, "check")).toMatchObject({
      phase: "verified",
      lastVerified: { stage: "uploaded" },
    });
    expect(await restarted.advance(workflowId, "upload")).toMatchObject({
      phase: "verified",
      lastVerified: { stage: "uploaded" },
    });
    expect(JSON.parse(await readJournal(directory, workflowId))).toMatchObject({ pending: false });
    expect(requests).toEqual([
      { ...targeted, statusOnly: false },
      { ...targeted, phase: "upload" },
      { ...targeted, statusOnly: true },
      { ...targeted, statusOnly: true },
      { ...targeted, statusOnly: true },
      { ...targeted, statusOnly: true },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reserves a staged upload, reconciles a lost reply, and keeps Submit separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-upload-journal-"));
  try {
    const staged = {
      ...armJournal,
      definition: {
        ...journalDefinition,
        states: uploadStates,
        uploadSelector: "#upload",
      },
    };
    let matched = true;
    let approved = false;
    let verifiedUpload = false;
    let submitApproved = false;
    let uploads = 0;
    let submits = 0;
    const workflows = makeBrowserWorkflows(
      directory,
      journalOwner,
      async ({ phase, statusOnly }) => {
        if (phase === "upload") {
          uploads++;
          return undefined;
        }
        if (phase === "submit") {
          submits++;
          return undefined;
        }
        if (verifiedUpload) return { ...status("uploaded"), submissionApproved: submitApproved };
        return {
          target: journalTarget,
          disposition: "observed",
          submissionApproved: approved,
          observation: {
            stage: "ready_to_upload",
            statusText: "Ready to upload",
            breakpoint: statusOnly ? "irrelevant" : matched ? "matched" : "clear",
            submitAvailable: false,
            uploadAvailable: true,
          },
        };
      },
    );
    const { workflowId, phase } = await workflows.arm(staged);
    expect(phase).toBe("paused");
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({ phase: "paused" });
    matched = false;
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({
      phase: "approval_required",
    });
    approved = true;
    expect(await workflows.advance(workflowId, "resume")).toMatchObject({ phase: "ready" });
    expect(await workflows.advance(workflowId, "submit")).toMatchObject({ phase: "ready" });
    expect(uploads).toBe(0);
    expect(submits).toBe(0);
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({
      phase: "uncertain",
      reason: expect.stringContaining("Upload may have reached"),
    });
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({ phase: "uncertain" });
    expect(uploads).toBe(1);
    await workflows.watch(workflowId, "uploaded");
    const reference = { workflowId, stage: "ready_to_upload" as const };
    const draft = {
      target: journalTarget,
      definition: staged.definition,
      stage: "ready_to_upload",
      pendingAction: "upload",
    };
    const beforeReceipt = await readJournal(directory, workflowId);
    expect(await readBrowserWorkflowResult(directory, journalOwner, reference)).toEqual(draft);
    const reconcile = (receipt: BrowserWorkflowReceipt) =>
      reconcileBrowserWorkflowSubmission(
        directory,
        journalOwner,
        reference,
        journalTarget.projectId,
        async () => receipt,
      );
    const stale = {
      target: journalTarget,
      stage: "ready_to_upload",
      statusText: uploadStates.ready_to_upload,
    } as const;
    const receipt = { target: journalTarget, stage: "uploaded", statusText: "Uploaded" } as const;
    await expect(reconcile(stale)).resolves.toEqual(draft);
    await expect(
      reconcile({ ...receipt, target: { ...journalTarget, hostKey: "other-host" } }),
    ).rejects.toThrow("did not confirm");
    await expect(reconcile({ ...receipt, statusText: "uploaded" })).rejects.toThrow(
      "did not confirm",
    );
    expect(await readJournal(directory, workflowId)).toBe(beforeReceipt);

    verifiedUpload = true;
    const saved = { target: journalTarget, definition: staged.definition, stage: "uploaded" };
    await expect(reconcile(receipt)).resolves.toEqual(saved);
    expect(await readBrowserWorkflowResult(directory, journalOwner, reference)).toEqual(saved);
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([]);
    const afterReceipt = await readJournal(directory, workflowId);
    await expect(reconcile(receipt)).resolves.toEqual(saved);
    await expect(reconcile(stale)).rejects.toThrow("did not confirm");
    expect(await readJournal(directory, workflowId)).toBe(afterReceipt);
    expect(await workflows.advance(workflowId, "upload")).toMatchObject({
      phase: "verified",
      lastVerified: { stage: "uploaded" },
    });
    expect(await workflows.advance(workflowId, "submit")).toMatchObject({
      phase: "approval_required",
    });
    expect(uploads).toBe(1);
    expect(submits).toBe(0);

    submitApproved = true;
    expect(await workflows.advance(workflowId, "submit")).toMatchObject({ phase: "uncertain" });
    const pendingSubmit = await readJournal(directory, workflowId);
    const readFromOldUploadLink = vi.fn(async () => ({
      target: journalTarget,
      stage: "submitted" as const,
      statusText: "Submitted",
    }));
    await expect(
      reconcileBrowserWorkflowSubmission(
        directory,
        journalOwner,
        reference,
        journalTarget.projectId,
        readFromOldUploadLink,
      ),
    ).resolves.toEqual({ ...saved, pendingAction: "submit" });
    expect(readFromOldUploadLink).toHaveBeenCalledExactlyOnceWith(saved);
    expect(await readJournal(directory, workflowId)).toBe(pendingSubmit);
    expect(uploads).toBe(1);
    expect(submits).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires journal-bound approval and keeps the reservation until a receipt appears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-journal-"));
  try {
    const target = journalTarget;
    const owner = journalOwner;
    const requests: (typeof BrowserWorkflowBrowserRequest.Type)[] = [];
    let dispatched = 0;
    let receiptVisible = false;
    let approval: boolean | undefined;
    let invalidateApproval = false;
    const connect = () =>
      makeBrowserWorkflows(directory, owner, async (request) => {
        requests.push(request);
        if (request.target && requests.length === 2) {
          expect(request.workflowId).toBeDefined();
          expect(
            await readBrowserWorkflowResult(directory, owner, {
              workflowId: request.workflowId!,
              stage: "uploaded",
            }),
          ).toMatchObject({ target: request.target, definition: request.definition });
        }
        if (request.phase === "submit") {
          if (invalidateApproval) {
            approval = false;
          } else {
            dispatched++;
            return undefined;
          }
        }
        const submissionApproved = request.target ? approval : true;
        return {
          target,
          disposition: "observed",
          ...(submissionApproved === undefined ? {} : { submissionApproved }),
          observation: {
            stage: receiptVisible ? "submitted" : "uploaded",
            statusText: receiptVisible ? "Submitted" : "Uploaded",
            breakpoint: "clear",
            submitAvailable: !receiptVisible,
          },
        };
      });
    const journal = connect();
    const arm = armJournal;
    const initial = await journal.arm(arm);
    const { workflowId } = initial;
    expect(initial).toMatchObject({
      phase: "approval_required",
      reason: expect.stringContaining("Approve one submission"),
    });
    const browserRequest = { profileId: target.profileId, definition: arm.definition };
    const journalRequest = { ...browserRequest, target, workflowId };
    expect(requests).toStrictEqual([
      { ...browserRequest, phase: "inspect" },
      { ...journalRequest, phase: "inspect" },
    ]);
    approval = false;
    for (const action of ["check", "enter", "resume", "refresh", "submit"] as const) {
      expect((await journal.advance(workflowId, action)).phase).toBe("approval_required");
    }
    expect(requests.slice(2)).toEqual(
      ["inspect", "enter", "inspect", "refresh", "inspect"].map((phase) => ({
        ...journalRequest,
        phase,
        statusOnly: false,
      })),
    );
    expect(dispatched).toBe(0);
    const beforeInvalidation = requests.length;
    approval = true;
    invalidateApproval = true;
    expect((await journal.advance(workflowId, "submit")).phase).toBe("approval_required");
    expect(requests.slice(beforeInvalidation)).toEqual([
      { ...journalRequest, phase: "inspect", statusOnly: false },
      { ...journalRequest, phase: "submit" },
      { ...journalRequest, phase: "inspect", statusOnly: false },
    ]);
    expect(dispatched).toBe(0);
    invalidateApproval = false;
    approval = true;
    const beforeDispatch = requests.length;
    expect((await journal.advance(workflowId, "submit")).phase).toBe("uncertain");
    expect((await journal.arm(arm)).phase).toBe("uncertain");
    expect((await connect().advance(workflowId, "submit")).phase).toBe("uncertain");
    await journal.watch(workflowId, "submitted");
    const pending = await readJournal(directory, workflowId);
    expect(JSON.parse(pending)).toMatchObject({ pending: true });
    await connect().pollWatch(workflowId);
    expect(await readJournal(directory, workflowId)).toBe(pending);
    receiptVisible = true;
    await connect().pollWatch(workflowId);
    expect(JSON.parse(await readJournal(directory, workflowId))).toMatchObject({
      pending: false,
      evidence: { stage: "submitted" },
    });
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([]);
    expect(await connect().advance(workflowId, "submit")).toMatchObject({
      phase: "verified",
      lastVerified: { stage: "submitted" },
    });
    expect(requests.slice(beforeDispatch)).toStrictEqual([
      { ...journalRequest, phase: "inspect", statusOnly: false },
      { ...journalRequest, phase: "submit" },
      { ...journalRequest, phase: "inspect", statusOnly: true },
      { ...browserRequest, phase: "inspect" },
      { ...journalRequest, phase: "inspect", statusOnly: true },
      {
        ...journalRequest,
        phase: "monitor",
        statusOnly: true,
        refresh: false,
        lastVerifiedStage: "uploaded",
      },
      {
        ...journalRequest,
        phase: "monitor",
        statusOnly: true,
        refresh: false,
        lastVerifiedStage: "uploaded",
      },
      { ...journalRequest, phase: "inspect", statusOnly: false },
    ]);
    const reference = { workflowId, stage: "uploaded" as const };
    expect(await readBrowserWorkflowResult(directory, owner, reference)).toMatchObject({
      target,
      stage: "submitted",
      definition: { resourceId: "42", url: "https://fixture.test/draft/42" },
    });
    expect(await readBrowserWorkflowResult(directory, owner, reference)).not.toHaveProperty(
      "pendingAction",
    );
    await expect(
      readBrowserWorkflowResult(directory, owner, { ...reference, stage: "published" }),
    ).rejects.toThrow("unavailable");
    await expect(
      readBrowserWorkflowResult(
        directory,
        { ...owner, threadId: ThreadId.make("other") },
        reference,
      ),
    ).rejects.toThrow("original thread");
    await expect(
      readBrowserWorkflowResult(
        directory,
        { ...owner, environmentId: EnvironmentId.make("other") },
        reference,
      ),
    ).rejects.toThrow("original thread");
    expect(dispatched).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["pending", "manual"] as const)(
  "same-stage Upload preserves a %s submission until a user status check verifies a receipt",
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-browser-human-receipt-"));
    try {
      const manual = mode === "manual";
      const definition = { ...journalDefinition, states: uploadStates, uploadSelector: "#upload" };
      let submits = 0;
      const browser = vi.fn(async (request: BrowserWorkflowBrowserRequest) => {
        if (request.phase === "submit") {
          submits++;
          return undefined;
        }
        if (request.statusOnly || manual) {
          return {
            target: journalTarget,
            disposition: "observed",
            observation: {
              stage: "uploaded",
              statusText: "Uploaded",
              breakpoint: request.statusOnly ? "irrelevant" : "clear",
              submitAvailable: false,
              ...(!request.statusOnly && { submitRequiresUser: true as const }),
            },
          } satisfies BrowserWorkflowHostResult;
        }
        return status("uploaded");
      });
      const workflow = makeBrowserWorkflows(directory, journalOwner, browser);
      const { workflowId } = await workflow.arm({ ...armJournal, definition });
      expect(await workflow.advance(workflowId, "submit")).toMatchObject({
        phase: manual ? "manual_submit" : "uncertain",
      });
      const reference = { workflowId, stage: "uploaded" as const };
      const draft = {
        target: journalTarget,
        definition,
        stage: "uploaded",
        ...(manual ? { submitRequiresUser: true } : { pendingAction: "submit" }),
      };
      expect(await readBrowserWorkflowResult(directory, journalOwner, reference)).toEqual(draft);
      browser.mockClear();
      for (let retry = 0; retry < 2; retry++) {
        expect(await workflow.advance(workflowId, "upload")).toMatchObject({
          phase: "verified",
          lastVerified: { stage: "uploaded" },
        });
        expect(await readBrowserWorkflowResult(directory, journalOwner, reference)).toEqual(draft);
      }
      const inspection = {
        phase: "inspect",
        profileId: journalTarget.profileId,
        target: journalTarget,
        definition,
        workflowId,
        statusOnly: true,
      };
      expect(browser.mock.calls).toEqual([
        [inspection, tabId],
        [inspection, tabId],
      ]);
      const beforeReceipt = await readJournal(directory, workflowId);
      expect(JSON.parse(beforeReceipt)).toMatchObject({ pending: !manual });
      const read = async () => {
        throw new Error("Unexpected browser action");
      };
      const reconcile = (receipt: Parameters<typeof reconcileBrowserWorkflowSubmission>[4]) =>
        reconcileBrowserWorkflowSubmission(
          directory,
          journalOwner,
          reference,
          journalTarget.projectId,
          receipt,
        );
      await expect(reconcile(read)).rejects.toThrow("Unexpected browser action");
      for (const target of [
        { ...journalTarget, projectId: "other-project" },
        { ...journalTarget, tabId: PreviewTabId.make("other-tab") },
        { ...journalTarget, profileId: "Personal" },
        { ...journalTarget, hostKey: "other-host" },
      ]) {
        await expect(
          reconcile(async () => ({ target, stage: "submitted", statusText: "Submitted" })),
        ).rejects.toThrow("did not confirm");
      }
      await expect(
        reconcile(async () => ({
          target: journalTarget,
          stage: "submitted",
          statusText: "Uploaded",
        })),
      ).rejects.toThrow("did not confirm");
      await expect(
        reconcileBrowserWorkflowSubmission(
          directory,
          journalOwner,
          reference,
          "other-project",
          read,
        ),
      ).rejects.toThrow("unavailable");
      for (const owner of [
        { ...journalOwner, threadId: ThreadId.make("other") },
        { ...journalOwner, environmentId: EnvironmentId.make("other") },
      ]) {
        await expect(
          reconcileBrowserWorkflowSubmission(
            directory,
            owner,
            reference,
            journalTarget.projectId,
            read,
          ),
        ).rejects.toThrow("original thread");
      }
      await expect(
        reconcile(async () => ({
          target: journalTarget,
          stage: "uploaded",
          statusText: "Uploaded",
        })),
      ).resolves.toEqual(draft);
      expect(await readJournal(directory, workflowId)).toBe(beforeReceipt);
      const check = () =>
        reconcile(async (saved) => ({
          target: saved.target,
          stage: "submitted",
          statusText: "Submitted",
        }));
      await check(); // Simulate a lost response after the durable commit.
      const afterReceipt = await readJournal(directory, workflowId);
      const receipt = { target: journalTarget, definition, stage: "submitted" };
      expect(await check()).toEqual(receipt);
      expect(await readBrowserWorkflowResult(directory, journalOwner, reference)).toEqual(receipt);
      await expect(
        reconcile(async () => ({
          target: journalTarget,
          stage: "uploaded",
          statusText: "Uploaded",
        })),
      ).rejects.toThrow("did not confirm");
      expect(await readJournal(directory, workflowId)).toBe(afterReceipt);
      expect(submits).toBe(manual ? 0 : 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each(["control", "breakpoint"] as const)(
  "saves the Uploaded receipt and finishes the watch when the next %s is unavailable",
  async (unavailable) => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-browser-upload-watch-"));
    try {
      const definition = { ...journalDefinition, states: uploadStates, uploadSelector: "#upload" };
      let page: BrowserWorkflowHostResult = {
        target: journalTarget,
        disposition: "observed",
        observation: {
          stage: "ready_to_upload",
          statusText: uploadStates.ready_to_upload,
          breakpoint: "clear",
          submitAvailable: false,
          uploadAvailable: false,
        },
      };
      const workflows = makeBrowserWorkflows(directory, journalOwner, async () => page);
      const { workflowId } = await workflows.arm({ ...armJournal, definition });
      expect(await workflows.watch(workflowId, "uploaded")).toMatchObject({ phase: "watching" });

      page = {
        ...status("uploaded"),
        observation: {
          stage: "uploaded",
          statusText: uploadStates.uploaded,
          breakpoint: unavailable === "breakpoint" ? "unobservable" : "clear",
          submitAvailable: unavailable !== "control",
        },
      };
      const checked = await workflows.advance(workflowId, "check");
      expect(checked).toMatchObject({
        phase: "unobservable",
        reason: expect.stringContaining(unavailable === "control" ? "Submit needs" : "breakpoint"),
        lastVerified: { stage: "uploaded", statusText: uploadStates.uploaded },
      });
      expect(checked.watchUntil).toBeUndefined();
      expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([]);
      expect(
        await readBrowserWorkflowResult(directory, journalOwner, { workflowId, stage: "uploaded" }),
      ).toEqual({ target: journalTarget, definition, stage: "uploaded" });
      expect(await workflows.advance(workflowId, "upload")).toMatchObject({ phase: "verified" });

      page = status("uploaded");
      const corrected = { ...definition, submitSelector: "#new-submit" };
      expect(await workflows.arm({ ...armJournal, definition: corrected })).toMatchObject({
        workflowId,
        phase: "ready",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("recovers a status-only watch and keeps exactly zero submit requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-watch-"));
  try {
    const requests: (typeof BrowserWorkflowBrowserRequest.Type)[] = [];
    let monitorResult: BrowserWorkflowHostResult | Error | undefined;
    const connect = () =>
      makeBrowserWorkflows(directory, journalOwner, async (request, requestedTab) => {
        requests.push(request);
        if (request.phase !== "monitor") {
          return {
            ...status("uploaded"),
            observation: {
              stage: "uploaded",
              statusText: journalDefinition.states.uploaded,
              breakpoint: "matched",
              submitAvailable: false,
            },
          };
        }
        if (requestedTab !== tabId) throw new Error("Unexpected tab");
        if (monitorResult instanceof Error) throw monitorResult;
        return monitorResult;
      });
    const journal = connect();
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([]);
    await expect(journal.watch("0".repeat(64), "published")).rejects.toThrow(
      "No saved browser workflow",
    );
    expect(requests).toEqual([]);
    const initial = await journal.arm(armJournal);
    const { workflowId } = initial;
    expect(initial).toMatchObject({
      phase: "paused",
      breakpoint: { observedText: journalDefinition.breakpoint.pauseText },
    });
    requests.length = 0;

    expect(await journal.watch(workflowId, "certified")).toMatchObject({
      phase: "watching",
      watchUntil: "certified",
    });
    expect(await journal.watch(workflowId, "published", true)).toMatchObject({
      phase: "watching",
      watchUntil: "published",
      lastVerified: initial.lastVerified,
    });
    expect(requests).toEqual([]);
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([
      { workflowId, threadId },
    ]);

    const restarted = connect();
    monitorResult = status("submitted");
    await restarted.pollWatch(workflowId);
    expect(requests).toEqual([
      {
        phase: "monitor",
        profileId: journalTarget.profileId,
        definition: journalDefinition,
        target: journalTarget,
        workflowId,
        statusOnly: true,
        refresh: true,
        lastVerifiedStage: "uploaded",
      },
    ]);
    const submitted = await readJournal(directory, workflowId);
    expect(JSON.parse(submitted)).toMatchObject({
      evidence: { stage: "submitted" },
      watch: { until: "published", refresh: true },
    });
    expect(JSON.parse(submitted)).not.toHaveProperty("breakpoint");

    const published = status("published");
    for (const invalid of [
      new Error("Offline"),
      undefined,
      { ...published, disposition: "unobservable" },
      { ...published, target: { ...journalTarget, hostKey: "other-host" } },
      { ...published, observation: { ...published.observation!, statusText: "Wrong label" } },
      status("uploaded"),
    ] as const) {
      monitorResult = invalid;
      await restarted.pollWatch(workflowId);
      expect(await readJournal(directory, workflowId)).toBe(submitted);
    }

    monitorResult = published;
    await restarted.pollWatch(workflowId);
    expect(requests.at(-1)?.lastVerifiedStage).toBe("submitted");
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([]);
    expect(await restarted.watch(workflowId, "certified")).toMatchObject({
      phase: "verified",
      lastVerified: { stage: "published" },
    });
    const pollCount = requests.length;
    await restarted.pollWatch(workflowId);
    expect(requests).toHaveLength(pollCount);
    expect(requests.every((request) => request.phase === "monitor")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("isolates watches by owner and stops polling after cancellation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-watch-"));
  const started = Promise.withResolvers<void>();
  const observation = Promise.withResolvers<BrowserWorkflowHostResult>();
  try {
    const requests: (typeof BrowserWorkflowBrowserRequest.Type)[] = [];
    const browser = async (request: typeof BrowserWorkflowBrowserRequest.Type) => {
      requests.push(request);
      if (request.phase !== "monitor") return status("uploaded");
      started.resolve();
      return observation.promise;
    };
    const journal = makeBrowserWorkflows(directory, journalOwner, browser);
    const { workflowId } = await journal.arm(armJournal);
    await journal.watch(workflowId, "published");

    const otherThreadId = ThreadId.make("other-thread");
    const otherEnvironmentId = EnvironmentId.make("other-environment");
    const wrongThread = makeBrowserWorkflows(
      directory,
      { environmentId, threadId: otherThreadId },
      browser,
    );
    const otherEnvironment = makeBrowserWorkflows(
      directory,
      { environmentId: otherEnvironmentId, threadId: otherThreadId },
      browser,
    );
    const { workflowId: otherId } = await otherEnvironment.arm(armJournal);
    await otherEnvironment.watch(otherId, "certified");
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([
      { workflowId, threadId },
    ]);
    expect(await listBrowserWorkflowWatches(directory, otherEnvironmentId)).toEqual([
      { workflowId: otherId, threadId: otherThreadId },
    ]);
    requests.length = 0;
    for (const foreign of [wrongThread, otherEnvironment]) {
      await expect(foreign.watch(workflowId, "submitted")).rejects.toThrow("original thread");
      await expect(foreign.unwatch(workflowId)).rejects.toThrow("original thread");
      await expect(foreign.pollWatch(workflowId)).rejects.toThrow("original thread");
    }
    expect(requests).toEqual([]);

    const polling = journal.pollWatch(workflowId);
    await started.promise;
    const stopping = journal.unwatch(workflowId);
    observation.resolve(status("submitted"));
    await polling;
    expect(await stopping).toMatchObject({
      phase: "watch_stopped",
      lastVerified: { stage: "submitted" },
    });
    expect(await listBrowserWorkflowWatches(directory, environmentId)).toEqual([]);
    await makeBrowserWorkflows(directory, journalOwner, browser).pollWatch(workflowId);
    expect(requests).toEqual([expect.objectContaining({ phase: "monitor", refresh: false })]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the registered watch follows the saved draft and retires when a check reaches its goal", async () => {
  const definition = {
    ...journalDefinition,
    uploadInputSelector: "#package",
    states: uploadStates,
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const broker = yield* Broker.PreviewAutomationBroker;
      const clientId = "workflow-watch-host";
      const liveTab = { threadId, tabId, workflowHostKey: journalTarget.hostKey };
      const connect = Effect.gen(function* () {
        const connected = yield* Deferred.make<string>();
        const stream = yield* broker.connect({
          clientId,
          environmentId,
          supportedOperations: ["browserWorkflow"],
        });
        yield* Stream.runForEach(stream, (event) =>
          Effect.gen(function* () {
            if (event.type === "connected") {
              yield* Deferred.succeed(connected, event.connectionId);
              return;
            }
            const { request } = event;
            expect(request).toMatchObject({
              operation: "browserWorkflow",
              tabId,
              tabIdExplicit: true,
              threadId,
            });
            const input = decodeRequest(request.input);
            expect(input.definition).toEqual(definition);
            if (input.phase === "monitor") samples.push(input);
            expect(["inspect", "monitor"]).toContain(input.phase);
            yield* broker.respond({
              clientId,
              connectionId: event.connectionId,
              requestId: request.requestId,
              ok: true,
              result: { ...page, submissionApproved: false },
            });
          }),
        ).pipe(Effect.forkScoped);
        const connectionId = yield* Deferred.await(connected);
        return (liveTabs: (typeof liveTab)[]) =>
          broker.focusHost({ clientId, connectionId, environmentId, focused: false, liveTabs });
      });
      const samples: BrowserWorkflowBrowserRequest[] = [];
      let page: BrowserWorkflowHostResult = {
        ...status("uploaded"),
        observation: {
          stage: "ready_to_upload",
          statusText: definition.states.ready_to_upload,
          breakpoint: "clear",
          submitAvailable: false,
          uploadAvailable: true,
        },
      };
      const poll = pollBrowserWorkflowWatches(
        stateDir,
        environmentId,
        () =>
          Effect.succeed({
            archivedAt: null,
            deletedAt: null,
            providerInstanceId: ProviderInstanceId.make("codex"),
          }),
        broker,
      );
      const advertise = yield* connect;
      yield* advertise([liveTab]);
      const armed = report(
        yield* call({ action: "arm", tabId, profileId: "Work", definition }, "watch-provider"),
      );
      expect(armed).toMatchObject({
        phase: "approval_required",
        reason: expect.stringContaining("choose a file and approve the upload"),
      });
      const { workflowId } = armed;
      const watching = report(
        yield* call(
          { action: "watch", workflowId, until: "uploaded", refresh: true },
          "watch-provider",
        ),
      );
      expect(watching).toMatchObject({ phase: "watching", watchUntil: "uploaded" });
      const read = () => readJournal(stateDir, workflowId);
      const before = yield* Effect.promise(read);

      // A takeover withdraws the existing grant from the host advertisement.
      yield* advertise([]);
      yield* poll;
      // Neither a new tab in Work nor the saved tab ID in another partition qualifies.
      yield* advertise([
        { ...liveTab, tabId: PreviewTabId.make("agents-surface-replacement") },
        { ...liveTab, workflowHostKey: "desktop-personal" },
      ]);
      yield* poll;
      const advertiseReconnected = yield* connect;
      yield* poll;
      expect(samples).toEqual([]);
      expect(yield* Effect.promise(read)).toBe(before);

      yield* advertiseReconnected([liveTab]);
      yield* poll;
      expect(samples).toEqual([
        {
          phase: "monitor",
          target: journalTarget,
          profileId: journalTarget.profileId,
          definition,
          workflowId,
          statusOnly: true,
          refresh: true,
          lastVerifiedStage: "ready_to_upload",
        },
      ]);

      page = status("uploaded");
      const checked = report(yield* call({ action: "check", workflowId }, "watch-provider"));
      expect(checked).toMatchObject({
        phase: "approval_required",
        lastVerified: { stage: "uploaded" },
      });
      expect(checked.watchUntil).toBeUndefined();
      expect(
        yield* Effect.promise(() => listBrowserWorkflowWatches(stateDir, environmentId)),
      ).toEqual([]);

      // Older journals can already contain a watch whose goal was verified by a check.
      const saved = JSON.parse(yield* Effect.promise(read));
      yield* Effect.promise(() =>
        writeFile(
          join(stateDir, "browser-workflows", `${workflowId}.json`),
          JSON.stringify({ ...saved, watch: { until: "uploaded", refresh: true } }),
        ),
      );
      yield* poll;
      expect(samples).toHaveLength(1);
      expect(JSON.parse(yield* Effect.promise(read))).toEqual(saved);

      yield* call({ action: "watch", workflowId, until: "published" }, "watch-provider");
      page = status("published");
      yield* poll;
      expect(JSON.parse(yield* Effect.promise(read))).toMatchObject({
        target: journalTarget,
        definition,
        evidence: { stage: "published" },
      });
      expect(
        yield* Effect.promise(() => listBrowserWorkflowWatches(stateDir, environmentId)),
      ).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(mcpLayer),
      Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "tabs-workflow-watch-" })),
      Effect.provide(NodeServices.layer),
    ),
  );
});

const chromiumPath = chromium.executablePath();

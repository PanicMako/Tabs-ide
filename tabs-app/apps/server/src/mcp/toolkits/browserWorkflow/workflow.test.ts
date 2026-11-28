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

const chromiumPath = chromium.executablePath();

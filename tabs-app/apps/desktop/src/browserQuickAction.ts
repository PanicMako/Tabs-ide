import { createHash, randomUUID } from "node:crypto";
import {
  BROWSER_QUICK_ACTION_MAX_FILE_BYTES,
  BrowserQuickAction,
  BrowserQuickActionFileReceipt,
  type BrowserQuickActionResult,
} from "@tabs/contracts";
import {
  browserQuickActionPage,
  checkBrowserQuickAction,
  resolveBrowserQuickActionFilename,
} from "@tabs/shared/browserQuickAction";
import * as Schema from "effect/Schema";
import type { WebContents } from "electron";
import { browserQuickActionProbe } from "./browserQuickActionDom";
import { runBrowserReproduction } from "./browserReproductionRunner";

export type QuickActionApproval = {
  readonly id: string;
  readonly taskId: string;
  readonly token: string;
  readonly url: string;
  readonly partition: string;
  readonly action: BrowserQuickAction;
  readonly values: ReadonlyMap<string, string>;
  readonly startAt: number;
};

type QuickActionFileResult = {
  readonly action: Pick<BrowserQuickAction, "origin" | "outcome">;
  readonly receipt: NonNullable<BrowserQuickActionResult["fileReceipt"]>;
  readonly taskId: string;
  readonly instanceId: string;
  readonly url: string;
  readonly pageToken: string;
  readonly partition: string;
};

type QuickActionFileBaseline = {
  readonly filename: string;
  readonly digests: ReadonlySet<string>;
};

export class BrowserQuickActionState {
  revision = 0;
  private grant: QuickActionApproval | undefined;
  private expiration?: ReturnType<typeof setTimeout>;
  running: { actionId: string } | undefined;
  readonly fileResults = new Map<string, QuickActionFileResult>();
  paused:
    | {
        action: BrowserQuickAction;
        pageToken: string;
        startAt: number;
        repairAt: number;
        agent?: { pauseId: string; taskId: string; url: string; partition: string };
        unconfirmedStep?: { id: string; url: string; partition: string };
        lockedValues?: ReadonlyMap<string, string>;
        fileBaseline?: QuickActionFileBaseline;
        savedAction?: BrowserQuickAction;
        pendingFileVerification?: boolean;
      }
    | undefined;

  get approval(): QuickActionApproval | undefined {
    return this.grant;
  }

  authorize(approval: QuickActionApproval, onExpire: () => void): void {
    this.revoke();
    this.grant = approval;
    this.expiration = setTimeout(() => {
      this.revoke();
      onExpire();
    }, 5 * 60_000);
    this.expiration.unref();
  }

  revoke(): void {
    clearTimeout(this.expiration);
    this.grant = undefined;
  }

  navigated(): void {
    this.revoke();
    this.paused = undefined;
    this.fileResults.clear();
    this.revision++;
  }

  rememberFileResult(result: QuickActionFileResult): string {
    const id = randomUUID();
    if (this.fileResults.size >= 12) {
      const first = this.fileResults.keys().next();
      if (!first.done) this.fileResults.delete(first.value);
    }
    this.fileResults.set(id, result);
    return id;
  }
}

const decodeAction = Schema.decodeUnknownSync(BrowserQuickAction);
const decodeFileReceipt = Schema.decodeUnknownSync(BrowserQuickActionFileReceipt);
function readFileReceipt(result: object) {
  if ("base64" in result) {
    if (
      typeof result.base64 !== "string" ||
      result.base64.length > Math.ceil(BROWSER_QUICK_ACTION_MAX_FILE_BYTES / 3) * 4
    )
      throw new Error("The browser returned an invalid file receipt.");
    const bytes = Buffer.from(result.base64, "base64");
    if (!("byteLength" in result) || bytes.length !== result.byteLength)
      throw new Error("The browser returned an invalid file receipt.");
    return decodeFileReceipt({
      ...result,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return decodeFileReceipt(result);
}

const wrongFilename = "The reviewed result did not offer a download with the expected filename.";
const baselineUnavailable =
  "The browser could not verify which files were present before this run.";
const preexistingFile = "This file matches a download that was available before this run.";
const fileReplyUnavailable =
  "The browser could not confirm the file. Check the download and resume.";
const resultReplyUnavailable =
  "The browser could not confirm the result. Check the page and resume verification.";
const stepReplyUnavailable =
  "The browser could not confirm the step. Check whether it took effect before continuing.";
const replayPauseMessages = new Map([
  ["ambiguous", "Multiple elements match the reviewed target."],
  [
    "changed",
    "The saved selector conflicts with the reviewed accessible name. Choose the intended control.",
  ],
  ["blocked", "The reviewed control is covered, protected, or unavailable."],
  ["file-filename", wrongFilename],
  ["file-scope", "The download points outside the scope approved for this Quick Action."],
  [
    "file-unavailable",
    "The link appeared, but the browser could not verify the file. Check the download and resume.",
  ],
  ["file-changed", "The download link changed during verification. Review the current result."],
]);

export function validatedBrowserQuickAction(input: unknown): BrowserQuickAction {
  let action: BrowserQuickAction;
  try {
    action = decodeAction(input);
  } catch {
    throw new Error("Review the saved browser action before running it.");
  }
  const error = checkBrowserQuickAction(action);
  if (error) throw new Error(error);
  return action;
}

export function matchingQuickActionPause(
  state: BrowserQuickActionState,
  action: BrowserQuickAction,
  pageToken: string,
) {
  const paused = state.paused;
  return paused &&
    paused.pageToken === pageToken &&
    (JSON.stringify(paused.action) === JSON.stringify(action) ||
      (paused.savedAction && JSON.stringify(paused.savedAction) === JSON.stringify(action)))
    ? paused
    : undefined;
}

export async function replayBrowserQuickAction(
  contents: Pick<WebContents, "executeJavaScriptInIsolatedWorld">,
  action: BrowserQuickAction,
  values: ReadonlyMap<string, string>,
  startAt: number,
  checkControl: () => void,
  allowWebsiteDownloads = false,
  fileBaseline?: QuickActionFileBaseline,
): Promise<
  BrowserQuickActionResult & {
    repairAt?: number;
    unconfirmedStep?: true;
    websiteFile?: true;
    fileBaseline?: QuickActionFileBaseline;
  }
> {
  const expectedFilename = resolveBrowserQuickActionFilename(action, values);
  const outcome = {
    id: "outcome",
    action: "assertVisible" as const,
    selector: action.outcome.selector,
    semantic: action.outcome.semantic,
  };
  const steps = [
    ...action.steps.map((step, index) => ({
      id: String(index),
      action: step.action,
      selector: step.selector,
      semantic: step.semantic,
      tag: step.tag,
      value: step.parameter === undefined ? undefined : values.get(step.parameter),
    })),
    outcome,
  ].slice(startAt);
  const probe = (expression: string) =>
    contents.executeJavaScriptInIsolatedWorld(999, [{ code: expression }]);
  if (fileBaseline && fileBaseline.filename !== expectedFilename)
    throw new Error("Keep the original expected filename when continuing this run.");
  if (startAt === 0 && !fileBaseline) {
    checkControl();
    const preexisting = await probe(
      browserQuickActionProbe(action.origin, { ...outcome, expectedFilename }),
    );
    checkControl();
    if (preexisting === "ok") {
      return {
        status: "fail",
        completedSteps: 0,
        message: "The expected result is already visible. Open the starting page before running.",
      };
    }
    if (preexisting === "ambiguous" || preexisting === "changed") {
      return {
        status: "paused",
        completedSteps: 0,
        repairAt: action.steps.length,
        message:
          preexisting === "changed"
            ? "The saved selector conflicts with the reviewed result. Choose the result again."
            : "Multiple elements match the expected result.",
      };
    }
    if (preexisting === "scope") throw new Error("Interrupted by a change of browser scope.");
    if (expectedFilename !== undefined) {
      const observed = await probe(
        browserQuickActionProbe(action.origin, {
          ...outcome,
          expectedFilename,
          verifyFile: { allowWebsiteDownloads, captureBaseline: true },
        }),
      );
      checkControl();
      if (observed === "scope") throw new Error("Interrupted by a change of browser scope.");
      const digests = new Set<string>();
      try {
        if (!Array.isArray(observed)) throw new Error(baselineUnavailable);
        for (const item of observed) {
          if (!item || typeof item !== "object") throw new Error(baselineUnavailable);
          const receipt = readFileReceipt(item);
          if (receipt.filename !== expectedFilename) throw new Error(baselineUnavailable);
          digests.add(receipt.sha256);
        }
      } catch {
        return { status: "fail", completedSteps: 0, message: baselineUnavailable };
      }
      fileBaseline = { filename: expectedFilename, digests };
    }
  }
  if (expectedFilename !== undefined && !fileBaseline)
    return { status: "fail", completedSteps: startAt, message: baselineUnavailable };
  let pauseMessage: string | undefined;
  let file:
    | {
        fileReceipt: typeof BrowserQuickActionFileReceipt.Type;
        websiteFile?: true;
      }
    | undefined;
  const runDeadline = Date.now() + 32_000;
  const result = await runBrowserReproduction(
    {
      checkControl,
      async performStep(step) {
        const deadline = Math.min(runDeadline, Date.now() + 2_000);
        const verifyFile = step.action === "assertVisible" && expectedFilename !== undefined;
        const expression = browserQuickActionProbe(
          action.origin,
          verifyFile ? { ...step, expectedFilename, verifyFile: { allowWebsiteDownloads } } : step,
        );
        while (true) {
          checkControl();
          let status: unknown;
          try {
            status = await probe(expression);
          } catch {
            checkControl();
            if (step.action === "assertVisible") {
              pauseMessage = verifyFile ? fileReplyUnavailable : resultReplyUnavailable;
              throw new Error(pauseMessage);
            }
            // A lost reply can follow a dispatched export. Check its file before allowing any retry.
            if (
              fileBaseline &&
              step.action === "click" &&
              step.id === String(action.steps.length - 1)
            )
              return;
            pauseMessage = stepReplyUnavailable;
            throw new Error(pauseMessage);
          }
          checkControl();
          if (!verifyFile && status === "ok") return;
          if (verifyFile && typeof status === "object" && status !== null) {
            let receipt: typeof BrowserQuickActionFileReceipt.Type;
            try {
              receipt = readFileReceipt(status);
            } catch {
              pauseMessage = "The browser returned an invalid file receipt.";
              throw new Error(pauseMessage);
            }
            if (receipt.filename !== expectedFilename) {
              pauseMessage = "The browser returned a receipt for another filename.";
              throw new Error(pauseMessage);
            }
            if (fileBaseline?.digests.has(receipt.sha256)) {
              pauseMessage = preexistingFile;
              throw new Error(pauseMessage);
            }
            file = {
              fileReceipt: receipt,
              ...("websiteFile" in status && status.websiteFile === true && { websiteFile: true }),
            };
            return;
          }
          if (status === "scope") throw new Error("Interrupted by a change of browser scope.");
          const pending = status === "missing" || status === "wrong-filename";
          const reason = typeof status === "string" ? replayPauseMessages.get(status) : undefined;
          if (reason) {
            pauseMessage = reason;
            throw new Error(reason);
          }
          if (pending && Date.now() >= deadline) {
            pauseMessage =
              status === "wrong-filename"
                ? wrongFilename
                : step.action === "assertVisible"
                  ? "The expected result did not become visible."
                  : "The reviewed target could not be found.";
            throw new Error(pauseMessage);
          }
          if (!pending) {
            pauseMessage =
              step.action !== "assertVisible"
                ? stepReplyUnavailable
                : verifyFile
                  ? fileReplyUnavailable
                  : resultReplyUnavailable;
            throw new Error(pauseMessage);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
    },
    action.origin,
    steps,
    {},
  );
  const completedSteps = Math.min(action.steps.length, startAt + result.completedSteps);
  if (result.status === "pass")
    return {
      status: "pass",
      completedSteps,
      message: action.outcome.description,
      ...file,
    };
  if (result.status === "fail" && pauseMessage)
    return {
      status: "paused",
      completedSteps,
      message: pauseMessage,
      ...(pauseMessage === stepReplyUnavailable && { unconfirmedStep: true }),
      ...(fileBaseline && { fileBaseline }),
    };
  return {
    status: result.status === "interrupted" ? "interrupted" : "fail",
    completedSteps,
    message:
      result.status === "interrupted"
        ? "Replay stopped after the tab or control changed."
        : "Replay could not confirm the last step. Check the page before running the action again.",
  };
}

export async function revealBrowserQuickActionFile(
  evaluate: (expression: string) => Promise<unknown>,
  result: Pick<QuickActionFileResult, "action" | "receipt">,
  allowWebsiteDownloads: boolean,
) {
  const { action, receipt } = result;
  const step = {
    action: "assertVisible",
    selector: action.outcome.selector,
    semantic: action.outcome.semantic,
    expectedFilename: receipt.filename,
  };
  const revealToken = randomUUID();
  const changed = () => new Error("The verified download has changed or is unavailable.");
  const value = await evaluate(
    browserQuickActionProbe(action.origin, {
      ...step,
      verifyFile: { allowWebsiteDownloads, revealToken },
    }),
  );
  if (typeof value !== "object" || !value) throw changed();
  const observed = readFileReceipt(value);
  if (
    observed.filename !== receipt.filename ||
    observed.sha256 !== receipt.sha256 ||
    observed.byteLength !== receipt.byteLength
  )
    throw changed();
  if (
    (await evaluate(
      browserQuickActionProbe(action.origin, { ...step, revealFileToken: revealToken }),
    )) !== "ok"
  )
    throw changed();
}

export function quickActionPageLabel(url: string): string {
  const page = browserQuickActionPage(url);
  return page ? page.origin + page.pathname : "";
}

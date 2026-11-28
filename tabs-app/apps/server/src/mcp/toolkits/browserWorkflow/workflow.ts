import {
  BrowserWorkflowDefinition,
  BrowserWorkflowEvidence,
  BrowserWorkflowReport,
  type BrowserWorkflowReceipt,
  type BrowserWorkflowResultRef,
  type BrowserWorkflowSavedResult,
  BrowserWorkflowStage,
  BrowserWorkflowTarget,
  EnvironmentId,
  ThreadId,
  type BrowserWorkflowBrowserRequest,
  type BrowserWorkflowHostResult,
} from "@tabs/contracts";
import { hasProtectedBrowserUrlState } from "@tabs/shared/preview";
import * as Schema from "effect/Schema";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { lock } from "proper-lockfile";

const stages = BrowserWorkflowStage.literals;
const rank = (stage: BrowserWorkflowStage) => stages.indexOf(stage);
const actionForStage = (stage: BrowserWorkflowStage) =>
  stage === "ready_to_upload" ? "upload" : stage === "uploaded" ? "submit" : undefined;
const actionAvailable = (observation: NonNullable<BrowserWorkflowHostResult["observation"]>) =>
  observation.stage === "ready_to_upload"
    ? observation.uploadAvailable === true
    : observation.submitAvailable;

const RecordSchema = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  target: BrowserWorkflowTarget,
  definition: BrowserWorkflowDefinition,
  evidence: BrowserWorkflowEvidence,
  breakpoint: BrowserWorkflowReport.fields.breakpoint,
  pending: Schema.Boolean,
  /** What the page showed when Upload/Submit was dispatched, so a later label can be tied to it. */
  pendingContext: Schema.optional(
    Schema.Struct({
      action: Schema.Literals(["upload", "submit"]),
      stage: BrowserWorkflowStage,
      statusText: Schema.String,
      resourceId: Schema.String,
      observedAt: Schema.String,
      dispatchedAt: Schema.String,
    }),
  ),
  /** The user's durable decision on an uncertain action. Only the web UI writes this. */
  resolution: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(["confirmNotSent", "confirmSent"]),
      action: Schema.Literals(["upload", "submit"]),
      at: Schema.String,
    }),
  ),
  submitRequiresUser: Schema.optional(Schema.Literal(true)),
  awaitingPreflight: Schema.optional(Schema.Literal(true)),
  watch: Schema.optional(Schema.Struct({ until: BrowserWorkflowStage, refresh: Schema.Boolean })),
});
type WorkflowRecord = typeof RecordSchema.Type;
type Owner = Pick<WorkflowRecord, "environmentId" | "threadId">;
type WatchReference = { workflowId: string; threadId: ThreadId };
type Browser = (
  request: BrowserWorkflowBrowserRequest,
  tabId: BrowserWorkflowTarget["tabId"],
) => Promise<BrowserWorkflowHostResult | undefined>;

export class BrowserWorkflowError extends Error {}

const decodeRecord = Schema.decodeUnknownSync(RecordSchema);
const idPattern = /^[0-9a-f]{64}$/u;
const workflowDirectory = "browser-workflows";

function workflowPath(stateDir: string, id: string) {
  if (!idPattern.test(id))
    throw new BrowserWorkflowError("Use the workflow ID returned when it was armed.");
  return join(stateDir, workflowDirectory, `${id}.json`);
}

async function readWorkflowRecord(file: string) {
  try {
    return decodeRecord(JSON.parse(await readFile(file, "utf8")));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

async function readOwnedWorkflowRecord(file: string, owner: Owner) {
  const record = await readWorkflowRecord(file);
  if (
    record &&
    (record.environmentId !== owner.environmentId || record.threadId !== owner.threadId)
  )
    throw new BrowserWorkflowError("Open this workflow in its original thread.");
  return record;
}

export async function listBrowserWorkflowWatches(
  stateDir: string,
  environmentId: EnvironmentId,
): Promise<readonly WatchReference[]> {
  const directory = join(stateDir, workflowDirectory);
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return [];
      throw cause;
    },
  );
  const watches: WatchReference[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const workflowId = entry.name.slice(0, -".json".length);
    if (!idPattern.test(workflowId)) continue;
    // One unreadable journal should not prevent the other watches from recovering.
    const record = await readWorkflowRecord(join(directory, entry.name)).catch(() => undefined);
    if (record?.environmentId === environmentId && record.watch) {
      watches.push({ workflowId, threadId: record.threadId });
    }
  }
  return watches;
}

export async function readBrowserWorkflowResult(
  stateDir: string,
  owner: Owner,
  reference: BrowserWorkflowResultRef,
): Promise<BrowserWorkflowSavedResult> {
  const record = await readOwnedWorkflowRecord(workflowPath(stateDir, reference.workflowId), owner);
  return savedResult(record, reference.stage);
}

function savedResult(
  record: WorkflowRecord | undefined,
  stage: BrowserWorkflowStage,
): BrowserWorkflowSavedResult {
  if (!record || rank(record.evidence.stage) < rank(stage))
    throw new BrowserWorkflowError("This saved browser result is unavailable in the thread.");
  const pendingAction = record.pending ? actionForStage(record.evidence.stage) : undefined;
  return {
    target: record.target,
    definition: record.definition,
    stage: record.evidence.stage,
    ...(pendingAction && { pendingAction }),
    ...(record.submitRequiresUser &&
      record.evidence.stage === "uploaded" &&
      !pendingAction && {
        submitRequiresUser: true as const,
      }),
  };
}

function workflowId(
  owner: Owner,
  target: BrowserWorkflowTarget,
  definition: BrowserWorkflowDefinition,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        owner.environmentId,
        target.hostKey,
        new URL(definition.url).origin,
        definition.resourceId,
      ]),
    )
    .digest("hex");
}

const isDraftUrlWithinLimit = Schema.is(BrowserWorkflowDefinition.fields.url);

function normalizeDefinition(definition: BrowserWorkflowDefinition): BrowserWorkflowDefinition {
  let url: URL;
  try {
    url = new URL(definition.url);
  } catch {
    throw new BrowserWorkflowError("Provide the exact HTTP(S) URL of the draft status page.");
  }
  if (!isDraftUrlWithinLimit(url.href)) {
    throw new BrowserWorkflowError("The draft URL is too long after normalization.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new BrowserWorkflowError("Provide a draft URL without embedded credentials.");
  }
  if (
    [...url.searchParams.keys()].some((key) =>
      /^(?:access_token|refresh_token|id_token|token|code|password|api[-_]?key|client_secret|signature)$/i.test(
        key,
      ),
    )
  )
    throw new BrowserWorkflowError(
      "Open a stable draft URL without sign-in or access credentials.",
    );
  const labels = Object.values(definition.states).filter((label) => label !== undefined);
  if (labels.length === 0 || new Set(labels).size !== labels.length) {
    throw new BrowserWorkflowError(
      "Provide at least one lifecycle stage with a distinct, exact label.",
    );
  }
  const hasUploadStage = definition.states.ready_to_upload !== undefined;
  const uploadSelectorCount =
    Number(definition.uploadSelector !== undefined) +
    Number(definition.uploadInputSelector !== undefined);
  if (definition.readOnly) {
    if (
      uploadSelectorCount ||
      definition.submitSelector !== undefined ||
      definition.breakpoint !== undefined
    ) {
      throw new BrowserWorkflowError(
        "Read-only workflows must omit action selectors and the breakpoint.",
      );
    }
    return { ...definition, url: url.href };
  }
  if (
    definition.submitSelector === undefined ||
    definition.breakpoint === undefined ||
    stages.slice(1).some((stage) => definition.states[stage] === undefined)
  ) {
    throw new BrowserWorkflowError(
      "Guarded workflows require a submit selector, a breakpoint and labels for uploaded, submitted, certified and published.",
    );
  }
  if (uploadSelectorCount !== Number(hasUploadStage)) {
    throw new BrowserWorkflowError(
      "Provide exactly one of uploadSelector and uploadInputSelector with states.ready_to_upload. Omit the upload selectors when that stage is absent.",
    );
  }
  if (definition.breakpoint.clearText === definition.breakpoint.pauseText) {
    throw new BrowserWorkflowError("Use distinct, exact breakpoint labels.");
  }
  return { ...definition, url: url.href };
}

function draftPageAddress(url: URL): string {
  return url.origin + url.pathname;
}

function report(
  id: string,
  record: WorkflowRecord,
  phase: BrowserWorkflowReport["phase"],
  reason?: string,
): BrowserWorkflowReport {
  return {
    workflowId: id,
    phase,
    result: {
      projectId: record.target.projectId,
      tabId: record.target.tabId,
      profileId: record.target.profileId,
      url: draftPageAddress(new URL(record.definition.url)),
      resourceId: record.definition.resourceId,
      ...(record.definition.readOnly && { readOnly: true }),
    },
    lastVerified: record.evidence,
    evidence: record.evidence.source ?? "pageLabel",
    ...(record.pending && actionForStage(record.evidence.stage)
      ? { pendingAction: actionForStage(record.evidence.stage) as "upload" | "submit" }
      : {}),
    ...(record.watch ? { watchUntil: record.watch.until } : {}),
    ...(record.breakpoint ? { breakpoint: record.breakpoint } : {}),
    ...(reason ? { reason } : {}),
  };
}

function sameTarget(left: BrowserWorkflowTarget, right: BrowserWorkflowTarget): boolean {
  return (
    left.projectId === right.projectId &&
    left.tabId === right.tabId &&
    left.profileId === right.profileId &&
    left.hostKey === right.hostKey
  );
}

function evidence(definition: BrowserWorkflowDefinition, browserResult: BrowserWorkflowHostResult) {
  const observation = browserResult.observation;
  if (
    browserResult.disposition !== "observed" ||
    !observation ||
    definition.states[observation.stage] !== observation.statusText
  )
    return;
  return {
    stage: observation.stage,
    statusSelector: definition.statusSelector,
    statusText: observation.statusText,
    observedAt: new Date().toISOString(),
    source: "pageLabel" as const,
  };
}

/**
 * A label alone cannot tell this submission from an earlier one. While an action is pending, only
 * a strictly later stage, read after dispatch and on the same draft, can reconcile it.
 */
function reconcilesPending(
  record: WorkflowRecord,
  candidate: { stage: BrowserWorkflowStage; observedAt?: string; identityText?: string },
): boolean {
  const context = record.pendingContext;
  if (rank(candidate.stage) <= rank(record.evidence.stage)) return false;
  if (!context) return true;
  if (rank(candidate.stage) <= rank(context.stage)) return false;
  if (candidate.observedAt !== undefined && candidate.observedAt < context.dispatchedAt)
    return false;
  if (candidate.identityText !== undefined && candidate.identityText !== context.resourceId)
    return false;
  return true;
}

function clearCompletedWatch(record: WorkflowRecord): WorkflowRecord {
  return record.watch && rank(record.evidence.stage) >= rank(record.watch.until)
    ? { ...record, watch: undefined }
    : record;
}

function requireMappedGoal(record: WorkflowRecord, until: BrowserWorkflowStage): void {
  if (
    record.definition.readOnly &&
    rank(record.evidence.stage) < rank(until) &&
    record.definition.states[until] === undefined
  ) {
    throw new BrowserWorkflowError(`This workflow does not define a status label for ${until}.`);
  }
}

function recordReceipt(record: WorkflowRecord, verified: BrowserWorkflowEvidence): WorkflowRecord {
  return clearCompletedWatch({
    ...record,
    awaitingPreflight: actionForStage(verified.stage) ? record.awaitingPreflight : undefined,
    breakpoint: undefined,
    pending: false,
    pendingContext: undefined,
    submitRequiresUser: undefined,
    evidence: verified,
  });
}

const disconnected =
  "The original tab, its approved profile or the page's browser access could not be verified.";
const approvalRequired = "On the original draft, choose Approve one submission before continuing.";
const uncertain =
  'Submit may have reached the site. Check this workflow for a later status on the original draft, or ask the user to choose "It sent" or "It didn\'t send". Tabs will not dispatch another Submit while the outcome is unknown.';
const uploadUncertain =
  'Upload may have reached the site. Check this workflow for the page to show Uploaded on the original draft, or ask the user to choose "It sent" or "It didn\'t send". Tabs will not dispatch another Upload while the outcome is unknown.';
const missing = "No saved browser workflow matches this ID.";

async function withRecord<T>(
  stateDir: string,
  owner: Owner,
  id: string,
  run: (
    existing: WorkflowRecord | undefined,
    save: (record: WorkflowRecord) => Promise<void>,
  ) => Promise<T>,
  waitForLock = false,
): Promise<T> {
  const file = workflowPath(stateDir, id);
  const directory = join(stateDir, workflowDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let compromised = false;
  const release = await lock(file, {
    realpath: false,
    // Watch updates may arrive during a bounded browser read in another poll.
    retries: waitForLock ? { retries: 160, factor: 1, minTimeout: 100 } : 0,
    onCompromised: () => {
      compromised = true;
    },
  }).catch(() => {
    throw new BrowserWorkflowError(
      "This workflow's journal is busy or unavailable. Check it again before proceeding.",
    );
  });
  try {
    const existing = await readOwnedWorkflowRecord(file, owner);
    return await run(existing, async (record) => {
      const temporary = join(directory, `${id}.${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(record));
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (compromised)
          throw new BrowserWorkflowError(
            "The workflow journal lock expired. Check the draft before retrying.",
          );
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  } finally {
    if (!compromised) await release();
  }
}

export async function reconcileBrowserWorkflowSubmission(
  stateDir: string,
  owner: Owner,
  reference: BrowserWorkflowResultRef,
  projectId: BrowserWorkflowTarget["projectId"],
  read: (saved: BrowserWorkflowSavedResult) => Promise<BrowserWorkflowReceipt>,
): Promise<BrowserWorkflowSavedResult> {
  return withRecord(
    stateDir,
    owner,
    reference.workflowId,
    async (record, save) => {
      if (!record || record.target.projectId !== projectId)
        throw new BrowserWorkflowError("This saved browser result is unavailable in the thread.");
      const saved = savedResult(record, reference.stage);
      // A different action may have started after chat looked up the pending upload.
      // The old work-log link may read the draft without reconciling that later Submit.
      const checkingEarlierUpload =
        reference.stage === "ready_to_upload" && saved.stage !== "ready_to_upload";
      const receipt = await read(
        checkingEarlierUpload
          ? { target: saved.target, definition: saved.definition, stage: saved.stage }
          : saved,
      );
      if (
        !sameTarget(record.target, receipt.target) ||
        record.definition.states[receipt.stage] !== receipt.statusText ||
        rank(receipt.stage) < rank(saved.stage)
      )
        throw new BrowserWorkflowError("The browser did not confirm the saved receipt.");
      if (
        checkingEarlierUpload ||
        (!saved.pendingAction && !saved.submitRequiresUser) ||
        receipt.stage === saved.stage
      )
        return saved;
      // A stale label, an earlier read or another draft leaves the action uncertain.
      if (
        record.pending &&
        !reconcilesPending(record, {
          stage: receipt.stage,
          ...(receipt.observedAt !== undefined && { observedAt: receipt.observedAt }),
          ...(receipt.identityText !== undefined && { identityText: receipt.identityText }),
        })
      )
        return saved;
      const verified = recordReceipt(record, {
        stage: receipt.stage,
        statusSelector: record.definition.statusSelector,
        statusText: receipt.statusText,
        observedAt: new Date().toISOString(),
        source: "pageLabel",
      });
      await save(verified);
      return savedResult(verified, reference.stage);
    },
    true,
  );
}

/** User-only: release an uncertain pending Upload/Submit. Never reachable from the agent tool. */
export async function resolveBrowserWorkflowPending(
  stateDir: string,
  owner: Owner,
  reference: BrowserWorkflowResultRef,
  projectId: BrowserWorkflowTarget["projectId"],
  kind: "confirmNotSent" | "confirmSent",
): Promise<BrowserWorkflowSavedResult> {
  return withRecord(
    stateDir,
    owner,
    reference.workflowId,
    async (record, save) => {
      if (!record || record.target.projectId !== projectId)
        throw new BrowserWorkflowError("This saved browser result is unavailable in the thread.");
      savedResult(record, reference.stage);
      const action = record.pending ? actionForStage(record.evidence.stage) : undefined;
      if (!record.pending || !action)
        throw new BrowserWorkflowError("No Upload or Submit is waiting for your confirmation.");
      const at = new Date().toISOString();
      const resolution = { kind, action, at } as const;
      let next: WorkflowRecord;
      if (kind === "confirmNotSent") {
        next = { ...record, pending: false, pendingContext: undefined, resolution };
      } else {
        const stage = stages[rank(record.evidence.stage) + 1];
        const statusText = stage && record.definition.states[stage];
        if (!stage || !statusText)
          throw new BrowserWorkflowError("This workflow has no status label for the next stage.");
        next = {
          ...recordReceipt(record, {
            stage,
            statusSelector: record.definition.statusSelector,
            statusText,
            observedAt: at,
            source: "user",
          }),
          resolution,
        };
      }
      await save(next);
      return savedResult(next, reference.stage);
    },
    true,
  );
}

export function makeBrowserWorkflows(stateDir: string, owner: Owner, browser: Browser) {
  async function observe(
    id: string,
    record: WorkflowRecord,
    save: (record: WorkflowRecord) => Promise<void>,
    result: BrowserWorkflowHostResult | undefined,
    resume = false,
  ): Promise<{ record: WorkflowRecord; report: BrowserWorkflowReport }> {
    if (result && !sameTarget(record.target, result.target)) result = undefined;
    const observation = result?.observation;
    const verified = result && evidence(record.definition, result);
    const uncertainty = record.evidence.stage === "ready_to_upload" ? uploadUncertain : uncertain;
    if (
      !observation ||
      !verified ||
      !result ||
      rank(verified.stage) < rank(record.evidence.stage)
    ) {
      const reason = !result
        ? disconnected
        : verified
          ? "The visible status is older than the last observed status. Recheck the draft."
          : (result.reason ?? "The site did not expose a verifiable status.");
      return {
        record,
        report: report(
          id,
          record,
          record.pending ? "uncertain" : "unobservable",
          record.pending ? `${uncertainty} ${reason}` : reason,
        ),
      };
    }
    const advanced = verified.stage !== record.evidence.stage;
    if (
      record.pending &&
      advanced &&
      !reconcilesPending(record, {
        stage: verified.stage,
        observedAt: verified.observedAt,
        ...(observation.identityText !== undefined && { identityText: observation.identityText }),
      })
    )
      return {
        record,
        report: report(
          id,
          record,
          "uncertain",
          `${uncertainty} The page shows ${verified.statusText}, which cannot be tied to this action.`,
        ),
      };
    const action = record.definition.readOnly ? undefined : actionForStage(verified.stage);
    if (!action || (record.pending && advanced)) {
      record = recordReceipt(record, verified);
      await save(record);
      return { record, report: report(id, record, "verified") };
    }
    if (record.pending) return { record, report: report(id, record, "uncertain", uncertainty) };
    if (advanced) record = recordReceipt(record, verified);
    const { breakpoint } = record.definition;
    if (!breakpoint)
      throw new BrowserWorkflowError("The saved guarded workflow has no breakpoint.");
    const label = action === "upload" ? "Upload" : "Submit";
    const directUpload = record.definition.uploadInputSelector !== undefined;
    const { awaitingPreflight: _awaitingPreflight, ...armed } = record;
    if (observation.breakpoint === "matched") {
      record = clearCompletedWatch({
        ...armed,
        evidence: verified,
        breakpoint: record.breakpoint ?? {
          selector: breakpoint.selector,
          observedText: breakpoint.pauseText,
          observedAt: verified.observedAt,
        },
      });
      await save(record);
      return {
        record,
        report: report(id, record, "paused", `The configured breakpoint matched before ${label}.`),
      };
    }
    if (
      action === "submit" &&
      observation.breakpoint === "clear" &&
      observation.submitRequiresUser
    ) {
      record = clearCompletedWatch({
        ...armed,
        evidence: verified,
        submitRequiresUser: true,
      });
      await save(record);
      return { record, report: report(id, record, "manual_submit", result.reason) };
    }
    if (observation.breakpoint !== "clear" || !actionAvailable(observation)) {
      if (advanced) await save(record);
      return {
        record,
        report: report(
          id,
          record,
          "unobservable",
          observation.breakpoint !== "clear"
            ? `The breakpoint needs one visible match with a known value before ${label}.`
            : (result.reason ??
                (action === "upload"
                  ? directUpload
                    ? "Upload needs one visible, enabled and unobstructed empty HTML file input."
                    : "Upload needs one staged file and one visible, enabled and unobstructed HTML button."
                  : "Submit needs one visible, enabled and unobstructed HTML button.")),
        ),
      };
    }
    const approved = result.submissionApproved === true;
    record = clearCompletedWatch({
      ...armed,
      evidence: verified,
      submitRequiresUser: undefined,
      breakpoint: approved && resume ? undefined : record.breakpoint,
    });
    await save(record);
    if (!approved) {
      return {
        record,
        report: report(
          id,
          record,
          "approval_required",
          action === "upload"
            ? directUpload
              ? "On the original draft, choose a file and approve the upload in the browser."
              : "On the original draft, choose Approve one upload before continuing."
            : approvalRequired,
        ),
      };
    }
    return {
      record,
      report: record.breakpoint
        ? report(
            id,
            record,
            "paused",
            "The condition has cleared. Resume after the user reviews the breakpoint.",
          )
        : report(id, record, "ready"),
    };
  }

  return {
    async arm(
      input: Pick<BrowserWorkflowTarget, "tabId" | "profileId"> & {
        definition: BrowserWorkflowDefinition;
      },
    ): Promise<BrowserWorkflowReport> {
      const supplied = normalizeDefinition(input.definition);
      const result = await browser(
        { phase: "inspect", profileId: input.profileId, definition: supplied },
        input.tabId,
      );
      const verified = result && evidence(supplied, result);
      if (
        !result ||
        !verified ||
        result.target.tabId !== input.tabId ||
        result.target.profileId !== input.profileId
      ) {
        throw new BrowserWorkflowError(result?.reason ?? disconnected);
      }
      let definition = supplied;
      if (result.resolvedDraftUrl !== undefined) {
        const resolved = normalizeDefinition({ ...supplied, url: result.resolvedDraftUrl });
        const url = new URL(resolved.url);
        const address = draftPageAddress(url);
        if (
          resolved.url !== result.resolvedDraftUrl ||
          resolved.url === address ||
          input.definition.url !== address
        ) {
          throw new BrowserWorkflowError("The browser did not confirm the supplied draft URL.");
        }
        if (hasProtectedBrowserUrlState(url)) {
          throw new BrowserWorkflowError(
            "Open a stable draft URL without sign-in or access credentials.",
          );
        }
        definition = resolved;
      }
      const id = workflowId(owner, result.target, definition);
      return withRecord(stateDir, owner, id, async (existing, save) => {
        let record: WorkflowRecord = existing ?? {
          version: 1,
          ...owner,
          target: result.target,
          definition,
          evidence: verified,
          pending: false,
          ...(definition.readOnly ? {} : { awaitingPreflight: true as const }),
        };
        if (existing) {
          if (!sameTarget(existing.target, result.target)) {
            throw new BrowserWorkflowError("A workflow already owns this result in another tab.");
          }
          if (existing.definition.readOnly !== definition.readOnly) {
            throw new BrowserWorkflowError(
              "A workflow already owns this result. Keep its original mode.",
            );
          }
          if (!isDeepStrictEqual(existing.definition, definition)) {
            const { submitSelector, breakpoint, uploadSelector, uploadInputSelector } = definition;
            if (
              !existing.awaitingPreflight ||
              submitSelector === undefined ||
              !breakpoint ||
              !existing.definition.breakpoint
            ) {
              throw new BrowserWorkflowError(
                "A workflow already owns this result. Use its original draft and selectors.",
              );
            }
            const updated = {
              ...existing.definition,
              submitSelector,
              ...(existing.definition.uploadSelector !== undefined && uploadSelector !== undefined
                ? { uploadSelector }
                : {}),
              ...(existing.definition.uploadInputSelector !== undefined &&
              uploadInputSelector !== undefined
                ? { uploadInputSelector }
                : {}),
              breakpoint: { ...existing.definition.breakpoint, selector: breakpoint.selector },
            };
            if (!isDeepStrictEqual(updated, definition)) {
              throw new BrowserWorkflowError(
                "A workflow already owns this result. Use its original draft and selectors.",
              );
            }
            record = { ...existing, definition: updated };
          }
        }
        if (!record.definition.readOnly && record !== existing) await save(record);
        const observation = result.observation;
        // Proposals can only refer to the definition and target already in the journal.
        if (
          !record.definition.readOnly &&
          !record.pending &&
          actionForStage(record.evidence.stage) === actionForStage(verified.stage) &&
          actionForStage(verified.stage) !== undefined &&
          observation?.breakpoint === "clear" &&
          actionAvailable(observation)
        ) {
          const targeted = await browser(
            {
              phase: "inspect",
              profileId: record.target.profileId,
              definition: record.definition,
              target: record.target,
              workflowId: id,
            },
            record.target.tabId,
          );
          return (await observe(id, record, save, targeted)).report;
        }
        return (await observe(id, record, save, result)).report;
      });
    },

    async advance(
      id: string,
      action: "check" | "enter" | "submit" | "upload" | "resume" | "refresh",
      until?: BrowserWorkflowStage,
    ): Promise<BrowserWorkflowReport> {
      return withRecord(stateDir, owner, id, async (existing, save) => {
        if (!existing) throw new BrowserWorkflowError(missing);
        const readOnly = existing.definition.readOnly === true;
        if (readOnly && (action === "upload" || action === "submit" || action === "resume"))
          throw new BrowserWorkflowError("This read-only workflow only tracks status.");
        if (until) requireMappedGoal(existing, until);
        if (
          action === "upload" &&
          existing.definition.uploadSelector === undefined &&
          existing.definition.uploadInputSelector === undefined
        )
          throw new BrowserWorkflowError("This workflow has no upload step.");
        const request = {
          profileId: existing.target.profileId,
          definition: existing.definition,
          target: existing.target,
          workflowId: id,
        };
        const uploadAlreadyObserved =
          action === "upload" && rank(existing.evidence.stage) >= rank("uploaded");
        const inspect = (statusOnly = readOnly || existing.pending || uploadAlreadyObserved) =>
          browser(
            {
              ...request,
              phase: action === "enter" || action === "refresh" ? action : "inspect",
              statusOnly,
            },
            existing.target.tabId,
          );
        const observation = await inspect();
        if (uploadAlreadyObserved) {
          const verified =
            observation && sameTarget(existing.target, observation.target)
              ? evidence(existing.definition, observation)
              : undefined;
          if (verified && rank(verified.stage) >= rank(existing.evidence.stage)) {
            const received =
              verified.stage === existing.evidence.stage
                ? clearCompletedWatch({ ...existing, evidence: verified })
                : recordReceipt(existing, verified);
            await save(received);
            return report(id, received, "verified");
          }
          return report(
            id,
            existing,
            "unobservable",
            "The current Uploaded receipt could not be verified.",
          );
        }
        const current = await observe(id, existing, save, observation, action === "resume");
        if (
          (action !== "submit" && action !== "upload") ||
          current.report.phase !== "ready" ||
          actionForStage(current.record.evidence.stage) !== action
        )
          return current.report;

        // Reserve durably before handing control to the browser. A process can stop
        // after dispatch and before receiving or saving the site's acknowledgement.
        const dispatchedAt = new Date().toISOString();
        const before = current.record.evidence;
        const pending: WorkflowRecord = {
          ...current.record,
          pending: true,
          pendingContext: {
            action,
            stage: before.stage,
            statusText: before.statusText,
            resourceId: current.record.definition.resourceId,
            observedAt: before.observedAt,
            dispatchedAt,
          },
        };
        await save(pending);
        const result = await browser({ ...request, phase: action }, existing.target.tabId);
        if (
          !result ||
          !sameTarget(existing.target, result.target) ||
          result.disposition === "dispatched"
        ) {
          return (await observe(id, pending, save, await inspect(true))).report;
        }

        // An explicit reply from the guarded operation means it did not click.
        // With no reply we retain the reservation, even if the page still says Uploaded.
        await save({ ...current.record, pendingContext: undefined });
        const rejected = await observe(id, current.record, save, result);
        if (rejected.report.phase !== "approval_required") return rejected.report;

        // A proposal can have expired between inspection and the guarded operation.
        return (await observe(id, rejected.record, save, await inspect())).report;
      });
    },

    async watch(
      id: string,
      until: BrowserWorkflowStage,
      refresh = false,
    ): Promise<BrowserWorkflowReport> {
      return withRecord(
        stateDir,
        owner,
        id,
        async (existing, save) => {
          if (!existing) throw new BrowserWorkflowError(missing);
          requireMappedGoal(existing, until);
          const reached = rank(existing.evidence.stage) >= rank(until);
          const watch = reached ? undefined : { until, refresh };
          const record = { ...existing, watch };
          if (watch || existing.watch) await save(record);
          return report(id, record, reached ? "verified" : "watching");
        },
        true,
      );
    },

    async unwatch(id: string): Promise<BrowserWorkflowReport> {
      return withRecord(
        stateDir,
        owner,
        id,
        async (existing, save) => {
          if (!existing) throw new BrowserWorkflowError(missing);
          const record = { ...existing, watch: undefined };
          if (existing.watch) await save(record);
          return report(id, record, "watch_stopped");
        },
        true,
      );
    },

    async pollWatch(id: string): Promise<void> {
      await withRecord(stateDir, owner, id, async (existing, save) => {
        if (!existing?.watch) return;
        const record = clearCompletedWatch(existing);
        if (!record.watch) {
          // A journal from before this check may still have an already fulfilled watch.
          await save(record);
          return;
        }
        const { target, definition, watch } = record;
        const result = await browser(
          {
            phase: "monitor",
            profileId: target.profileId,
            definition,
            target,
            workflowId: id,
            statusOnly: true,
            refresh: watch.refresh,
            lastVerifiedStage: record.evidence.stage,
          },
          target.tabId,
        ).catch(() => undefined);
        if (!result || !sameTarget(target, result.target)) return;
        const verified = evidence(definition, result);
        if (!verified || rank(verified.stage) <= rank(record.evidence.stage)) return;
        await save(recordReceipt(record, verified));
      });
    },
  };
}

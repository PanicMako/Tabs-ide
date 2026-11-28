import { createHash, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { BrowserQuickAction, BrowserQuickActionFileReceipt } from "@tabs/contracts";
import * as Schema from "effect/Schema";

export interface BrowserAttachmentBookmark {
  readonly projectId: string;
  readonly tabId: string;
  readonly profileId: string;
  readonly hostKey: string;
  readonly partition: string;
  readonly threadId: string;
  readonly instanceId: string;
  readonly managerId: string;
  readonly url: string;
  readonly verifyScreenshotImages?: true;
}

export interface BrowserScreenshotDraftBookmark extends BrowserAttachmentBookmark {
  readonly grantId: string;
  readonly pairedGrantId?: string;
  readonly pageRef: string;
  readonly digest: string;
}

export interface BrowserDeviceComparisonDraftBookmark extends BrowserAttachmentBookmark {
  readonly runId: string;
  readonly step: number;
  readonly digests: readonly [string, string];
}

const QuickActionFileEvidence = Schema.Struct({
  outcome: BrowserQuickAction.fields.outcome,
  receipt: BrowserQuickActionFileReceipt,
});

type BrowserQuickActionFileBookmark = BrowserAttachmentBookmark &
  typeof QuickActionFileEvidence.Type;
const decodeQuickActionFileEvidence = Schema.decodeUnknownSync(QuickActionFileEvidence);

type DeviceComparisonDraftScope = Pick<
  BrowserDeviceComparisonDraftBookmark,
  "projectId" | "threadId" | "runId" | "step"
>;

const ATTACHMENT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BOOKMARK_FIELDS = [
  "projectId",
  "tabId",
  "profileId",
  "hostKey",
  "partition",
  "threadId",
  "instanceId",
  "managerId",
  "url",
] as const satisfies ReadonlyArray<keyof BrowserAttachmentBookmark>;

function readBookmark(file: string): BrowserAttachmentBookmark | undefined {
  let json: string;
  try {
    json = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const bookmark = JSON.parse(json);
  if (
    bookmark &&
    BOOKMARK_FIELDS.every((field) => typeof bookmark[field] === "string" && bookmark[field]) &&
    (bookmark.verifyScreenshotImages === undefined || bookmark.verifyScreenshotImages === true)
  )
    return bookmark;
  throw new Error("The saved browser attachment is invalid.");
}

export class BrowserAttachmentBookmarks {
  constructor(private readonly userDataDir: () => string) {}

  private directory() {
    return join(this.userDataDir(), "browser-attachment-bookmarks");
  }

  private write(destination: string, contents: string) {
    const directory = this.directory();
    const stagingFile = join(directory, `pending-${randomUUID()}`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(stagingFile, contents, { flag: "wx", mode: 0o600 });
      linkSync(stagingFile, destination);
    } finally {
      rmSync(stagingFile, { force: true });
    }
  }

  save(bookmark: BrowserAttachmentBookmark): string {
    const id = randomUUID();
    this.write(join(this.directory(), id), JSON.stringify(bookmark));
    return id;
  }

  read(id: unknown): BrowserAttachmentBookmark | undefined {
    if (typeof id !== "string" || !ATTACHMENT_ID.test(id)) return;
    try {
      return readBookmark(join(this.directory(), id));
    } catch {
      // A missing or unreadable bookmark is unavailable to the renderer.
    }
  }

  saveQuickActionFile(id: string, bookmark: BrowserQuickActionFileBookmark): void {
    if (!ATTACHMENT_ID.test(id)) throw new Error("Invalid Quick Action file result ID.");
    this.write(join(this.directory(), `quick-action-file-${id}`), JSON.stringify(bookmark));
  }

  readQuickActionFile(id: unknown): BrowserQuickActionFileBookmark | undefined {
    if (typeof id !== "string" || !ATTACHMENT_ID.test(id)) return;
    try {
      const bookmark = readBookmark(join(this.directory(), `quick-action-file-${id}`));
      if (bookmark) return { ...bookmark, ...decodeQuickActionFileEvidence(bookmark) };
    } catch {
      // An unreadable file receipt is unavailable to the renderer.
    }
  }
  saveScreenshotDraft(bookmark: BrowserScreenshotDraftBookmark): void {
    if (
      !ATTACHMENT_ID.test(bookmark.grantId) ||
      (bookmark.pairedGrantId !== undefined &&
        (!ATTACHMENT_ID.test(bookmark.pairedGrantId) ||
          bookmark.pairedGrantId === bookmark.grantId))
    )
      throw new Error("Invalid screenshot grant ID.");
    try {
      this.write(
        join(this.directory(), `screenshot-draft-${bookmark.grantId}`),
        JSON.stringify(bookmark),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!isDeepStrictEqual(this.readScreenshotDraft(bookmark.grantId), bookmark)) throw error;
    }
  }

  readScreenshotDraft(grantId: unknown): BrowserScreenshotDraftBookmark | undefined {
    if (typeof grantId !== "string" || !ATTACHMENT_ID.test(grantId))
      throw new Error("Invalid screenshot grant ID.");
    try {
      const bookmark = readBookmark(join(this.directory(), `screenshot-draft-${grantId}`));
      if (!bookmark) return;
      if (
        "grantId" in bookmark &&
        bookmark.grantId === grantId &&
        "pageRef" in bookmark &&
        typeof bookmark.pageRef === "string" &&
        SHA256.test(bookmark.pageRef) &&
        "digest" in bookmark &&
        typeof bookmark.digest === "string" &&
        SHA256.test(bookmark.digest)
      ) {
        const pairedGrantId = "pairedGrantId" in bookmark ? bookmark.pairedGrantId : undefined;
        if (
          pairedGrantId !== undefined &&
          (typeof pairedGrantId !== "string" ||
            !ATTACHMENT_ID.test(pairedGrantId) ||
            pairedGrantId === grantId)
        )
          throw new Error("Invalid paired screenshot grant ID.");
        return {
          ...bookmark,
          grantId,
          pageRef: bookmark.pageRef,
          digest: bookmark.digest,
          ...(pairedGrantId ? { pairedGrantId } : {}),
        };
      }
    } catch {
      // Fail closed on read errors and invalid records.
    }
    throw new Error("The saved screenshot draft bookmark is unavailable.");
  }

  readPairedScreenshotDraft(grantId: unknown, pairedGrantId: unknown) {
    const first = this.readScreenshotDraft(grantId);
    const second = this.readScreenshotDraft(pairedGrantId);
    if (!first && !second) return;
    if (
      !first ||
      !second ||
      first.pairedGrantId !== second.grantId ||
      second.pairedGrantId !== first.grantId ||
      first.pageRef !== second.pageRef ||
      BOOKMARK_FIELDS.some((field) => first[field] !== second[field])
    )
      throw new Error("Both screenshot receipts must belong to the same approved draft.");
    return { bookmark: first, digests: [first.digest, second.digest] };
  }

  private deviceComparisonDraftPath(
    { projectId, threadId, runId, step }: DeviceComparisonDraftScope,
    pending: boolean,
  ) {
    const key = createHash("sha256")
      .update(JSON.stringify([projectId, threadId, runId, step]))
      .digest("hex");
    return join(this.directory(), `device-comparison-${pending ? "pending" : "draft"}-${key}`);
  }

  saveDeviceComparisonDraft(bookmark: BrowserDeviceComparisonDraftBookmark, pending = false) {
    const destination = this.deviceComparisonDraftPath(bookmark, pending);
    const contents = JSON.stringify(pending ? { ...bookmark, pendingId: randomUUID() } : bookmark);
    // Publish both receipts together and keep the first verified bookmark for this scope.
    this.write(destination, contents);
    if (!pending) rmSync(this.deviceComparisonDraftPath(bookmark, true), { force: true });
    if (pending)
      return () => {
        try {
          if (readFileSync(destination, "utf8") === contents) rmSync(destination, { force: true });
        } catch {
          // The checkpoint may already have been removed or replaced by a verified receipt.
        }
      };
  }

  readDeviceComparisonDraft(
    scope: DeviceComparisonDraftScope,
  ): (BrowserDeviceComparisonDraftBookmark & { pending?: true }) | undefined {
    try {
      const verified = readBookmark(this.deviceComparisonDraftPath(scope, false));
      const stored = (verified ?? readBookmark(this.deviceComparisonDraftPath(scope, true))) as
        | (BrowserAttachmentBookmark & { pendingId?: string })
        | undefined;
      if (!stored) return;
      const { pendingId: _pendingId, ...bookmark } = stored;
      if (
        bookmark.projectId !== scope.projectId ||
        bookmark.threadId !== scope.threadId ||
        !("runId" in bookmark) ||
        bookmark.runId !== scope.runId ||
        !("step" in bookmark) ||
        bookmark.step !== scope.step ||
        !("digests" in bookmark) ||
        !Array.isArray(bookmark.digests) ||
        bookmark.digests.length !== 2
      )
        return;
      const [source, target] = bookmark.digests;
      if (
        typeof source !== "string" ||
        typeof target !== "string" ||
        !SHA256.test(source) ||
        !SHA256.test(target)
      )
        return;
      return {
        ...bookmark,
        runId: scope.runId,
        step: scope.step,
        digests: [source, target],
        ...(!verified && { pending: true }),
      };
    } catch {
      // An unreadable receipt is unavailable to the renderer.
    }
  }
}

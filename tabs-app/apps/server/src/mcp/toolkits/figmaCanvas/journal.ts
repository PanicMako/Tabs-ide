import {
  EnvironmentId,
  FigmaCanvasReceipt,
  FigmaCanvasTarget,
  FigmaOperationId,
  ThreadId,
  type FigmaFrameSpec,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const Reservation = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  accountDigest: FigmaOperationId,
  target: FigmaCanvasTarget,
});
type Owner = Pick<typeof Reservation.Type, "environmentId" | "threadId">;

const decodeReservation = Schema.decodeUnknownSync(Reservation);
const decodeReceipt = Schema.decodeUnknownSync(FigmaCanvasReceipt);
const validId = Schema.is(FigmaOperationId);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function figmaOperationId(owner: Owner, target: FigmaCanvasTarget, frame: FigmaFrameSpec) {
  return digest(
    JSON.stringify([
      owner.environmentId,
      owner.threadId,
      target.attachmentId,
      target.hostKey,
      target.tabId,
      target.fileKey,
      target.nodeId,
      frame.name,
      frame.text,
      frame.width,
      frame.height,
    ]),
  );
}

async function read(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function createImmutable(directory: string, file: string, record: object) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const draft = join(directory, `${randomUUID()}.tmp`);
  try {
    const handle = await open(draft, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(draft, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await rm(draft, { force: true });
  }
}

export function figmaCanvasJournal(stateDir: string, operationId: string) {
  if (!validId(operationId)) throw new Error("Invalid Figma operation ID.");
  const directory = join(stateDir, "figma-canvas");
  const pendingPath = join(directory, `${operationId}.pending.json`);
  const receiptPath = join(directory, `${operationId}.receipt.json`);
  return {
    reserve: (owner: Owner, target: FigmaCanvasTarget, email: string) =>
      createImmutable(directory, pendingPath, { ...owner, target, accountDigest: digest(email) }),
    async state(owner: Owner, email?: string) {
      const payload = await read(pendingPath);
      if (payload === undefined) return undefined;
      const reservation = decodeReservation(payload);
      if (
        reservation.environmentId !== owner.environmentId ||
        reservation.threadId !== owner.threadId ||
        (email !== undefined && reservation.accountDigest !== digest(email))
      )
        throw new Error("Open the original Figma operation in its approved account and thread.");
      const receipt = await read(receiptPath);
      const verified = receipt === undefined ? undefined : decodeReceipt(receipt);
      if (verified && !isDeepStrictEqual(verified.target, reservation.target))
        throw new Error("The Figma receipt does not match the saved target.");
      return { target: reservation.target, receipt: verified };
    },
    // Only the owner of a new reservation may clear it, before its connector call starts.
    clearUnsentReservation: () => rm(pendingPath),
    saveReceipt: (receipt: FigmaCanvasReceipt) => createImmutable(directory, receiptPath, receipt),
  };
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  DeviceComparisonError,
  DeviceComparisonReport,
  DeviceComparisonResultRef,
  DeviceComparisonScrollDirection,
  DeviceComparisonTotal,
  ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

const Header = Schema.Struct({
  threadId: ThreadId,
  report: DeviceComparisonReport,
});
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Images = Schema.Struct({
  sourcePng: Schema.optional(Schema.String),
  targetPng: Schema.optional(Schema.String),
});
// Saved results also carry a digest per image so tampered or damaged bytes are not shown.
const StoredImages = Schema.Struct({
  ...Images.fields,
  sourceSha256: Schema.optional(Digest),
  targetSha256: Schema.optional(Digest),
});
const decodeHeader = Schema.decodeUnknownSync(Header);
const decodeImages = Schema.decodeUnknownSync(StoredImages);
const decodeRunId = Schema.decodeUnknownSync(DeviceComparisonResultRef.fields.runId);
const ReplayControl = Schema.Struct({
  label: Schema.String.check(Schema.isMaxLength(180)),
  role: Schema.String.check(Schema.isMaxLength(64)),
  context: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(180))),
});
const Amount = Schema.Struct({
  minor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  display: Schema.String.check(Schema.isMaxLength(32)),
});
const Checkpoint = Schema.Struct({
  step: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  timing: Schema.Literals(["before", "after"]),
});
export const MAX_REPLAY_SCROLLS = 6;
const ReplayCheckpoint = Schema.Struct({
  version: Schema.Literal(1),
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 11 })),
  applied: Schema.Literals(["yes", "no", "unknown"]),
  previouslyApplied: Schema.Boolean,
  clearsBlocker: Schema.Boolean,
  scroll: Schema.optionalKey(
    Schema.Struct({
      attempts: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_REPLAY_SCROLLS })),
      inFlight: Schema.Boolean,
    }),
  ),
  screenKey: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))),
  steps: Schema.Array(
    Schema.Struct({
      action: Schema.Union([
        Schema.Struct({
          type: Schema.Literal("tap"),
          control: ReplayControl,
          uniqueIdentifier: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(96))),
        }),
        Schema.Struct({
          type: Schema.Literal("scroll"),
          direction: DeviceComparisonScrollDirection,
        }),
      ]),
      expected: Schema.optionalKey(ReplayControl),
      beforeTotal: Schema.optionalKey(Amount),
      afterTotal: Schema.optionalKey(Amount),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
  total: Schema.optionalKey(
    Schema.Struct({
      settings: DeviceComparisonTotal,
      startsAt: Checkpoint,
      pending: Schema.optionalKey(Checkpoint),
    }),
  ),
  requireConsequentialReview: Schema.Boolean,
});
export type DeviceReplayCheckpoint = typeof ReplayCheckpoint.Type;
const decodeReplay = Schema.decodeUnknownSync(ReplayCheckpoint);
const decodeActiveReplay = Schema.decodeUnknownSync(
  Schema.Struct({ ...Header.fields, checkpoint: ReplayCheckpoint }),
);
const maxReplaySourceSteps = 12;
const maxReplaySourceFrameBytes = 4 * 1024 * 1024;
const ReplaySourceFrame = Schema.Struct({
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maxReplaySourceFrameBytes })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});
const ReplaySourceStep = Schema.Struct({
  before: Schema.optionalKey(ReplaySourceFrame),
  after: Schema.optionalKey(ReplaySourceFrame),
});
const ReplaySourceHeader = Schema.Struct({
  version: Schema.Literal(1),
  threadId: Schema.String,
  runId: DeviceComparisonResultRef.fields.runId,
  steps: Schema.Array(ReplaySourceStep).check(Schema.isMaxLength(maxReplaySourceSteps)),
});
const decodeReplaySourceHeader = Schema.decodeUnknownSync(ReplaySourceHeader);
const replaySourceTimings = ["before", "after"] as const;
type ReplaySourceTiming = (typeof replaySourceTimings)[number];
const maxReplayBytes = 48 * 1024;
const maxHeaderBytes = 16 * 1024;
const maxActiveReplayBytes = maxReplayBytes + maxHeaderBytes;
// Two base64-encoded device screenshots, each capped at 4 MiB before encoding.
const maxFileBytes = 12 * 1024 * 1024;
const base64Digest = (png: string) =>
  createHash("sha256").update(Buffer.from(png, "base64")).digest("hex");

/** Verify saved result images. Old records have no digest, so they load but stay unverified. */
function verifiedImages(stored: typeof StoredImages.Type) {
  const evidence: {
    sourcePng?: string;
    targetPng?: string;
    unverified?: true;
    unavailableReason?: string;
  } = {};
  const failed: string[] = [];
  for (const side of ["source", "target"] as const) {
    const png = stored[`${side}Png`];
    if (png === undefined) continue;
    const digest = stored[`${side}Sha256`];
    if (digest === undefined) evidence.unverified = true;
    if (digest !== undefined && digest !== base64Digest(png)) failed.push(side);
    else evidence[`${side}Png`] = png;
  }
  if (failed.length > 0)
    evidence.unavailableReason = `The saved ${failed.join(" and ")} image failed its integrity check and was not loaded.`;
  return evidence;
}
const missing = (cause: unknown) => {
  if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
  throw cause;
};

async function writeAtomically(
  path: string,
  content: string | ((file: FileHandle) => Promise<void>),
  isCurrent: () => boolean,
  temporary = `${path}.${randomUUID()}.tmp`,
) {
  if (!isCurrent()) return false;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      if (typeof content === "string") await file.writeFile(content);
      else await content(file);
      await file.sync();
    } finally {
      await file.close();
    }
    if (!isCurrent()) return false;
    await rename(temporary, path);
    return true;
  } finally {
    await rm(temporary, { force: true });
  }
}

const replaySourceDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function readBytes(file: FileHandle, size: number, position: number) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(bytes, offset, size - offset, position + offset);
    if (bytesRead === 0) return undefined;
    offset += bytesRead;
  }
  return bytes;
}

async function readReplaySourceHeader(file: FileHandle) {
  const prefix = await readBytes(file, Math.min((await file.stat()).size, maxHeaderBytes), 0);
  const separator = prefix?.indexOf(0x0a) ?? -1;
  if (!prefix || separator < 0) return undefined;
  try {
    return decodeReplaySourceHeader(JSON.parse(prefix.toString("utf8", 0, separator)));
  } catch {
    return undefined;
  }
}

function replaySourceFileSize(steps: ReadonlyArray<typeof ReplaySourceStep.Type>) {
  let size = 0;
  for (const step of steps) {
    for (const timing of replaySourceTimings) {
      const frame = step[timing];
      if (!frame) continue;
      if (frame.offset !== size) return undefined;
      size += frame.size;
    }
  }
  return maxHeaderBytes + size;
}

async function withReplaySourceFile<T>(
  path: string,
  read: (file: FileHandle, header: typeof ReplaySourceHeader.Type) => T | Promise<T>,
) {
  const file = await open(path, "r").catch(missing);
  if (!file) return undefined;
  try {
    const header = await readReplaySourceHeader(file);
    if (header) return await read(file, header);
    return undefined;
  } finally {
    await file.close();
  }
}

async function readBounded<T>(path: string, maxBytes: number, decode: (value: unknown) => T) {
  const file = await open(path, "r").catch(missing);
  if (!file) return undefined;
  try {
    if ((await file.stat()).size > maxBytes) throw new Error("Checkpoint exceeds the size limit");
    return decode(JSON.parse(await file.readFile("utf8")));
  } finally {
    await file.close();
  }
}

export function makeDeviceComparisonStore(stateDir: string) {
  const directory = join(stateDir, "device-comparisons");
  const writes = Semaphore.makeUnsafe(1);
  const pathFor = (threadId: ThreadId) =>
    join(directory, createHash("sha256").update(threadId).digest("hex"));
  const runPath = (path: string, runId: string) => `${path}.${decodeRunId(runId)}.jsonl`;
  const replayPath = (threadId: ThreadId, runId: string) =>
    `${pathFor(threadId)}.${decodeRunId(runId)}.replay.json`;
  const activeReplayPath = (threadId: ThreadId) => `${pathFor(threadId)}.replay.json`;
  const replaySourcePath = (threadId: ThreadId) => `${pathFor(threadId)}.replay.frames`;
  // The write permit reserves this staging path. A crash leaves at most one per thread.
  const replaySourceTemporary = (threadId: ThreadId) => `${replaySourcePath(threadId)}.tmp`;
  const resultTemporary = (threadId: ThreadId) => `${pathFor(threadId)}.result.tmp`;
  const readReplaySourceOwner = (threadId: ThreadId) =>
    withReplaySourceFile(replaySourcePath(threadId), (_, header) =>
      header.threadId === threadId ? header.runId : undefined,
    );
  const readActiveReplay = async (threadId: ThreadId) => {
    const saved = await readBounded(
      activeReplayPath(threadId),
      maxActiveReplayBytes,
      decodeActiveReplay,
    );
    if (!saved) return undefined;
    const { report, checkpoint } = saved;
    if (
      saved.threadId !== threadId ||
      report.phase !== "stopped" ||
      !report.target ||
      !report.savedAt ||
      report.approvalId !== undefined ||
      report.agentRecording !== undefined ||
      report.firstDifference !== undefined ||
      report.availableEvidence !== undefined ||
      report.busy ||
      report.playing ||
      report.canResume ||
      report.uncertainTap !== (checkpoint.applied === "unknown") ||
      report.steps.length !== checkpoint.steps.length ||
      report.completedSteps !== checkpoint.index ||
      checkpoint.index >= checkpoint.steps.length
    )
      throw new Error("Invalid active replay checkpoint");
    return saved;
  };

  const loadReplay = (threadId: ThreadId, runId?: string) =>
    Effect.tryPromise({
      try: async () => {
        const active = await readActiveReplay(threadId);
        if (active)
          return runId === undefined || runId === active.report.runId ? active : undefined;
        if (runId === undefined) return undefined;
        const checkpoint = await readBounded(
          replayPath(threadId, runId),
          maxReplayBytes,
          decodeReplay,
        );
        return checkpoint && checkpoint.index < checkpoint.steps.length
          ? { checkpoint, report: undefined }
          : undefined;
      },
      catch: () =>
        new DeviceComparisonError({
          reason: "The saved replay checkpoint is unavailable.",
        }),
    });

  const saveReplay = (
    threadId: ThreadId,
    report: DeviceComparisonReport,
    checkpoint: DeviceReplayCheckpoint,
    isCurrent: () => boolean,
  ) =>
    writes.withPermit(
      Effect.tryPromise({
        try: async () => {
          if (!isCurrent()) return false;
          // Check we can read what we write before the guarded device input can be sent.
          const record = decodeActiveReplay({ threadId, report, checkpoint });
          const content = JSON.stringify(record);
          if (Buffer.byteLength(content) > maxActiveReplayBytes)
            throw new Error("Replay checkpoint exceeds the size limit");
          await mkdir(directory, { recursive: true, mode: 0o700 });
          return writeAtomically(activeReplayPath(threadId), content, isCurrent);
        },
        catch: () =>
          new DeviceComparisonError({
            reason: "Tabs could not save replay progress.",
          }),
      }).pipe(Effect.uninterruptible),
    );

  const saveReplaySourceFrames = (
    threadId: ThreadId,
    runId: string,
    frames: ReadonlyArray<{
      readonly before?: string;
      readonly after?: string;
    }>,
    isCurrent: () => boolean,
  ) =>
    writes.withPermit(
      Effect.tryPromise({
        try: async () => {
          if (!isCurrent()) return false;
          decodeRunId(runId);
          if (frames.length > maxReplaySourceSteps) throw new Error("Too many replay source steps");
          const path = replaySourcePath(threadId);
          const temporary = replaySourceTemporary(threadId);
          const alreadySaved = await withReplaySourceFile(path, async (file, header) => {
            if (header.threadId !== threadId || header.runId !== runId) return false;
            return (await file.stat()).size === replaySourceFileSize(header.steps);
          });
          if (!isCurrent()) return false;
          await rm(temporary, { force: true });
          if (alreadySaved) return isCurrent();
          await mkdir(directory, { recursive: true, mode: 0o700 });
          return writeAtomically(
            path,
            async (file) => {
              // Reserve the header so each PNG can be decoded, hashed, and written in one pass.
              await file.writeFile(Buffer.alloc(maxHeaderBytes));
              const steps: (typeof ReplaySourceStep.Type)[] = [];
              let offset = 0;
              for (const frame of frames) {
                const step: Partial<Record<ReplaySourceTiming, typeof ReplaySourceFrame.Type>> = {};
                for (const timing of replaySourceTimings) {
                  const png = frame[timing];
                  if (png === undefined) continue;
                  if (Buffer.byteLength(png, "base64") > maxReplaySourceFrameBytes)
                    throw new Error("Replay source frame exceeds the size limit");
                  const bytes = Buffer.from(png, "base64");
                  if (bytes.length === 0) throw new Error("Missing replay source frame bytes");
                  step[timing] = {
                    offset,
                    size: bytes.length,
                    sha256: replaySourceDigest(bytes),
                  };
                  await file.writeFile(bytes);
                  offset += bytes.length;
                }
                steps.push(step);
              }
              const header = Buffer.from(
                `${JSON.stringify({ version: 1, threadId, runId, steps })}\n`,
              );
              if (header.length > maxHeaderBytes)
                throw new Error("Replay source header is too large");
              const { bytesWritten } = await file.write(header, 0, header.length, 0);
              if (bytesWritten !== header.length)
                throw new Error("Incomplete replay source header");
            },
            isCurrent,
            temporary,
          );
        },
        catch: () =>
          new DeviceComparisonError({
            reason: "Tabs could not save replay screenshots.",
          }),
      }).pipe(Effect.uninterruptible),
    );

  const loadReplaySourceFrame = (
    threadId: ThreadId,
    runId: string,
    stepIndex: number,
    timing: ReplaySourceTiming,
  ) =>
    Effect.tryPromise({
      try: async () => {
        if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= maxReplaySourceSteps)
          return undefined;
        return withReplaySourceFile(replaySourcePath(threadId), async (file, header) => {
          if (header.threadId !== threadId || header.runId !== runId) return undefined;
          const frame = header.steps[stepIndex]?.[timing];
          if (!frame || (await file.stat()).size !== replaySourceFileSize(header.steps))
            return undefined;
          const bytes = await readBytes(file, frame.size, maxHeaderBytes + frame.offset);
          return bytes && replaySourceDigest(bytes) === frame.sha256
            ? bytes.toString("base64")
            : undefined;
        });
      },
      catch: () =>
        new DeviceComparisonError({
          reason: "The saved replay screenshot is unavailable.",
        }),
    });

  const clearReplay = (threadId: ThreadId, runId: string) =>
    writes.withPermit(
      Effect.tryPromise({
        try: async () => {
          const active = await readActiveReplay(threadId);
          // Retire the older fallback before removing the active restore entry or its images.
          await rm(replayPath(threadId, runId), { force: true });
          if (active?.report.runId === runId) await rm(activeReplayPath(threadId), { force: true });
          const sourceOwner = await readReplaySourceOwner(threadId);
          if (sourceOwner === runId) await rm(replaySourcePath(threadId), { force: true });
          await rm(replaySourceTemporary(threadId), { force: true });
          await rm(resultTemporary(threadId), { force: true });
        },
        catch: () =>
          new DeviceComparisonError({
            reason: "Tabs could not remove the replay checkpoint.",
          }),
      }).pipe(Effect.uninterruptible),
    );

  const supersedeReplay = (threadId: ThreadId, runId: string, isCurrent: () => boolean) =>
    writes.withPermit(
      Effect.tryPromise({
        try: async () => {
          if (!isCurrent()) return;
          const active = await readActiveReplay(threadId).catch(() => undefined);
          const latest = await readFile(`${pathFor(threadId)}.latest`, "utf8").catch(missing);
          if (!isCurrent()) return;
          const previous = active?.report.runId;
          for (const oldRun of new Set([latest, previous])) {
            if (oldRun && oldRun !== runId && isCurrent())
              await rm(replayPath(threadId, oldRun), { force: true });
          }
          if (!isCurrent()) return;
          if (active?.report.runId !== runId) await rm(activeReplayPath(threadId), { force: true });
          const sourceOwner = await readReplaySourceOwner(threadId);
          if (!isCurrent()) return;
          if (sourceOwner !== runId) await rm(replaySourcePath(threadId), { force: true });
          await rm(replaySourceTemporary(threadId), { force: true });
          await rm(resultTemporary(threadId), { force: true });
        },
        catch: () =>
          new DeviceComparisonError({
            reason: "Tabs could not replace the saved replay.",
          }),
      }).pipe(Effect.uninterruptible),
    );

  const load = (threadId: ThreadId, runId?: string, includeImages = false) =>
    Effect.tryPromise({
      try: async () => {
        const path = pathFor(threadId);
        const latest =
          runId === undefined ? await readFile(`${path}.latest`, "utf8").catch(missing) : undefined;
        const requested = runId ?? latest;
        const current =
          requested === undefined
            ? undefined
            : await open(runPath(path, requested), "r").catch(missing);
        // Previous builds stored the most recent checkpoint directly under the thread key.
        const file =
          current ??
          (latest === undefined ? await open(`${path}.jsonl`, "r").catch(missing) : undefined);
        if (!file) return undefined;
        try {
          const prefix = Buffer.alloc(maxHeaderBytes);
          const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
          const separator = prefix.subarray(0, bytesRead).indexOf(0x0a);
          if (separator < 0) throw new Error("Missing checkpoint header");
          const { threadId: owner, report } = decodeHeader(
            JSON.parse(prefix.toString("utf8", 0, separator)),
          );
          const savedOutcome =
            report.phase === "completed"
              ? report.target !== undefined &&
                report.steps.length > 0 &&
                report.completedSteps === report.steps.length &&
                !report.uncertainTap
              : report.phase === "stopped" && report.firstDifference !== undefined;
          if (
            owner !== threadId ||
            !report.savedAt ||
            !savedOutcome ||
            report.approvalId !== undefined ||
            report.canResume ||
            report.playing ||
            report.busy
          ) {
            throw new Error("Invalid checkpoint report");
          }
          if (requested !== undefined && requested !== report.runId) return undefined;
          // Polling status reads just the bounded metadata from the same atomic record.
          if (!includeImages || !report.firstDifference) return { report };
          const { size } = await file.stat();
          if (size > maxFileBytes) throw new Error("Checkpoint exceeds the size limit");
          const contents = await file.readFile("utf8");
          return {
            report,
            evidence: verifiedImages(
              decodeImages(JSON.parse(contents.slice(contents.indexOf("\n") + 1))),
            ),
          };
        } finally {
          await file.close();
        }
      },
      catch: () =>
        new DeviceComparisonError({
          reason: "The saved comparison is unavailable.",
        }),
    });

  const save = (
    threadId: ThreadId,
    report: DeviceComparisonReport,
    evidence: typeof Images.Type,
    isCurrent: () => boolean,
  ) =>
    writes.withPermit(
      Effect.tryPromise({
        try: async () => {
          if (!isCurrent()) return false;
          const header = `${JSON.stringify({ threadId, report })}\n`;
          const images = JSON.stringify({
            ...evidence,
            ...(evidence.sourcePng !== undefined && {
              sourceSha256: base64Digest(evidence.sourcePng),
            }),
            ...(evidence.targetPng !== undefined && {
              targetSha256: base64Digest(evidence.targetPng),
            }),
          });
          if (
            Buffer.byteLength(header) > maxHeaderBytes ||
            Buffer.byteLength(header) + Buffer.byteLength(images) > maxFileBytes
          ) {
            throw new Error("Checkpoint exceeds the size limit");
          }
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const path = pathFor(threadId);
          const temporary = resultTemporary(threadId);
          if (!isCurrent()) return false;
          await rm(temporary, { force: true });
          if (
            !(await writeAtomically(
              runPath(path, report.runId),
              header + images,
              isCurrent,
              temporary,
            ))
          )
            return false;
          await writeAtomically(`${path}.latest`, report.runId, isCurrent);
          return true;
        },
        catch: () =>
          new DeviceComparisonError({
            reason: "Tabs could not save the comparison result.",
          }),
      }).pipe(Effect.uninterruptible),
    );

  return {
    load,
    save,
    loadReplay,
    saveReplay,
    saveReplaySourceFrames,
    loadReplaySourceFrame,
    clearReplay,
    supersedeReplay,
  };
}

export type DeviceComparisonStore = ReturnType<typeof makeDeviceComparisonStore>;

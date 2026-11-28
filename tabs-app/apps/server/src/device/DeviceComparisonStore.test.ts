import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadId, type DeviceComparisonReport } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDeviceComparisonStore, type DeviceReplayCheckpoint } from "./DeviceComparisonStore.ts";

const threadId = ThreadId.make("checkout");
const otherThreadId = ThreadId.make("other-checkout");
const current = () => true;
const image = (color: number) => {
  const png = new PNG({ width: 1, height: 1 });
  png.data.fill(color);
  return PNG.sync.write(png).toString("base64");
};
const before = image(0);
const after = image(255);
const checkpoint: DeviceReplayCheckpoint = {
  version: 1,
  index: 0,
  applied: "no",
  previouslyApplied: false,
  clearsBlocker: false,
  steps: [{ action: { type: "tap", control: { label: "Continue", role: "button" } } }],
  requireConsequentialReview: false,
};

describe("replay source frames", () => {
  let directory: string;
  let store: ReturnType<typeof makeDeviceComparisonStore>;
  let runId: string;
  const threadPath = (owner: ThreadId = threadId) =>
    join(directory, "device-comparisons", createHash("sha256").update(owner).digest("hex"));
  const sourcePath = (owner?: ThreadId) => `${threadPath(owner)}.replay.frames`;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tabs-replay-source-"));
    store = makeDeviceComparisonStore(directory);
    runId = randomUUID();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("saves once, reopens by step and timing, and verifies thread and run identity", async () => {
    const sourceFrames = [{ before, after }, {}, { after: before }];
    await expect(
      Effect.runPromise(store.saveReplaySourceFrames(threadId, runId, sourceFrames, current)),
    ).resolves.toBe(true);
    const reopened = makeDeviceComparisonStore(directory);
    await expect(
      Effect.runPromise(
        reopened.saveReplaySourceFrames(threadId, runId, [{ before: after }], current),
      ),
    ).resolves.toBe(true);
    const load = (index: number, timing: "before" | "after") =>
      Effect.runPromise(reopened.loadReplaySourceFrame(threadId, runId, index, timing));
    await expect(load(0, "before")).resolves.toBe(before);
    await expect(load(0, "after")).resolves.toBe(after);
    await expect(load(2, "after")).resolves.toBe(before);
    await expect(load(1, "before")).resolves.toBeUndefined();
    await expect(load(3, "after")).resolves.toBeUndefined();
    await expect(load(-1, "before")).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(reopened.loadReplaySourceFrame(threadId, randomUUID(), 0, "before")),
    ).resolves.toBeUndefined();
    await copyFile(sourcePath(), sourcePath(otherThreadId));
    await expect(
      Effect.runPromise(reopened.loadReplaySourceFrame(otherThreadId, runId, 0, "before")),
    ).resolves.toBeUndefined();
  });

  it("rejects changed bytes in the selected frame and can still read another frame", async () => {
    await Effect.runPromise(
      store.saveReplaySourceFrames(threadId, runId, [{ before, after }], current),
    );
    const file = await open(sourcePath(), "r+");
    try {
      const { size } = await file.stat();
      // Damage the second PNG without changing the header, file size, or PNG signature.
      await file.write(Buffer.from([1]), 0, 1, size - 1);
    } finally {
      await file.close();
    }
    await expect(
      Effect.runPromise(store.loadReplaySourceFrame(threadId, runId, 0, "after")),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(store.loadReplaySourceFrame(threadId, runId, 0, "before")),
    ).resolves.toBe(before);
  });

  it("keeps the committed sidecar when ownership is lost before replacement", async () => {
    await Effect.runPromise(store.saveReplaySourceFrames(threadId, runId, [{ before }], current));
    const newer = randomUUID();
    const staging = `${sourcePath()}.tmp`;
    await expect(
      Effect.runPromise(
        store.saveReplaySourceFrames(threadId, newer, [{ after }], () => !existsSync(staging)),
      ),
    ).resolves.toBe(false);
    expect(existsSync(staging)).toBe(false);
    await expect(
      Effect.runPromise(store.loadReplaySourceFrame(threadId, newer, 0, "after")),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(store.loadReplaySourceFrame(threadId, runId, 0, "before")),
    ).resolves.toBe(before);
  });

  it("caps steps, frame sizes, and headers without publishing partial writes", async () => {
    const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64");
    for (const [owner, frames] of [
      [threadId, Array.from({ length: 13 }, () => ({}))],
      [threadId, [{ before, after: tooLarge }]],
      [ThreadId.make("t".repeat(16 * 1024)), [{ before }]],
    ] as const) {
      await expect(
        Effect.runPromise(store.saveReplaySourceFrames(owner, runId, frames, current)),
      ).rejects.toMatchObject({ _tag: "DeviceComparisonError" });
      expect(existsSync(sourcePath(owner))).toBe(false);
    }
    expect(await readdir(join(directory, "device-comparisons"))).toEqual([]);
  });

  it("retires frames without a progress checkpoint while preserving frozen evidence", async () => {
    const endpoint = {
      hostId: "host",
      deviceId: "device",
      name: "Test",
      appId: "com.tabs.test",
    };
    const report: DeviceComparisonReport = {
      runId,
      phase: "stopped",
      source: { ...endpoint, platform: "ios" },
      target: { ...endpoint, platform: "android" },
      busy: false,
      playing: false,
      completedSteps: 0,
      steps: [{ label: "Continue" }],
      canResume: false,
      uncertainTap: false,
      savedAt: "2026-11-27T00:00:00.000Z",
      firstDifference: {
        step: 1,
        kind: "control",
        reason: "Continue is missing",
      },
    };
    const evidence = { sourcePng: before, targetPng: after };
    await Effect.runPromise(store.save(threadId, report, evidence, current));
    await Effect.runPromise(store.saveReplaySourceFrames(threadId, runId, [{ before }], current));
    await writeFile(`${sourcePath()}.tmp`, "staged bytes from an interrupted write");
    const newer = randomUUID();
    await Effect.runPromise(store.clearReplay(threadId, newer));
    await Effect.runPromise(store.supersedeReplay(threadId, newer, () => false));
    await Effect.runPromise(store.supersedeReplay(threadId, runId, current));
    expect(existsSync(sourcePath())).toBe(true);
    expect(existsSync(`${sourcePath()}.tmp`)).toBe(false);
    await Effect.runPromise(store.supersedeReplay(threadId, newer, current));
    expect(existsSync(sourcePath())).toBe(false);
    await Effect.runPromise(store.saveReplaySourceFrames(threadId, newer, [{ after }], current));
    await Effect.runPromise(store.clearReplay(threadId, runId));
    expect(existsSync(sourcePath())).toBe(true);
    await Effect.runPromise(store.clearReplay(threadId, newer));
    expect(existsSync(sourcePath())).toBe(false);
    await expect(Effect.runPromise(store.load(threadId, runId, true))).resolves.toEqual({
      report,
      evidence,
    });
  });

  it("still loads a legacy checkpoint when no source frames exist", async () => {
    const path = `${threadPath()}.${runId}.replay.json`;
    await mkdir(join(directory, "device-comparisons"));
    await writeFile(path, JSON.stringify(checkpoint));
    await expect(Effect.runPromise(store.loadReplay(threadId, runId))).resolves.toEqual({
      checkpoint,
      report: undefined,
    });
    await expect(
      Effect.runPromise(store.loadReplaySourceFrame(threadId, runId, 0, "before")),
    ).resolves.toBeUndefined();
  });

  it("clears a short source file with a readable ownership header", async () => {
    await Effect.runPromise(store.saveReplaySourceFrames(threadId, runId, [{ before }], current));
    const path = sourcePath();
    const headerEnd = (await readFile(path)).indexOf(0x0a) + 1;
    expect(headerEnd).toBeGreaterThan(0);
    await truncate(path, headerEnd);
    const reopened = makeDeviceComparisonStore(directory);
    await expect(
      Effect.runPromise(reopened.loadReplaySourceFrame(threadId, runId, 0, "before")),
    ).resolves.toBeUndefined();
    await Effect.runPromise(reopened.clearReplay(threadId, runId));
    expect(existsSync(path)).toBe(false);
  });

  it.each(["stop", "replace"] as const)(
    "keeps the active checkpoint and source when %s cannot retire its legacy fallback",
    async (action) => {
      const endpoint = {
        hostId: "host",
        deviceId: "device",
        name: "Test",
        appId: "com.tabs.test",
      };
      const report: DeviceComparisonReport = {
        runId,
        phase: "stopped",
        source: { ...endpoint, platform: "ios" },
        target: { ...endpoint, platform: "android" },
        busy: false,
        playing: false,
        completedSteps: 0,
        steps: [{ label: "Continue" }],
        canResume: false,
        uncertainTap: false,
        savedAt: "2026-11-27T00:00:00.000Z",
      };
      await Effect.runPromise(store.saveReplay(threadId, report, checkpoint, current));
      await Effect.runPromise(store.saveReplaySourceFrames(threadId, runId, [{ before }], current));
      const legacyPath = `${threadPath()}.${runId}.replay.json`;
      await mkdir(legacyPath);
      await writeFile(join(legacyPath, "inaccessible-fallback"), "fixture");
      const retire = (owner: typeof store) =>
        Effect.runPromise(
          action === "stop"
            ? owner.clearReplay(threadId, runId)
            : owner.supersedeReplay(threadId, randomUUID(), current),
        );
      await expect(retire(store)).rejects.toMatchObject({
        _tag: "DeviceComparisonError",
      });
      const reopened = makeDeviceComparisonStore(directory);
      await expect(Effect.runPromise(reopened.loadReplay(threadId, runId))).resolves.toMatchObject({
        checkpoint,
      });
      await expect(
        Effect.runPromise(reopened.loadReplaySourceFrame(threadId, runId, 0, "before")),
      ).resolves.toBe(before);
      await rm(legacyPath, { recursive: true });
      await writeFile(legacyPath, JSON.stringify(checkpoint));
      await retire(reopened);
      await expect(
        Effect.runPromise(reopened.loadReplay(threadId, runId)),
      ).resolves.toBeUndefined();
      expect(existsSync(sourcePath())).toBe(false);
    },
  );
});

describe("saved result image digests", () => {
  let directory: string;
  let store: ReturnType<typeof makeDeviceComparisonStore>;
  const runId = randomUUID();
  const endpoint = {
    hostId: "host",
    deviceId: "device",
    name: "Test",
    appId: "com.tabs.test",
  };
  const report: DeviceComparisonReport = {
    runId,
    phase: "stopped",
    source: { ...endpoint, platform: "ios" },
    target: { ...endpoint, platform: "android" },
    busy: false,
    playing: false,
    completedSteps: 0,
    steps: [{ label: "Continue" }],
    canResume: false,
    uncertainTap: false,
    savedAt: "2026-11-27T00:00:00.000Z",
    firstDifference: {
      step: 1,
      kind: "control",
      reason: "Continue is missing",
    },
  };
  const resultPath = () =>
    join(
      directory,
      "device-comparisons",
      `${createHash("sha256").update(threadId).digest("hex")}.${runId}.jsonl`,
    );
  const rewrite = async (edit: (images: Record<string, unknown>) => Record<string, unknown>) => {
    const text = await readFile(resultPath(), "utf8");
    const split = text.indexOf("\n") + 1;
    const images = JSON.parse(text.slice(split)) as Record<string, unknown>;
    await writeFile(resultPath(), text.slice(0, split) + JSON.stringify(edit(images)));
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tabs-result-digest-"));
    store = makeDeviceComparisonStore(directory);
    await Effect.runPromise(
      store.save(threadId, report, { sourcePng: before, targetPng: after }, current),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes a digest and withholds an image that no longer matches it", async () => {
    await rewrite((images) => {
      expect(images.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
      return { ...images, sourcePng: after };
    });
    const loaded = await Effect.runPromise(store.load(threadId, runId, true));
    expect(loaded?.evidence?.sourcePng).toBeUndefined();
    expect(loaded?.evidence?.targetPng).toBe(after);
    expect(loaded?.evidence?.unavailableReason).toContain(
      "source image failed its integrity check",
    );
  });

  it("loads records saved before digests existed but marks them unverified", async () => {
    await rewrite(({ sourcePng, targetPng }) => ({ sourcePng, targetPng }));
    const loaded = await Effect.runPromise(store.load(threadId, runId, true));
    expect(loaded?.evidence).toEqual({
      sourcePng: before,
      targetPng: after,
      unverified: true,
    });
  });
});

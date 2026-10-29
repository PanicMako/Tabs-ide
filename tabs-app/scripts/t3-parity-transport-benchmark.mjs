import { deepStrictEqual } from "node:assert";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import {
  dedupeSnapshotBodies,
  hasOmittedBodies,
  restoreSnapshotBodies,
  restoreSubagentBodies,
  restoreTurnItemBodies,
  stripBodySourceSequence,
  turnItemBodySourceKey,
} from "../packages/shared/src/orchestrationV2DedupedBodies.ts";
import { makeLiveBodyDeduper } from "../apps/server/src/orchestration-v2/WireProjection.ts";

function byteStats(fullBytes, compactBytes) {
  const fullGzip = gzipSync(fullBytes, { level: 6 }).byteLength;
  const compactGzip = gzipSync(compactBytes, { level: 6 }).byteLength;
  return {
    fullJson: fullBytes.byteLength,
    compactJson: compactBytes.byteLength,
    fullGzip,
    compactGzip,
    jsonSavingsPercent: Number(
      ((1 - compactBytes.byteLength / fullBytes.byteLength) * 100).toFixed(2),
    ),
    gzipSavingsPercent: Number(((1 - compactGzip / fullGzip) * 100).toFixed(2)),
  };
}

function measure(name, iterations, decode) {
  if (globalThis.gc) globalThis.gc();
  const beforeMemory = process.memoryUsage();
  const start = performance.now();
  let decodedRecords = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    decodedRecords += decode();
  }
  const elapsedMs = performance.now() - start;
  const afterMemory = process.memoryUsage();
  return {
    name,
    iterations,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    msPerIteration: Number((elapsedMs / iterations).toFixed(3)),
    heapUsedDeltaBytes: afterMemory.heapUsed - beforeMemory.heapUsed,
    rssDeltaBytes: afterMemory.rss - beforeMemory.rss,
    decodedRecords,
  };
}

const snapshotIterations = 30;
const messageCount = 240;
const body =
  "Tabs transport benchmark: repeated assistant output; Unicode: café, 東京, 🌍.\n".repeat(240);
const messages = Array.from({ length: messageCount }, (_, index) => ({
  id: `message-${index}`,
  text: body,
}));
const fullSnapshot = {
  checkpoints: [],
  subagents: [],
  visibleTurnItems: [],
  messages,
  turnItems: messages.map((message, index) => ({
    id: `turn-${index}`,
    type: "assistant_message",
    messageId: message.id,
    text: message.text,
  })),
};
const compactSnapshot = dedupeSnapshotBodies(fullSnapshot);
deepStrictEqual(restoreSnapshotBodies(compactSnapshot), fullSnapshot);
const fullSnapshotBytes = Buffer.from(JSON.stringify(fullSnapshot));
const compactSnapshotBytes = Buffer.from(JSON.stringify(compactSnapshot));

const liveThreadId = "thread-live-benchmark";
let nextSequence = 1;
const fullLiveTrace = [];
const emit = (type, payload) => {
  const sequence = nextSequence++;
  fullLiveTrace.push({
    kind: "event",
    sequence,
    event: { id: `event-${sequence}`, type, threadId: liveThreadId, payload },
  });
};
const liveText = (suffix = "") => `${body}${suffix}`;
const files = Array.from({ length: 90 }, (_, index) => ({
  path: `src/feature-${String(index).padStart(3, "0")}.tsx`,
  kind: "modified",
  additions: 20 + (index % 17),
  deletions: 3 + (index % 9),
}));
const subagentPrompt = `Inspect the following Unicode workspace content: ${body}`;
const subagentResult = `Completed the inspection with notes: ${body}`;

emit("message.updated", {
  id: "live-message",
  text: liveText(),
  role: "assistant",
  streaming: true,
});
emit("turn-item.updated", {
  type: "assistant_message",
  messageId: "live-message",
  text: liveText(),
});
emit("message.updated", {
  id: "live-message",
  text: liveText("An edited continuation with 🧭 and café."),
  role: "assistant",
  streaming: true,
});
emit("turn-item.updated", {
  type: "assistant_message",
  messageId: "live-message",
  text: liveText("An edited continuation with 🧭 and café."),
});
emit("checkpoint.captured", { id: "checkpoint-live", files });
emit("turn-item.updated", { type: "checkpoint", checkpointId: "checkpoint-live", files });
emit("subagent.updated", { id: "subagent-live", prompt: subagentPrompt, result: subagentResult });
emit("turn-item.updated", {
  type: "subagent",
  subagentId: "subagent-live",
  prompt: subagentPrompt,
  result: subagentResult,
});
emit("subagent.updated", { id: "subagent-live", prompt: subagentPrompt, result: subagentResult });
emit("turn-item.updated", {
  type: "subagent",
  subagentId: "subagent-live",
  prompt: subagentPrompt,
  result: subagentResult,
});

const liveDeduper = makeLiveBodyDeduper(true);
const compactLiveTrace = fullLiveTrace.map(liveDeduper);

function restoreLiveTrace(trace) {
  const messagesById = new Map();
  const checkpointsById = new Map();
  const subagentsById = new Map();
  const versions = new Map();
  const restoredTrace = [];
  const source = {
    messageText: (id) => messagesById.get(id)?.text,
    checkpointFiles: (id) => checkpointsById.get(id)?.files,
    subagent: (id) => subagentsById.get(id),
  };
  const rememberSubagent = (record, sequence) => {
    subagentsById.set(record.id, { prompt: record.prompt, result: record.result });
    versions.set(`subagent:${record.id}`, sequence);
  };

  for (const item of trace) {
    const { sequence, event } = item;
    let payload = event.payload;
    switch (event.type) {
      case "message.updated":
        messagesById.set(payload.id, { text: payload.text });
        versions.set(`message:${payload.id}`, sequence);
        break;
      case "checkpoint.captured":
        checkpointsById.set(payload.id, { files: payload.files });
        versions.set(`checkpoint:${payload.id}`, sequence);
        break;
      case "subagent.updated": {
        const key = `subagent:${payload.id}`;
        if (
          hasOmittedBodies(payload) &&
          (payload.bodySourceSequence === undefined ||
            versions.get(key) !== payload.bodySourceSequence)
        )
          throw new Error(`Subagent source version mismatch at sequence ${sequence}`);
        payload = stripBodySourceSequence(
          restoreSubagentBodies(payload, subagentsById.get(payload.id)),
        );
        if (hasOmittedBodies(payload))
          throw new Error(`Unrestored subagent at sequence ${sequence}`);
        rememberSubagent(payload, sequence);
        break;
      }
      case "turn-item.updated": {
        const key = turnItemBodySourceKey(payload);
        if (
          hasOmittedBodies(payload) &&
          (key === null ||
            payload.bodySourceSequence === undefined ||
            versions.get(key) !== payload.bodySourceSequence)
        )
          throw new Error(`Turn-item source version mismatch at sequence ${sequence}`);
        payload = stripBodySourceSequence(restoreTurnItemBodies(payload, source));
        if (hasOmittedBodies(payload))
          throw new Error(`Unrestored turn item at sequence ${sequence}`);
        break;
      }
    }
    restoredTrace.push({ ...item, event: { ...event, payload } });
  }
  return restoredTrace;
}

deepStrictEqual(restoreLiveTrace(compactLiveTrace), fullLiveTrace);
const fullLiveBytes = Buffer.from(JSON.stringify(fullLiveTrace));
const compactLiveBytes = Buffer.from(JSON.stringify(compactLiveTrace));
const liveIterations = 100;

const shellCount = 10_000;
const shellDataset = Array.from({ length: shellCount }, (_, index) => ({
  id: `thread-${String(shellCount - index).padStart(5, "0")}`,
  projectId: "project-seeded",
  title: `Seeded conversation ${shellCount - index}: ${index % 4 === 0 ? "東京 🌍" : "feature review"}`,
  status: ["idle", "running", "waiting", "completed"][index % 4],
  branch: `codex/feature-${index % 73}`,
  createdAt: new Date(Date.UTC(2026, 0, 1) + (shellCount - index) * 60_000).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 0, 1) + (shellCount - index) * 60_000 + 15_000).toISOString(),
  itemCount: 12 + (index % 89),
  visibleItemCount: 8 + (index % 71),
  latestVisibleMessage: {
    role: index % 2 === 0 ? "assistant" : "user",
    text: `Representative sidebar summary for thread ${index}; café, 東京, 🌍.`,
    createdAt: new Date(
      Date.UTC(2026, 0, 1) + (shellCount - index) * 60_000 + 10_000,
    ).toISOString(),
  },
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: `thread-${index}` },
}));
const pageSize = 100;
const olderPageSize = 25;
const firstPage = {
  snapshotSequence: 10_000,
  totalCount: shellCount,
  nextCursor: shellDataset[pageSize - 1].id,
  threads: shellDataset.slice(0, pageSize),
};
const olderPage = {
  snapshotSequence: 10_000,
  totalCount: shellCount,
  nextCursor: shellDataset[pageSize + olderPageSize - 1].id,
  threads: shellDataset.slice(pageSize, pageSize + olderPageSize),
};
const fullShellSnapshot = {
  snapshotSequence: 10_000,
  totalCount: shellCount,
  threads: shellDataset,
};
const fullShellBytes = Buffer.from(JSON.stringify(fullShellSnapshot));
const firstPageBytes = Buffer.from(JSON.stringify(firstPage));
const olderPageBytes = Buffer.from(JSON.stringify(olderPage));
const pagedGzipBytes =
  gzipSync(firstPageBytes, { level: 6 }).byteLength +
  gzipSync(olderPageBytes, { level: 6 }).byteLength;
const pagingIterations = 20;

const shellDecodeResults = [
  measure(
    "full-decode-10000-shells",
    pagingIterations,
    () => JSON.parse(fullShellBytes.toString("utf8")).threads.length,
  ),
  measure("paged-decode-first-100-plus-next-25", pagingIterations, () => {
    const initial = JSON.parse(firstPageBytes.toString("utf8"));
    const next = JSON.parse(olderPageBytes.toString("utf8"));
    return initial.threads.concat(next.threads).length;
  }),
];

const report = {
  benchmark: "t3-parity-transport-workloads",
  generatedAt: new Date().toISOString(),
  runtime: {
    bun: process.versions.bun ?? null,
    nodeCompatibility: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  compression: "gzip level 6; paged total is the sum of separately compressed response payloads",
  snapshotDedup: {
    dataset: {
      messageCount,
      turnItemCount: messageCount,
      bodyCharactersPerRecord: body.length,
      bodyUtf8BytesPerRecord: Buffer.byteLength(body),
      iterations: snapshotIterations,
    },
    bytes: byteStats(fullSnapshotBytes, compactSnapshotBytes),
    decodeRestoreCpu: [
      measure(
        "full-snapshot-decode",
        snapshotIterations,
        () => JSON.parse(fullSnapshotBytes.toString("utf8")).turnItems.length,
      ),
      measure("deduped-snapshot-decode-and-restore", snapshotIterations, () => {
        const decoded = JSON.parse(compactSnapshotBytes.toString("utf8"));
        return restoreSnapshotBodies(decoded).turnItems.length;
      }),
    ],
  },
  liveStream: {
    dataset: {
      fullEventCount: fullLiveTrace.length,
      unicodeBodyUtf8Bytes: Buffer.byteLength(body),
      checkpointFileCount: files.length,
      traceKinds: [
        "assistant text source and item",
        "edited text source and item",
        "checkpoint source and item",
        "subagent source, repeated update, and items",
      ],
      iterations: liveIterations,
    },
    bytes: byteStats(fullLiveBytes, compactLiveBytes),
    decodeRestoreCpu: [
      measure(
        "full-live-trace-decode",
        liveIterations,
        () => JSON.parse(fullLiveBytes.toString("utf8")).length,
      ),
      measure(
        "versioned-live-trace-decode-and-restore",
        liveIterations,
        () => restoreLiveTrace(JSON.parse(compactLiveBytes.toString("utf8"))).length,
      ),
    ],
    restorationVerified: true,
  },
  paging: {
    dataset: {
      shellCount: shellCount,
      pageSize,
      additionalOlderPageSize: olderPageSize,
      loadedAfterOneOlderPage: pageSize + olderPageSize,
      iterations: pagingIterations,
    },
    bytes: {
      full: {
        json: fullShellBytes.byteLength,
        gzip: gzipSync(fullShellBytes, { level: 6 }).byteLength,
      },
      firstRecentPage: {
        json: firstPageBytes.byteLength,
        gzip: gzipSync(firstPageBytes, { level: 6 }).byteLength,
      },
      oneAdditionalOlderPage: {
        json: olderPageBytes.byteLength,
        gzip: gzipSync(olderPageBytes, { level: 6 }).byteLength,
      },
      firstPagePlusOlderPage: {
        json: firstPageBytes.byteLength + olderPageBytes.byteLength,
        gzip: pagedGzipBytes,
        jsonSavingsPercentVsFull: Number(
          (
            (1 -
              (firstPageBytes.byteLength + olderPageBytes.byteLength) / fullShellBytes.byteLength) *
            100
          ).toFixed(2),
        ),
        gzipSavingsPercentVsFull: Number(
          ((1 - pagedGzipBytes / gzipSync(fullShellBytes, { level: 6 }).byteLength) * 100).toFixed(
            2,
          ),
        ),
      },
    },
    decodeCpu: shellDecodeResults,
    domRenderCost: "not measured; this benchmark does not mount or render React components",
  },
  limitations: [
    "All datasets are synthetic, deterministic fixtures and are not production captures.",
    "The snapshot case calls the production shared dedupeSnapshotBodies and restoreSnapshotBodies helpers.",
    "The live case calls the production server makeLiveBodyDeduper(true) and shared restore helpers, and verifies full payload equality after client-style version checks and restoration. It does not instantiate WsNativeApi or a WebSocket transport.",
    "The paging case serializes the same seeded 10000-shell array for the full response and the 100-shell plus 25-shell page responses. It does not model SQL query cost, cursor filtering, request headers, or cache behavior.",
    "JSON parse and restoration timings are CPU-only. WebSocket framing, TLS, network latency, scheduling, React DOM rendering, browser layout, persistence, and server projection are excluded. Paging DOM render cost is explicitly not measured.",
    "Gzip sizes use local gzip level 6. Negotiated permessage-deflate or HTTP compression may differ; the paged total sums two separately compressed responses.",
    "CPU timings and heap/RSS deltas vary by runtime and host. Negative memory deltas can result from garbage collection; rerun on target hardware for comparative measurements.",
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

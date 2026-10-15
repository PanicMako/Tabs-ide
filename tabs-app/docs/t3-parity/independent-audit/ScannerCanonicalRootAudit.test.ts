import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import { describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationProjectShell,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings as ContractServerSettings,
} from "@tabs/contracts";
import { symlinksSupported } from "@tabs/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { OrchestrationReadModel } from "@tabs/contracts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";

const makeProjectShell = (workspaceRoot: string): OrchestrationProjectShell => ({
  id: ProjectId.make("project-1"),
  title: "Imported",
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const layerProjectionSnapshotQuery = (importedWorkspaceRoots: ReadonlyArray<string>) =>
  Layer.succeed(
    ProjectionSnapshotQuery.ProjectionSnapshotQuery,
    ProjectionSnapshotQuery.ProjectionSnapshotQuery.of({
      getSnapshot: () =>
        Effect.succeed({
          sequence: 0,
          projects: importedWorkspaceRoots.map((workspaceRoot) => makeProjectShell(workspaceRoot)),
          threads: [],
          threadMessages: [],
          threadProposedPlans: [],
          threadActivities: [],
          threadSessions: [],
          checkpoints: [],
          latestTurns: [],
          state: [],
          threadPullRequests: [],
        } as unknown as OrchestrationReadModel),
      getImportedAgentSessionSources: () => Effect.succeed([]),
    }),
  );

/**
 * Run a scan against the given homes. Homes are temp dirs created inside the
 * test, so the layer is built per run rather than shared.
 */
interface ScannerTestInput {
  readonly claudeHomePath: string;
  readonly codexHomePath: string;
  readonly importedWorkspaceRoots?: ReadonlyArray<string>;
  /** Base dir for the test ServerConfig; worktreesDir derives from it. */
  readonly configBaseDir?: string;
  readonly providerInstances?: ContractServerSettings["providerInstances"];
}

const layerScannerTest = (input: ScannerTestInput) =>
  AgentSessionScanner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({
          providers: {
            claudeAgent: { homePath: input.claudeHomePath },
            codex: { homePath: input.codexHomePath },
          },
          ...(input.providerInstances === undefined
            ? {}
            : { providerInstances: input.providerInstances }),
        }),
        ServerConfig.layerTest(
          input.claudeHomePath,
          input.configBaseDir ?? { prefix: "t3code-scanner-config-" },
        ),
        layerProjectionSnapshotQuery(input.importedWorkspaceRoots ?? []),
      ),
    ),
  );

const runScan = (input: ScannerTestInput) =>
  Effect.gen(function* () {
    const scanner = yield* AgentSessionScanner.AgentSessionScanner;
    return yield* scanner.scan;
  }).pipe(Effect.provide(layerScannerTest(input)));

const runRecentThreadOutcomes = (input: ScannerTestInput & { readonly workspaceRoot: string }) =>
  Effect.gen(function* () {
    const scanner = yield* AgentSessionScanner.AgentSessionScanner;
    return yield* scanner.recentThreads(input.workspaceRoot).pipe(
      Stream.runCollect,
      Effect.map((outcomes) => Array.from(outcomes)),
    );
  }).pipe(Effect.provide(layerScannerTest(input)));

const runRecentThreads = (input: ScannerTestInput & { readonly workspaceRoot: string }) =>
  runRecentThreadOutcomes(input).pipe(
    Effect.map((outcomes) =>
      outcomes.flatMap((outcome) => (outcome._tag === "Importable" ? [outcome.thread] : [])),
    ),
  );

const makeTempDir = Effect.fn("AgentSessionScanner.test.makeTempDir")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix });
});

const writeTranscript = Effect.fn("AgentSessionScanner.test.writeTranscript")(function* (input: {
  readonly filePath: string;
  readonly contents: string;
  /** Epoch millis, so ordering assertions never depend on write timing. */
  readonly mtimeMs: number;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(input.filePath), { recursive: true });
  yield* fileSystem.writeFileString(input.filePath, input.contents);
  // Numeric utimes arguments are seconds, not milliseconds.
  const seconds = input.mtimeMs / 1000;
  yield* fileSystem.utimes(input.filePath, seconds, seconds);
});

/** Claude session line: the first record carries the real `cwd`. */
const claudeSessionLine = (cwd: string) =>
  `${JSON.stringify({ type: "user", cwd, sessionId: "s1" })}\n${JSON.stringify({ type: "assistant" })}\n`;

/** Codex rollout line: session metadata is nested under `payload`. */
const codexRolloutLine = (cwd: string) =>
  `${JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type: "session_meta", payload: { id: "r1", cwd } })}\n`;

const encodeTranscriptRecord = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

function makeRecordLimitTranscript(cwd: string, overflow: boolean): string {
  const records =
    [
      encodeTranscriptRecord({
        type: "session_meta",
        payload: { id: "record-limit-session", cwd },
      }),
      encodeTranscriptRecord({
        type: "event_msg",
        payload: { type: "user_message", message: "First prompt" },
      }),
    ].join("\n") +
    "\n" +
    "{}\n".repeat(99_998);
  return overflow
    ? records +
        "\n" +
        encodeTranscriptRecord({
          type: "event_msg",
          payload: { type: "user_message", message: "Overflow prompt" },
        }) +
        "\n"
    : records;
}

it.layer(NodeServices.layer)("Scanner canonical root audit", (it) => {
  it.effect("canonical configured root excludes symlink sandbox", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const claudeHomePath = yield* makeTempDir("t3code-claude-home-");
      const codexHomePath = yield* makeTempDir("t3code-codex-home-");
      const configBaseDir = yield* (yield* FileSystem.FileSystem).realPath(
        yield* makeTempDir("t3code-scanner-base-"),
      );
      const linkParent = yield* makeTempDir("t3code-scanner-links-");
      const fileSystem = yield* FileSystem.FileSystem;

      // The recorded cwd is a symlink whose own spelling looks harmless;
      // only its realpath reveals the managed sandbox.
      const worktreeCwd = path.join(configBaseDir, "worktrees", "t3code", "wt-3");
      yield* fileSystem.makeDirectory(worktreeCwd, { recursive: true });
      const symlinkCwd = path.join(linkParent, "innocent-project");
      yield* fileSystem.symlink(worktreeCwd, symlinkCwd);
      yield* writeTranscript({
        filePath: path.join(claudeHomePath, "projects", "-slug", "a.jsonl"),
        contents: claudeSessionLine(symlinkCwd),
        mtimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
      });

      const result = yield* runScan({ claudeHomePath, codexHomePath, configBaseDir });

      expect(result.candidates).toEqual([]);
    }),
  );

  it.effect("imports visible history past a genuine 33 MiB discarded tool payload", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const nowMs = Date.parse("2026-08-24T12:00:00.000Z");
      yield* TestClock.setTime(nowMs);
      const claudeHomePath = yield* makeTempDir("t3code-claude-home-");
      const codexHomePath = yield* makeTempDir("t3code-codex-home-");
      const workspace = yield* makeTempDir("t3code-workspace-");
      const transcript = `${[
        encodeTranscriptRecord({
          type: "session_meta",
          payload: { id: "large-session", cwd: workspace },
        }),
        encodeTranscriptRecord({
          type: "event_msg",
          payload: { type: "user_message", message: "Import this large session" },
        }),
      ].join(
        "\n",
      )}\n${encodeTranscriptRecord({ type: "tool_result", data: "x".repeat(33 * 1024 * 1024) })}`;
      yield* writeTranscript({
        filePath: path.join(codexHomePath, "sessions", "2026", "08", "24", "rollout-large.jsonl"),
        contents: transcript,
        mtimeMs: nowMs,
      });

      const outcomes = yield* runRecentThreadOutcomes({
        claudeHomePath,
        codexHomePath,
        workspaceRoot: workspace,
      });

      expect(outcomes).toMatchObject([
        {
          _tag: "Importable",
          thread: {
            providerSessionId: "large-session",
            messages: [{ role: "user", text: "Import this large session" }],
          },
        },
      ]);
    }),
  );
});

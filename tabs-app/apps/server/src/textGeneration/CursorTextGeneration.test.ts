// @effect-diagnostics nodeBuiltinImport:off
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@tabs/shared/model";
import { expect } from "vitest";

import { CursorSettings, ProviderInstanceId } from "@tabs/contracts";

import { ServerConfig } from "../config";
import { type TextGenerationShape } from "./TextGeneration";
import { makeCursorTextGeneration } from "./CursorTextGeneration";
import { TEST_REVIEW_FINDING } from "./TextGenerationTestFixtures";
const decodeCursorSettings = Schema.decodeSync(CursorSettings);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../scripts/acp-mock-agent.ts");

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const CursorTextGenerationTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-cursor-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeAcpAgentWrapper(dir: string, env: Record<string, string>): string {
  const binDir = path.join(dir, "bin");
  const agentPath = path.join(binDir, "agent");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    agentPath,
    [
      "#!/bin/sh",
      ...Object.entries(env).map(([key, value]) => `export ${key}=${shellSingleQuote(value)}`),
      'if [ "$1" != "acp" ]; then',
      '  printf "%s\\n" "unexpected args: $*" >&2',
      "  exit 11",
      "fi",
      `exec node ${JSON.stringify(mockAgentPath)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(agentPath, 0o755);
  return agentPath;
}

function withFakeAcpAgent<A, E, R>(
  env: Record<string, string>,
  effectFn: (textGeneration: TextGenerationShape) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "t3code-cursor-text-acp-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        rmSync(tempDir, { recursive: true, force: true });
      }),
    );
    const agentPath = makeAcpAgentWrapper(tempDir, env);
    const config = decodeCursorSettings({ binaryPath: agentPath });
    const textGeneration = yield* makeCursorTextGeneration(config);
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

function waitForFileContent(path: string): Effect.Effect<string> {
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + 5_000;
    for (;;) {
      const result = yield* Effect.exit(Effect.sync(() => readFileSync(path, "utf8")));
      if (Exit.isSuccess(result)) {
        return result.value;
      }
      {
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return yield* Effect.die(result.cause);
        }
      }
      yield* Effect.sleep(25);
    }
  });
}

it.layer(CursorTextGenerationTestLayer)("CursorTextGeneration", (it) => {
  it.effect("uses ACP model config options instead of raw CLI model ids", () => {
    const requestLogDir = mkdtempSync(path.join(os.tmpdir(), "t3code-cursor-text-log-"));
    const requestLogPath = path.join(requestLogDir, "requests.ndjson");

    return withFakeAcpAgent(
      {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          subject: "Add generated commit message",
          body: "- verify cursor acp model config path",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/cursor-text-generation",
            stagedSummary: "M apps/server/src/textGeneration/CursorTextGeneration.ts",
            stagedPatch:
              "diff --git a/apps/server/src/textGeneration/CursorTextGeneration.ts b/apps/server/src/textGeneration/CursorTextGeneration.ts",
            modelSelection: {
              ...createModelSelection("cursor" as ProviderInstanceId, "gpt-5.4", [
                { id: "reasoning", value: "xhigh" },
                { id: "fastMode", value: true },
                { id: "contextWindow", value: "1m" },
              ]),
            },
          });

          expect(generated.subject).toBe("Add generated commit message");
          expect(generated.body).toBe("- verify cursor acp model config path");

          const requests = readFileSync(requestLogPath, "utf8")
            .trim()
            .split("\n")
            .filter((line) => line.length > 0)
            .map(
              (line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> },
            );

          // The adapter sends `parameterizedModelPicker: true`, but the pinned
          // effect-smol `ndJsonRpc` wire serialization nulls boolean values
          // inside `_meta` in transit, so the key is preserved as `null` here.
          const initializeClientCapabilities = requests.find(
            (request) => request.method === "initialize",
          )?.params?.clientCapabilities as { _meta?: Record<string, unknown> } | undefined;
          expect(initializeClientCapabilities?._meta).toHaveProperty("parameterizedModelPicker");
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "model" &&
                request.params?.value === "gpt-5.4",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "reasoning" &&
                request.params?.value === "extra-high",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "context" &&
                request.params?.value === "1m",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "fast" &&
                request.params?.value === "true",
            ),
          ).toBe(true);
          expect(
            requests.find((request) => request.method === "session/prompt")?.params?.prompt,
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: expect.stringContaining("Staged patch:"),
              }),
            ]),
          );
          const prompt = (
            requests.find((request) => request.method === "session/prompt")?.params?.prompt as
              | Array<{ text?: string }>
              | undefined
          )?.[0]?.text;
          expect(prompt).toContain("Structured output contract:");
          expect(prompt).toContain('"subject"');
          expect(prompt).toContain("Minimal valid example:");
          expect(prompt).toContain("Do not use Markdown fences or add commentary.");

          rmSync(requestLogDir, { recursive: true, force: true });
        }),
    );
  });

  it.effect("accepts json objects with extra assistant text around them", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT:
          'Sure, here is the JSON:\n```json\n{\n  "subject": "Update README dummy comment with attribution and date",\n  "body": ""\n}\n```\nDone.',
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/cursor-noisy-json",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: {
              instanceId: "cursor" as ProviderInstanceId,
              model: "composer-2",
            },
          });

          expect(generated.subject).toBe("Update README dummy comment with attribution and date");
          expect(generated.body).toBe("");
        }),
    ),
  );

  it.effect("parses lenient JSON containing trailing commas and comments", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: `{\n  "summary": "Full review summary",\n  "keyChanges": "- Added feature X",\n  "notesAndRisk": "Low risk",\n  "findings": [${JSON.stringify(TEST_REVIEW_FINDING)}],\n} // trailing comma and comment`,
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateDiffSummary({
            cwd: process.cwd(),
            diffSummary: "M apps/web/src/App.tsx",
            diffPatch: "diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx",
            modelSelection: {
              instanceId: "cursor" as ProviderInstanceId,
              model: "composer-2",
            },
          });

          expect(generated.summary).toBe("Full review summary");
          expect(generated.keyChanges).toBe("- Added feature X");
          expect(generated.findings).toEqual([TEST_REVIEW_FINDING]);
        }),
    ),
  );

  it.effect("generates thread titles through Cursor ACP text generation", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          title: '"Trim reconnect spinner status after resume."',
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Fix the reconnect spinner after a resumed session.",
            modelSelection: {
              instanceId: "cursor" as ProviderInstanceId,
              model: "composer-2",
            },
          });

          expect(generated.title).toBe("Trim reconnect spinner status after resume.");
        }),
    ),
  );

  it.effect("closes the ACP child process after text generation completes", () => {
    const exitLogDir = mkdtempSync(path.join(os.tmpdir(), "t3code-cursor-text-exit-log-"));
    const exitLogPath = path.join(exitLogDir, "exit.log");

    return withFakeAcpAgent(
      {
        T3_ACP_EXIT_LOG_PATH: exitLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          subject: "Close runtime after generation",
          body: "",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/cursor-runtime-close",
            stagedSummary: "M apps/server/src/textGeneration/CursorTextGeneration.ts",
            stagedPatch:
              "diff --git a/apps/server/src/textGeneration/CursorTextGeneration.ts b/apps/server/src/textGeneration/CursorTextGeneration.ts",
            modelSelection: {
              instanceId: "cursor" as ProviderInstanceId,
              model: "composer-2",
            },
          });

          expect(generated.subject).toBe("Close runtime after generation");

          const exitLog = yield* waitForFileContent(exitLogPath);
          expect(exitLog).toContain("exit:0");

          rmSync(exitLogDir, { recursive: true, force: true });
        }),
    );
  });
});

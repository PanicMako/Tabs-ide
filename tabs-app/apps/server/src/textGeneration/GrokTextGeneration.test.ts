// @effect-diagnostics nodeBuiltinImport:off
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@tabs/shared/model";
import { expect } from "vitest";
import { GrokSettings, ProviderInstanceId } from "@tabs/contracts";

import { ServerConfig } from "../config";
import { type TextGenerationShape } from "./TextGeneration";
import { makeGrokTextGeneration } from "./GrokTextGeneration";
import { TEST_REVIEW_FINDING } from "./TextGenerationTestFixtures";
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../scripts/acp-mock-agent.ts");

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const GrokTextGenerationTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-grok-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeAcpGrokWrapper(dir: string, env: Record<string, string>): string {
  const binDir = path.join(dir, "bin");
  const grokPath = path.join(binDir, "grok");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    grokPath,
    [
      "#!/bin/sh",
      ...Object.entries(env).map(([key, value]) => `export ${key}=${shellSingleQuote(value)}`),
      'if [ "$1" != "--no-auto-update" ] || [ "$2" != "agent" ] || [ "$3" != "stdio" ]; then',
      '  printf "%s\\n" "unexpected args: $*" >&2',
      "  exit 11",
      "fi",
      `exec "bun" ${JSON.stringify(mockAgentPath)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(grokPath, 0o755);
  return grokPath;
}

function withFakeAcpGrok<A, E, R>(
  env: Record<string, string>,
  effectFn: (textGeneration: TextGenerationShape) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "t3code-grok-text-acp-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        rmSync(tempDir, { recursive: true, force: true });
      }),
    );
    const binaryPath = makeAcpGrokWrapper(tempDir, env);
    const config = decodeGrokSettings({ binaryPath });
    const textGeneration = yield* makeGrokTextGeneration(config);
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

function readJsonRpcRequests(
  filePath: string,
): ReadonlyArray<{ readonly method?: string; readonly params?: Record<string, unknown> }> {
  return readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
}

it.layer(GrokTextGenerationTestLayer)("GrokTextGeneration", (it) => {
  it.effect("preserves code-review findings", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          summary: "Review summary",
          keyChanges: "- Reviewed change",
          notesAndRisk: "Low risk",
          findings: [TEST_REVIEW_FINDING],
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateDiffSummary({
            cwd: process.cwd(),
            diffSummary: "M src/example.ts",
            diffPatch: "diff --git a/src/example.ts b/src/example.ts",
            modelSelection: createModelSelection("grok" as ProviderInstanceId, "grok-build"),
          });

          expect(generated.findings).toEqual([TEST_REVIEW_FINDING]);
        }),
    ),
  );

  it.effect("uses ACP with disabled tool capabilities and forwards the requested model id", () => {
    const requestLogDir = mkdtempSync(path.join(os.tmpdir(), "t3code-grok-text-log-"));
    const requestLogPath = path.join(requestLogDir, "requests.ndjson");

    return withFakeAcpGrok(
      {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          subject: "Add Grok provider",
          body: "Wire up the ACP runtime and headless text generation path.",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/grok",
            stagedSummary: "M apps/server/src/provider/Drivers/GrokDriver.ts",
            stagedPatch: "diff --git a/.../GrokDriver.ts b/.../GrokDriver.ts",
            modelSelection: createModelSelection("grok" as ProviderInstanceId, "grok-mock-alt"),
          });

          expect(generated.subject).toBe("Add Grok provider");
          expect(generated.body).toBe("Wire up the ACP runtime and headless text generation path.");

          const requests = readJsonRpcRequests(requestLogPath);
          expect(
            requests.find((request) => request.method === "initialize")?.params?.clientCapabilities,
          ).toMatchObject({
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          });
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_model" &&
                request.params?.modelId === "grok-mock-alt",
            ),
          ).toBe(true);
          const prompt = (
            requests.find((request) => request.method === "session/prompt")?.params?.prompt as
              | Array<{ text?: string }>
              | undefined
          )?.[0]?.text;
          expect(prompt).toContain("Structured output contract:");
          expect(prompt).toContain('"subject"');
          expect(prompt).toContain("Minimal valid example:");
          expect(prompt).toContain("Do not use Markdown fences or add commentary.");
        }),
    );
  });

  it.effect("extracts the JSON object when Grok wraps it in conversational text", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT:
          "Sure! Here's a thread title:\n\n" +
          JSON.stringify({ title: "Investigate failing CI" }) +
          "\n\nLet me know if you need anything else.",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "the lint job is red",
            modelSelection: createModelSelection("grok" as ProviderInstanceId, "grok-mock-alt"),
          });
          expect(generated.title).toBe("Investigate failing CI");
        }),
    ),
  );

  it.effect("surfaces ACP request failures as text generation errors", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({ branch: "unreachable" }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateBranchName({
              cwd: process.cwd(),
              message: "wire up grok",
              modelSelection: createModelSelection(
                "grok" as ProviderInstanceId,
                "missing-grok-model",
              ),
            }),
          );
          expect(error._tag).toBe("TextGenerationError");
          expect(error.detail).toContain("Grok ACP base model");
        }),
    ),
  );

  it.effect("fails with TextGenerationError when output is empty", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: "   \n  ",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateThreadTitle({
              cwd: process.cwd(),
              message: "anything",
              modelSelection: createModelSelection("grok" as ProviderInstanceId, "grok-build"),
            }),
          );
          expect(error._tag).toBe("TextGenerationError");
          expect(error.detail).toMatch(/empty/i);
        }),
    ),
  );

  it.effect("decodes a structured PR title + body", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          title: "feat(grok): wire up session/set_model",
          body: "## Summary\n- Replace `-m` spawn flag with the typed ACP `session/set_model`.\n- Translate `MODEL_SWITCH_INCOMPATIBLE_AGENT` into a validation error.",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generatePrContent({
            cwd: process.cwd(),
            baseBranch: "main",
            headBranch: "feat/grok-provider",
            commitSummary: "feat: add grok provider",
            diffSummary: "M apps/server/src/provider/Drivers/GrokDriver.ts",
            diffPatch: "diff --git a/.../GrokDriver.ts b/.../GrokDriver.ts",
            modelSelection: createModelSelection("grok" as ProviderInstanceId, "grok-build"),
          });

          expect(generated.title).toBe("feat(grok): wire up session/set_model");
          expect(generated.body).toContain("Translate `MODEL_SWITCH_INCOMPATIBLE_AGENT`");
        }),
    ),
  );

  it.effect("fails with TextGenerationError when output is unparseable JSON", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: "totally not json output from a confused model",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateThreadTitle({
              cwd: process.cwd(),
              message: "anything",
              modelSelection: createModelSelection("grok" as ProviderInstanceId, "grok-build"),
            }),
          );
          expect(error._tag).toBe("TextGenerationError");
          expect(error.detail).toMatch(/invalid structured output/i);
        }),
    ),
  );
});

// @effect-diagnostics nodeBuiltinImport:off
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { CopilotSettings, ProviderInstanceId } from "@tabs/contracts";
import { createModelSelection } from "@tabs/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { expect, vi } from "vitest";

vi.mock("../provider/CopilotCredentialStore", () => ({
  getCopilotToken: async () => null,
}));

import { ServerConfig } from "../config";
import { makeCopilotTextGeneration } from "./CopilotTextGeneration";
import type { TextGenerationShape } from "./TextGeneration";
import { TEST_REVIEW_FINDING } from "./TextGenerationTestFixtures";

const decodeCopilotSettings = Schema.decodeSync(CopilotSettings);
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "tabs-copilot-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));
const mockAgentPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/acp-mock-agent.ts",
);

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function makeCopilotWrapper(directory: string, environment: Record<string, string>): string {
  const binaryDirectory = path.join(directory, "bin");
  const binaryPath = path.join(binaryDirectory, "copilot");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      ...Object.entries(environment).map(
        ([key, value]) => `export ${key}=${shellSingleQuote(value)}`,
      ),
      'if [ "$1" != "--acp" ] || [ "$2" != "--stdio" ]; then',
      '  printf "%s\\n" "unexpected args: $*" >&2',
      "  exit 11",
      "fi",
      `exec "bun" ${JSON.stringify(mockAgentPath)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function withFakeCopilot<A, E, R>(
  environment: Record<string, string>,
  run: (textGeneration: TextGenerationShape) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tabs-copilot-text-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    );
    const settings = decodeCopilotSettings({
      binaryPath: makeCopilotWrapper(directory, environment),
    });
    const textGeneration = yield* makeCopilotTextGeneration(settings, process.env);
    return yield* run(textGeneration);
  }).pipe(Effect.scoped);
}

it.layer(testLayer)("CopilotTextGeneration", (it) => {
  it.effect("preserves code-review findings", () =>
    withFakeCopilot(
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
            modelSelection: createModelSelection("copilot" as ProviderInstanceId, "grok-build"),
          });

          expect(generated.findings).toEqual([TEST_REVIEW_FINDING]);
        }),
    ),
  );

  it.effect("sends the operation schema and a valid example in the final ACP prompt", () => {
    const requestLogDir = mkdtempSync(path.join(os.tmpdir(), "tabs-copilot-schema-log-"));
    const requestLogPath = path.join(requestLogDir, "requests.ndjson");
    return withFakeCopilot(
      {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({ subject: "Describe schema", body: "" }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/schema",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: createModelSelection("copilot" as ProviderInstanceId, "grok-build"),
          });
          const promptRequest = readFileSync(requestLogPath, "utf8")
            .trim()
            .split("\n")
            .map(
              (line) =>
                JSON.parse(line) as {
                  method?: string;
                  params?: { prompt?: Array<{ text?: string }> };
                },
            )
            .find((request) => request.method === "session/prompt");
          const prompt = promptRequest?.params?.prompt?.[0]?.text ?? "";
          expect(prompt).toContain("Structured output contract:");
          expect(prompt).toContain('"subject"');
          expect(prompt).toContain("Minimal valid example:");
          expect(prompt).toContain("Do not use Markdown fences or add commentary.");
          rmSync(requestLogDir, { recursive: true, force: true });
        }),
    );
  });
});

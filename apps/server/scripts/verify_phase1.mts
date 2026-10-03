import fs from "fs";
import path from "path";
import os from "os";
import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@tabs/contracts";
import { makeGeminiTextGeneration } from "../src/textGeneration/GeminiTextGeneration.ts";
import { buildDiffSummaryPrompt } from "../src/textGeneration/TextGenerationPrompts.ts";

// These values exactly match the unit test added to TextGenerationPrompts.test.ts
const testUserHint = "Custom instructions: Focus on security.";
const testStaticContext = "Static Analysis Tool Findings:\n- ESLint: [warning] no-console";
const testDiffSummary = "1 file changed";
const testDiffPatch = "diff --git a/src/app.ts b/src/app.ts\n+console.log('test');";

// ================================================================
// STEP 1: Render the exact same prompt as the unit test
// ================================================================
console.log("=== STEP 1: buildDiffSummaryPrompt OUTPUT (same inputs as unit test) START ===");
const { prompt } = buildDiffSummaryPrompt({
  diffSummary: testDiffSummary,
  diffPatch: testDiffPatch,
  userHint: testUserHint,
  staticAnalysisContext: testStaticContext,
});
console.log(prompt);
console.log("=== STEP 1: buildDiffSummaryPrompt OUTPUT END ===");

// ================================================================
// STEP 2: Verify section separation
// ================================================================
console.log("\n=== STEP 2: Section index check ===");
const customIndex = prompt.indexOf("Custom Review Instructions:");
const staticIndex = prompt.indexOf("Static Analysis Tool Findings:");
console.log("'Custom Review Instructions:' at index:", customIndex);
console.log("'Static Analysis Tool Findings:' at index:", staticIndex);
console.log("Both present:", customIndex > -1 && staticIndex > -1);
console.log("Static comes after custom:", staticIndex > customIndex);

// ================================================================
// STEP 3: Live LLM call using the same inputs
// ================================================================
console.log("\n=== STEP 3: Live Gemini generateDiffSummary call ===");
const settingsPath = path.join(os.homedir(), ".tabs", "dev", "settings.json");
const settingsJson = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const apiKey = settingsJson.providers?.gemini?.apiKey;
console.log("API key present:", !!apiKey, "| length:", apiKey ? apiKey.length : 0);
console.log("Model used: gemini-3.6-flash");

const driver = await Effect.runPromise(
  makeGeminiTextGeneration({
    enabled: true,
    apiKey: apiKey,
    baseUrl: "https://generativelanguage.googleapis.com",
    customModels: [],
  }),
);

const program = driver.generateDiffSummary({
  cwd: process.cwd(),
  diffSummary: testDiffSummary,
  diffPatch: testDiffPatch,
  userHint: testUserHint,
  staticAnalysisContext: testStaticContext,
  modelSelection: {
    instanceId: ProviderInstanceId.make("gemini"),
    model: "gemini-3.6-flash",
  },
});

const result = await Effect.runPromise(program);
console.log("=== STEP 3: Raw result JSON ===");
console.log(JSON.stringify(result, null, 2));
console.log("=== STEP 3: END ===");

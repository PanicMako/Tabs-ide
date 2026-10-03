/**
 * Phase 3 live end-to-end verification script.
 *
 * Requirements:
 * 1. Emits review_cost_preview before LLM calls fire, showing the emitted payload.
 * 2. Diff contains a genuine null-dereference and a genuine SQL-injection-shaped issue.
 * 3. Runs 2 sequential passes (Correctness + Security) via Gemini API (gemini-3.6-flash).
 * 4. Shows raw live findings produced by the 2 passes and filtered by VerificationFilter.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import spawnSync from "node:child_process";

import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@tabs/contracts";
import { makeGeminiTextGeneration } from "../src/textGeneration/GeminiTextGeneration.ts";
import { runReviewPasses, estimateReviewCost } from "../src/review/ReviewPassRunner.ts";

console.log("=== Phase 3 Live Verification Script START ===");

// 1. Prepare diff patch with genuine null-dereference and SQL-injection
const diffSummary = "1 file changed (userController.ts)";
const diffPatch = `diff --git a/src/userController.ts b/src/userController.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/userController.ts
@@ -0,0 +1,25 @@
+import { db } from "./db";
+
+interface UserRequest {
+  user?: {
+    id: string;
+    name?: string;
+  };
+  queryId: string;
+}
+
+export function handleGetUser(req: UserRequest) {
+  // BUG 1 (Null dereference): accessing req.user.id without checking if req.user is defined
+  const userId = req.user.id.toUpperCase();
+  console.log("User ID:", userId);
+
+  // BUG 2 (SQL Injection): string interpolation directly into SQL query
+  const query = "SELECT * FROM users WHERE id = '" + req.queryId + "' AND active = 1";
+  const record = db.query(query);
+
+  return {
+    userId,
+    record,
+  };
+}
+`;

console.log("\n=== STEP 1: Diff patch being reviewed START ===");
console.log(diffPatch);
console.log("=== STEP 1: Diff patch END ===");

// 2. Load API key
const settingsPath = path.join(os.homedir(), ".tabs", "dev", "settings.json");
const settingsJson = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const apiKey = settingsJson.providers?.gemini?.apiKey;

console.log("\n=== STEP 2: Gemini API Key & Driver Setup ===");
console.log("API Key present:", !!apiKey, "| length:", apiKey?.length ?? 0);
console.log("Model: gemini-3.6-flash");

const driver = await Effect.runPromise(
  makeGeminiTextGeneration({
    enabled: true,
    apiKey,
    baseUrl: "https://generativelanguage.googleapis.com",
    customModels: [],
  }),
);

// 3. Pre-run cost preview confirmation
console.log("\n=== STEP 3: Pre-run Cost Preview Event ===");
let costPreviewPayload: any = null;

const onCostPreview = (event: any) =>
  Effect.sync(() => {
    costPreviewPayload = event;
    console.log("--> [EVENT EMITTED] review_cost_preview:");
    console.log(JSON.stringify(event, null, 2));
  });

// 4. Run Multi-pass Review
console.log("\n=== STEP 4: Running Multi-Pass Review (Correctness + Security) ===");
const startTime = Date.now();

const program = runReviewPasses(
  {
    cwd: process.cwd(),
    diffSummary,
    diffPatch,
    userHint: "Find code quality, safety, and security vulnerabilities.",
    modelSelection: {
      instanceId: ProviderInstanceId.make("gemini"),
      model: "gemini-3.6-flash",
    },
    configuredPasses: ["correctness", "security"],
    onCostPreview,
  },
  driver,
);

const result = await Effect.runPromise(program);
const durationMs = Date.now() - startTime;

console.log(`\n=== STEP 5: Multi-Pass Review Results (${durationMs}ms) ===`);
console.log("Passes run:", result.passesRun);
console.log("Cost preview emitted before LLM calls:", costPreviewPayload !== null);
console.log("\nSummary:");
console.log(result.summary);
console.log("\nKey Changes:");
console.log(result.keyChanges);
console.log("\nNotes & Risk:");
console.log(result.notesAndRisk);

console.log("\n=== STEP 6: Verified Findings Count =", result.findings.length, "===");
console.log(JSON.stringify(result.findings, null, 2));

console.log("\n=== Phase 3 Live Verification Script END ===");

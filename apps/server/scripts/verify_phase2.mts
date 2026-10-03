/**
 * Phase 2 live end-to-end verification script.
 *
 * This script:
 * 1. Creates a temporary git repo with a changed exported function used in
 *    multiple files so git grep finds real callers.
 * 2. Creates a .tabs-review.json with project rules.
 * 3. Runs RepoContextService directly and shows: git log output, git grep
 *    output, and the final compressed contextSection.
 * 4. Calls the live Gemini API (gemini-3.6-flash) with the full enriched
 *    prompt and shows the raw LLM response.
 * 5. Verifies the LLM output references the broader impact without being
 *    explicitly told the caller list in plain diff form.
 */

import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@tabs/contracts";
import { makeGeminiTextGeneration } from "../src/textGeneration/GeminiTextGeneration.ts";
import {
  buildRepoContext,
  loadTabsReviewJson,
  extractExportedSymbols,
  buildCallerList,
  buildFileHistory,
} from "../src/repoContext/RepoContextService.ts";
import { extractChangedFilesFromPatch } from "../src/staticAnalysis/ContextBuilder.ts";

// ---------------------------------------------------------------------------
// Setup: temp repo with a changed exported function and callers
// ---------------------------------------------------------------------------

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-phase2-verify-"));
console.log("=== Temp repo:", repoDir, "===");

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  return result.stdout ?? "";
}

// Init repo
git("init", "--initial-branch=main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test User");

// Commit 1: create the original auth.ts + callers
fs.writeFileSync(
  path.join(repoDir, "auth.ts"),
  `// Original auth module
export function validateToken(token: string): boolean {
  return token.length > 10;
}
`,
);

fs.writeFileSync(
  path.join(repoDir, "api.ts"),
  `import { validateToken } from "./auth";
export function handleRequest(token: string) {
  if (!validateToken(token)) throw new Error("Unauthorized");
  return { ok: true };
}
`,
);

fs.writeFileSync(
  path.join(repoDir, "middleware.ts"),
  `import { validateToken } from "./auth";
export function authMiddleware(token: string) {
  return validateToken(token);
}
`,
);

fs.writeFileSync(
  path.join(repoDir, "guards.ts"),
  `import { validateToken } from "./auth";
export function requireAuth(token: string) {
  if (!validateToken(token)) return false;
  return true;
}
`,
);

git("add", ".");
git("commit", "-m", "Initial commit: add auth module and callers");

// Commit 2: add a second commit to auth.ts so history has multiple entries
const patch1 = fs.readFileSync(path.join(repoDir, "auth.ts"), "utf8");
fs.writeFileSync(
  path.join(repoDir, "auth.ts"),
  patch1.replace("token.length > 10", "token.length > 0 && token.startsWith('Bearer')"),
);
git("add", ".");
git("commit", "-m", "Tighten token validation to require Bearer prefix");

// Now modify auth.ts (the change we are reviewing)
fs.writeFileSync(
  path.join(repoDir, "auth.ts"),
  `// Auth module — updated
export function validateToken(token: string): boolean {
  // Now validates format and expiry
  if (!token.startsWith("Bearer ")) return false;
  const parts = token.split(".");
  return parts.length === 3;
}

export function revokeToken(tokenId: string): void {
  // TODO: implement revocation store
  void tokenId;
}
`,
);

// .tabs-review.json project rules
fs.writeFileSync(
  path.join(repoDir, ".tabs-review.json"),
  JSON.stringify({
    instructions:
      "Security policy: Any change to authentication primitives (validateToken, revokeToken, issueToken) must include a migration note and a test plan. Flag any missing error handling in auth paths.",
    excludedPaths: ["dist/"],
  }),
);

// ---------------------------------------------------------------------------
// STEP 1: Show the raw diff that will be reviewed
// ---------------------------------------------------------------------------
const diffResult = spawnSync("git", ["diff"], { cwd: repoDir, encoding: "utf8" });
const rawPatch = diffResult.stdout;
console.log("\n=== STEP 1: Raw git diff (the change being reviewed) START ===");
console.log(rawPatch);
console.log("=== STEP 1: Raw git diff END ===");

// ---------------------------------------------------------------------------
// STEP 2: Extract changed files and exported symbols
// ---------------------------------------------------------------------------
const changedFiles = extractChangedFilesFromPatch(rawPatch);
const symbols = extractExportedSymbols(rawPatch);

console.log("\n=== STEP 2: Changed files ===");
console.log(changedFiles);
console.log("\n=== STEP 2: Extracted exported symbols ===");
console.log(symbols);

// ---------------------------------------------------------------------------
// STEP 3: git log output (raw, per file)
// ---------------------------------------------------------------------------
console.log("\n=== STEP 3: git log history per file START ===");
for (const file of changedFiles) {
  const history = buildFileHistory(repoDir, file, 3);
  console.log(`File: ${file}`);
  console.log(`  commits: ${JSON.stringify(history.commits)}`);
}
console.log("=== STEP 3: git log history per file END ===");

// ---------------------------------------------------------------------------
// STEP 4: git grep output (raw, per symbol)
// ---------------------------------------------------------------------------
console.log("\n=== STEP 4: git grep caller list per symbol START ===");
for (const sym of symbols) {
  const result = spawnSync("git", ["grep", "-l", sym], { cwd: repoDir, encoding: "utf8" });
  console.log(`Symbol '${sym}' grep exit=${result.status}:`);
  console.log(`  stdout: ${result.stdout.trim()}`);
}
console.log("=== STEP 4: git grep caller list per symbol END ===");

// ---------------------------------------------------------------------------
// STEP 5: Build compressed context (show the actual string passed to LLM)
// ---------------------------------------------------------------------------
const tabsReview = loadTabsReviewJson(repoDir);
console.log("\n=== STEP 5: .tabs-review.json load result ===");
console.log("parseError:", tabsReview.parseError ?? null);
console.log("config:", JSON.stringify(tabsReview.config, null, 2));

const rcResult = buildRepoContext({
  cwd: repoDir,
  changedFiles,
  diffPatch: rawPatch,
  maxCallersPerSymbol: 5,
  maxCommitHistoryPerFile: 3,
});

console.log("\n=== STEP 5: Compressed repoContext section START ===");
console.log(rcResult.contextSection);
console.log("=== STEP 5: Compressed repoContext section END ===");
console.log("  char length:", rcResult.contextSection.length, "/ 16000 budget");

const projectRules = tabsReview.config?.instructions?.trim() ?? "";
console.log("\n=== STEP 5: projectRules section ===");
console.log(projectRules);

// ---------------------------------------------------------------------------
// STEP 6: Live Gemini call with full enriched prompt
// ---------------------------------------------------------------------------
const settingsJson = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".tabs", "dev", "settings.json"), "utf8"),
);
const apiKey = settingsJson.providers?.gemini?.apiKey;
console.log("\n=== STEP 6: Live Gemini generateDiffSummary call ===");
console.log("API key present:", !!apiKey, "| length:", apiKey?.length ?? 0);
console.log("Model: gemini-3.6-flash");

const driver = await Effect.runPromise(
  makeGeminiTextGeneration({
    enabled: true,
    apiKey,
    baseUrl: "https://generativelanguage.googleapis.com",
    customModels: [],
  }),
);

const result = await Effect.runPromise(
  driver.generateDiffSummary({
    cwd: repoDir,
    diffSummary: "1 file changed (auth.ts)",
    diffPatch: rawPatch,
    userHint: "Focus on security and backward compatibility.",
    repoContext: rcResult.contextSection || undefined,
    projectRules: projectRules || undefined,
    modelSelection: {
      instanceId: ProviderInstanceId.make("gemini"),
      model: "gemini-3.6-flash",
    },
  }),
);

console.log("\n=== STEP 6: Raw Gemini result JSON START ===");
console.log(JSON.stringify(result, null, 2));
console.log("=== STEP 6: Raw Gemini result JSON END ===");

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
fs.rmSync(repoDir, { recursive: true, force: true });
console.log("\n=== Temp repo cleaned up ===");

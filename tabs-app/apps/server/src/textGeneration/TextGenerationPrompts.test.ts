import { describe, expect, it } from "vitest";

import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildPrContentPrompt,
  buildStructuredTestingPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts";
import { normalizeCliError, sanitizeThreadTitle } from "./TextGenerationUtils";
import { TextGenerationError } from "@tabs/contracts";

const testingPromptInput = {
  sanitizedPrompt: "Use the supplied testing evidence.",
  reasoningTier: "medium" as const,
  budget: { maxEstimatedTokens: 1_000, maxEstimatedCostUsd: 0.1 },
};

describe("buildStructuredTestingPrompt", () => {
  it("describes test-generation fields", () => {
    const prompt = buildStructuredTestingPrompt({
      ...testingPromptInput,
      taskKind: "test-generation",
    });
    expect(prompt).toContain("featureSlug: non-empty, lowercase slug-compatible text");
    expect(prompt).toContain("testTitle: concise, non-empty title");
    expect(prompt).toContain("assertionText: non-empty observable outcome");
  });

  it("describes story-to-cases fields", () => {
    const prompt = buildStructuredTestingPrompt({
      ...testingPromptInput,
      taskKind: "story-to-cases",
    });
    expect(prompt).toContain(
      "cases[].externalId: stable, non-empty human-readable case identifier",
    );
    expect(prompt).toContain("cases[].steps: ordered, actionable user interactions");
    expect(prompt).toContain("cases[].locatorKeys: known locator-library keys");
  });

  it("describes failure-triage fields", () => {
    const prompt = buildStructuredTestingPrompt({
      ...testingPromptInput,
      taskKind: "failure-triage",
    });
    expect(prompt).toContain("classification: exactly one of application-regression");
    expect(prompt).toContain("observedFacts: directly observed evidence only");
    expect(prompt).toContain("recommendation: concrete next action");
  });
});

describe("buildCommitMessagePrompt", () => {
  it("includes staged patch and summary in the prompt", () => {
    const result = buildCommitMessagePrompt({
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md\n+hello",
      includeBranch: false,
    });

    expect(result.prompt).toContain("Staged files:");
    expect(result.prompt).toContain("M README.md");
    expect(result.prompt).toContain("Staged patch:");
    expect(result.prompt).toContain("diff --git a/README.md b/README.md");
    expect(result.prompt).toContain("Branch: main");
    // Should NOT include the branch generation instruction
    expect(result.prompt).not.toContain("branch must be a short semantic git branch fragment");
  });

  it("includes branch generation instruction when includeBranch is true", () => {
    const result = buildCommitMessagePrompt({
      branch: "feature/foo",
      stagedSummary: "M README.md",
      stagedPatch: "diff",
      includeBranch: true,
    });

    expect(result.prompt).toContain("branch must be a short semantic git branch fragment");
    expect(result.prompt).toContain("Return a JSON object with keys: subject, body, branch.");
  });

  it("shows (detached) when branch is null", () => {
    const result = buildCommitMessagePrompt({
      branch: null,
      stagedSummary: "M a.ts",
      stagedPatch: "diff",
      includeBranch: false,
    });

    expect(result.prompt).toContain("Branch: (detached)");
  });
});

describe("buildPrContentPrompt", () => {
  it("includes branch names, commits, and diff in the prompt", () => {
    const result = buildPrContentPrompt({
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: add login page",
      diffSummary: "3 files changed",
      diffPatch: "diff --git a/auth.ts b/auth.ts\n+export function login()",
    });

    expect(result.prompt).toContain("Base branch: main");
    expect(result.prompt).toContain("Head branch: feature/auth");
    expect(result.prompt).toContain("Commits:");
    expect(result.prompt).toContain("feat: add login page");
    expect(result.prompt).toContain("Diff stat:");
    expect(result.prompt).toContain("3 files changed");
    expect(result.prompt).toContain("Diff patch:");
    expect(result.prompt).toContain("export function login()");
  });
});

describe("buildBranchNamePrompt", () => {
  it("includes the user message in the prompt", () => {
    const result = buildBranchNamePrompt({
      message: "Fix the login timeout bug",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Fix the login timeout bug");
    expect(result.prompt).not.toContain("Attachment metadata:");
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildBranchNamePrompt({
      message: "Fix the layout from screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-123",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 12345,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("screenshot.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("12345 bytes");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("includes the user message in the prompt", () => {
    const result = buildThreadTitlePrompt({
      message: "Investigate reconnect regressions after session restore",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Investigate reconnect regressions after session restore");
    expect(result.prompt).not.toContain("Attachment metadata:");
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildThreadTitlePrompt({
      message: "Name this thread from the screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-456",
          name: "thread.png",
          mimeType: "image/png",
          sizeBytes: 67890,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("thread.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("67890 bytes");
  });
});

describe("sanitizeThreadTitle", () => {
  it("truncates long titles with the shared sidebar-safe limit", () => {
    expect(
      sanitizeThreadTitle(
        '  "Reconnect failures after restart because the session state does not recover"  ',
      ),
    ).toBe("Reconnect failures after restart because the se...");
  });
});

describe("normalizeCliError", () => {
  it("detects 'Command not found' and includes CLI name in the message", () => {
    const error = normalizeCliError(
      "claude",
      "generateCommitMessage",
      new Error("Command not found: claude"),
      "Something went wrong",
    );

    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error.detail).toContain("Claude CLI");
    expect(error.detail).toContain("not available on PATH");
  });

  it("uses the CLI name from the first argument for codex", () => {
    const error = normalizeCliError(
      "codex",
      "generateBranchName",
      new Error("Command not found: codex"),
      "Something went wrong",
    );

    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error.detail).toContain("Codex CLI");
    expect(error.detail).toContain("not available on PATH");
  });

  it("returns the error as-is if it is already a TextGenerationError", () => {
    const existing = new TextGenerationError({
      operation: "generatePrContent",
      detail: "Already wrapped",
    });

    const result = normalizeCliError("claude", "generatePrContent", existing, "fallback");

    expect(result).toBe(existing);
  });

  it("wraps unknown non-Error values with the fallback message", () => {
    const result = normalizeCliError("codex", "generateCommitMessage", "string error", "fallback");

    expect(result).toBeInstanceOf(TextGenerationError);
    expect(result.detail).toBe("fallback");
  });
});

describe("buildDiffSummaryPrompt", () => {
  it("builds structured prompt and schema for AI diff summary", () => {
    const result = buildDiffSummaryPrompt({
      diffSummary: "2 files changed",
      diffPatch: "diff --git a/index.ts b/index.ts\n+const x = 1;",
      commitMessage: "feat: initial commit",
    });

    expect(result.prompt).toContain("2 files changed");
    expect(result.prompt).toContain("diff --git a/index.ts b/index.ts");
    expect(result.prompt).toContain("feat: initial commit");
    expect(result.outputSchema).toBeDefined();
  });

  it("keeps all four enrichment sections separate and in order (userHint < staticAnalysis < repoContext < projectRules)", () => {
    const result = buildDiffSummaryPrompt({
      diffSummary: "1 file changed",
      diffPatch: "diff --git a/src/app.ts b/src/app.ts\n+console.log('test');",
      userHint: "Custom instructions: Focus on security.",
      staticAnalysisContext: "Static Analysis Tool Findings:\n- ESLint: [warning] no-console",
      repoContext:
        "## Repo Context & Impact Analysis\n### File Commit History\n**src/app.ts**\n- 2024-01-01 [abc00001] Alice: Add app entry point",
      projectRules: "All console statements must be removed before merging.",
    });

    expect(result.prompt).toContain(
      "Custom Review Instructions: Custom instructions: Focus on security.",
    );
    expect(result.prompt).toContain(
      "Static Analysis Tool Findings:\n- ESLint: [warning] no-console",
    );
    expect(result.prompt).toContain("## Repo Context & Impact Analysis");
    expect(result.prompt).toContain("## Project Review Rules (.tabs-review.json)");
    expect(result.prompt).toContain("All console statements must be removed before merging.");

    const customIndex = result.prompt.indexOf("Custom Review Instructions:");
    const staticIndex = result.prompt.indexOf("Static Analysis Tool Findings:");
    const repoIndex = result.prompt.indexOf("## Repo Context & Impact Analysis");
    const projectIndex = result.prompt.indexOf("## Project Review Rules (.tabs-review.json)");

    expect(customIndex).toBeGreaterThan(-1);
    expect(staticIndex).toBeGreaterThan(-1);
    expect(repoIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(-1);

    // Strict ordering: userHint < staticAnalysis < repoContext < projectRules
    expect(staticIndex).toBeGreaterThan(customIndex);
    expect(repoIndex).toBeGreaterThan(staticIndex);
    expect(projectIndex).toBeGreaterThan(repoIndex);
  });
});

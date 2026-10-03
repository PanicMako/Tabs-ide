import { it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({ runProcess: vi.fn() }));

import { runProcess } from "../../processRunner";
import { AzureDevOpsCli } from "../Services/AzureDevOpsCli";
import { AzureDevOpsCliLive, decodeAzureDevOpsPullRequests } from "./AzureDevOpsCli";

const mockedRunProcess = vi.mocked(runProcess);

afterEach(() => mockedRunProcess.mockReset());

it("normalizes Azure DevOps pull request metadata", () => {
  expect(
    decodeAzureDevOpsPullRequests([
      {
        pullRequestId: 17,
        title: "Ship Azure support",
        description: "Provider-backed.",
        status: "active",
        isDraft: true,
        autoCompleteSetBy: { uniqueName: "merger@example.com" },
        completionOptions: { squashMerge: true },
        mergeStatus: "conflicts",
        sourceRefName: "refs/heads/feature/azure",
        targetRefName: "refs/heads/main",
        creationDate: "2026-09-01T10:00:00Z",
        createdBy: { uniqueName: "author@example.com", displayName: "Author" },
        reviewers: [{ uniqueName: "reviewer@example.com" }],
        repository: { webUrl: "https://dev.azure.com/org/project/_git/repo" },
        _links: {
          web: {
            href: "https://dev.azure.com/org/project/_git/repo/pullrequest/17",
          },
        },
      },
    ]),
  ).toMatchObject([
    {
      provider: "azure-devops",
      number: 17,
      headBranch: "feature/azure",
      baseBranch: "main",
      state: "open",
      isDraft: true,
      autoMergeEnabled: true,
      autoMergeMethod: "squash",
      mergeability: "conflicting",
      author: { login: "author@example.com" },
      reviewers: [{ login: "reviewer@example.com" }],
    },
  ]);
});

const layer = it.layer(AzureDevOpsCliLive);

layer("AzureDevOpsCliLive", (it) => {
  it.effect("passes reviewer values as literal Azure CLI arguments", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "{}",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const azure = yield* AzureDevOpsCli;
      yield* azure.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "add_reviewer",
        value: "reviewer@example.com;$(literal)",
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "az",
        [
          "repos",
          "pr",
          "reviewer",
          "add",
          "--detect",
          "true",
          "--id",
          "42",
          "--reviewers",
          "reviewer@example.com;$(literal)",
          "--only-show-errors",
          "--output",
          "json",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("configures Azure auto-complete with the selected merge strategy", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "{}",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const azure = yield* AzureDevOpsCli;
      yield* azure.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "enable_auto_merge",
        mergeMethod: "squash",
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "az",
        [
          "repos",
          "pr",
          "update",
          "--detect",
          "true",
          "--id",
          "42",
          "--auto-complete",
          "true",
          "--squash",
          "true",
          "--only-show-errors",
          "--output",
          "json",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("disables Azure auto-complete without changing merge state", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "{}",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const azure = yield* AzureDevOpsCli;
      yield* azure.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "disable_auto_merge",
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "az",
        [
          "repos",
          "pr",
          "update",
          "--detect",
          "true",
          "--id",
          "42",
          "--auto-complete",
          "false",
          "--only-show-errors",
          "--output",
          "json",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("updates Azure pull request text as literal CLI arguments", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "{}",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const azure = yield* AzureDevOpsCli;
      yield* azure.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "edit_pull_request",
        title: "Literal $(title)",
        body: "Updated description",
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "az",
        [
          "repos",
          "pr",
          "update",
          "--detect",
          "true",
          "--id",
          "42",
          "--title",
          "Literal $(title)",
          "--description",
          "Updated description",
          "--only-show-errors",
          "--output",
          "json",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );
});

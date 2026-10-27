import * as Effect from "effect/Effect";
import type { TextGenerationShape } from "./TextGeneration";
import { expect, it, vi } from "vitest";
import {
  generateLocalCommitMessage,
  isLocalCommitModelReady,
  generateLocalPrContent,
  withLocalGitGeneration,
  markUnverifiedTesting,
} from "./LocalCommitDraft";
import { conventionalCommitsTextGenerationPolicy } from "./TextGenerationPresets";
import { ProviderInstanceId } from "@tabs/contracts";

const input = {
  cwd: "/test",
  branch: null,
  stagedSummary: "scm.ts",
  stagedPatch: "+ local generation",
  policy: conventionalCommitsTextGenerationPolicy,
  modelSelection: {
    instanceId: ProviderInstanceId.makeUnsafe("openrouter"),
    model: "openrouter/free",
  },
};
it("runs locally with a constrained schema and no remote credentials", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: "qwen3:0.6b" }] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: '{"subject":"feat(scm): generate local commit drafts","body":""}' },
      }),
    });
  const result = await generateLocalCommitMessage(
    input,
    "qwen3:0.6b",
    new AbortController().signal,
    fetchMock,
  );
  expect(result.subject).toBe("feat(scm): generate local commit drafts");
  expect(
    fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:11434/")),
  ).toBe(true);
  const request = fetchMock.mock.calls[1]?.[1];
  expect(request.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(request.body).think).toBe(false);
  expect(JSON.parse(request.body).format.properties.subject.pattern).toContain("feat|fix");
});
it("rejects cloud-backed Ollama models instead of sending repository content", async () => {
  const fetchMock = vi.fn();
  await expect(
    generateLocalCommitMessage(input, "gpt-oss:20b-cloud", new AbortController().signal, fetchMock),
  ).rejects.toThrow("downloaded local");
  expect(fetchMock).not.toHaveBeenCalled();
  const aliases = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ models: [{ name: "local-alias", remote_host: "https://ollama.com" }] }),
  });
  expect(await isLocalCommitModelReady("local-alias", new AbortController().signal, aliases)).toBe(
    false,
  );
});
it("rejects prose or nonconventional output without creating a message", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: "qwen3:0.6b" }] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "User Safety: safe" } }),
    });
  await expect(
    generateLocalCommitMessage(input, "qwen3:0.6b", new AbortController().signal, fetchMock),
  ).rejects.toThrow("invalid commit draft");
});
it("gives setup guidance when the daemon or downloaded model is unavailable", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  expect(await isLocalCommitModelReady("qwen3:0.6b", new AbortController().signal, fetchMock)).toBe(
    false,
  );
  await expect(
    generateLocalCommitMessage(input, "qwen3:0.6b", new AbortController().signal, fetchMock),
  ).rejects.toThrow("ollama pull qwen3:0.6b");
});

it("uses local Git writing even when the selected remote provider is unavailable", async () => {
  const remote = new Proxy(
    {},
    {
      get() {
        throw new Error("Remote provider must not be accessed");
      },
    },
  ) as TextGenerationShape;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: "qwen3:1.7b" }] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: '{"subject":"feat(scm): draft messages locally","body":""}' },
      }),
    });
  const service = withLocalGitGeneration(remote, Effect.succeed("qwen3:1.7b"), fetchMock);
  const result = await Effect.runPromise(service.generateCommitMessage(input));
  expect(result.subject).toBe("feat(scm): draft messages locally");
  expect(
    fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:11434/")),
  ).toBe(true);
});
it("drafts PRs from the supplied branch context and preserves template instructions", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: "qwen3:1.7b" }] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            title: "feat(scm): draft local messages",
            body: "## Purpose\nDraft messages locally.\n\n## Checks\nNot run",
          }),
        },
      }),
    });
  const result = await generateLocalPrContent(
    {
      cwd: "/repo",
      baseBranch: "main",
      headBranch: "feature/local",
      commitSummary: "feat(scm): draft local messages",
      diffSummary: "scm.ts | 2 ++",
      diffPatch: "+localDraft()",
      changeRequestTemplate: "## Purpose\n\n## Checks",
      modelSelection: input.modelSelection,
    },
    "qwen3:1.7b",
    new AbortController().signal,
    fetchMock,
  );
  expect(result.title).toBe("feat(scm): draft local messages");
  const request = JSON.parse(fetchMock.mock.calls[1]?.[1].body);
  expect(request.messages[0].content).toContain("Base branch: main");
  expect(request.messages[0].content).toContain("## Checks");
  expect(request.messages[0].content).toContain("do not invent issue links, tests run");
  expect(request.format.properties).toHaveProperty("title");
  expect(request.format.properties).not.toHaveProperty("subject");
});
it("does not fall back to a remote provider when Ollama is unavailable", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
  const service = withLocalGitGeneration(
    {} as TextGenerationShape,
    Effect.succeed("qwen3:1.7b"),
    fetchMock,
  );
  await expect(Effect.runPromise(service.generateCommitMessage(input))).rejects.toThrow(
    "Start Ollama",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("replaces invented verification claims while retaining the PR structure", () => {
  const result = markUnverifiedTesting(
    "## Summary\nUse a local model.\n\n## Testing\n- All checks passed\n### Details\nVerified on all platforms\n\n## Notes\nReview the model choice.",
  );
  expect(result).toContain("Not run (generation does not execute checks)");
  expect(result).not.toContain("All checks passed");
  expect(result).not.toContain("Verified on all platforms");
  expect(result).toContain("## Notes\nReview the model choice.");
});

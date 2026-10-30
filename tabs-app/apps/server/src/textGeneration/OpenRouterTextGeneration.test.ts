import { conventionalCommitsTextGenerationPolicy } from "./TextGenerationPresets";
import { OpenRouterSettings, ProviderInstanceId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { makeOpenRouterTextGeneration } from "./OpenRouterTextGeneration";

describe("OpenRouterTextGeneration", () => {
  it("reports rate limits without exposing the upstream payload or retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"metadata":"large private upstream payload"}',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const driver = await Effect.runPromise(
        makeOpenRouterTextGeneration({
          harness: "deepseek",
          deepseekBinaryPath: "dsh",
          binaryPath: "opencode",
          enabled: true,
          apiKey: "test-key",
          baseUrl: "https://openrouter.test/api/v1",
          customModels: [],
        }),
      );
      const result = await Effect.runPromise(
        Effect.result(
          driver.generateCommitMessage({
            cwd: "/test",
            branch: null,
            stagedSummary: "README.md",
            stagedPatch: "+ documentation",
            modelSelection: {
              instanceId: ProviderInstanceId.makeUnsafe("openrouter"),
              model: "vendor/model:free",
            },
          }),
        ),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.detail).toContain("rate limiting");
        expect(result.failure.detail).toContain("Settings > Providers > OpenRouter");
        expect(result.failure.detail).not.toContain("private upstream");
      }
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).provider.allow_fallbacks).toBe(
        false,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    ["feat(scm): draft commit messages from staged changes", true],
    ["fix(explorer): preserve selection when renaming files", true],
    ["Add commit message generation and rail presentation controls", false],
  ])("validates Conventional Commit output: %s", async (subject, valid) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ subject, body: "" }) } }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const driver = await Effect.runPromise(
        makeOpenRouterTextGeneration({
          harness: "deepseek",
          deepseekBinaryPath: "dsh",
          binaryPath: "opencode",
          enabled: true,
          apiKey: "test-key",
          baseUrl: "https://openrouter.test/api/v1",
          customModels: [],
        }),
      );
      const result = await Effect.runPromise(
        Effect.result(
          driver.generateCommitMessage({
            cwd: "/test",
            branch: null,
            stagedSummary: "scm.ts",
            stagedPatch: "+ generate draft",
            policy: conventionalCommitsTextGenerationPolicy,
            modelSelection: {
              instanceId: ProviderInstanceId.makeUnsafe("openrouter"),
              model: "vendor/model:free",
            },
          }),
        ),
      );
      expect(result._tag).toBe(valid ? "Success" : "Failure");
      const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(payload.messages[0].content).toContain("Conventional Commits 1.0.0");
      expect(payload.messages[0].content).toContain("do not produce a file-by-file inventory");
      expect(payload.response_format.json_schema.schema.properties.subject.pattern).toContain(
        "feat|fix",
      );
      expect(payload.response_format.json_schema.schema.properties.subject.maxLength).toBe(72);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves automatic free routing to a compatible text model before sending the diff", async () => {
    const model = (id: string) => ({
      id,
      context_length: 65_536,
      supported_parameters: ["tools", "structured_outputs"],
      pricing: { prompt: "0", completion: "0" },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [model("vendor/safety-guard:free"), model("vendor/chat:free")],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: '{"subject":"feat(scm): generate commit drafts","body":""}' } },
          ],
        }),
      });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const driver = await Effect.runPromise(
        makeOpenRouterTextGeneration({
          harness: "deepseek",
          deepseekBinaryPath: "dsh",
          binaryPath: "opencode",
          enabled: true,
          apiKey: "test-key",
          baseUrl: "https://openrouter.test/api/v1",
          customModels: [],
        }),
      );
      const result = await Effect.runPromise(
        driver.generateCommitMessage({
          cwd: "/test",
          branch: null,
          stagedSummary: "scm.ts",
          stagedPatch: "+ draft",
          policy: conventionalCommitsTextGenerationPolicy,
          modelSelection: {
            instanceId: ProviderInstanceId.makeUnsafe("openrouter"),
            model: "openrouter/free",
          },
        }),
      );
      expect(result.subject).toBe("feat(scm): generate commit drafts");
      const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      expect(payload.model).toBe("vendor/chat:free");
      expect(payload.provider).toEqual({ allow_fallbacks: false, require_parameters: true });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.test/api/v1/models/user");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends the operation-specific JSON Schema", async () => {
    const settings: OpenRouterSettings = {
      harness: "deepseek",
      deepseekBinaryPath: "dsh",
      binaryPath: "opencode",
      enabled: true,
      apiKey: "test-openrouter-key",
      baseUrl: "https://openrouter.test/api/v1",
      customModels: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Generate operation schema",
                body: "## Summary\n- Send the PR schema.\n\n## Testing\n- Added contract coverage.",
              }),
            },
          },
        ],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const driver = await Effect.runPromise(makeOpenRouterTextGeneration(settings));
      await Effect.runPromise(
        driver.generatePrContent({
          cwd: "/test",
          baseBranch: "main",
          headBranch: "feature/schema",
          commitSummary: "Add schema support",
          diffSummary: "1 file changed",
          diffPatch: "+ schema",
          modelSelection: {
            instanceId: ProviderInstanceId.make("openrouter"),
            model: "vendor/model",
          },
        }),
      );

      const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        response_format: {
          type: string;
          json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
        };
      };
      expect(request.response_format).toMatchObject({
        type: "json_schema",
        json_schema: {
          name: "generatePrContent",
          strict: true,
          schema: {
            type: "object",
            required: ["title", "body"],
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

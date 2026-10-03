import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyCopilotAcpModelSelection,
  buildCopilotAcpSpawnInput,
  buildCopilotEnvironment,
  resolveCopilotAcpBaseModelId,
  resolveCopilotAuthMethodId,
  resolveCopilotTerminalAuthCommand,
} from "./CopilotAcpSupport";

describe("resolveCopilotAcpBaseModelId", () => {
  it("requires an explicit Copilot model id", () => {
    expect(resolveCopilotAcpBaseModelId(undefined)).toBeUndefined();
    expect(resolveCopilotAcpBaseModelId("   ")).toBeUndefined();
    expect(resolveCopilotAcpBaseModelId("  account-model-a  ")).toBe("account-model-a");
    expect(resolveCopilotAcpBaseModelId("  account-model-b  ")).toBe("account-model-b");
  });
});

describe("buildCopilotAcpSpawnInput", () => {
  it("constructs standard spawn input with --acp --stdio", () => {
    const spawn = buildCopilotAcpSpawnInput(
      { binaryPath: "/usr/local/bin/copilot" },
      "/workspace/project",
      {},
    );

    expect(spawn.command).toBe("/usr/local/bin/copilot");
    expect(spawn.args).toEqual(["--acp", "--stdio"]);
    expect(spawn.cwd).toBe("/workspace/project");
  });

  it("injects configured token into environment variables without leaking parent tokens", () => {
    const env = buildCopilotEnvironment({}, { PATH: "/bin:/usr/bin" }, "github_pat_test12345");

    expect(env.COPILOT_GITHUB_TOKEN).toBe("github_pat_test12345");
    expect(env.GH_TOKEN).toBe("github_pat_test12345");
    expect(env.GITHUB_TOKEN).toBe("github_pat_test12345");
  });

  it("injects GitHub Enterprise host into environment", () => {
    const env = buildCopilotEnvironment({ gheHost: "https://ghe.mycompany.com" }, { PATH: "/bin" });

    expect(env.GITHUB_ENTERPRISE_URL).toBe("https://ghe.mycompany.com");
    expect(env.GH_HOST).toBe("https://ghe.mycompany.com");
  });

  it("injects BYOK provider api keys", () => {
    const env = buildCopilotEnvironment(
      { byokProvider: "openai", byokApiKey: "sk-proj-test99" },
      { PATH: "/bin" },
    );

    expect(env.COPILOT_PROVIDER_OPENAI_API_KEY).toBe("sk-proj-test99");
    expect(env.COPILOT_PROVIDER_API_KEY).toBe("sk-proj-test99");
  });

  it("removes ambient BYOK keys unless the user configured BYOK", () => {
    const env = buildCopilotEnvironment(
      {},
      {
        PATH: "/bin",
        COPILOT_PROVIDER_API_KEY: "ambient-generic",
        COPILOT_PROVIDER_OPENAI_API_KEY: "ambient-openai",
        COPILOT_GITHUB_TOKEN: "ambient-copilot-token",
        GH_TOKEN: "ambient-gh-token",
        GITHUB_TOKEN: "ambient-github-token",
      },
    );

    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("resolveCopilotTerminalAuthCommand", () => {
  it("extracts terminal-auth command and args from advertised initialize metadata", () => {
    const meta = {
      "terminal-auth": {
        command: "copilot",
        args: ["login", "--web"],
        label: "GitHub Sign In",
      },
    };

    const resolved = resolveCopilotTerminalAuthCommand(meta);
    expect(resolved.command).toBe("copilot");
    expect(resolved.args).toEqual(["login", "--web"]);
    expect(resolved.label).toBe("GitHub Sign In");
  });

  it("appends --host when a GitHub Enterprise host is specified", () => {
    const meta = {
      "terminal-auth": {
        command: "copilot",
        args: ["login"],
      },
    };

    const resolved = resolveCopilotTerminalAuthCommand(meta, "https://ghe.mycorp.internal");
    expect(resolved.args).toEqual(["login", "--host", "https://ghe.mycorp.internal"]);
  });

  it("falls back to default copilot login if metadata is absent", () => {
    const resolved = resolveCopilotTerminalAuthCommand(undefined);
    expect(resolved.command).toBe("copilot");
    expect(resolved.args).toEqual(["login"]);
  });
});

describe("resolveCopilotAuthMethodId", () => {
  it("resolves the first advertised authMethod id dynamically", () => {
    const initializeResult = {
      protocolVersion: "1.0",
      authMethods: [
        { id: "copilot-login", name: "GitHub Login" },
        { id: "device-code", name: "Device Code" },
      ],
    } as any;

    expect(resolveCopilotAuthMethodId(initializeResult)).toBe("copilot-login");
  });

  it("uses BYOK auth method when BYOK key is configured", () => {
    expect(resolveCopilotAuthMethodId(undefined, { byokApiKey: "sk-test" })).toBe("byok");
  });

  it("falls back to copilot-login when authMethods array is empty", () => {
    expect(resolveCopilotAuthMethodId({ protocolVersion: "1.0", authMethods: [] } as any)).toBe(
      "copilot-login",
    );
    expect(resolveCopilotAuthMethodId(undefined)).toBe("copilot-login");
  });
});

describe("applyCopilotAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<string> = [];
    const runtime = {
      setSessionModel: (modelId: string) =>
        Effect.gen(function* () {
          modelCalls.push(modelId);
          if (failure) return yield* failure;
          return {};
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("calls session/set_model when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyCopilotAcpModelSelection({
        runtime,
        currentModelId: "account-model-a",
        requestedModelId: "account-model-b",
        mapError: (cause) => cause.message,
      });

      expect(result).toBe("account-model-b");
      expect(modelCalls).toEqual(["account-model-b"]);
    }),
  );

  it.effect("no-ops when requested model equals current model", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyCopilotAcpModelSelection({
        runtime,
        currentModelId: "account-model-a",
        requestedModelId: "account-model-a",
        mapError: (cause) => cause.message,
      });

      expect(result).toBe("account-model-a");
      expect(modelCalls).toHaveLength(0);
    }),
  );
});

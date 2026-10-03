import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch, ProviderInstanceId } from "@tabs/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { vi } from "vitest";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const keytarMock = vi.hoisted(() => ({
  deletePassword: vi.fn(async () => true),
  getPassword: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
}));

vi.mock("keytar", () => ({ default: keytarMock }));

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "tabs-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        }),
        {
          textGenerationModelSelection: {
            // Legacy object option payloads decode to the canonical
            // `ProviderOptionSelections` array shape.
            options: [{ id: "fastMode", value: false }],
          },
        },
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: true },
          ],
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        shadowHomePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        homePath: "",
        customModels: ["claude-custom"],
        launchArgs: "",
      });
      // Option selections are merged by id under the canonical array shape,
      // so reasoningEffort is preserved and fastMode is updated.
      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: "codex" as ProviderInstanceId,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: false },
        ],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("replaces text generation selection when provider or model changes", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-sonnet-4-5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: "claudeAgent" as ProviderInstanceId,
        model: "claude-sonnet-4-5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("clears stale text generation options when a full selection omits them", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5.4",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5.4",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        shadowHomePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        homePath: "",
        customModels: [],
        launchArgs: "",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores Copilot tokens securely without persisting plaintext", () =>
    Effect.gen(function* () {
      keytarMock.setPassword.mockClear();
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      const next = yield* serverSettings.updateSettings({
        providers: { copilot: { token: "github_pat_secure_test" } },
      });

      assert.equal(next.providers.copilot.token, "");
      assert.deepEqual(keytarMock.setPassword.mock.calls, [
        ["Tabs GitHub Copilot", "github-token", "github_pat_secure_test"],
      ]);
      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.equal(raw.includes("github_pat_secure_test"), false);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores every app-managed provider secret in the OS credential store", () =>
    Effect.gen(function* () {
      keytarMock.setPassword.mockClear();
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      const next = yield* serverSettings.updateSettings({
        providers: {
          copilot: { byokApiKey: "copilot-byok-secret" },
          gemini: { apiKey: "gemini-secret" },
          droid: { apiKey: "droid-secret" },
          antigravity: { apiKey: "antigravity-secret" },
          openrouter: { apiKey: "openrouter-secret" },
          opencode: { serverPassword: "opencode-secret" },
          kilo: { serverPassword: "kilo-secret" },
        },
      });

      assert.equal(next.providers.copilot.byokApiKey, "");
      assert.equal(next.providers.gemini.apiKey, "");
      assert.equal(next.providers.droid.apiKey, "");
      assert.equal(next.providers.antigravity.apiKey, "");
      assert.equal(next.providers.openrouter.apiKey, "");
      assert.equal(next.providers.opencode.serverPassword, "");
      assert.equal(next.providers.kilo.serverPassword, "");
      assert.deepEqual(keytarMock.setPassword.mock.calls, [
        ["Tabs Provider Credentials", "copilot.byok-api-key", "copilot-byok-secret"],
        ["Tabs Provider Credentials", "gemini.api-key", "gemini-secret"],
        ["Tabs Provider Credentials", "droid.api-key", "droid-secret"],
        ["Tabs Provider Credentials", "antigravity.api-key", "antigravity-secret"],
        ["Tabs Provider Credentials", "openrouter.api-key", "openrouter-secret"],
        ["Tabs Provider Credentials", "opencode.server-password", "opencode-secret"],
        ["Tabs Provider Credentials", "kilo.server-password", "kilo-secret"],
      ]);
      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.equal(raw.includes("droid-secret"), false);
      assert.equal(raw.includes("antigravity-secret"), false);
      assert.equal(raw.includes("openrouter-secret"), false);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("migrates a legacy plaintext Copilot token during startup", () =>
    Effect.gen(function* () {
      keytarMock.setPassword.mockClear();
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      yield* fileSystem.makeDirectory(serverConfig.stateDir, { recursive: true });
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({ providers: { copilot: { token: "github_pat_legacy_test" } } }),
      );
      yield* serverSettings.start;

      assert.deepEqual(keytarMock.setPassword.mock.calls, [
        ["Tabs GitHub Copilot", "github-token", "github_pat_legacy_test"],
      ]);
      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.equal(raw.includes("github_pat_legacy_test"), false);
      assert.equal((yield* serverSettings.getSettings).providers.copilot.token, "");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});

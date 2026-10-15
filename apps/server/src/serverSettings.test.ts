import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch, ProviderInstanceId } from "@tabs/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import { vi } from "vitest";
import { ServerConfig } from "./config";
import {
  redactServerSettingsForClient,
  ServerSettingsLive,
  ServerSettingsService,
} from "./serverSettings";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";

const keytarMock = vi.hoisted(() => ({
  deletePassword: vi.fn(async () => true),
  getPassword: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
}));

import * as SqlitePersistence from "./persistence/Sqlite.ts";

vi.mock("keytar", () => ({ default: keytarMock }));

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(SqlitePersistence.layerConfig),
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
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection!.model,
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
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        homePath: "",
        customModels: ["claude-custom"],
        launchArgs: "",
        autoCompactWindow: "",
      });
      // Option selections are merged by id under the canonical array shape,
      // so reasoningEffort is preserved and fastMode is updated.
      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: "codex" as ProviderInstanceId,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection!.model,
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
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection!.model,
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
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection!.model,
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
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        homePath: "",
        customModels: [],
        launchArgs: "",
        autoCompactWindow: "",
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
          cursor: {
            enabled: false,
          },
          grok: {
            enabled: false,
          },
          opencode: {
            enabled: false,
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "keeps Bitbucket tokens in the secret store and tells clients only that one is set",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const serverConfig = yield* ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;

        const saved = yield* serverSettings.updateSettings({
          bitbucket: { email: "me@example.com", accessToken: "bb-access", apiToken: "bb-api" },
        });
        assert.deepEqual(saved.bitbucket, {
          email: "me@example.com",
          accessToken: "bb-access",
          apiToken: "bb-api",
        });

        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.equal(raw.includes("bb-access"), false);
        assert.equal(raw.includes("bb-api"), false);
        assert.equal(raw.includes("me@example.com"), true);

        const forClient = redactServerSettingsForClient(saved).bitbucket;
        assert.equal(forClient.email, "me@example.com");
        assert.equal(forClient.accessToken.includes("bb-access"), false);
        assert.equal(forClient.apiToken.includes("bb-api"), false);
        assert.isAbove(forClient.accessToken.length, 0);
        assert.isAbove(forClient.apiToken.length, 0);

        const cleared = yield* serverSettings.updateSettings({ bitbucket: { accessToken: "" } });
        assert.equal(cleared.bitbucket.accessToken, "");
        assert.equal(cleared.bitbucket.apiToken, "bb-api");
        assert.isTrue(Option.isNone(yield* secrets.get("bitbucket-access-token")));
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});

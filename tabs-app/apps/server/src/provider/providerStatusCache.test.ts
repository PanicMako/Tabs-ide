import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@tabs/contracts";
import { createModelCapabilities } from "@tabs/shared/model";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  hydrateCachedProvider,
  isCachedProviderCorrelated,
  PROVIDER_STATUS_CACHE_SCHEMA_VERSION,
  readProviderStatusCache,
  readProviderStatusCacheEnvelope,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "./providerStatusCache";

const emptyCapabilities = createModelCapabilities({ optionDescriptors: [] });
const CODEX_DRIVER = "codex" as ProviderDriverKind;
const CLAUDE_AGENT_DRIVER = "claudeAgent" as ProviderDriverKind;
const OPENCODE_DRIVER = "opencode" as ProviderDriverKind;

const makeProvider = (
  provider: ProviderDriverKind,
  overrides?: Partial<ServerProvider>,
): ServerProvider => ({
  instanceId: defaultInstanceIdForDriver(provider),
  driver: provider,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-11T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

it.layer(NodeServices.layer)("providerStatusCache", (it) => {
  it.effect("writes and reads provider status snapshots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-cache-" });
      const codexProvider = makeProvider(CODEX_DRIVER);
      const claudeProvider = makeProvider(CLAUDE_AGENT_DRIVER, {
        status: "warning",
        auth: { status: "unknown" },
      });
      const openCodeProvider = makeProvider(OPENCODE_DRIVER, {
        status: "warning",
        auth: { status: "unknown", type: "opencode" },
      });
      const codexPath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: defaultInstanceIdForDriver("codex" as ProviderDriverKind),
      });
      const claudePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: defaultInstanceIdForDriver("claudeAgent" as ProviderDriverKind),
      });
      const openCodePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: defaultInstanceIdForDriver("opencode" as ProviderDriverKind),
      });

      yield* writeProviderStatusCache({
        filePath: codexPath,
        provider: codexProvider,
      });
      yield* writeProviderStatusCache({
        filePath: claudePath,
        provider: claudeProvider,
      });
      yield* writeProviderStatusCache({
        filePath: openCodePath,
        provider: openCodeProvider,
      });

      assert.deepStrictEqual(yield* readProviderStatusCache(codexPath), codexProvider);
      assert.deepStrictEqual(yield* readProviderStatusCache(claudePath), claudeProvider);
      assert.deepStrictEqual(yield* readProviderStatusCache(openCodePath), openCodeProvider);
    }),
  );

  it("hydrates cached provider status while preserving current settings-derived models", () => {
    const cachedCodex = makeProvider(CODEX_DRIVER, {
      checkedAt: "2026-04-10T12:00:00.000Z",
      models: [
        {
          slug: "gpt-5-mini",
          name: "GPT-5 Mini",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      message: "Cached message",
      skills: [
        {
          name: "github:gh-fix-ci",
          path: "/tmp/skills/gh-fix-ci/SKILL.md",
          enabled: true,
          displayName: "CI Debug",
        },
      ],
    });
    const fallbackCodex = makeProvider(CODEX_DRIVER, {
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      message: "Pending refresh",
    });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      {
        ...fallbackCodex,
        models: [
          ...fallbackCodex.models,
          {
            slug: "gpt-5-mini",
            name: "GPT-5 Mini",
            isCustom: false,
            capabilities: emptyCapabilities,
          },
        ],
        installed: cachedCodex.installed,
        version: cachedCodex.version,
        status: cachedCodex.status,
        auth: cachedCodex.auth,
        checkedAt: cachedCodex.checkedAt,
        slashCommands: cachedCodex.slashCommands,
        skills: cachedCodex.skills,
        message: cachedCodex.message,
      },
    );
  });

  it("ignores stale cached enabled state when the provider is now disabled", () => {
    const cachedCodex = makeProvider(CODEX_DRIVER, {
      checkedAt: "2026-04-10T12:00:00.000Z",
      message: "Cached ready status",
    });
    const disabledFallback = makeProvider(CODEX_DRIVER, {
      enabled: false,
      installed: false,
      version: null,
      status: "disabled",
      auth: { status: "unknown" },
      message: "Codex is disabled in Tabs settings.",
    });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: disabledFallback,
      }),
      disabledFallback,
    );
  });

  it("rejects cached snapshots that are not correlated to the fallback instance", () => {
    const fallbackCodex = makeProvider(CODEX_DRIVER, {
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
    });
    const legacyCachedCodex = {
      provider: "codex" as ProviderDriverKind,
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T12:00:00.000Z",
      models: [
        {
          slug: "cached-legacy-model",
          name: "Cached Legacy Model",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      slashCommands: [],
      skills: [],
    } as unknown as ServerProvider;
    const mismatchedCachedCodex = makeProvider(CODEX_DRIVER, {
      instanceId: "codex_personal" as ProviderInstanceId,
    });

    assert.strictEqual(
      isCachedProviderCorrelated({
        cachedProvider: legacyCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      false,
    );
    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: legacyCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      fallbackCodex,
    );
    assert.strictEqual(
      isCachedProviderCorrelated({
        cachedProvider: mismatchedCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      false,
    );
    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: mismatchedCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      fallbackCodex,
    );
  });

  it.effect("writes and reads versioned provider cache identity envelopes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-envelope-test-" });
      const codexProvider = makeProvider(CODEX_DRIVER, {
        checkedAt: "2026-09-13T12:00:00.000Z",
      });
      const cachePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: codexProvider.instanceId,
      });

      yield* writeProviderStatusCache({
        filePath: cachePath,
        provider: codexProvider,
      });

      const envelope = yield* readProviderStatusCacheEnvelope(cachePath);
      assert.ok(envelope !== undefined);
      assert.strictEqual(envelope.schemaVersion, PROVIDER_STATUS_CACHE_SCHEMA_VERSION);
      assert.strictEqual(envelope.instanceId, codexProvider.instanceId);
      assert.strictEqual(envelope.driver, codexProvider.driver);
      assert.deepStrictEqual(envelope.provider, codexProvider);

      // readProviderStatusCache unwraps to the provider
      const unwrapped = yield* readProviderStatusCache(cachePath);
      assert.deepStrictEqual(unwrapped, codexProvider);
    }),
  );

  it.effect("synthesizes envelope when reading legacy un-enveloped cache files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-legacy-test-" });
      const codexProvider = makeProvider(CODEX_DRIVER, {
        checkedAt: "2026-04-10T12:00:00.000Z",
      });
      const cachePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: codexProvider.instanceId,
      });

      // Write raw ServerProvider JSON without envelope
      yield* fs.writeFileString(cachePath, JSON.stringify(codexProvider, null, 2));

      const envelope = yield* readProviderStatusCacheEnvelope(cachePath);
      assert.ok(envelope !== undefined);
      assert.strictEqual(envelope.schemaVersion, PROVIDER_STATUS_CACHE_SCHEMA_VERSION);
      assert.strictEqual(envelope.instanceId, codexProvider.instanceId);
      assert.strictEqual(envelope.driver, codexProvider.driver);
      assert.deepStrictEqual(envelope.provider, codexProvider);
    }),
  );

  it("preserves last-known-good models when fallback provider has empty models list", () => {
    const cachedCodex = makeProvider(CODEX_DRIVER, {
      checkedAt: "2026-04-10T12:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
    });
    // Fallback provider returned by an un-probed or failed refresh has empty models
    const fallbackCodex = makeProvider(CODEX_DRIVER, {
      models: [],
      status: "warning",
      message: "Temporary probe failure",
    });

    const hydrated = hydrateCachedProvider({
      cachedProvider: cachedCodex,
      fallbackProvider: fallbackCodex,
    });

    // Models should be preserved from cache!
    assert.strictEqual(hydrated.models.length, 1);
    assert.strictEqual(hydrated.models[0]?.slug, "gpt-5.4");
  });
});

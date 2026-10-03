import { KeybindingRule, KeybindingsConfig, MAX_KEYBINDINGS_COUNT } from "@tabs/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ServerConfig } from "./config";

import { Keybindings, KeybindingsConfigError, KeybindingsLive } from "./keybindings";

const KeybindingsConfigJson = Schema.fromJsonString(KeybindingsConfig);

const makeKeybindingsLayer = () => {
  return KeybindingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "tabs-keybindings-batch-test-",
        }),
      ),
    ),
  );
};

const toDetailResult = <A, R>(effect: Effect.Effect<A, KeybindingsConfigError, R>) =>
  effect.pipe(
    Effect.mapError((error) => error.detail),
    Effect.result,
  );

const writeKeybindingsConfig = (configPath: string, rules: readonly KeybindingRule[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const encoded = yield* Schema.encodeEffect(KeybindingsConfigJson)(rules);
    yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fileSystem.writeFileString(configPath, encoded);
  });

const readKeybindingsConfig = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const rawConfig = yield* fileSystem.readFileString(configPath);
    return yield* Schema.decodeUnknownEffect(KeybindingsConfigJson)(rawConfig);
  });

it.layer(NodeServices.layer)("keybindings.batch", (it) => {
  it.effect("rejects structurally invalid entry upfront and performs zero disk writes", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig;
      const initialRules: KeybindingRule[] = [{ key: "mod+j", command: "terminal.toggle" }];
      yield* writeKeybindingsConfig(keybindingsConfigPath, initialRules);

      const invalidBatch = [
        { key: "mod+k", command: "commandPalette.toggle" },
        // Structurally invalid: missing key, command is invalid number
        { key: "", command: 12345 as any },
      ] as const;

      const result = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings;
        return yield* keybindings.batchUpsertKeybindingRules(invalidBatch as any);
      }).pipe(toDetailResult);

      assertFailure(result, "Invalid keybinding entry at index 1: command=12345");

      // Verify the disk file was NOT modified
      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(
        persisted.map(({ key, command }) => ({ key, command })),
        initialRules,
      );
    }).pipe(Effect.provide(makeKeybindingsLayer())),
  );

  it.effect("writes twenty valid rules in a single batch and returns exact committed count", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig;

      // Create 20 unique valid rules
      const twentyRules: KeybindingRule[] = [
        { key: "meta+1", command: "tab.jumpTo1" },
        { key: "meta+2", command: "tab.jumpTo2" },
        { key: "meta+3", command: "tab.jumpTo3" },
        { key: "meta+4", command: "tab.jumpTo4" },
        { key: "meta+5", command: "tab.jumpTo5" },
        { key: "meta+6", command: "tab.jumpTo6" },
        { key: "meta+7", command: "tab.jumpTo7" },
        { key: "meta+8", command: "tab.jumpTo8" },
        { key: "meta+9", command: "tab.jumpTo9" },
        { key: "meta+t", command: "tab.new" },
        { key: "meta+w", command: "tab.close" },
        { key: "meta+]", command: "tab.next" },
        { key: "meta+[", command: "tab.prev" },
        { key: "meta+j", command: "terminal.toggle" },
        { key: "meta+`", command: "terminal.new" },
        { key: "meta+k", command: "commandPalette.toggle" },
        { key: "meta+b", command: "sidebar.toggle" },
        { key: "meta+,", command: "window.settings" },
        { key: "meta+r", command: "window.reload" },
        { key: "meta+=", command: "zoom.in" },
      ];

      const res = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings;
        return yield* keybindings.batchUpsertKeybindingRules(twentyRules);
      });

      assert.equal(res.importedCount, 20);

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.equal(persisted.length, 20);
      assert.deepEqual(
        persisted.map((r) => r.command),
        twentyRules.map((r) => r.command),
      );
    }).pipe(Effect.provide(makeKeybindingsLayer())),
  );

  it.effect("resolves duplicate commands deterministically with later entries winning", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig;

      const batchWithDuplicates: KeybindingRule[] = [
        { key: "meta+j", command: "terminal.toggle" },
        { key: "meta+t", command: "tab.new" },
        // Later duplicate of terminal.toggle with different key
        { key: "meta+shift+`", command: "terminal.toggle" },
      ];

      const res = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings;
        return yield* keybindings.batchUpsertKeybindingRules(batchWithDuplicates);
      });

      // 3 items in batch, but only 2 unique commands committed
      assert.equal(res.importedCount, 2);

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.equal(persisted.length, 2);

      const terminalToggle = persisted.find((r) => r.command === "terminal.toggle");
      assert.isDefined(terminalToggle);
      assert.equal(terminalToggle?.key, "meta+shift+`");
    }).pipe(Effect.provide(makeKeybindingsLayer())),
  );

  it.effect("preserves existing custom keybindings not overridden by the batch", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig;

      // Seed with existing custom rule
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "meta+shift+p", command: "commandPalette.toggle" },
        { key: "meta+k", command: "terminal.new" },
      ]);

      const batch: KeybindingRule[] = [
        // Overrides commandPalette.toggle
        { key: "meta+p", command: "commandPalette.toggle" },
        // New command
        { key: "meta+j", command: "terminal.toggle" },
      ];

      const res = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings;
        return yield* keybindings.batchUpsertKeybindingRules(batch);
      });

      assert.equal(res.importedCount, 2);

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      // terminal.new was preserved, commandPalette.toggle was updated, terminal.toggle was added
      assert.equal(persisted.length, 3);
      assert.isTrue(persisted.some((r) => r.command === "terminal.new" && r.key === "meta+k"));
      assert.isTrue(
        persisted.some((r) => r.command === "commandPalette.toggle" && r.key === "meta+p"),
      );
      assert.isTrue(persisted.some((r) => r.command === "terminal.toggle" && r.key === "meta+j"));
    }).pipe(Effect.provide(makeKeybindingsLayer())),
  );

  it.effect("leaves original file unchanged when persistence fails partway", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig;
      const { dirname } = yield* Path.Path;

      const initialRules: KeybindingRule[] = [{ key: "meta+j", command: "terminal.toggle" }];
      yield* writeKeybindingsConfig(keybindingsConfigPath, initialRules);

      // Make directory read-only to simulate atomic write failure
      yield* fs.chmod(dirname(keybindingsConfigPath), 0o500);

      const result = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings;
        return yield* keybindings.batchUpsertKeybindingRules([
          { key: "meta+k", command: "commandPalette.toggle" },
          { key: "meta+b", command: "sidebar.toggle" },
        ]);
      }).pipe(toDetailResult);

      assertFailure(result, "failed to write keybindings config");

      // Restore write permissions
      yield* fs.chmod(dirname(keybindingsConfigPath), 0o700);

      // Verify original file is 100% intact
      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(
        persisted.map(({ key, command }) => ({ key, command })),
        initialRules,
      );
    }).pipe(Effect.provide(makeKeybindingsLayer())),
  );

  it.effect(
    "rejects oversized import exceeding MAX_KEYBINDINGS_COUNT without modifying original file",
    () =>
      Effect.gen(function* () {
        const { keybindingsConfigPath } = yield* ServerConfig;

        const initialRules: KeybindingRule[] = [{ key: "meta+j", command: "terminal.toggle" }];
        yield* writeKeybindingsConfig(keybindingsConfigPath, initialRules);

        // Create a batch that exceeds MAX_KEYBINDINGS_COUNT
        const oversizedBatch: KeybindingRule[] = [];
        for (let i = 0; i <= MAX_KEYBINDINGS_COUNT; i++) {
          oversizedBatch.push({ key: `ctrl+shift+${i % 10}`, command: `script.cmd${i}.run` });
        }

        const result = yield* Effect.gen(function* () {
          const keybindings = yield* Keybindings;
          return yield* keybindings.batchUpsertKeybindingRules(oversizedBatch);
        }).pipe(toDetailResult);

        assertFailure(
          result,
          `Keybindings limit exceeded: maximum allowed is ${MAX_KEYBINDINGS_COUNT} rules, but resulting configuration would have ${oversizedBatch.length + initialRules.length} rules.`,
        );

        // Verify original file is 100% intact and not overwritten or truncated
        const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
        assert.deepEqual(
          persisted.map(({ key, command }) => ({ key, command })),
          initialRules,
        );
      }).pipe(Effect.provide(makeKeybindingsLayer())),
  );
});

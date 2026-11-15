import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Settings from "../serverSettings.ts";
import { sweep } from "./ProjectSettingsOverrideSweep.ts";

const run = (overrides: Record<string, unknown>, liveIds: ReadonlyArray<string>) => {
  const patches: Array<unknown> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(Settings.ServerSettingsService, {
      getSettings: Effect.succeed({ projectSettingsOverrides: overrides }),
      updateSettings: (patch: unknown) => Effect.sync(() => void patches.push(patch)),
    } as never),
    Layer.succeed(ProjectStore.ProjectStoreV2, {
      listShells: () => Effect.succeed(liveIds.map((id) => ({ id }))),
    } as never),
  );
  return sweep.pipe(Effect.provide(layer), Effect.as(patches));
};

describe("ProjectSettingsOverrideSweep", () => {
  it.effect("clears overrides of projects that no longer exist", () =>
    Effect.gen(function* () {
      const patches = yield* run({ live: {}, gone: {}, alsoGone: {} }, ["live"]);
      assert.deepEqual(patches, [{ projectSettingsOverrides: { gone: null, alsoGone: null } }]);
    }),
  );

  it.effect("writes nothing when every override belongs to a live project", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* run({ live: {} }, ["live"]), []);
    }),
  );
});

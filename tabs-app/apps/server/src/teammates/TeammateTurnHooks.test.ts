import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { Teammate, TeammateId, ThreadId } from "@tabs/contracts";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import { TeammateHome, layer as homeLayer } from "./TeammateHome.ts";
import { TeammateStore, layer as storeLayer } from "./TeammateStore.ts";
import {
  TeammateTurnHooks,
  isStarterSoul,
  layer as hooksLayer,
  queueSoulNotice,
} from "./TeammateTurnHooks.ts";

const storage = Layer.merge(storeLayer, homeLayer);
const layer = hooksLayer.pipe(
  Layer.provideMerge(storage),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "tabs-teammate-hooks-" })),
  Layer.provideMerge(NodeServices.layer),
);

const id = "tm-1" as TeammateId;
const now = "2026-11-02T10:00:00.000Z";
const teammate: Teammate = {
  id,
  name: "Notch",
  finish: "signature",
  modelSelection: null,
  projectId: null,
  paused: false,
  lookAround: { enabled: false, preset: "every4h", focus: "", maxSuggestions: 3 },
  notify: { needsYou: true, workDone: true, couldntFinish: true },
  homeThreadId: null,
  lastLookAroundAt: null,
  createdAt: now,
  updatedAt: now,
};

it.effect("prefaces teammate chats only, once per native thread, and relays soul edits", () =>
  Effect.gen(function* () {
    yield* runMigrations();
    const store = yield* TeammateStore;
    const home = yield* TeammateHome;
    const hooks = yield* TeammateTurnHooks;
    yield* store.putTeammate(teammate);
    yield* home.ensure({ id, name: "Notch" });
    const link = (threadId: string, kind: "home" | "worker") =>
      store.linkThread({
        threadId: threadId as ThreadId,
        teammateId: id,
        kind,
        itemId: null,
        createdAt: now,
      });
    yield* link("home-1", "home");
    yield* link("worker-1", "worker");

    // A thread nobody owns and a worker get nothing.
    assert.equal(
      yield* hooks.prefaceFor({ threadId: "plain" as ThreadId, firstNativeTurn: true }),
      "",
    );
    assert.equal(
      yield* hooks.prefaceFor({ threadId: "worker-1" as ThreadId, firstNativeTurn: true }),
      "",
    );

    const first = yield* hooks.prefaceFor({
      threadId: "home-1" as ThreadId,
      firstNativeTurn: true,
    });
    assert.include(first, "You are Notch, a teammate in Tabs.");
    // The starter soul means a brand-new teammate: it greets first.
    assert.include(first, "## First run");
    assert.equal(
      yield* hooks.prefaceFor({ threadId: "home-1" as ThreadId, firstNativeTurn: false }),
      "",
    );

    yield* home.writeSoul(id, "# Notch\nTerse reviewer.");
    yield* home.writeMemory(id, "- 2026-11-02: Owns billing\n");
    const later = yield* hooks.prefaceFor({
      threadId: "home-1" as ThreadId,
      firstNativeTurn: true,
    });
    assert.notInclude(later, "## First run");
    assert.include(later, "Terse reviewer.");
    assert.include(later, "Owns billing");

    // A soul edit reaches a running chat on its next turn, once.
    queueSoulNotice(id, "[Tabs: your owner edited SOUL.md.]");
    assert.equal(
      yield* hooks.prefaceFor({ threadId: "home-1" as ThreadId, firstNativeTurn: false }),
      "[Tabs: your owner edited SOUL.md.]",
    );
    assert.equal(
      yield* hooks.prefaceFor({ threadId: "home-1" as ThreadId, firstNativeTurn: false }),
      "",
    );
  }).pipe(Effect.provide(layer)),
);

it("recognises the starter soul", () => {
  assert.isTrue(isStarterSoul(null));
  assert.isTrue(
    isStarterSoul(
      "# Notch\n\nDescribe Notch here: what it is for, how it talks, and what it must never do.\n",
    ),
  );
  assert.isFalse(isStarterSoul("# Notch\nTerse."));
});

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import type {
  Teammate,
  TeammateId,
  TeammateItem,
  TeammateItemId,
  TeammateMemoryFact,
  TeammateMemoryFactId,
  TeammateSuggestion,
  TeammateSuggestionId,
  ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../persistence/Migrations.ts";
import * as TeammateStore from "./TeammateStore.ts";

const layer = it.layer(
  TeammateStore.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

const id = <T>(value: string) => value as unknown as T;
const now = "2026-11-02T10:00:00.000Z";
const teammate = (over: Partial<Teammate> = {}): Teammate => ({
  id: id<TeammateId>("tm-1"),
  name: "Notch",
  finish: "signature",
  modelSelection: null,
  projectId: null,
  paused: false,
  lookAround: { enabled: true, preset: "every4h", focus: "", maxSuggestions: 3 },
  notify: { needsYou: true, workDone: true, couldntFinish: true },
  homeThreadId: null,
  lastLookAroundAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

layer("TeammateStore", (it) => {
  it.effect("round-trips teammates, items, suggestions, facts and thread links", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const store = yield* TeammateStore.TeammateStore;

      yield* store.putTeammate(
        teammate({ modelSelection: { instanceId: "codex", model: "gpt-5" } as never }),
      );
      yield* store.putTeammate(teammate({ id: id<TeammateId>("tm-2"), name: "Notch 2" }));
      const renamed = teammate({ name: "Pixel", paused: true, homeThreadId: id<ThreadId>("th-1") });
      yield* store.putTeammate(renamed);
      const all = yield* store.listTeammates;
      assert.deepEqual(
        all.map((t) => t.name),
        ["Pixel", "Notch 2"],
      );
      const first = yield* store.getTeammate(renamed.id);
      assert.equal(first?.paused, true);
      assert.equal(first?.homeThreadId, "th-1");
      assert.deepEqual(first?.lookAround, renamed.lookAround);

      const item: TeammateItem = {
        id: id<TeammateItemId>("it-1"),
        teammateId: renamed.id,
        title: "Fix login",
        detail: "",
        status: "working",
        workerThreadIds: [id<ThreadId>("w-1")],
        question: null,
        link: null,
        createdAt: now,
        updatedAt: now,
      };
      yield* store.putItem(item);
      yield* store.putItem({ ...item, status: "needsYou", question: "Which env?" });
      const items = yield* store.listItems;
      assert.equal(items.length, 1);
      assert.equal(items[0]?.status, "needsYou");
      assert.deepEqual(items[0]?.workerThreadIds, [id<ThreadId>("w-1")]);

      const suggestion: TeammateSuggestion = {
        id: id<TeammateSuggestionId>("s-1"),
        teammateId: renamed.id,
        title: "Fix CI",
        why: "red",
        ask: "fix it",
        link: null,
        status: "open",
        createdAt: now,
      };
      assert.isTrue(yield* store.insertSuggestionIfNew(suggestion, "fix ci|"));
      yield* store.setSuggestionStatus(suggestion.id, "dismissed");
      // A dismissed suggestion is never suggested again under the same key.
      assert.isFalse(
        yield* store.insertSuggestionIfNew(
          { ...suggestion, id: id<TeammateSuggestionId>("s-2") },
          "fix ci|",
        ),
      );
      assert.equal((yield* store.listSuggestions).length, 1);
      assert.equal(yield* store.countOpenSuggestions(renamed.id), 0);

      const fact: TeammateMemoryFact = {
        id: id<TeammateMemoryFactId>("f-1"),
        teammateId: renamed.id,
        text: "Owns billing",
        topic: null,
        source: "teammate",
        createdAt: now,
      };
      yield* store.insertFact(fact);
      assert.equal((yield* store.listFacts(renamed.id)).length, 1);
      yield* store.deleteFact(fact.id);
      assert.equal((yield* store.listFacts(renamed.id)).length, 0);

      yield* store.linkThread({
        threadId: id<ThreadId>("th-1"),
        teammateId: renamed.id,
        kind: "home",
        itemId: null,
        createdAt: now,
      });
      assert.equal((yield* store.getThreadLink(id<ThreadId>("th-1")))?.kind, "home");

      // Deleting a teammate removes everything it owns and reports its threads.
      const removed = yield* store.deleteTeammate(renamed.id);
      assert.deepEqual(
        removed.map((link) => link.threadId),
        ["th-1"],
      );
      assert.equal((yield* store.listItems).length, 0);
      assert.equal((yield* store.listSuggestions).length, 0);
      assert.isNull(yield* store.getThreadLink(id<ThreadId>("th-1")));
      assert.deepEqual(
        (yield* store.listTeammates).map((t) => t.name),
        ["Notch 2"],
      );
    }),
  );
});

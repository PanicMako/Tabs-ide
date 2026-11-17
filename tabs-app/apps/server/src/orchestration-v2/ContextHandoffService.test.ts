import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ContextHandoffService from "./ContextHandoffService.ts";
import * as IdAllocator from "./IdAllocator.ts";

const layerTest = ContextHandoffService.layer.pipe(Layer.provide(IdAllocator.layer));

function importedItem(
  input:
    | {
        readonly role: "user";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      }
    | {
        readonly role: "assistant";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      },
): OrchestrationV2TurnItem {
  const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const base = {
    id: TurnItemId.make(`turn-item:${input.id}`),
    threadId: ThreadId.make("thread:legacy-context"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    messageId: MessageId.make(`message:${input.id}`),
    text: input.text,
  };
  return input.role === "user"
    ? {
        ...base,
        createdBy: "user",
        creationSource: "server",
        type: "user_message",
        inputIntent: "turn_start",
        attachments: [],
      }
    : {
        ...base,
        type: "assistant_message",
        streaming: false,
      };
}

it.layer(layerTest)("ContextHandoffService legacy import", (it) => {
  it.effect("prepares imported history for the first native v2 turn", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({ role: "user", id: "one", text: "What did we decide?", ordinal: 1 }),
          importedItem({
            role: "assistant",
            id: "two",
            text: "We decided to keep the migration lightweight.",
            ordinal: 2,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.equal(handoff.strategy, "manual_context");
      assert.deepStrictEqual(handoff.fromProviderThreadIds, []);
      assert.include(handoff.summaryText, "What did we decide?");
      assert.include(handoff.summaryText, "keep the migration lightweight");
      const providerMessage = ContextHandoffService.providerMessageWithContextHandoff({
        handoff,
        userText: "Continue from there.",
      });
      assert.include(providerMessage, handoff.summaryText);
      assert.include(providerMessage, "User message:\nContinue from there.");
    }),
  );

  it.effect("preserves role attribution when truncating imported history", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({
            role: "user",
            id: "long",
            text: `${"x".repeat(35_000)} retained final words`,
            ordinal: 1,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.isAtMost(handoff.summaryText.length, 32_000);
      assert.include(handoff.summaryText, "User:\n... retained final words");
      assert.notMatch(handoff.summaryText, /\n+x+ retained final words/);
    }),
  );

  it.effect("retains the newest oversized import even when it has no whitespace", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({
            role: "assistant",
            id: "older",
            text: "older message",
            ordinal: 1,
          }),
          importedItem({
            role: "user",
            id: "long-single-token",
            text: `${"🧪".repeat(20_000)}LATEST_SINGLE_TOKEN`,
            ordinal: 2,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.include(
        handoff.history?.omittedItemIds ?? [],
        TurnItemId.make("turn-item:long-single-token"),
      );
      assert.isAtMost(handoff.summaryText.length, 32_000);
      assert.include(handoff.summaryText, "User:\n... ");
      assert.include(handoff.summaryText, "LATEST_SINGLE_TOKEN");
      assert.notInclude(handoff.summaryText, "\ufffd");
    }),
  );
});

const parentThreadId = ThreadId.make("thread:side-chat-parent");

it("builds side chat context with the parent's activity, oldest first", () => {
  const text = ContextHandoffService.makeSideChatContext({
    parentThreadId,
    digest: [
      importedItem({ role: "user", id: "one", text: "Fix the login bug", ordinal: 1 }),
      importedItem({ role: "assistant", id: "two", text: "Patched the session check", ordinal: 2 }),
    ],
  });
  assert.include(text, "You are in a side chat beside the main thread");
  assert.include(text, "Main thread activity since this side chat's starting point:");
  assert.include(text, `t3_thread_read on thread ${parentThreadId}`);
  assert.isBelow(text.indexOf("Fix the login bug"), text.indexOf("Patched the session check"));
});

it("keeps only the framing note when the parent did nothing since the fork point", () => {
  const text = ContextHandoffService.makeSideChatContext({ parentThreadId, digest: [] });
  assert.include(text, "do not continue or redo the main thread's task");
  assert.notInclude(text, "Main thread activity");
});

it("truncates the oldest digest lines first once the cap is reached", () => {
  const lines = Array.from({ length: 400 }, (_, index) => `line ${index} ${"x".repeat(60)}`);
  const text = ContextHandoffService.makeSideChatContext({ parentThreadId, digest: lines });
  assert.isAtMost(text.length, 8_000);
  assert.include(text, "- Earlier items truncated.");
  assert.include(text, "line 399 ");
  assert.notInclude(text, "line 0 ");
});

it.layer(layerTest)("ContextHandoffService side chat context", (it) => {
  it.effect("prepares a ready manual handoff that delivery recognises", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareSideChatContext({
        threadId: ThreadId.make("thread:side-chat"),
        parentThreadId,
        targetRunId: RunId.make("run:side-chat:1"),
        transferId: null,
        toProviderThreadId: ProviderThreadId.make("provider-thread:side-chat"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        coveredRunOrdinals: { from: 1, to: 1 },
        parentItems: [],
        createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
      });
      assert.equal(handoff.status, "ready");
      assert.equal(handoff.strategy, "manual_context");
      assert.isUndefined(handoff.delivery);
      assert.isTrue(ContextHandoffService.isSideChatContextHandoff(handoff));
      assert.isFalse(
        ContextHandoffService.isSideChatContextHandoff({
          ...handoff,
          summaryText: "Manual context handoff.",
        }),
      );
    }),
  );
});

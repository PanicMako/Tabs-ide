import * as DateTime from "effect/DateTime";

import { describe, expect, it } from "vite-plus/test";

import { queuedRunsInDeliveryOrder, readyQueuedRunsInDeliveryOrder } from "./QueuedRunOrder.ts";

describe("queued run delivery order", () => {
  it("skips future deliveries without blocking ready entries and includes the exact deadline", () => {
    const now = DateTime.makeUnsafe("2026-10-13T10:00:00.000Z");
    const projection = {
      messages: [],
      runs: [
        {
          id: "future",
          status: "queued",
          ordinal: 1,
          scheduledFor: DateTime.addDuration(now, "1 second"),
        },
        { id: "ready", status: "queued", ordinal: 2, scheduledFor: now },
        { id: "unscheduled", status: "queued", ordinal: 3 },
      ],
    } as never;
    expect(readyQueuedRunsInDeliveryOrder(projection, now).map((run) => run.id)).toEqual([
      "ready",
      "unscheduled",
    ]);
    expect(
      readyQueuedRunsInDeliveryOrder(projection, DateTime.addDuration(now, "1 second")).map(
        (run) => run.id,
      ),
    ).toEqual(["future", "ready", "unscheduled"]);
  });

  it("keeps automatic completion delivery ahead of visible queued messages", () => {
    const projection = {
      messages: [
        { id: "message:visible-first" },
        {
          id: "message:automatic",
          delegatedCompletion: {
            generation: 1,
            parentRunId: "run:parent",
            taskIds: ["task:child"],
          },
        },
        { id: "message:visible-second" },
      ],
      runs: [
        {
          id: "run:visible-first",
          ordinal: 2,
          queuePosition: 1,
          status: "queued",
          userMessageId: "message:visible-first",
        },
        {
          id: "run:automatic",
          ordinal: 4,
          queuePosition: 3,
          status: "queued",
          userMessageId: "message:automatic",
        },
        {
          id: "run:visible-second",
          ordinal: 3,
          queuePosition: 2,
          status: "queued",
          userMessageId: "message:visible-second",
        },
      ],
    } as never;

    expect(queuedRunsInDeliveryOrder(projection).map((run) => run.id)).toEqual([
      "run:automatic",
      "run:visible-first",
      "run:visible-second",
    ]);
  });
});

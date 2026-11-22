import type { TeammateId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { deriveTeammateActivity, type ThreadActivityInput } from "./teammateActivity.ts";

const teammateId = "t1" as TeammateId;
const thread = (
  kind: ThreadActivityInput["kind"],
  status: ThreadActivityInput["status"],
  hasPendingRequest = false,
): ThreadActivityInput => ({ threadId: `${kind}-${status}`, kind, status, hasPendingRequest });
const derive = (over: Partial<Parameters<typeof deriveTeammateActivity>[0]> = {}) =>
  deriveTeammateActivity({
    teammateId,
    paused: false,
    threads: [],
    needsYouItems: 0,
    recentlyHappy: false,
    ...over,
  });

describe("deriveTeammateActivity", () => {
  it("is idle with nothing going on and sleeping when paused", () => {
    expect(derive().mood).toBe("idle");
    expect(derive({ paused: true }).mood).toBe("sleeping");
  });

  it("thinks while the home chat or a look-around runs", () => {
    expect(derive({ threads: [thread("home", "running")] })).toMatchObject({
      mood: "thinking",
      thinkingCount: 1,
    });
    expect(derive({ threads: [thread("look-around", "starting")] }).mood).toBe("thinking");
  });

  it("works while workers run and counts them", () => {
    const result = derive({
      threads: [
        thread("worker", "running"),
        thread("worker", "waiting"),
        thread("worker", "completed"),
      ],
    });
    expect(result).toMatchObject({ mood: "working", workingCount: 2, label: "Working on 2 tasks" });
  });

  it("needs you for needsYou items or a worker blocked on a request, above everything else", () => {
    expect(derive({ needsYouItems: 1, threads: [thread("home", "running")] }).mood).toBe(
      "needsYou",
    );
    expect(derive({ threads: [thread("worker", "waiting", true)] })).toMatchObject({
      mood: "needsYou",
      needsYouCount: 1,
    });
  });

  it("shows error when the home chat failed, happy right after finished work", () => {
    expect(derive({ threads: [thread("home", "failed")] }).mood).toBe("error");
    expect(derive({ recentlyHappy: true }).mood).toBe("happy");
    expect(derive({ recentlyHappy: true, threads: [thread("worker", "running")] }).mood).toBe(
      "working",
    );
  });
});

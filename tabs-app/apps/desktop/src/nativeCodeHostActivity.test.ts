import { expect, it, vi } from "vitest";
import {
  createNativeCodeHostActivity,
  type NativeAgentCoordinator,
} from "./nativeCodeHostActivity";

function fixture() {
  const coordinator = {
    initialize: vi.fn((count) => ({ editorSessionCount: count })),
    update: vi.fn(),
    claim: vi.fn(() => ({ id: "invitation" })),
    markShown: vi.fn(),
    release: vi.fn(),
    resetWindow: vi.fn(),
    onDidChange: vi.fn(() => ({ dispose() {} })),
    dispose: vi.fn(),
  } satisfies NativeAgentCoordinator;
  const revive = vi.fn((value) => ({ revived: value }));
  const activity = createNativeCodeHostActivity(coordinator, revive, (id) =>
    id === 1 ? "editor" : id === 2 ? "agents" : undefined,
  );
  return { coordinator, activity, revive };
}

it("forwards initialization and editor request, commit, delete and impression updates", () => {
  const { coordinator, activity } = fixture();
  expect(activity.initialize(7)).toEqual({ editorSessionCount: 7 });
  const updates = [
    { kind: "request", resource: { scheme: "test", path: "/1" }, isNewSession: true },
    {
      kind: "commit",
      original: { scheme: "test", path: "/1" },
      committed: { scheme: "test", path: "/2" },
    },
    { kind: "delete", resources: [{ scheme: "test", path: "/2" }] },
    { kind: "copilotHarnessIntroductionShown" },
  ];
  for (const update of updates) activity.update(1, update);
  expect(coordinator.update.mock.calls).toEqual(updates.map((update) => [1, update]));
  for (const count of [-1, NaN, undefined]) expect(() => activity.initialize(count)).toThrow();
});

it("revokes editor ownership for Agents-window requests without counting editor usage", () => {
  const { activity, coordinator } = fixture();
  const update = { kind: "request", resource: { scheme: "test", path: "/1" }, isNewSession: true };
  activity.update(2, update);
  expect(coordinator.update).toHaveBeenCalledWith(undefined, update);
  expect(() => activity.update(2, { kind: "copilotHarnessIntroductionShown" })).toThrow(
    "registered editor",
  );
  expect(() => activity.update(99, update)).toThrow("registered editor");
});

it("routes invitation ownership through the registered editor", () => {
  const { activity, coordinator, revive } = fixture();
  const resource = { scheme: "test", path: "/1" };
  expect(activity.claim(1, resource, true)).toEqual({ id: "invitation" });
  expect(revive).toHaveBeenCalledWith(resource);
  expect(coordinator.claim).toHaveBeenCalledWith(1, { revived: resource }, true);
  activity.markShown(1, "invitation");
  activity.release(1, "invitation");
  expect(coordinator.markShown).toHaveBeenCalledWith(1, "invitation");
  expect(coordinator.release).toHaveBeenCalledWith(1, "invitation");
  expect(() => activity.claim(2, resource, false)).toThrow("registered editor");
});

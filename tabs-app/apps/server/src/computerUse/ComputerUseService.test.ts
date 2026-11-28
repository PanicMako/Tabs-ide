import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ComputerRequest } from "./commands.ts";
import * as ComputerUse from "./ComputerUseService.ts";

const tree = (status: string) =>
  [
    "App: Notes (com.apple.Notes, pid 7)",
    'Window: "A"',
    "",
    '1 Window "Notes"',
    `\t2 StaticText "${status}"`,
    ...Array.from(
      { length: 10 },
      (_, i) => `\t${3 + i} StaticText "padding line ${i} that keeps the tree long"`,
    ),
    "",
    "12 elements.",
  ].join("\n");

const reply = (status: string, id: string) =>
  JSON.stringify({
    ok: true,
    action: { path: "accessibility", detail: "pressed Button" },
    snapshot: {
      id,
      app: { name: "Notes", bundleId: "com.apple.Notes", pid: 7 },
      window: { title: "A", key: "index:0", frame: { x: 0, y: 0, width: 1, height: 1 } },
      treeText: tree(status),
      elementCount: 12,
      focusedElementIndex: null,
      truncated: false,
    },
  });

const make = (platform: NodeJS.Platform, replies: string[], seen: ComputerRequest[] = []) =>
  ComputerUse.make(async (request) => {
    seen.push(request);
    return { stdout: replies.shift() ?? "", stderr: "" };
  }, platform);

const click: ComputerRequest = {
  op: "click",
  app: { kind: "name", query: "Notes" },
  target: { kind: "element", index: 2 },
  clickCount: 1,
  button: "left",
  foreground: false,
  maxNodes: 400,
};

it.effect("diffs action results against the previous snapshot of the same session", () =>
  Effect.gen(function* () {
    const computer = yield* make("darwin", [reply("Saved", "a"), reply("Saving", "b")]);
    const first = yield* computer.execute(click, "thread-1");
    expect(first.treeIsDiff).toBe(false);
    const second = yield* computer.execute(click, "thread-1");
    expect(second.treeIsDiff).toBe(true);
    expect(second.tree).toContain('~ \t2 StaticText "Saving"');
    expect(second.action).toBe("pressed Button");
  }),
);

it.effect("returns the full tree for an explicit snapshot", () =>
  Effect.gen(function* () {
    const computer = yield* make("darwin", [reply("Saved", "a"), reply("Saving", "b")]);
    const snapshot: ComputerRequest = {
      op: "snapshot",
      app: { kind: "name", query: "Notes" },
      maxNodes: 400,
    };
    yield* computer.execute(snapshot, "thread-1");
    const second = yield* computer.execute(snapshot, "thread-1");
    expect(second.treeIsDiff).toBe(false);
    expect(second.tree).toContain("padding line 9");
  }),
);

it.effect("surfaces runtime failures with advice and refuses off macOS", () =>
  Effect.gen(function* () {
    const failing = yield* make("darwin", [
      JSON.stringify({ ok: false, code: "permission_denied", message: "No access." }),
    ]);
    const error = yield* failing.execute(click, "t").pipe(Effect.flip);
    expect(error.code).toBe("permission_denied");
    expect(error.message).toContain("System Settings");

    const seen: ComputerRequest[] = [];
    const linux = yield* make("freebsd", [], seen);
    const refused = yield* linux.execute(click, "t").pipe(Effect.flip);
    expect(refused.code).toBe("unsupported_capability");
    expect(seen).toEqual([]);
    expect((yield* linux.permissions).platformSupported).toBe(false);
  }),
);

it.effect("marks Windows and Wayland native control as preview", () =>
  Effect.gen(function* () {
    const windows = yield* make("win32", [
      JSON.stringify({
        ok: true,
        permissions: { accessibility: true, screenRecording: "unknown" },
      }),
    ]);
    expect(yield* windows.permissions).toMatchObject({
      maturity: "preview",
      maturityNote: "Preview on Windows: not yet verified on a live desktop.",
    });
    const mac = yield* make("darwin", [
      JSON.stringify({
        ok: true,
        permissions: { accessibility: true, screenRecording: "granted" },
      }),
    ]);
    expect(yield* mac.permissions).toMatchObject({ maturity: "stable" });
  }),
);

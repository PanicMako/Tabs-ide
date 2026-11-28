import { expect, it } from "@effect/vitest";
import {
  ThreadId,
  type NativeComputerCapabilities,
  type NativeWindowChoice,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import type { ComputerRequest } from "./commands.ts";
import { ComputerUseError } from "./ComputerUseError.ts";
import { NativeWindows } from "./nativeWindows.ts";
import type { RuntimeAction, RuntimeSnapshot, RuntimeSuccess } from "./runtimeResponse.ts";

const first = ThreadId.make("thread-1");
const second = ThreadId.make("thread-2");
const frame = { x: 160, y: 100, width: 1000, height: 600 };
const windowA: NativeWindowChoice = {
  id: "pid-42:birth:1",
  title: "Duplicate",
  app: "Fixture",
  pid: 42,
  frame,
};
const windowB: NativeWindowChoice = {
  ...windowA,
  id: "pid-42:birth:2",
  frame: { ...frame, x: -1200 },
};
type Desktop = "windows" | "macos" | "x11" | "wayland";

function setup(session: Desktop) {
  return Effect.gen(function* () {
    const gate = yield* Semaphore.make(1);
    const capabilities: NativeComputerCapabilities = {
      session,
      windowSelection: true,
      accessibilityActions: true,
      windowCapture: session !== "wayland",
      foregroundInput: session !== "wayland",
      details: `Simulated ${session}`,
    };
    let actual = windowB;
    let scale = session === "macos" ? 2 : session === "windows" ? 1.5 : 1;
    let control = "send-button-original";
    let focus = true;
    let overlay = false;
    let replacement = false;
    let treeText = '1 Window\n\t2 Button "Send"';
    let snapshotWindow: NativeWindowChoice | undefined;
    let pause: ((signal: AbortSignal) => Promise<void>) | undefined;
    let pauseSnapshot: ((signal: AbortSignal) => Promise<void>) | undefined;
    let lostActionReply = false;
    let physicalDelivery: RuntimeAction["delivery"] = "foreground";
    const packets: ComputerRequest[] = [];
    const sends: ComputerRequest[] = [];
    const makeSnapshot = (window: NativeWindowChoice): RuntimeSnapshot => ({
      id: "runtime-snapshot",
      window: { ...window, key: window.id },
      app: { name: window.app, bundleId: null, pid: window.pid },
      treeText,
      elementCount: 2,
      elements: ["root", control],
      focusedElementIndex: 2,
      truncated: false,
      scale,
    });
    const permission = { accessibility: true, screenRecording: "unknown" as const, capabilities };
    const windows = new NativeWindows(
      (request, signal) =>
        Effect.gen(function* () {
          packets.push(request);
          if (request.op === "listWindows")
            return {
              ok: true,
              permissions: permission,
              windows: [windowA, windowB],
            } satisfies RuntimeSuccess;
          if (!("app" in request) || request.app.kind !== "window")
            return yield* new ComputerUseError({
              code: "wrong_target",
              message: "Unexpected unscoped request.",
            });
          const target = request.app.id === windowA.id ? windowA : actual;
          if (target.id !== request.app.id || replacement)
            return yield* new ComputerUseError({
              code: "window_stale",
              message: "The window identity changed.",
            });
          if (request.op === "snapshot") {
            if (pauseSnapshot && signal) yield* Effect.promise(() => pauseSnapshot!(signal));
            return {
              ok: true,
              snapshot: makeSnapshot(snapshotWindow ?? target),
            } satisfies RuntimeSuccess;
          }
          if (request.op === "focusApp") return { ok: true } satisfies RuntimeSuccess;
          const stale =
            JSON.stringify(request.native?.frame) !== JSON.stringify(target.frame) ||
            request.native?.scale !== scale ||
            (request.native?.elements?.["2"] !== undefined &&
              request.native.elements["2"] !== control);
          if (stale)
            return yield* new ComputerUseError({
              code: "stale_observation",
              message: "Layout, display scale or element changed.",
            });
          if (request.op === "screenshot")
            return {
              ok: true,
              action: { path: "synthetic", detail: "fixture capture", delivery: "background" },
            } satisfies RuntimeSuccess;
          if (pause && signal) yield* Effect.promise(() => pause!(signal));
          if (request.native?.foreground && (!focus || overlay))
            return yield* new ComputerUseError({
              code: focus ? "target_occluded" : "focus_changed",
              message: "Physical input refused.",
            });
          if (signal?.aborted)
            return yield* new ComputerUseError({
              code: "user_turn",
              message: "Stopped before input.",
            });
          sends.push(request);
          if (lostActionReply) {
            treeText = '1 Window\n\t2 Button "Sent"';
            return yield* new ComputerUseError({
              code: "accessibility_error",
              message: "The desktop runtime timed out.",
            });
          }
          const delivery = request.native?.foreground ? physicalDelivery : "background";
          return {
            ok: true,
            snapshot: makeSnapshot(target),
            action: {
              path: delivery === "foreground" ? "synthetic" : "accessibility",
              detail: "fixture action",
              ...(delivery ? { delivery } : {}),
            },
          } satisfies RuntimeSuccess;
        }),
      gate,
    );
    const attach = (
      threadId = first,
      windowId = windowB.id,
      foreground = capabilities.foregroundInput,
    ) => windows.control({ op: "attach", threadId, windowId, foreground });
    const attachB = attach().pipe(
      Effect.map(({ grant }) => ({ kind: "attachment", selector: grant!.selector }) as const),
    );
    return {
      windows,
      packets,
      sends,
      attach,
      attachB,
      move: () => {
        actual = { ...actual, frame: { ...frame, x: 1850 } };
        scale = 1.25;
      },
      replace: () => {
        replacement = true;
      },
      rebuild: () => {
        control += "-rebuilt";
      },
      changeText: (text: string) => {
        treeText = text;
      },
      setSnapshotWindow: (window: NativeWindowChoice) => {
        snapshotWindow = window;
      },
      setFocus: (value: boolean) => {
        focus = value;
      },
      setOverlay: (value: boolean) => {
        overlay = value;
      },
      setPhysicalDelivery: (delivery: RuntimeAction["delivery"]) => {
        physicalDelivery = delivery;
      },
      hold: (wait: (signal: AbortSignal) => Promise<void>) => {
        pause = wait;
      },
      holdSnapshot: (wait: (signal: AbortSignal) => Promise<void>) => {
        pauseSnapshot = wait;
      },
      loseActionReply: () => {
        lostActionReply = true;
      },
    };
  });
}

const click = {
  op: "click",
  target: { kind: "element", index: 2 },
  clickCount: 1,
  button: "left",
  foreground: false,
  maxNodes: 400,
} as const;
const snapshot = { op: "snapshot", maxNodes: 400 } as const;

it.effect("reports only the current exact attachment's runtime activity", () =>
  Effect.gen(function* () {
    const f = yield* setup("windows");
    const attached = yield* f.attach();
    expect(attached.grant?.foreground).toBe(true);
    expect(attached).not.toHaveProperty("activity");
    const app = { kind: "attachment", selector: attached.grant!.selector } as const;
    const status = f.windows.control({ op: "status", threadId: first });
    const observe = f.windows.run({ ...snapshot, app }, first);
    const physical = (id: string | undefined) =>
      f.windows.run({ ...click, foreground: true, app }, first, id);

    const initial = yield* observe;
    expect(yield* status).toEqual({ grant: attached.grant, activity: "background" });
    f.setFocus(false);
    expect((yield* physical(initial.snapshot?.id).pipe(Effect.flip)).code).toBe("focus_changed");
    expect(yield* status).toEqual({ grant: attached.grant, activity: "needs_foreground" });

    const fresh = yield* observe;
    yield* f.windows.run({ op: "screenshot", app, path: "fixture.png" }, first, fresh.snapshot?.id);
    const packetCount = f.packets.length;
    expect((yield* f.windows.run({ ...snapshot, app }, second).pipe(Effect.flip)).code).toBe(
      "window_grant_required",
    );
    expect(
      (yield* f.windows
        .run({ ...snapshot, app: { ...app, selector: "window:stale" } }, first)
        .pipe(Effect.flip)).code,
    ).toBe("window_grant_required");
    expect(yield* f.windows.control({ op: "status", threadId: second })).toEqual({ grant: null });
    expect((yield* status).activity).toBe("needs_foreground");
    expect(f.packets).toHaveLength(packetCount);

    f.setFocus(true);
    f.setPhysicalDelivery("background");
    const background = yield* physical(fresh.snapshot?.id);
    expect((yield* status).activity).toBe("background");
    f.setPhysicalDelivery("foreground");
    const foreground = yield* physical(background.snapshot?.id);
    expect((yield* status).activity).toBe("foreground");
    f.setPhysicalDelivery(undefined);
    const unknown = yield* physical(foreground.snapshot?.id);
    expect(yield* status).not.toHaveProperty("activity");

    f.setFocus(false);
    expect((yield* physical(unknown.snapshot?.id).pipe(Effect.flip)).code).toBe("focus_changed");
    const next = yield* observe;
    yield* f.windows.run({ ...click, app }, first, next.snapshot?.id);
    expect((yield* status).activity).toBe("background");
    const replacement = yield* f.attach(first, windowA.id);
    expect(replacement.grant?.selector).not.toBe(app.selector);
    expect(replacement).not.toHaveProperty("activity");
  }),
);

it("ignores a late focus failure after takeover and return of the same attachment", async () => {
  const f = await Effect.runPromise(setup("windows"));
  const app = await Effect.runPromise(f.attachB);
  const initial = await Effect.runPromise(f.windows.run({ ...snapshot, app }, first));
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  f.hold((signal) => {
    started.resolve(signal);
    return release.promise;
  });
  const pending = Effect.runPromise(
    f.windows
      .run({ ...click, foreground: true, app }, first, initial.snapshot?.id)
      .pipe(Effect.flip),
  );
  const signal = await started.promise;
  const status = f.windows.control({ op: "status", threadId: first });
  try {
    expect((await Effect.runPromise(status)).activity).toBe("checking_foreground");
    const aborted = Promise.withResolvers<void>();
    signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    const take = Effect.runPromise(f.windows.control({ op: "take", threadId: first }));
    await aborted.promise;
    expect(await Effect.runPromise(status)).not.toHaveProperty("activity");
    const resume = await Effect.runPromise(
      f.windows.control({ op: "resume", threadId: first, selector: app.selector }),
    );
    expect(resume.grant).toMatchObject({ selector: app.selector, mode: "agent" });
    f.setFocus(false);
    release.resolve();
    expect((await pending).code).toBe("user_turn");
    await take;
    expect(await Effect.runPromise(status)).toEqual({ grant: resume.grant });
  } finally {
    release.resolve();
    await Promise.allSettled([pending]);
  }
});

for (const desktop of ["windows", "macos", "x11", "wayland"] as const) {
  it.effect(
    `pins ${desktop} to the selected duplicate-title window and invalidates moved layouts and rebuilt controls`,
    () =>
      Effect.gen(function* () {
        const f = yield* setup(desktop);
        const app = yield* f.attachB;
        const initial = yield* f.windows.run({ ...snapshot, app }, first);
        expect(initial.snapshot?.window.key).toBe(windowB.id);
        expect((yield* f.windows.run({ ...snapshot, app }, second).pipe(Effect.flip)).code).toBe(
          "window_grant_required",
        );
        expect((yield* f.attach(second, windowB.id, false).pipe(Effect.flip)).code).toBe(
          "window_busy",
        );
        f.move();
        expect(
          (yield* f.windows.run({ ...click, app }, first, initial.snapshot?.id).pipe(Effect.flip))
            .code,
        ).toBe("stale_observation");
        const moved = yield* f.windows.run({ ...snapshot, app }, first);
        f.rebuild();
        expect(
          (yield* f.windows.run({ ...click, app }, first, moved.snapshot?.id).pipe(Effect.flip))
            .code,
        ).toBe("stale_observation");
        const rebuilt = yield* f.windows.run({ ...snapshot, app }, first);
        expect(rebuilt.snapshot?.id).not.toBe(moved.snapshot?.id);
        expect(
          (yield* f.windows.run({ ...click, app }, first, moved.snapshot?.id).pipe(Effect.flip))
            .code,
        ).toBe("stale_observation");
        yield* f.windows.run({ ...click, app }, first, rebuilt.snapshot?.id);
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0]).toMatchObject({
          app: { kind: "window", id: windowB.id },
          native: { scale: 1.25 },
        });
        f.replace();
        expect((yield* f.windows.run({ ...snapshot, app }, first).pipe(Effect.flip)).code).toBe(
          "window_stale",
        );
      }),
  );
}

for (const desktop of ["windows", "macos", "x11"] as const) {
  it.effect(
    `protects the ${desktop} pointer when the user switches focus or an overlay appears`,
    () =>
      Effect.gen(function* () {
        const f = yield* setup(desktop);
        const app = yield* f.attachB;
        expect((yield* f.attach(second, windowA.id).pipe(Effect.flip)).code).toBe("pointer_busy");
        const initial = yield* f.windows.run({ ...snapshot, app }, first);
        const point = {
          ...click,
          app,
          foreground: true,
          target: { kind: "point", x: 12, y: 9 },
        } as const;
        f.setOverlay(true);
        expect(
          (yield* f.windows.run(point, first, initial.snapshot?.id).pipe(Effect.flip)).code,
        ).toBe("target_occluded");
        expect(yield* f.windows.control({ op: "status", threadId: first })).not.toHaveProperty(
          "activity",
        );
        const afterOverlay = f.packets.length;
        expect(
          (yield* f.windows.run(point, first, initial.snapshot?.id).pipe(Effect.flip)).code,
        ).toBe("stale_observation");
        expect(f.packets).toHaveLength(afterOverlay);
        f.setOverlay(false);
        f.setFocus(false);
        const fresh = yield* f.windows.run({ ...snapshot, app }, first);
        expect(
          (yield* f.windows.run(point, first, fresh.snapshot?.id).pipe(Effect.flip)).code,
        ).toBe("focus_changed");
        expect(f.sends).toHaveLength(0);
      }),
  );
}

it.effect("requires a fresh snapshot when native input lands but its reply is lost", () =>
  Effect.gen(function* () {
    const f = yield* setup("macos");
    const app = yield* f.attachB;
    const initial = yield* f.windows.run({ ...snapshot, app }, first);
    const action = f.windows.run({ ...click, app }, first, initial.snapshot?.id).pipe(Effect.flip);
    f.loseActionReply();
    expect((yield* action).code).toBe("accessibility_error");
    expect(yield* f.windows.control({ op: "status", threadId: first })).not.toHaveProperty(
      "activity",
    );
    expect((yield* action).code).toBe("stale_observation");
    expect(f.sends).toHaveLength(1);
    const fresh = yield* f.windows.run({ ...snapshot, app }, first);
    expect(fresh.snapshot?.id).not.toBe(initial.snapshot?.id);
    expect(fresh.snapshot?.treeText).toContain('Button "Sent"');
    expect(f.sends).toHaveLength(1);
  }),
);

it.effect(
  "gives Wayland semantic access with DISPLAY present while refusing a foreground grant",
  () =>
    Effect.gen(function* () {
      const f = yield* setup("wayland");
      expect((yield* f.attach(first, windowB.id, true).pipe(Effect.flip)).code).toBe(
        "background_unavailable",
      );
      const app = yield* f.attachB;
      const initial = yield* f.windows.run({ ...snapshot, app }, first);
      expect(
        (yield* f.windows
          .run({ ...click, app, foreground: true }, first, initial.snapshot?.id)
          .pipe(Effect.flip)).code,
      ).toBe("foreground_denied");
      yield* f.windows.run({ ...click, app }, first, initial.snapshot?.id);
      expect(f.sends).toHaveLength(1);
    }),
);

it("cancels an in-flight packet and discards queued input across takeover and resume", async () => {
  const f = await Effect.runPromise(setup("windows"));
  const app = await Effect.runPromise(f.attachB);
  for (const op of ["take", "revoke"] as const) {
    const stale = await Effect.runPromise(
      Effect.flip(
        f.windows.control({
          op,
          threadId: first,
          selector: "window:replaced",
        }),
      ),
    );
    expect(stale.code).toBe("window_stale");
  }
  expect(f.windows.get(first)).toMatchObject({ mode: "agent", selector: app.selector });
  const initial = await Effect.runPromise(f.windows.run({ ...snapshot, app }, first));
  const action = f.windows.run({ ...click, app }, first, initial.snapshot?.id).pipe(Effect.flip);
  const started = Promise.withResolvers<void>();
  f.hold(
    (signal) =>
      new Promise<void>((resolve) => {
        started.resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  );
  const current = Effect.runPromise(action);
  await started.promise;
  const queued = Effect.runPromise(action);
  await Effect.runPromise(f.windows.control({ op: "take", threadId: first }));
  expect((await current).code).toBe("user_turn");
  expect((await queued).code).toBe("user_turn");
  expect(f.sends).toHaveLength(0);
  f.rebuild();
  const resume = {
    op: "resume",
    threadId: first,
    meaning: "  Export the selected rows  ",
  } as const;
  const staleResume = await Effect.runPromise(
    Effect.flip(f.windows.control({ ...resume, selector: "window:replaced" })),
  );
  expect(staleResume.code).toBe("window_stale");
  await Effect.runPromise(f.windows.control({ ...resume, selector: app.selector }));
  expect((await Effect.runPromise(action)).code).toBe("stale_observation");
  const after = await Effect.runPromise(
    f.windows.run({ ...snapshot, app }, first, undefined, true),
  );
  expect(after.handoff).toContain("layout changed");
  expect(after.userDemonstration).toBe("Export the selected rows");
  expect(after.snapshot?.id).not.toBe(initial.snapshot?.id);
  const next = await Effect.runPromise(f.windows.run({ ...snapshot, app }, first, undefined, true));
  expect(next.userDemonstration).toBe("Export the selected rows");
  const revoked = await Effect.runPromise(f.windows.control({ op: "revoke", threadId: first }));
  expect(revoked).toEqual({ grant: null });
  expect((await Effect.runPromise(action)).code).toBe("window_grant_required");
});

it.effect("verifies changed window text privately and still requires a fresh agent snapshot", () =>
  Effect.gen(function* () {
    const f = yield* setup("windows");
    const app = yield* f.attachB;
    const initial = yield* f.windows.run({ ...snapshot, maxNodes: 72, app }, first);
    f.changeText('1 Window\n\t2 Button "Send selected rows"');
    const { grant } = yield* f.windows.control({ op: "take", threadId: first });
    expect(f.packets.at(-1)).toEqual({
      op: "snapshot",
      app: { kind: "window", id: windowB.id },
      maxNodes: 72,
      native: { foreground: false },
    });
    expect(grant?.takeoverId).toBeTruthy();
    const resume = {
      op: "resume",
      threadId: first,
      selector: app.selector,
      takeoverId: grant!.takeoverId!,
    } as const;
    f.changeText('1 Window\n\t2 Button "Export selected rows"');
    const result = yield* f.windows.control(resume);
    expect(result).toEqual({
      grant: { ...grant, mode: "agent" },
      continuationId: expect.any(String),
    });
    expect(f.packets.at(-1)).toEqual({
      op: "snapshot",
      app: { kind: "window", id: windowB.id },
      maxNodes: 72,
      native: { foreground: false },
    });
    expect(f.sends).toHaveLength(0);
    expect(yield* f.windows.control({ op: "status", threadId: first })).toEqual({
      grant: result.grant,
    });
    const packetCount = f.packets.length;
    expect(yield* f.windows.control(resume)).toEqual(result);
    expect(f.packets).toHaveLength(packetCount);
    expect(
      (yield* Effect.flip(f.windows.run({ ...click, app }, first, initial.snapshot?.id))).code,
    ).toBe("stale_observation");
    const after = yield* f.windows.run({ ...snapshot, app }, first, undefined, true);
    expect(after.handoff).toContain("observable window state changed");
    expect(after.handoff).toContain("New or changed current controls include 2.");
    expect(after.handoff).not.toContain("Send selected rows");
    const continuation = yield* f.windows.run({ ...snapshot, app }, first, undefined, true);
    expect(continuation.handoff).toBe(after.handoff);
    f.changeText('1 Window\n\t2 Button "Export finished"');
    const later = yield* f.windows.run({ ...snapshot, app }, first, undefined, true);
    expect(later.handoff).toContain("The window changed again after control returned.");
    expect(later.handoff).not.toContain("New or changed current controls");
    yield* f.windows.run({ ...click, app }, first, later.snapshot?.id);
    expect(f.sends).toHaveLength(1);
  }),
);

it.effect("issues a receipt only for an observed change or explicitly supplied meaning", () =>
  Effect.gen(function* () {
    const f = yield* setup("x11");
    const app = yield* f.attachB;
    const take = f.windows.control({ op: "take", threadId: first });
    const resume = (takeoverId: string, meaning?: string) =>
      f.windows.control({
        op: "resume",
        threadId: first,
        selector: app.selector,
        takeoverId,
        ...(meaning ? { meaning } : {}),
      });

    const noBaseline = yield* take;
    expect((yield* resume(noBaseline.grant!.takeoverId!)).continuationId).toBeUndefined();
    yield* f.windows.run({ ...snapshot, app }, first);
    f.changeText('1 Window\n\t2 Button "Changed before takeover"');
    const unchanged = yield* take;
    expect((yield* resume(unchanged.grant!.takeoverId!, "   ")).continuationId).toBeUndefined();
    yield* f.windows.run({ ...snapshot, app }, first);
    const changed = yield* take;
    f.rebuild();
    expect((yield* resume(changed.grant!.takeoverId!)).continuationId).toBeTruthy();

    // A second takeover before the agent observes the result begins a new handoff.
    const explained = yield* take;
    const meaning = "Export the selected rows";
    const result = yield* resume(explained.grant!.takeoverId!, `  ${meaning}  `);
    expect(result).toEqual({
      grant: { ...explained.grant, mode: "agent" },
      continuationId: expect.any(String),
    });
    const after = yield* f.windows.run({ ...snapshot, app }, first, undefined, true);
    expect(after.userDemonstration).toBe(meaning);
  }),
);

it.effect("keeps takeover available when it cannot read the exact starting window", () =>
  Effect.gen(function* () {
    const f = yield* setup("windows");
    const app = yield* f.attachB;
    const initial = yield* f.windows.run({ ...snapshot, app }, first);
    f.setSnapshotWindow(windowA);
    const { grant } = yield* f.windows.control({ op: "take", threadId: first });
    expect(grant?.mode).toBe("user");
    expect(
      (yield* Effect.flip(f.windows.run({ ...click, app }, first, initial.snapshot?.id))).code,
    ).toBe("user_turn");

    f.setSnapshotWindow(windowB);
    const returned = yield* f.windows.control({
      op: "resume",
      threadId: first,
      selector: app.selector,
      takeoverId: grant!.takeoverId!,
      meaning: "The selected item was corrected",
    });
    expect(returned.continuationId).toBeTruthy();
    const current = yield* f.windows.run({ ...snapshot, app }, first, undefined, true);
    expect(current.handoff).toBe("No starting observation was available for the user handoff.");
    expect(current.userDemonstration).toBe("The selected item was corrected");
    expect(f.sends).toHaveLength(0);
  }),
);

it.effect("rejects a stale generation, missing selector, or mismatched window observation", () =>
  Effect.gen(function* () {
    const f = yield* setup("macos");
    const app = yield* f.attachB;
    const take = f.windows.control({ op: "take", threadId: first });
    const firstTake = yield* take;
    const latest = yield* take;
    const takeoverId = latest.grant!.takeoverId!;
    expect(takeoverId).not.toBe(firstTake.grant?.takeoverId);
    const input = { op: "resume", threadId: first, meaning: "Export" } as const;
    const packetCount = f.packets.length;
    for (const command of [
      { ...input, selector: app.selector, takeoverId: firstTake.grant!.takeoverId! },
      { ...input, takeoverId },
      { ...input, selector: "window:replaced", takeoverId },
    ]) {
      expect((yield* Effect.flip(f.windows.control(command))).code).toBe("window_stale");
    }
    expect(f.packets).toHaveLength(packetCount);

    const resume = f.windows.control({ ...input, selector: app.selector, takeoverId });
    f.setSnapshotWindow(windowA);
    expect((yield* Effect.flip(resume)).code).toBe("window_stale");
    expect(f.windows.get(first)).toEqual(latest.grant);
    f.replace();
    expect(yield* Effect.flip(resume)).toMatchObject({
      code: "window_stale",
      message: "Could not verify the attached window before returning control.",
    });
    expect(f.windows.get(first)).toEqual(latest.grant);
  }),
);

for (const op of ["take", "revoke"] as const) {
  it(`blocks a verified return when ${op} supersedes the read in flight`, async () => {
    const f = await Effect.runPromise(setup("windows"));
    const { selector } = await Effect.runPromise(f.attachB);
    const { grant } = await Effect.runPromise(f.windows.control({ op: "take", threadId: first }));
    const started = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    f.holdSnapshot((signal) => {
      started.resolve(signal);
      return release.promise;
    });
    const returning = Effect.runPromise(
      Effect.flip(
        f.windows.control({
          op: "resume",
          threadId: first,
          selector,
          takeoverId: grant!.takeoverId!,
          meaning: "Export",
        }),
      ),
    );
    const signal = await started.promise;
    const aborted = Promise.withResolvers<void>();
    signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    const superseding = Effect.runPromise(f.windows.control({ op, threadId: first, selector }));
    await aborted.promise;
    release.resolve();
    expect((await returning).code).toBe("window_stale");
    const result = await superseding;
    if (op === "take") {
      expect(result.grant?.mode).toBe("user");
      expect(result.grant?.takeoverId).not.toBe(grant?.takeoverId);
    } else {
      expect(result.grant).toBeNull();
    }
    expect(result.continuationId).toBeUndefined();
  });
}

it.effect("reveals only the current native attachment on a human request", () =>
  Effect.gen(function* () {
    const { windows, attachB, packets, replace } = yield* setup("windows");
    const { selector } = yield* attachB;
    const reveal = windows.control({ op: "reveal", selector, threadId: first });
    yield* windows.control({ op: "take", threadId: first });
    expect((yield* reveal).grant?.mode).toBe("user");
    expect(packets.at(-1)).toEqual({ op: "focusApp", app: { kind: "window", id: windowB.id } });
    expect(
      (yield* Effect.flip(windows.control({ op: "reveal", selector, threadId: second }))).code,
    ).toBe("window_stale");
    replace();
    expect((yield* Effect.flip(reveal)).code).toBe("window_stale");
    yield* windows.control({ op: "revoke", threadId: first });
    const count = packets.length;
    expect((yield* Effect.flip(reveal)).code).toBe("window_stale");
    expect(packets.length).toBe(count);
  }),
);

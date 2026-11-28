import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceComparisonError, type DeviceComparisonGesture } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vitest";

import type { DeviceHostReady } from "./DeviceHost.ts";
import { runIosDeviceInput } from "./DeviceIosInput.ts";

const udid = "2C32776F-6A4B-4493-82C8-1B5FA717FD99";
const confirmed = { code: 0, stdout: "Tabs iOS input delivered\n", stderr: "" };
const makeHost = (
  run: DeviceHostReady["run"],
  cli = "/remote/hub/serve-sim.js",
): DeviceHostReady => ({
  nodePath: "/remote/bin/node",
  hub: { origin: "http://127.0.0.1:1" },
  helpers: { serveSimCli: cli, serveSimAxSettings: null },
  run,
});

it("binds iOS keyboard delivery to the selected simulator and keeps text out of arguments", async () => {
  const run = vi.fn<DeviceHostReady["run"]>(() => Effect.succeed(confirmed));
  await Effect.runPromise(
    runIosDeviceInput(
      makeHost(run),
      udid,
      {
        type: "text",
        text: "A?09",
      },
      Effect.void,
    ),
  );
  const [executable, args, options] = run.mock.calls[0]!;
  expect(executable).toBe("/remote/bin/node");
  expect(args.slice(-3)).toEqual(["--", "/remote/hub/serve-sim.js", udid]);
  expect(args.join(" ")).not.toContain("A?09");
  expect(JSON.parse(options?.stdin ?? "")).toEqual({
    type: "keys",
    keys: [{ usage: 4, shift: true }, { usage: 56, shift: true }, { usage: 39 }, { usage: 38 }],
  });
});

it("rejects a stale grant, unsupported character or unacknowledged process result", async () => {
  const run = vi.fn<DeviceHostReady["run"]>(() => Effect.succeed({ ...confirmed, stdout: "" }));
  const ready = makeHost(run);
  await expect(
    Effect.runPromise(
      runIosDeviceInput(
        ready,
        udid,
        { type: "home" },
        Effect.fail(new DeviceComparisonError({ reason: "You returned control." })),
      ),
    ),
  ).rejects.toThrow("returned control");
  await expect(
    Effect.runPromise(runIosDeviceInput(ready, udid, { type: "text", text: "é" }, Effect.void)),
  ).rejects.toThrow("on-screen keyboard");
  expect(run).not.toHaveBeenCalled();
  await expect(
    Effect.runPromise(runIosDeviceInput(ready, udid, { type: "home" }, Effect.void)),
  ).rejects.toThrow("did not confirm");
});

it("delivers a swipe in order and refuses input when the displayed or active geometry differs", async () => {
  const folder = await mkdtemp(join(tmpdir(), "tabs-ios-input-test-"));
  try {
    const native = join(folder, "native");
    await mkdir(native);
    await writeFile(
      join(native, "serve-sim-native.node"),
      `
      exports.SimCapture = class {
        constructor(udid) { this.udid = udid; this.observations = 0; }
        async start() {}
        async screenSize() {
          this.observations++;
          if (process.env.TABS_TEST_ROTATED === "1" && this.observations > 1)
            return {width:2556,height:1179,orientation:"landscape",screenId:1};
          return {width:1179,height:2556,orientation:"portrait",screenId:1};
        }
        async stop() {}
      };
      exports.SimHID = class {
        async setScreen(screenId) {
          if (screenId !== 1) throw new Error("Unexpected screen");
        }
        async touch(phase,x,y,width,height) {
          if (width !== 1179 || height !== 2556) throw new Error("Unexpected dimensions");
          console.log(JSON.stringify({phase,x,y}));
        }
      };
    `,
    );
    let rotated = false;
    const outputs: string[] = [];
    const ready = makeHost(
      (_command, args, options) =>
        Effect.sync(() => {
          const enableFixture =
            'require("node:module")._extensions[".node"] = require("node:module")._extensions[".js"];';
          const child = spawnSync(
            process.execPath,
            [args[0]!, enableFixture + args[1], ...args.slice(2)],
            {
              encoding: "utf8",
              input: options?.stdin,
              env: { ...process.env, TABS_TEST_ROTATED: rotated ? "1" : "0" },
              timeout: 5_000,
            },
          );
          outputs.push(child.stdout);
          return { code: child.status ?? 127, stdout: child.stdout, stderr: child.stderr };
        }),
      join(folder, "serve-sim.js"),
    );
    const input: DeviceComparisonGesture = {
      type: "swipe",
      x1: 0.25,
      y1: 0.75,
      x2: 0.75,
      y2: 0.25,
      durationMs: 60,
      viewport: { width: 1179, height: 2556 },
    };
    await Effect.runPromise(runIosDeviceInput(ready, udid, input, Effect.void));
    expect(
      outputs[0]!
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { phase: "begin", x: 0.25, y: 0.75 },
      { phase: "move", x: 0.5, y: 0.5 },
      { phase: "move", x: 0.75, y: 0.25 },
      { phase: "end", x: 0.75, y: 0.25 },
    ]);
    await expect(
      Effect.runPromise(
        runIosDeviceInput(
          ready,
          udid,
          { ...input, viewport: { width: 2556, height: 1179 } },
          Effect.void,
        ),
      ),
    ).rejects.toThrow("did not confirm");
    rotated = true;
    await expect(
      Effect.runPromise(runIosDeviceInput(ready, udid, input, Effect.void)),
    ).rejects.toThrow("did not confirm");
    expect(outputs.slice(1)).toEqual(["", ""]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

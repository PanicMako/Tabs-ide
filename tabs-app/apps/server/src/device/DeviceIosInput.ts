import type { DeviceComparisonGesture } from "@tabs/contracts";
import { DeviceComparisonError } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import type { DeviceHostReady } from "./DeviceHost.ts";

type Key = { readonly usage: number; readonly shift?: true };
type PointerInput = Extract<DeviceComparisonGesture, { type: "tap" | "swipe" }>;
type IosInput = PointerInput | { type: "keys"; keys: Key[] } | { type: "button"; button: "home" };

// USB HID keyboard usages for the same editing keys the Device panel supports on Android.
const iosKeyUsages = {
  19: 0x52,
  20: 0x51,
  21: 0x50,
  22: 0x4f,
  61: 0x2b,
  66: 0x28,
  67: 0x2a,
  111: 0x29,
  112: 0x4c,
} as const;
const unshifted = "1234567890-=[]\\;'\x60,./";
const shifted = '!@#$%^&*()_+{}|:"~<>?';
const punctuationUsage = [
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56,
];

function iosTextKey(character: string): Key | undefined {
  if (character >= "a" && character <= "z") return { usage: character.charCodeAt(0) - 93 };
  if (character >= "A" && character <= "Z")
    return { usage: character.charCodeAt(0) - 61, shift: true };
  if (character === " ") return { usage: 0x2c };
  if (character === "\t") return { usage: 0x2b };
  if (character === "\n" || character === "\r") return { usage: 0x28 };
  const normal = unshifted.indexOf(character);
  if (normal >= 0) return { usage: punctuationUsage[normal]! };
  const upper = shifted.indexOf(character);
  return upper < 0 ? undefined : { usage: punctuationUsage[upper]!, shift: true };
}

function toIosInput(gesture: DeviceComparisonGesture): IosInput | undefined {
  switch (gesture.type) {
    case "tap":
    case "swipe":
      return gesture.viewport ? gesture : undefined;
    case "key":
      return { type: "keys", keys: [{ usage: iosKeyUsages[gesture.keycode] }] };
    case "text": {
      const keys: Key[] = [];
      for (const character of gesture.text) {
        const key = iosTextKey(character);
        if (!key) return;
        keys.push(key);
      }
      return keys.length ? { type: "keys", keys } : undefined;
    }
    case "home":
      return { type: "button", button: "home" };
    default:
      return undefined;
  }
}

// Run beside the existing serve-sim helper, including on SSH hosts. Its socket
// only acknowledges connection. The native addon awaits delivery of each HID
// event, and reading the display geometry here avoids the stream cache.
const driver = String.raw`
const { dirname, join } = require("node:path");
const { readFileSync } = require("node:fs");
const { SimCapture, SimHID } = require(join(dirname(process.argv[1]), "native", "serve-sim-native.node"));
const udid = process.argv[2];
const input = JSON.parse(readFileSync(0, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hid = new SimHID(udid);
const delivered = async (task) => {
  if (typeof task?.then !== "function" || (await task) === false)
    throw new Error("The helper did not confirm delivery");
};
const key = (phase, usage) => delivered(hid.key(phase, usage));
async function typeKeys() {
  for (const stroke of input.keys) {
    if (stroke.shift) await key("down", 0xe1);
    try {
      await key("down", stroke.usage);
      await key("up", stroke.usage);
    } finally {
      if (stroke.shift) await key("up", 0xe1);
    }
  }
}
const sameDisplay = (a, b) => a.screenId === b.screenId &&
  a.width === b.width && a.height === b.height && a.orientation === b.orientation;
async function touchScreen() {
  const capture = new SimCapture(udid, 1, 0.65, 0, 1, 100000, 0);
  try {
    await capture.start();
    let screen = await capture.screenSize();
    for (let attempts = 0; (screen.width <= 0 || screen.height <= 0) && attempts < 20; attempts++) {
      await sleep(100);
      screen = await capture.screenSize();
    }
    if (!(screen.width > 0 && screen.height > 0)) throw new Error("Display size unavailable");
    const shown = input.viewport;
    const scaleRatio = (shown.width / shown.height) / (screen.width / screen.height);
    if (Math.abs(scaleRatio - 1) > 0.01) throw new Error("Display geometry changed");
    await hid.setScreen(screen.screenId ?? 0);
    if (!sameDisplay(screen, await capture.screenSize())) throw new Error("Display geometry changed");
    const touch = (phase, x, y) => delivered(hid.touch(phase, x, y, screen.width, screen.height, 0));
    const from = input.type === "tap" ? [input.x, input.y] : [input.x1, input.y1];
    const to = input.type === "tap" ? from : [input.x2, input.y2];
    let point = from;
    try {
      await touch("begin", ...point);
      if (input.type === "tap") {
        await sleep(40);
      } else {
        const frames = Math.ceil(input.durationMs / 30);
        const interval = input.durationMs / frames;
        const started = performance.now();
        for (let index = 1; index <= frames; index++) {
          await sleep(Math.max(0, index * interval - (performance.now() - started)));
          const progress = index / frames;
          point = from.map((start, axis) => start + (to[axis] - start) * progress);
          await touch("move", ...point);
        }
      }
    } finally {
      await touch("end", ...point);
    }
    if (!sameDisplay(screen, await capture.screenSize())) throw new Error("Display geometry changed");
  } finally {
    await capture.stop();
  }
}
(async () => {
  if (input.type === "keys") await typeKeys();
  else if (input.type === "button") await delivered(hid.button(input.button));
  else await touchScreen();
  console.log("Tabs iOS input delivered");
})().catch(() => { process.exitCode = 1; });
`;

export const runIosDeviceInput = Effect.fn("DeviceIosInput.run")(function* (
  ready: DeviceHostReady,
  udid: string,
  gesture: DeviceComparisonGesture,
  guard: Effect.Effect<void, DeviceComparisonError>,
) {
  const helper = ready.helpers.serveSimCli;
  if (!helper || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(udid))
    return yield* new DeviceComparisonError({
      reason: "Live iOS input requires a selected simulator.",
    });
  const input = toIosInput(gesture);
  if (!input) {
    return yield* new DeviceComparisonError({
      reason:
        gesture.type === "text"
          ? "Use the simulator’s on-screen keyboard for characters outside the US keyboard layout."
          : "Select a control on the current simulator screen.",
    });
  }
  yield* guard;
  // Input contains user keystrokes. Keep it off the command line and out of errors.
  const result = yield* ready.run(ready.nodePath, ["-e", driver, "--", helper, udid], {
    stdin: JSON.stringify(input),
    timeoutMs: 15_000,
  });
  if (result.code !== 0 || !result.stdout.split(/\r?\n/).includes("Tabs iOS input delivered"))
    return yield* new DeviceComparisonError({
      reason: "The simulator did not confirm the input. Check the live screen before continuing.",
    });
});

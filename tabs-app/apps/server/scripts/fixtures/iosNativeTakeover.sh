#!/bin/bash
set -euo pipefail
# Run on macOS with the iPhone 16 device type and iOS 18.2 simulator runtime installed.
# The fixture creates and deletes its own simulator and never launches Tabs.
cd "$(dirname "$0")/../.."
hub_version=$(bun -e 'import { DEVICE_HUB_VERSION } from "./src/device/DeviceToolchain.ts"; console.log(DEVICE_HUB_VERSION)')
node_path=$(command -v node)
scratch_dir=$(mktemp -d /tmp/tabs-ios-keyprobe.XXXXXX)
simulator_udid=
cleanup() {
  if [ -n "$simulator_udid" ]; then
    xcrun simctl shutdown "$simulator_udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$simulator_udid" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '{"private":true,"dependencies":{"expo-device-hub":"%s"}}
' "$hub_version" > "$scratch_dir/package.json"
BUN_INSTALL_CACHE_DIR="$scratch_dir/cache" bun install --cwd "$scratch_dir" --ignore-scripts --no-progress
helper="$scratch_dir/node_modules/expo-device-hub/vendor/serve-sim/dist/serve-sim.js"
test -f "$helper"
simulator_udid=$(xcrun simctl create "Tabs iOS keyboard fixture" com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-18-2)
xcrun simctl boot "$simulator_udid"
xcrun simctl bootstatus "$simulator_udid" -b
mkdir "$scratch_dir/TabsHIDFixture.app"
cat > "$scratch_dir/Fixture.swift" <<'SWIFT'
import UIKit

final class FixtureViewController: UIViewController {
    private let field = UITextField()
    private let readback = UILabel()
    private let status = UILabel()

    private func writeState(_ value: String) {
        let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("fixture.txt")
        try? value.write(to: path, atomically: true, encoding: .utf8)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        writeState("Tap pending")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        field.placeholder = "Fixture input"
        field.accessibilityLabel = "Fixture input"
        field.borderStyle = .roundedRect
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.addTarget(self, action: #selector(changed), for: .editingChanged)
        readback.text = "Readback empty"
        status.text = "Tap pending"
        let button = UIButton(type: .system)
        button.setTitle("Confirm fixture tap", for: .normal)
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [field, readback, button, status])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 60),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            field.heightAnchor.constraint(equalToConstant: 44),
        ])
        view.addGestureRecognizer(UISwipeGestureRecognizer(target: self, action: #selector(swiped)))
    }

    @objc private func changed() {
        let value = "Readback " + (field.text ?? "")
        readback.text = value
        writeState(value)
    }

    @objc private func tapped() {
        showStatus("Tap confirmed")
        field.becomeFirstResponder()
    }

    @objc private func swiped() {
        showStatus("Swipe confirmed")
    }

    private func showStatus(_ value: String) {
        status.text = value
        writeState(value)
    }
}

@main final class FixtureApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = FixtureViewController()
        window?.makeKeyAndVisible()
        return true
    }
}
SWIFT
cat > "$scratch_dir/TabsHIDFixture.app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TabsHIDFixture</string>
<key>CFBundleIdentifier</key><string>dev.tabs.hidfixture</string>
<key>CFBundleName</key><string>TabsHIDFixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>UILaunchScreen</key><dict/>
</dict></plist>
PLIST
sdk_path=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator swiftc -parse-as-library -target "$(uname -m)-apple-ios18.2-simulator" -sdk "$sdk_path" "$scratch_dir/Fixture.swift" -o "$scratch_dir/TabsHIDFixture.app/TabsHIDFixture"
codesign --force --sign - "$scratch_dir/TabsHIDFixture.app"
xcrun simctl install "$simulator_udid" "$scratch_dir/TabsHIDFixture.app"
xcrun simctl launch "$simulator_udid" dev.tabs.hidfixture
container=$(xcrun simctl get_app_container "$simulator_udid" dev.tabs.hidfixture data)
TABS_QA_IOS_CONTAINER="$container" TABS_QA_IOS_UDID="$simulator_udid" \
TABS_QA_IOS_HELPER="$helper" TABS_QA_IOS_NODE="$node_path" bun - <<'TS'
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeviceComparisonGesture } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import type { DeviceHostReady } from "./src/device/DeviceHost.ts";
import { runIosDeviceInput } from "./src/device/DeviceIosInput.ts";

const {
  TABS_QA_IOS_CONTAINER: container,
  TABS_QA_IOS_UDID: udid,
  TABS_QA_IOS_HELPER: helper,
  TABS_QA_IOS_NODE: nodePath,
} = process.env;
if (!container || !udid || !helper || !nodePath) throw new Error("Fixture configuration missing");

const ready: DeviceHostReady = {
  nodePath,
  hub: { origin: "http://127.0.0.1" },
  helpers: { serveSimCli: helper, serveSimAxSettings: null },
  run: (command, args, options) =>
    Effect.promise(() => new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      const timer = setTimeout(() => child.kill(), options?.timeoutMs ?? 15_000);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.stdin.on("error", () => {});
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 127, stdout, stderr });
      });
      child.stdin.end(options?.stdin);
    })),
};
const gesture = (input: DeviceComparisonGesture) =>
  Effect.runPromise(runIosDeviceInput(ready, udid, input, Effect.void));
const statePath = join(container, "Documents", "fixture.txt");

async function expectState(expected: string) {
  let current: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    current = await readFile(statePath, "utf8").catch(() => null);
    if (current === expected) return;
    await Bun.sleep(150);
  }
  throw new Error(`Expected ${expected}, received ${current}`);
}

const started = performance.now();
const screen = { width: 1179, height: 2556 };
const button = { x: 0.5, y: 222 / 852 };
await expectState("Tap pending");
const staleInput = await Effect.runPromiseExit(
  runIosDeviceInput(
    ready,
    udid,
    { type: "tap", ...button, viewport: { width: screen.height, height: screen.width } },
    Effect.void,
  ),
);
if (staleInput._tag !== "Failure") throw new Error("A mismatched viewport was accepted");
await expectState("Tap pending");

await gesture({ type: "tap", ...button, viewport: screen });
await expectState("Tap confirmed");
await gesture({ type: "text", text: "A?09" });
await expectState("Readback A?09");
await gesture({ type: "key", keycode: 67 });
await expectState("Readback A?0");
await gesture({ type: "swipe", x1: 0.2, y1: 0.42, x2: 0.8, y2: 0.42, durationMs: 280, viewport: screen });
await expectState("Swipe confirmed");

console.log(JSON.stringify({
  fixture: "ios-native-takeover",
  device: "iPhone 16/iOS 18.2",
  staleViewportRejected: true,
  tapSwipeTextAndBackspaceVerified: true,
  elapsedMs: Math.round(performance.now() - started),
}));
TS

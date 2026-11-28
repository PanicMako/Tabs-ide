#!/bin/bash
# Run from tabs-app on macOS with Accessibility permission for the terminal.
# TABS_QA_REQUIRE_CAPTURE=1 requires Screen Recording for the capture trial.
# TABS_QA_PHYSICAL=1 prompts you to focus the exact fixture for a physical click, Space, and intercepted secure-field checks.
# TABS_QA_MIXED_SCALE=1 prompts you to move the exact fixture to a display with different scale.
set -eu
probe_dir=$(mktemp -d)
trap 'rm -rf "$probe_dir"' EXIT
bundle="$probe_dir/TabsNativeGuardFixture.app"
mkdir -p "$bundle/Contents/MacOS"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.tabs.native-guard-fixture</string>
<key>CFBundleName</key><string>TabsNativeGuardFixture</string>
<key>CFBundleExecutable</key><string>TabsNativeGuardFixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
cat > "$probe_dir/Fixture.swift" <<'SWIFT'
import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.finishLaunching()
let window = NSWindow(contentRect: NSRect(x: 150, y: 140, width: 420, height: 220),
                      styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Tabs Native Guard Fixture"
window.isReleasedWhenClosed = false
let button = NSButton(title: "Save test item", target: nil, action: nil)
button.frame = NSRect(x: 20, y: 50, width: 160, height: 36)
class Controller: NSObject {
    @objc func save(_ sender: NSButton) {
        sender.title = sender.title == "Saved test item" ? "Corrected test item" : "Saved test item"
    }
    @objc func saveSibling(_ sender: NSButton) {
        sender.title = "Saved sibling item"
    }
}
let controller = Controller()
button.target = controller
button.action = #selector(Controller.save(_:))
window.contentView?.addSubview(button)
let cover = NSButton(title: "Cover test item", target: controller, action: #selector(Controller.saveSibling(_:)))
cover.frame = button.frame
let ordinary = NSTextField(frame: NSRect(x: 20, y: 150, width: 180, height: 28))
ordinary.setAccessibilityLabel("Fixture text field")
ordinary.stringValue = "fixturetext"
let secure = NSSecureTextField(frame: NSRect(x: 20, y: 100, width: 180, height: 28))
secure.setAccessibilityLabel("Fixture password field")
secure.stringValue = "fixture-only-password"
window.collectionBehavior = [.canJoinAllSpaces, .stationary]
window.orderBack(nil)
let sibling = NSWindow(contentRect: NSRect(x: 620, y: 140, width: 320, height: 220),
                       styleMask: [.titled, .closable], backing: .buffered, defer: false)
sibling.title = window.title
sibling.isReleasedWhenClosed = false
let siblingButton = NSButton(title: "Save test item", target: controller, action: #selector(Controller.saveSibling(_:)))
siblingButton.frame = button.frame
sibling.contentView?.addSubview(siblingButton)
sibling.collectionBehavior = window.collectionBehavior
sibling.orderBack(nil)
// Expose both fixture windows even when AppKit's default AXWindows omits a background window.
app.setAccessibilityWindows([window, sibling])

// Change the fixture without raising it. Only set field focus in the key window.
let marker = URL(fileURLWithPath: CommandLine.arguments[2])
Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in
    if let request = try? String(contentsOf: marker, encoding: .utf8) {
        if request == "move" {
            window.setFrameOrigin(NSPoint(x: window.frame.minX + 40, y: window.frame.minY))
        } else if request == "correct" {
            button.performClick(nil)
            try? siblingButton.title.write(to: marker.appendingPathExtension("sibling"), atomically: true, encoding: .utf8)
        } else if request == "cover" {
            window.contentView?.addSubview(cover, positioned: .above, relativeTo: button)
        } else if request == "uncover" {
            cover.removeFromSuperview()
        } else if request == "protect" {
            window.contentView?.addSubview(secure)
        } else if request == "unprotect" {
            secure.removeFromSuperview()
        } else if request == "focus-text" && app.isActive && window.isKeyWindow {
            window.contentView?.addSubview(ordinary)
            if window.makeFirstResponder(ordinary) {
                ordinary.currentEditor()?.selectedRange = NSRange(location: "fixture".utf16.count, length: 0)
            }
        } else if request == "focus-secure" && app.isActive && window.isKeyWindow {
            window.contentView?.addSubview(secure)
            window.makeFirstResponder(secure)
        }
        try? FileManager.default.removeItem(at: marker)
    }
}
let pid = ProcessInfo.processInfo.processIdentifier
try? String(pid).write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
app.run()
SWIFT
swiftc "$probe_dir/Fixture.swift" -o "$bundle/Contents/MacOS/TabsNativeGuardFixture" || exit
codesign --force --sign - "$bundle" >/dev/null 2>&1 || exit
trap 'if test -s "$probe_dir/id"; then kill "$(cat "$probe_dir/id")" 2>/dev/null || true; fi; rm -rf "$probe_dir"' EXIT
open -g -n "$bundle" --args "$probe_dir/id" "$probe_dir/correct" || exit
for ((wait_try = 0; wait_try < 75; wait_try++)); do
  if test -s "$probe_dir/id"; then break; fi
  sleep 0.1
done
test -s "$probe_dir/id" || exit 1
sleep 0.8
TABS_NATIVE_FIXTURE_PROBE_PID=$(cat "$probe_dir/id")
export TABS_NATIVE_FIXTURE_PROBE_PID
export TABS_NATIVE_FIXTURE_CORRECTION="$probe_dir/correct"
bun - <<'JS'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ComputerUseError } from "./apps/server/src/computerUse/ComputerUseError.ts";
import { JXA_RUNTIME } from "./apps/server/src/computerUse/jxaScript.ts";
import { parseKeySpec } from "./apps/server/src/computerUse/keySpec.ts";
import { NativeWindows } from "./apps/server/src/computerUse/nativeWindows.ts";
const server = process.cwd() + "/apps/server";
const Effect = await import(Bun.resolveSync("effect/Effect", server));
const Semaphore = await import(Bun.resolveSync("effect/Semaphore", server));
const pid = Number(process.env.TABS_NATIVE_FIXTURE_PROBE_PID);
const marker = process.env.TABS_NATIVE_FIXTURE_CORRECTION;
async function fixtureAction(action) {
  writeFileSync(marker + ".pending", action);
  renameSync(marker + ".pending", marker);
  for (let attempt = 0; attempt < 40 && existsSync(marker); attempt++) await Bun.sleep(50);
  assert.ok(!existsSync(marker), `The fixture did not apply ${action}`);
}
const fixtureRuntime = JXA_RUNTIME + `
var fixtureRunningApps = runningApps;
runningApps = function () {
  return fixtureRunningApps().filter(function (app) { return Number(app.processIdentifier) === ${pid}; });
};
`;
const noPhysicalInput = "\nmouseEvent = function () { fail('fixture_input_blocked', 'No input was posted.'); };";
const invoke = (op, code = fixtureRuntime) => {
  const result = spawnSync("osascript", ["-l", "JavaScript", "-"], {
    input: code, encoding: "utf8",
    env: { ...process.env, COMPUTER_USE_REQUEST: JSON.stringify({ ...op, pid }) },
    timeout: 12000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
};
const listing = invoke({ op: "listWindows" });
assert.ok(listing.permissions?.accessibility, "Grant Accessibility to the terminal to test the fixture");
if (process.env.TABS_QA_REQUIRE_CAPTURE === "1") {
  assert.ok(listing.permissions.capabilities.windowCapture,
    "Grant Screen Recording to the terminal and relaunch it before the required capture trial.");
}
const candidates = listing.windows.filter(window => window.pid === pid);
const bound = candidates.find(window => window.frame.width === 420);
const sibling = candidates.find(window => window.frame.width === 320);
if (!bound || !sibling) {
  const debug = invoke({ op: "listWindows" }, fixtureRuntime.replace(
    "result.windows = chooseWindows();",
    "result.cgFrames = windowRows(req.pid).map(cgFrame); result.axFrames = windowsOf($.AXUIElementCreateApplication(req.pid)).map(axFrame);",
  ));
  throw new Error(`Fixture windows unavailable. ${JSON.stringify(debug)}`);
}
assert.equal(bound.title, sibling.title);
assert.notEqual(bound.id, sibling.id);
console.log(JSON.stringify({ sameTitle: true, selectableFixtureWindows: candidates.length }));
const frontmostPid = () => invoke({}, `
ObjC.import('AppKit');
function run() {
  return JSON.stringify({ pid: Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier) });
}`).pid;
const app = { kind: "window", id: bound.id };
const read = invoke({ app, op: "snapshot", maxNodes: 80, native: { foreground: false } });
if (!read.ok) {
  console.log(JSON.stringify(read));
  process.exit(1);
}
const snapshot = read.snapshot;
const match = snapshot.treeText.match(/^\s*(\d+) Button "Save test item"/m);
console.log(JSON.stringify({ exactSnapshot: snapshot.window.key === app.id, frame: snapshot.window.frame, scale: snapshot.scale, buttonFound: !!match }));
if (!match) { console.log(snapshot.treeText); process.exit(1); }
const screenshotPath = marker + ".png";
const captureScope = { foreground: false, frame: snapshot.window.frame, display: snapshot.display, scale: snapshot.scale };
const captureGuardProbe = fixtureRuntime + `
var realCaptureGuard = checkScreenshotContent;
canCapture = function () { return true; };
checkScreenshotContent = function () {
  realCaptureGuard();
  fail('fixture_capture_guard_passed', 'The content guard passed and capture was not dispatched.');
};
`;
const guardPath = marker + ".guard.png";
const verifyCaptureGuard = () => invoke({ app, op: "screenshot", path: guardPath, native: captureScope }, captureGuardProbe);
const safeGuard = verifyCaptureGuard();
assert.equal(safeGuard.code, "fixture_capture_guard_passed", JSON.stringify(safeGuard));
const capture = invoke({ app, op: "screenshot", path: screenshotPath,
  native: captureScope });
if (listing.permissions.capabilities.windowCapture) {
  assert.ok(capture.ok, JSON.stringify(capture));
  const png = readFileSync(screenshotPath);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), snapshot.window.frame.width * snapshot.scale);
  assert.equal(png.readUInt32BE(20), snapshot.window.frame.height * snapshot.scale);
} else {
  assert.equal(capture.code, "permission_denied");
  assert.equal(existsSync(screenshotPath), false);
}
assert.equal(existsSync(screenshotPath + ".capture.png"), false);

await fixtureAction("protect");
const protectedRead = invoke({ app, op: "snapshot", maxNodes: 80, native: captureScope });
assert.ok(protectedRead.ok, JSON.stringify(protectedRead));
const secureField = protectedRead.snapshot.treeText.match(/^\s*(\d+) TextField\/SecureTextField.*\(secure\)/m);
assert.ok(secureField, protectedRead.snapshot.treeText);
assert.doesNotMatch(protectedRead.snapshot.treeText, /fixture-only-password/);
const secureIndex = Number(secureField[1]);
const refused = invoke({ app, op: "setValue", value: "fixture-replacement", elementIndex: secureIndex,
  maxNodes: 80, native: { ...captureScope, elements: { [secureIndex]: protectedRead.snapshot.elements[secureIndex - 1] } } });
assert.equal(refused.code, "sensitive_field");
const secureGuard = verifyCaptureGuard();
assert.equal(secureGuard.code, "sensitive_field", JSON.stringify(secureGuard));
assert.equal(existsSync(guardPath), false);
assert.equal(existsSync(guardPath + ".capture.png"), false);
if (listing.permissions.capabilities.windowCapture) {
  const protectedPath = marker + ".protected.png";
  const blocked = invoke({ app, op: "screenshot", path: protectedPath, native: captureScope });
  assert.equal(blocked.code, "sensitive_field");
  assert.equal(existsSync(protectedPath), false);
  assert.equal(existsSync(protectedPath + ".capture.png"), false);
}
await fixtureAction("unprotect");
console.log(JSON.stringify({ secureFieldRedacted: true, secureInputRefused: true,
  captureGuardPassedOnSafeWindow: true, captureGuardRefusedSecureWindow: true,
  secureCaptureRefused: listing.permissions.capabilities.windowCapture ? true : null }));

// Exercise the native foreground gate while the fixture is behind the editor.
// Intercept the event even if the fixture is brought forward during the run.
const foreground = invoke({ app, op: "click", target: { kind: "point", x: 10, y: 10 },
  button: "left", clickCount: 1, foreground: true, maxNodes: 80,
  native: { foreground: true, frame: snapshot.window.frame, display: snapshot.display, scale: snapshot.scale },
}, fixtureRuntime + noPhysicalInput);
assert.equal(foreground.code, listing.permissions.capabilities.foregroundInput ? "focus_changed" : "permission_denied");
console.log(JSON.stringify({ screenRecording: listing.permissions.screenRecording,
  windowCapture: capture.ok ? "verified" : capture.code,
  foregroundInput: listing.permissions.capabilities.foregroundInput,
  backgroundPhysicalAction: foreground.code }));
const index = Number(match[1]);
const packet = { app, op: "click", target: { kind: "element", index }, clickCount: 1, button: "left", maxNodes: 80, foreground: false,
  native: { foreground: false, frame: snapshot.window.frame, display: snapshot.display, scale: snapshot.scale, elements: { [index]: snapshot.elements[index - 1] } } };
const stale = invoke({ ...packet, native: { ...packet.native, scale: snapshot.scale + 1 } });
const paused = invoke({ ...packet, controlFile: "missing-fixture-control-" + pid });
const result = invoke({ app, op: "snapshot", maxNodes: 80, native: { foreground: false } });
console.log(JSON.stringify({ stale: stale.code, takeover: paused.code, unchanged: result.snapshot?.treeText.includes("Save test item") }));
if (stale.code !== "stale_observation" || paused.code !== "user_turn" || !result.snapshot?.treeText.includes("Save test item")) process.exit(1);
// Move the disposable window between the tree read and the final layout check.
const moving = invoke({ app, op: "snapshot", maxNodes: 80, native: { foreground: false } }, fixtureRuntime + `
var fixtureNodeToken = nodeToken;
var fixtureMoveStarted = false;
nodeToken = function (node) {
  if (fixtureMoveStarted) return fixtureNodeToken(node);
  fixtureMoveStarted = true;
  var targetX = axFrame(exactWindow).x + 40;
  if (!$('move').writeToFileAtomicallyEncodingError($(${JSON.stringify(marker)}), true, $.NSUTF8StringEncoding, null))
    fail('fixture_move_failed', 'Could not schedule the fixture window move.');
  for (var attempt = 0; attempt < 40; attempt++) {
    var frame = axFrame(exactWindow);
    if (frame && frame.x === targetX && matchCG(exactWindow, windowRows(${pid}))) return fixtureNodeToken(node);
    sleep(0.05);
  }
  fail('fixture_move_failed', 'The fixture window did not move during the read.');
};
`);
assert.equal(moving.code, "stale_observation", JSON.stringify(moving));
let moved;
for (let attempt = 0; attempt < 5; attempt++) {
  moved = invoke({ app, op: "snapshot", maxNodes: 80, native: { foreground: false } }).snapshot;
  if (moved?.window.frame.x === snapshot.window.frame.x + 40) break;
  await Bun.sleep(50);
}
assert.ok(moved, "The moved window could not be observed");
assert.equal(moved.window.frame.x, snapshot.window.frame.x + 40);
const staleGeometry = invoke(packet);
assert.equal(staleGeometry.code, "stale_observation");
assert.equal(moved.window.key, snapshot.window.key);
assert.match(moved.treeText, /Save test item/);
console.log(JSON.stringify({ movingSnapshotRefused: moving.code, freshSnapshotMatchesWindow: true }));

let droppedReply;
let loseSiblingClickReply = false;
let siblingDispatches = 0;
const windows = new NativeWindows(
  (request) => Effect.suspend(() => {
    const runtime = request.foreground === true ? fixtureRuntime + noPhysicalInput : fixtureRuntime;
    const result = invoke(request, runtime);
    if (request.op === "click" && request.app.kind === "window" && request.app.id === sibling.id) {
      siblingDispatches++;
      if (loseSiblingClickReply && result.ok) {
        droppedReply = result;
        return Effect.fail(new ComputerUseError({ code: "accessibility_error", message: "Fixture reply lost after input." }));
      }
    }
    return result.ok
      ? Effect.succeed(result)
      : Effect.fail(new ComputerUseError({ code: result.code, message: "Fixture runtime refused the request." }));
  }),
  Semaphore.makeUnsafe(1),
);
const threadId = "native-correction-fixture";
const siblingThreadId = "native-correction-sibling";
const run = Effect.runPromise;
const canTestForeground = listing.permissions.capabilities.foregroundInput;
const attached = await run(windows.control({ op: "attach", threadId, windowId: bound.id, foreground: canTestForeground }));
const selected = { kind: "attachment", selector: attached.grant.selector };
const occupied = await run(Effect.flip(windows.control({
  op: "attach", threadId: siblingThreadId, windowId: bound.id, foreground: false,
})));
assert.equal(occupied.code, "window_busy");
const attachedSibling = await run(windows.control({
  op: "attach", threadId: siblingThreadId, windowId: sibling.id, foreground: false,
}));
const siblingApp = { kind: "attachment", selector: attachedSibling.grant.selector };
const inspect = { app: selected, op: "snapshot", maxNodes: 80 };
assert.equal((await run(Effect.flip(windows.run(inspect, siblingThreadId)))).code, "window_grant_required");
const click = (app, index) => ({
  app, op: "click", target: { kind: "element", index },
  button: "left", clickCount: 1, foreground: false, maxNodes: 80,
});
const status = windows.control({ op: "status", threadId });
let primaryBefore = await run(windows.run(inspect, threadId));
assert.equal(primaryBefore.snapshot.window.key, bound.id);
if (canTestForeground) {
  const front = frontmostPid();
  assert.ok(front > 0 && front !== pid, "Leave another app in front for the foreground refusal trial.");
  const point = { app: selected, op: "click", target: { kind: "point", x: 10, y: 10 },
    button: "left", clickCount: 1, foreground: true, maxNodes: 80 };
  assert.equal((await run(status)).activity, "background");
  const result = await run(Effect.flip(windows.run(point, threadId, primaryBefore.snapshot.id)));
  assert.equal(result.code, "focus_changed");
  assert.equal((await run(status)).activity, "needs_foreground");
  assert.equal((await run(windows.control({ op: "status", threadId: siblingThreadId }))).activity, undefined);
  primaryBefore = await run(windows.run(inspect, threadId));
  assert.equal((await run(status)).activity, "needs_foreground");
  const hold = await run(windows.control({ op: "take", threadId, selector: selected.selector }));
  assert.equal(hold.grant.mode, "user");
  assert.equal(hold.activity, undefined);
  assert.equal((await run(Effect.flip(windows.run(point, threadId, primaryBefore.snapshot.id)))).code, "user_turn");
  const returned = await run(windows.control({
    op: "resume", threadId, selector: selected.selector, takeoverId: hold.grant.takeoverId,
  }));
  assert.equal(returned.continuationId, undefined);
  assert.equal(returned.activity, undefined);
  assert.equal(frontmostPid(), front);
  assert.match(primaryBefore.snapshot.treeText, /Save test item/);
  primaryBefore = await run(windows.run(inspect, threadId));
  console.log(JSON.stringify({ foregroundActivity: "needs_foreground", exactThread: true,
    preservedOnSnapshot: true, clearedByTakeover: true, backgroundPhysicalDispatch: false }));
}
const movedButton = primaryBefore.snapshot.treeText.match(/^\s*(\d+) Button "Save test item"/m);
assert.ok(movedButton);
const oldClick = click(selected, Number(movedButton[1]));
const frontBefore = frontmostPid();
assert.ok(frontBefore > 0 && frontBefore !== pid, "Leave another app in front for the background input trial.");
const actionAt = performance.now();
const beforeHandoff = await run(windows.run(oldClick, threadId, primaryBefore.snapshot.id));
const backgroundClickMs = Math.round(performance.now() - actionAt);
assert.equal(frontmostPid(), frontBefore);
assert.equal(beforeHandoff.action.delivery, "background");
assert.equal(beforeHandoff.snapshot.window.key, bound.id);
assert.match(beforeHandoff.snapshot.treeText, /Saved test item/);
console.log(JSON.stringify({ delivery: beforeHandoff.action.delivery,
  realMoveGuard: staleGeometry.code, changed: true, backgroundClickMs, foregroundAppUnchanged: true }));

const takeStarted = performance.now();
const taken = await run(windows.control({ op: "take", threadId, selector: selected.selector }));
const takeMs = Math.round(performance.now() - takeStarted);
assert.equal(taken.grant.mode, "user");
assert.equal((await run(Effect.flip(windows.run(oldClick, threadId, beforeHandoff.snapshot.id)))).code, "user_turn");

await fixtureAction("correct");
const seenAt = performance.now();
const resume = { op: "resume", threadId, selector: selected.selector, takeoverId: taken.grant.takeoverId };
const returned = await run(windows.control(resume));
const returnMs = Math.round(performance.now() - seenAt);
assert.equal(returned.grant.mode, "agent");
assert.ok(returned.continuationId);
assert.deepEqual(await run(windows.control(resume)), returned);
assert.equal((await run(Effect.flip(windows.run(oldClick, threadId, beforeHandoff.snapshot.id)))).code, "stale_observation");
const corrected = await run(windows.run(inspect, threadId, undefined, true));
const correctionObservedMs = Math.round(performance.now() - seenAt);
const correctedButton = corrected.snapshot.treeText.match(/^\s*(\d+) Button "Corrected test item"/m);
assert.ok(correctedButton);
assert.match(corrected.handoff, /changed/);
const changedControls = corrected.handoff.match(/current controls include ([\d, ]+)/)?.[1]?.split(", ");
assert.ok(changedControls?.includes(correctedButton[1]), corrected.handoff);
const siblingInspect = { ...inspect, app: siblingApp };
const siblingBefore = await run(windows.run(siblingInspect, siblingThreadId));
assert.equal(siblingBefore.snapshot.window.key, sibling.id);
const siblingMatch = siblingBefore.snapshot.treeText.match(/^\s*(\d+) Button "Save test item"/m);
assert.ok(siblingMatch);
assert.doesNotMatch(siblingBefore.snapshot.treeText, /Corrected test item/);
assert.equal(readFileSync(marker + ".sibling", "utf8"), "Save test item");

const frontBeforeSibling = frontmostPid();
assert.ok(frontBeforeSibling > 0 && frontBeforeSibling !== pid);
const siblingActionAt = performance.now();
const siblingClick = windows.run(click(siblingApp, Number(siblingMatch[1])), siblingThreadId, siblingBefore.snapshot.id);
loseSiblingClickReply = true;
assert.equal((await run(Effect.flip(siblingClick))).code, "accessibility_error");
const siblingClickMs = Math.round(performance.now() - siblingActionAt);
assert.equal(frontmostPid(), frontBeforeSibling);
assert.equal(droppedReply?.action.delivery, "background");
assert.equal(droppedReply.snapshot.window.key, sibling.id);
assert.equal((await run(Effect.flip(siblingClick))).code, "stale_observation");
assert.equal(siblingDispatches, 1);
const siblingAfter = await run(windows.run(siblingInspect, siblingThreadId));
assert.equal(siblingAfter.snapshot.window.key, sibling.id);
assert.match(siblingAfter.snapshot.treeText, /Saved sibling item/);
const primaryAfter = await run(windows.run(inspect, threadId));
assert.match(primaryAfter.snapshot.treeText, /Corrected test item/);
assert.doesNotMatch(primaryAfter.snapshot.treeText, /Saved sibling item/);
await run(windows.revokeThread(threadId));
await run(windows.revokeThread(siblingThreadId));
console.log(JSON.stringify({ exactWindowCorrection: true, independentlyAttached: true,
  duplicateGrantRefused: occupied.code, crossThreadSelectorRefused: true, siblingUnchangedByPrimary: true,
  primaryUnchangedBySibling: true, foregroundAppUnchanged: true, staleClickRefused: true,
  continuationReceipt: true, correctedControl: Number(correctedButton[1]), takeMs, returnMs,
  correctionObservedMs, siblingClickMs,
  lostReplyRetryRefused: true, siblingDispatches }));

if (process.env.TABS_QA_PHYSICAL === "1") {
  assert.ok(listing.permissions.capabilities.foregroundInput, "macOS denied synthetic input.");
  const fixtureSnapshot = () => {
    const read = invoke({ app, op: "snapshot", maxNodes: 80, native: { foreground: true } });
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(read.snapshot.window.key, app.id);
    return read.snapshot;
  };
  const physicalScope = (before) => ({
    foreground: true, frame: before.window.frame, display: before.display, scale: before.scale,
  });
  const clickCorrectedItem = (code) => {
    const before = fixtureSnapshot();
    const button = Number(before.treeText.match(/^\s*(\d+) Button "Corrected test item"/m)?.[1]);
    assert.ok(button > 0);
    return invoke({
      app, op: "click", target: { kind: "element", index: button },
      button: "left", clickCount: 1, foreground: true, maxNodes: 80,
      native: { ...physicalScope(before), elements: { [button]: before.elements[button - 1] } },
    }, code);
  };

  console.log("Within 30 seconds, bring the fixture window whose button reads Corrected test item fully to the front. Click its title bar and leave it focused.");
  const deadline = Date.now() + 30_000;
  let ready;
  do {
    ready = clickCorrectedItem(fixtureRuntime + noPhysicalInput);
    if (ready.code === "fixture_input_blocked") break;
    assert.ok(["focus_changed", "target_occluded"].includes(ready.code), JSON.stringify(ready));
    await Bun.sleep(250);
  } while (Date.now() < deadline);
  assert.equal(ready.code, "fixture_input_blocked", `The exact fixture control was never unobstructed and focused. ${JSON.stringify(ready)}`);

  await fixtureAction("cover");
  const covered = clickCorrectedItem(fixtureRuntime + noPhysicalInput);
  assert.equal(covered.code, "target_occluded", JSON.stringify(covered));
  assert.equal(covered.message, "Another control covers the selected control.");
  await fixtureAction("uncover");
  const clickStarted = performance.now();
  const clicked = clickCorrectedItem();
  assert.ok(clicked.ok, JSON.stringify(clicked));
  assert.equal(clicked.action.path, "synthetic");
  assert.equal(clicked.action.delivery, "foreground");
  let confirmed = clicked.snapshot;
  for (let attempt = 0; attempt < 5 && !confirmed?.treeText.includes('Button "Saved test item"'); attempt++) {
    await Bun.sleep(100);
    confirmed = fixtureSnapshot();
  }
  assert.match(confirmed?.treeText ?? "", /Button "Saved test item"/);
  console.log(JSON.stringify({ sameWindowOverlayRefused: true, physicalClick: "verified",
    scale: confirmed.scale, observeAndClickMs: Math.round(performance.now() - clickStarted) }));

  // Native keys post directly to the fixture PID. Intercept that call as well as mouse dispatch.
  const keyDispatch = "    $.CGEventPostToPid(Number(app.processIdentifier), ev);";
  assert.equal(fixtureRuntime.split(keyDispatch).length, 2, "Update the fixture's keyboard dispatch interceptor.");
  const interceptedInput = fixtureRuntime.replace(keyDispatch,
    "    fail('fixture_input_blocked', 'No input was posted.');") + noPhysicalInput;
  const space = parseKeySpec("Space");
  assert.ok(space.ok && space.key.insertsText);
  const focusedToken = (before, field) => {
    const index = Number(before.treeText.match(field)?.[1]);
    assert.ok(index > 0 && before.focusedElementIndex === index, before.treeText);
    const token = before.elements[index - 1];
    assert.ok(token);
    return token;
  };
  const spaceRequest = (before, focused) => ({
    app, op: "key", key: space.key, foreground: true, maxNodes: 80,
    native: { ...physicalScope(before), focused },
  });

  await fixtureAction("focus-text");
  const textBefore = fixtureSnapshot();
  const textToken = focusedToken(textBefore, /^\s*(\d+) TextField(?:\/\w+)? "Fixture text field" value="fixturetext"/m);
  const ordinarySpace = spaceRequest(textBefore, textToken);
  const readyToType = invoke(ordinarySpace, interceptedInput);
  assert.equal(readyToType.code, "fixture_input_blocked", JSON.stringify(readyToType));
  const typed = invoke(ordinarySpace);
  assert.ok(typed.ok, JSON.stringify(typed));
  assert.equal(typed.action.path, "synthetic");
  assert.equal(typed.action.delivery, "foreground");
  const textAfterSpace = /^\s*(\d+) TextField(?:\/\w+)? "Fixture text field" value="fixture text"/m;
  let typedSnapshot = typed.snapshot;
  for (let attempt = 0; attempt < 5 && !textAfterSpace.test(typedSnapshot?.treeText ?? ""); attempt++) {
    await Bun.sleep(100);
    typedSnapshot = fixtureSnapshot();
  }
  assert.equal(typedSnapshot?.window.key, app.id);
  focusedToken(typedSnapshot, textAfterSpace);
  console.log(JSON.stringify({ physicalSpace: "verified", delivery: typed.action.delivery, value: "fixture text" }));

  await fixtureAction("focus-secure");
  const secureBefore = fixtureSnapshot();
  const secureToken = focusedToken(secureBefore, /^\s*(\d+) TextField\/SecureTextField.*\(secure\)/m);
  assert.doesNotMatch(secureBefore.treeText, /fixture-only-password/);
  const secureSpace = invoke(spaceRequest(secureBefore, secureToken), interceptedInput);
  assert.equal(secureSpace.code, "sensitive_field", JSON.stringify(secureSpace));
  assert.match(secureSpace.message, /Refusing to send text-producing keys/);

  // Use a window-local point from the secure element's observed AX frame to exercise hit testing.
  const secureFrame = JSON.parse(secureToken)[4];
  assert.ok(secureFrame?.width > 0 && secureFrame.height > 0);
  const securePoint = invoke({
    app, op: "click", target: { kind: "point",
      x: secureFrame.x + secureFrame.width / 2 - secureBefore.window.frame.x,
      y: secureFrame.y + secureFrame.height / 2 - secureBefore.window.frame.y },
    button: "left", clickCount: 1, foreground: true, maxNodes: 80, native: physicalScope(secureBefore),
  }, interceptedInput);
  assert.equal(securePoint.code, "sensitive_field", JSON.stringify(securePoint));
  await fixtureAction("unprotect");
  console.log(JSON.stringify({ secureSpaceRefused: secureSpace.code, securePointRefused: securePoint.code,
    secureInputDispatched: false }));
}

if (process.env.TABS_QA_MIXED_SCALE === "1") {
  const readWindow = (allowMoving = false) => {
    const read = invoke({ app, op: "snapshot", maxNodes: 80, native: { foreground: false } });
    if (allowMoving && ["window_stale", "stale_observation"].includes(read.code)) return null;
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(read.snapshot.window.key, app.id);
    return read.snapshot;
  };
  const original = readWindow();
  assert.ok(original.display && original.scale > 0, "Place the fixture fully on a display before starting the trial.");
  const label = process.env.TABS_QA_PHYSICAL === "1" ? "Saved test item" : "Corrected test item";
  console.log(`Within 60 seconds, drag the fixture whose button reads ${label} fully onto a display with a different backing scale (currently ${original.scale}×).`);
  const deadline = Date.now() + 60_000;
  let relocated;
  do {
    const current = readWindow(true);
    if (current?.display && current.display !== original.display && current.scale > 0 && current.scale !== original.scale) {
      await Bun.sleep(500);
      const settled = readWindow(true);
      if (settled?.display === current.display && settled.scale === current.scale &&
          JSON.stringify(settled.window.frame) === JSON.stringify(current.window.frame)) {
        relocated = settled;
        break;
      }
    }
    await Bun.sleep(250);
  } while (Date.now() < deadline);
  assert.ok(relocated, "The fixture did not settle on a display with a different backing scale.");
  const native = { foreground: false, frame: relocated.window.frame, display: relocated.display, scale: relocated.scale };
  const refused = invoke({ app, op: "snapshot", maxNodes: 80, native: { ...native, scale: original.scale } });
  assert.equal(refused.code, "stale_observation", JSON.stringify(refused));
  const fresh = invoke({ app, op: "snapshot", maxNodes: 80, native });
  assert.ok(fresh.ok, JSON.stringify(fresh));
  assert.equal(fresh.snapshot.window.key, app.id);
  console.log(JSON.stringify({ mixedScale: { previousDisplay: original.display, previousScale: original.scale,
    display: relocated.display, scale: relocated.scale, oldScaleRefused: refused.code } }));
}

if (process.env.TABS_QA_REVEAL === "1") {
  const revealed = invoke({ app, op: "focusApp" });
  console.log(JSON.stringify({ revealed: revealed.ok, code: revealed.code }));
  if (!revealed.ok) process.exit(1);
}
JS

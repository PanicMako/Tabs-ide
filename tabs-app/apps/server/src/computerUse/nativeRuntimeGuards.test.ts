import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { JXA_RUNTIME } from "./jxaScript.ts";
import { LINUX_RUNTIME } from "./linuxRuntime.ts";

describe("macOS window guard", () => {
  it("rechecks the accessibility hit before a scoped scroll or drag reaches its target", () => {
    const output = runInNewContext(
      JXA_RUNTIME +
        `
      nativeRequest = {};
      var sent, coverAt;
      var app = {};
      var source = { point: { x: 20, y: 30 }, node: 'source' };
      var destination = { point: { x: 100, y: 30 }, node: 'destination' };
      requireTrusted = checkForeground = sleep = function () {};
      targetPoint = function (_, target) { return target; };
      checkClickHit = function (_, point, node) {
        if (node === 'destination' && coverAt >= 0 && sent.length >= coverAt)
          fail('target_occluded', 'Another control covers the destination.');
        if (node === 'source' && coverAt === -1)
          fail('sensitive_field', 'The source is protected.');
      };
      mouseEvent = function (_, kind, point) { sent.push([kind, point.x]); };
      post = function () { sent.push('scroll'); };
      function attempt(op, cover) {
        sent = [];
        coverAt = cover;
        try {
          if (op === 'scroll') doScroll(app, { target: destination, dy: 1, dx: 0, foreground: true });
          else doDrag(app, { from: source, to: destination, foreground: true });
          return { sent: sent };
        } catch (error) { return { code: error.code, sent: sent }; }
      }
      var stable = attempt('drag', Infinity);
      JSON.stringify([
        attempt('scroll', Infinity), attempt('scroll', 0), attempt('drag', 0),
        attempt('drag', -1), attempt('drag', 6), stable
      ]);
    `,
      {
        ObjC: { import() {} },
        $: {
          CGPointMake: (x: number, y: number) => ({ x, y }),
          CGEventCreateScrollWheelEvent2() {},
          CGEventSetLocation() {},
          kCGEventLeftMouseDown: "down",
          kCGEventLeftMouseDragged: "drag",
          kCGEventLeftMouseUp: "up",
        },
      },
    );
    const partial = [["down", 20], ...[30, 40, 50, 60, 70, 80, 90].map((x) => ["drag", x])];
    expect(JSON.parse(output)).toEqual([
      { sent: ["scroll"] },
      { code: "target_occluded", sent: [] },
      { code: "target_occluded", sent: [] },
      { code: "sensitive_field", sent: [] },
      { code: "target_occluded", sent: [...partial, ["up", 90]] },
      { sent: [...partial, ["drag", 100], ["up", 100]] },
    ]);
  });

  it("uses the native permission results when JXA leaves the probes unbound", () => {
    const bridge: Record<string, () => boolean> = { AXIsProcessTrusted: () => true };
    const bound: string[] = [];
    const capabilities = runInNewContext(
      JXA_RUNTIME + "\nJSON.stringify([permissions(), permissions()]);",
      {
        $: bridge,
        ObjC: {
          import() {},
          bindFunction(name: string, signature: unknown) {
            expect(signature).toEqual(["bool", []]);
            bound.push(name);
            bridge[name] = () => name === "CGPreflightPostEventAccess";
          },
        },
      },
    );
    expect(bound).toEqual(["CGPreflightScreenCaptureAccess", "CGPreflightPostEventAccess"]);
    expect(JSON.parse(capabilities)).toMatchObject(
      Array.from({ length: 2 }, () => ({
        accessibility: true,
        screenRecording: "denied",
        capabilities: { windowCapture: false, foregroundInput: true },
      })),
    );
  });

  it("publishes macOS capture only after rechecking protected content, layout and permission", () => {
    const paths = new Set<string>();
    const task = {
      launches: 0,
      arguments: [] as string[],
      afterLaunch: () => {},
      get launch() {
        this.launches++;
        paths.add(this.arguments.at(-1)!);
        this.afterLaunch();
        return undefined;
      },
      waitUntilExit: undefined,
      terminationStatus: 0,
    };
    const result = runInNewContext(
      JXA_RUNTIME +
        `
      exactId = 73;
      Ref = function () { return []; };
      $.AXUIElementCopyAttributeValue = function (element, attribute, ref) {
        if (element.errors && attribute in element.errors) return element.errors[attribute];
        if (!(attribute in element)) return -25205;
        ref[0] = element[attribute];
        return 0;
      };
      function attempt(before, after, failure) {
        var task = $.NSTask.alloc.init;
        var files = $.NSFileManager.defaultManager;
        files.removeItemAtPathError('/fixture.png');
        var launches = task.launches;
        exactWindow = before;
        task.afterLaunch = function () { exactWindow = after; };
        canCapture = function () { return failure !== 'permission' || task.launches === launches; };
        checkLayout = function () {
          if (failure === 'layout' && task.launches > launches) fail('stale_observation', 'Moved.');
        };
        var outcome = 'captured';
        try { exactScreenshot({}, { path: '/fixture.png' }); }
        catch (error) { outcome = error.code; }
        return [outcome, task.launches > launches, files.fileExistsAtPath('/fixture.png'),
                files.fileExistsAtPath('/fixture.png.capture.png')];
      }
      function nodeWithChild(role, child) {
        return { AXRole: role, AXChildren: { count: 1, objectAtIndex: function () { return child; } } };
      }
      function windowWith(child) { return nodeWithChild('AXWindow', child); }
      var safe = windowWith({ AXRole: 'AXButton', errors: { AXChildren: -25212 } });
      var protectedContent = windowWith({ AXRole: 'AXTextField', AXSubrole: 'AXSecureTextField' });
      var unreadable = windowWith({ AXRole: 'AXGroup', errors: { AXChildren: -25204 } });
      var unreadableLabel = windowWith({ AXRole: 'AXTextField', errors: { AXTitle: -25204 } });
      var tooMany = { AXRole: 'AXWindow', AXChildren: { count: 600, objectAtIndex: function () {
        return { AXRole: 'AXGroup' };
      } } };
      var deep = { AXRole: 'AXButton' };
      for (var depth = 0; depth <= MAX_DEPTH; depth++) deep = nodeWithChild('AXGroup', deep);
      JSON.stringify([attempt(safe, safe), attempt(unreadable, safe), attempt(protectedContent, safe),
                      attempt(safe, unreadable), attempt(safe, protectedContent),
                      attempt(unreadableLabel, safe), attempt(tooMany, safe), attempt(windowWith(deep), safe),
                      attempt(safe, safe, 'layout'), attempt(safe, safe, 'permission')]);
    `,
      {
        ObjC: {
          import() {},
          castRefToObject: (value: unknown) => value,
          unwrap: (value: unknown) => value,
        },
        $: Object.assign((path: string) => path, {
          NSTask: { alloc: { init: task } },
          NSFileManager: {
            defaultManager: {
              fileExistsAtPath: (path: string) => paths.has(path),
              moveItemAtPathToPathError: (source: string, destination: string) => {
                if (!paths.delete(source)) return false;
                paths.add(destination);
                return true;
              },
              removeItemAtPathError: (path: string) => paths.delete(path),
            },
          },
        }),
      },
    );
    expect(JSON.parse(result)).toEqual([
      ["captured", true, true, false],
      ["screenshot_failed", false, false, false],
      ["sensitive_field", false, false, false],
      ["screenshot_failed", true, false, false],
      ["sensitive_field", true, false, false],
      ["screenshot_failed", false, false, false],
      ["screenshot_failed", false, false, false],
      ["screenshot_failed", false, false, false],
      ["stale_observation", true, false, false],
      ["permission_denied", true, false, false],
    ]);
    expect(task.arguments).toEqual([
      "-x",
      "-o",
      "-t",
      "png",
      "-l",
      "73",
      "/fixture.png.capture.png",
    ]);
  });

  it("matches exact frames for duplicate titles and rechecks Retina layout, front window and overlays", () => {
    const sent = runInNewContext(
      JXA_RUNTIME +
        `
      var other = { title: "Duplicate", frame: { x: 60, y: 50, width: 200, height: 140 } };
      var approved = { title: "Duplicate", frame: { x: -800, y: 50, width: 200, height: 140 } };
      var overlays = [];
      var ours = { kCGWindowNumber: 12, kCGWindowLayer: 0, kCGWindowBounds: { X: -800, Y: 50, Width: 200, Height: 140 } };
      var app = { active: true, processIdentifier: 1 };
      var activeWindow = approved;
      var scale = 2;
      windowRows = function () { return [ours]; };
      windowsOf = function () { return [other, approved]; };
      cgWindows = function () { return overlays.concat(windowRows()); };
      axObject = function (value) { return value; };
      axBool = function () { return false; };
      axFrame = function (win) { return win.frame; };
      axStr = function (win) { return win.title; };
      axGet = function () { return activeWindow; };
      displayInfo = function () { return { display: "external", scale: scale }; };
      canPostEvents = function () { return true; };
      exactWindow = matchAX(ours, {});
      exactId = 12;
      nativeRequest = { foreground: true, native: { foreground: true, frame: approved.frame, display: "external", scale: 2 } };

      function attempt() {
        try { checkForeground(app, { x: -790, y: 65 }); return "allowed"; }
        catch (error) { return error.code; }
      }
      var results = [exactWindow === approved, attempt()];
      scale = 1;
      results.push(attempt());
      scale = 2;
      activeWindow = other;
      results.push(attempt());
      activeWindow = approved;
      overlays.push({ kCGWindowNumber: 99, kCGWindowLayer: 6, kCGWindowBounds: { X: -800, Y: 50, Width: 40, Height: 40 } });
      results.push(attempt());
      JSON.stringify(results);
    `,
      { ObjC: { import() {} }, $: { AXUIElementCreateApplication() {}, CFEqual: Object.is } },
    );
    expect(JSON.parse(sent)).toEqual([
      true,
      "allowed",
      "stale_observation",
      "focus_changed",
      "target_occluded",
    ]);
  });

  it("discards macOS snapshots if the display changes while element references are collected", () => {
    const result = runInNewContext(
      JXA_RUNTIME +
        `
      var screen;
      var frame = { x: 10, y: 20, width: 200, height: 120 };
      var app = { processIdentifier: 42 };
      exactWindow = {};
      exactId = 73;
      nativeRequest = { app: { id: 'approved' }, native: {} };
      pickWindow = function () { return exactWindow; };
      axFrame = function () { return frame; };
      matchCG = function () { return { kCGWindowNumber: exactId }; };
      windowRows = windowsOf = function () { return []; };
      axStr = function () { return 'Fixture'; };
      appInfo = function () { return { name: 'Fixture', pid: 42 }; };
      walk = function () { return { nodes: [{ depth: 0 }], truncated: false }; };
      renderNode = function () { return '1 Button'; };
      displayInfo = function () { return screen; };
      function attempt(nextScreen, afterAction) {
        screen = { display: 'external', scale: 2 };
        nodeToken = function () { screen = nextScreen; return 'button'; };
        try {
          var observed = snapshot(app, 20, undefined, afterAction);
          return [observed.display, observed.scale, observed.elements];
        } catch (error) { return error.code; }
      }
      JSON.stringify([
        attempt({ display: 'external', scale: 2 }, false),
        attempt({ display: 'internal', scale: 2 }, false),
        attempt({ display: 'external', scale: 1 }, true)
      ]);
    `,
      {
        ObjC: { import() {} },
        $: Object.assign((value: string) => value, {
          AXUIElementCreateApplication() {},
          AXUIElementSetAttributeValue() {},
        }),
      },
    );
    expect(JSON.parse(result)).toEqual([
      ["external", 2, ["button"]],
      "stale_observation",
      "stale_observation",
    ]);
  });

  it("posts foreground clicks only when the accessibility hit matches the scoped target", () => {
    const trace = runInNewContext(
      JXA_RUNTIME +
        `
      exactWindow = { name: 'approved window' };
      nativeRequest = { foreground: true };
      var button = { parent: exactWindow };
      var child = { parent: button };
      var overlay = { parent: exactWindow };
      var secret = { parent: exactWindow, sensitive: true };
      var secretChild = { parent: secret };
      var sibling = { name: 'sibling window' };
      var hit;
      var sent = [];
      var allowed = true;
      axObject = function (value) { return value; };
      axGet = function (el, name) { return name === 'AXParent' ? el.parent : undefined; };
      describe = function (el) { return el; };
      checkForeground = function () { if (!allowed) fail('focus_changed', 'Focus changed during the hit test.'); };
      mouseEvent = function (_, kind) { sent.push(kind); };
      sleep = function () {};
      $.AXUIElementCopyElementAtPosition = function (_, x, y, ref) {
        if (hit === undefined || x !== 20 || y !== 30) return -1;
        ref[0] = hit;
        return 0;
      };
      function attempt(nextHit, target) {
        hit = nextHit;
        sent = [];
        try { postClick({ processIdentifier: 42 }, { x: 20, y: 30 }, 1, false, true, target); return sent; }
        catch (error) { return [error.code, sent]; }
      }
      var result = [
        attempt(child, { el: button }),
        attempt(overlay, { el: button }),
        attempt({ parent: sibling }, null),
        attempt(secretChild, null),
        attempt(exactWindow, null),
        attempt(undefined, null)
      ];
      allowed = false;
      result.push(attempt(button, { el: button }));
      JSON.stringify(result);
    `,
      {
        ObjC: { import() {} },
        Ref: () => [],
        $: {
          AXUIElementCreateApplication() {},
          CFEqual: Object.is,
          kCGEventLeftMouseDown: "down",
          kCGEventLeftMouseUp: "up",
        },
      },
    );
    expect(JSON.parse(trace)).toEqual([
      ["down", "up"],
      ["target_occluded", []],
      ["target_occluded", []],
      ["sensitive_field", []],
      ["down", "up"],
      ["target_occluded", []],
      ["focus_changed", []],
    ]);
  });
});

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });

describe.skipIf(python.status !== 0)("Linux runtime", () => {
  function runPython(probe: string) {
    const input = LINUX_RUNTIME.slice(0, LINUX_RUNTIME.lastIndexOf("\ntry:")) + probe;
    const result = spawnSync("python3", ["-"], { input, encoding: "utf8", timeout: 8000 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  }

  it("checks X11 scroll and drag hits before input and releases an interrupted drag", () => {
    const result = runPython(`
native_request = {"native": {"foreground": True}}
source = (20, 30, "source")
destination = (100, 30, "destination")
center = lambda app, target, max_nodes: target
check_foreground = check_pointer = lambda *args: None

def attempt(op, cover_after, target="destination"):
    sent = []
    def verify(x, y, node):
        if node == target and len(sent) >= cover_after:
            raise Fail("target_occluded", "Another control covers this point.")
    globals()["check_click_hit"] = verify
    globals()["xdotool"] = lambda *args: sent.append(args)
    try:
        if op == "scroll":
            do_scroll(None, {"target": destination, "maxNodes": 20, "dx": 0, "dy": 2})
        else:
            do_drag(None, {"from": source, "to": destination, "maxNodes": 20})
        return {"sent": sent}
    except Fail as error:
        return {"code": error.code, "sent": sent}

print(json.dumps([
    attempt("scroll", 100), attempt("scroll", 0), attempt("scroll", 2),
    attempt("drag", 0), attempt("drag", 1, "source"), attempt("drag", 6), attempt("drag", 100)
]))
`);
    const partial = [
      ["mousemove", 20, 30],
      ["mousedown", 1],
      ...[30, 40, 50, 60, 70, 80, 90].map((x) => ["mousemove", x, 30]),
    ];
    expect(result).toEqual([
      {
        sent: [
          ["mousemove", 100, 30],
          ["click", "4"],
          ["click", "4"],
        ],
      },
      { code: "target_occluded", sent: [] },
      {
        code: "target_occluded",
        sent: [
          ["mousemove", 100, 30],
          ["click", "4"],
        ],
      },
      { code: "target_occluded", sent: [] },
      { code: "target_occluded", sent: [["mousemove", 20, 30]] },
      { code: "target_occluded", sent: [...partial, ["mouseup", 1]] },
      { sent: [...partial, ["mousemove", 100, 30], ["mouseup", 1]] },
    ]);
  });

  it.each([
    ["absent", "No ScreenCast or RemoteDesktop portal was detected"],
    ["cold", "Advertised portals: ScreenCast, RemoteDesktop"],
    ["owned", "Advertised portals: ScreenCast, RemoteDesktop"],
    ["similar interfaces", "Advertised portals: RemoteDesktop"],
    ["non-node root", "No ScreenCast or RemoteDesktop portal was detected"],
    ["timeout", "No ScreenCast or RemoteDesktop portal was detected"],
  ])("reports Wayland capabilities for portal state %s", (state, details) => {
    const result = runPython(`
import types
os.environ["DISPLAY"] = ":42"
os.environ["WAYLAND_DISPLAY"] = "wayland-fixture"
Atspi = types.SimpleNamespace(get_desktop=lambda index: types.SimpleNamespace(get_child_count=lambda: 2))
state = ${JSON.stringify(state)}
calls = []
shutil.which = lambda command: command

def run_dbus(args, **options):
    calls.append([args, options])
    if "org.freedesktop.DBus.NameHasOwner" in args:
        return subprocess.CompletedProcess(args, 0, "(true,)" if state == "owned" else "(false,)")
    if state == "timeout":
        raise subprocess.TimeoutExpired(args, options["timeout"])
    if state == "absent":
        if options.get("check"):
            raise subprocess.CalledProcessError(1, args)
        return subprocess.CompletedProcess(args, 1, "")
    if state == "similar interfaces":
        xml = '''<node>
            <interface name="org.freedesktop.portal.ScreenCastExtra"/>
            <node name="child"><interface name="org.freedesktop.portal.ScreenCast"/></node>
            <interface name="org.freedesktop.portal.RemoteDesktop"/>
        </node>'''
    elif state == "non-node root":
        xml = '<other><interface name="org.freedesktop.portal.ScreenCast"/></other>'
    else:
        xml = '''<node>
            <interface name="org.freedesktop.portal.ScreenCast"/>
            <interface name="org.freedesktop.portal.RemoteDesktop"/>
        </node>'''
    return subprocess.CompletedProcess(args, 0, xml)

subprocess.run = run_dbus
print(json.dumps({"permissions": permissions(), "calls": calls}))
`);
    expect(result.permissions).toMatchObject({
      screenRecording: "unknown",
      capabilities: {
        session: "wayland",
        accessibilityActions: true,
        windowCapture: false,
        foregroundInput: false,
        details: expect.stringContaining(`${details}.`),
      },
    });
    expect(result.calls).toEqual([
      [
        [
          "gdbus",
          "introspect",
          "--session",
          "--dest",
          "org.freedesktop.portal.Desktop",
          "--object-path",
          "/org/freedesktop/portal/desktop",
          "--xml",
        ],
        { capture_output: true, check: true, text: true, timeout: 1 },
      ],
    ]);
  });

  it("explains unavailable Wayland physical input before looking for an X11 target", () => {
    expect(
      runPython(`
os.environ["DISPLAY"] = ":42"
os.environ["WAYLAND_DISPLAY"] = "wayland-fixture"
native_request = {"native": {"foreground": True}, "foreground": True}
def get_x11():
    raise AssertionError("Physical input checked the X11 server in a Wayland session.")
try:
    check_foreground(None)
except Fail as failure:
    print(json.dumps({"code": failure.code, "message": str(failure)}))
`),
    ).toEqual({
      code: "unsupported_capability",
      message:
        "Physical input is unavailable in this Wayland session. Use accessibility actions on the selected window.",
    });
  });

  it("requires a fresh X11 observation when the monitor layout changes at fixed window geometry", () => {
    expect(
      runPython(`
import types
Atspi = types.SimpleNamespace(StateType=types.SimpleNamespace(DEFUNCT=1))
native_window = object()
window_identity = lambda *_: "target"
has_state = lambda *_: False
frame_of = lambda _: {"x": 20, "y": 30, "width": 200, "height": 100}
xid = 42
layout = [(11, 1, 0, 0, 1200, 800, 300, 200, [9])]
x11_window = lambda *_: xid
get_x11 = lambda: types.SimpleNamespace(monitor_layout=lambda: layout)
native_request = {"app": {"id": "target"}, "native": {"frame": frame_of(native_window)}}
native_request["native"]["display"] = x11_display_ref(None, native_window)

def attempt(reobserve=False):
    try:
        check_layout(None, reobserve)
        return "allowed"
    except Fail as failure:
        return failure.code

results = [attempt()]
layout[0] = (11, 1, 0, 0, 1200, 800, 600, 400, [9])
results += [attempt(), attempt(True)]
native_request["native"]["display"] = x11_display_ref(None, native_window)
results.append(attempt())
layout = []
results.append(attempt())
native_request["native"]["display"] = str(xid)
results.append(attempt())
xid = 43
results.append(attempt())
print(json.dumps(results))
`),
    ).toEqual([
      "allowed",
      "stale_observation",
      "allowed",
      "allowed",
      "stale_observation",
      "allowed",
      "stale_observation",
    ]);
  });

  it("discards X11 snapshots if the display changes while element references are collected", () => {
    expect(
      runPython(`
frame = {"x": 10, "y": 20, "width": 200, "height": 120}
native_xid = 42
native_request = {"app": {"id": "approved"}, "native": {}}
pick_window = lambda app: object()
app_info = lambda app: {"name": "Fixture", "pid": 73}
name_of = lambda win: "Fixture"
walk = lambda win, max_nodes: ([{"depth": 0, "focused": False}], False)
render = lambda *_: "1 Button"
check_layout = lambda *_: frame

def attempt(next_display, after_action):
    display = "original"
    def token(node):
        nonlocal display
        display = next_display
        return "button"
    globals()["x11_display_ref"] = lambda *_: display
    globals()["node_token"] = token
    try:
        result = snapshot(None, 20, after_action=after_action)
        return [result["display"], result["elements"]]
    except Fail as failure:
        return failure.code

print(json.dumps([attempt("original", False), attempt("changed", False), attempt("changed", True)]))
`),
    ).toEqual([["original", ["button"]], "stale_observation", "stale_observation"]);
  });

  it("rejects X11 actions when the active window, overlay or pointer changes", () => {
    expect(
      runPython(`
import types
native_request = {"foreground": True, "native": {"foreground": True}}
native_window = object()
native_xid = 42
active, hit, pointer = [42], 21, True
Atspi = types.SimpleNamespace(StateType=types.SimpleNamespace(ACTIVE=True))
check_layout = lambda _: {"x": 10, "y": 20, "width": 200, "height": 100}
has_state = lambda node, state: True
shutil.which = lambda _: "/mock/xdotool"
get_x11 = lambda: types.SimpleNamespace(root=1, property32=lambda *args: active,
    translate=lambda *args: (25, 30, hit), window_anchor=lambda *args: 21,
    pointer_at=lambda *args: pointer)

def attempt():
    try:
        check_foreground(None, 25, 30)
        check_pointer(25, 30)
        return "allowed"
    except Fail as failure:
        return failure.code

results = [attempt()]
active = [11]
results.append(attempt())
active, hit = [42], 36
results.append(attempt())
hit, pointer = 21, False
results.append(attempt())
print(json.dumps(results))
`),
    ).toEqual(["allowed", "focus_changed", "target_occluded", "focus_changed"]);
  });

  it("blocks X11 clicks when the selected control is covered in the same window", () => {
    expect(
      runPython(`
import types

class Accessible:
    def __init__(self, parent=None, secure=False, actionable=False):
        self.parent = parent
        self.secure = secure
        self.actionable = actionable
        self.showing = True
        self.child_at_point = None
        self.children = []
        if parent is not None:
            parent.children.append(self)
    def get_parent(self):
        return self.parent
    def get_component_iface(self):
        return self
    def get_action_iface(self):
        return self

native_window = Accessible()
button = Accessible(native_window, actionable=True)
label = Accessible(button)
button.child_at_point = label
cover = Accessible(native_window, actionable=True)
other_window = Accessible()
other_button = Accessible(other_window)
protected_field = Accessible(native_window, secure=True)
protected_child = Accessible(protected_field)
protected_field.child_at_point = protected_child
Atspi = types.SimpleNamespace(
    Component=types.SimpleNamespace(get_accessible_at_point=lambda el, x, y, _: el.child_at_point),
    Action=types.SimpleNamespace(get_n_actions=lambda el: int(el.actionable)),
    CoordType=types.SimpleNamespace(SCREEN=0),
    StateType=types.SimpleNamespace(SHOWING=0),
)
children = lambda el: list(el.children)
has_state = lambda el, _: el.showing
frame_of = lambda el: {"x": 20, "y": 20, "width": 20, "height": 20}
is_secure = lambda el: el.secure
check_foreground = lambda *args: None
check_pointer = lambda *args: None

def attempt(hit, selectable, cover_visible=False, cover_after_move=False):
    sent = []
    native_window.child_at_point = hit
    button.showing = hit is not None
    cover.showing = cover_visible
    protected_field.showing = hit is protected_field
    def send(*args):
        sent.append(args[0])
        if args[0] == "mousemove" and cover_after_move:
            cover.showing = True
    globals()["xdotool"] = send
    try:
        click_pointer(None, 25, 30, "1", 1, verify_hit=True, node={"el": button} if selectable else None)
        return sent
    except Fail as failure:
        return [failure.code, sent]

print(json.dumps([
    attempt(button, True),
    attempt(cover, True, cover_visible=True),
    attempt(button, True, cover_visible=True),
    attempt(other_button, False),
    attempt(protected_field, False),
    attempt(button, True, cover_after_move=True),
    attempt(None, True),
    attempt(None, False),
]))
`),
    ).toEqual([
      ["mousemove", "click"],
      ["target_occluded", []],
      ["target_occluded", []],
      ["target_occluded", []],
      ["sensitive_field", []],
      ["target_occluded", ["mousemove"]],
      ["target_occluded", []],
      ["mousemove", "click"],
    ]);
  });

  it("reveals an exact X11 client and hands unsupported activation to the window switcher", () => {
    expect(
      runPython(`
import types
Atspi = object()
native_xid = 42
request = {"op": "focusApp", "app": {"kind": "window", "id": "alpha"}}
active, mapped, session = 42, 42, "x11"
sent = []
resolve_exact = lambda req: "selected"
reject_blocked = lambda app: None
check_layout = lambda app: None
app_info = lambda app: {"name": "fixture"}
session_type = lambda: session
x11_window = lambda *args: mapped
xdotool = lambda *args: sent.append(args)
get_x11 = lambda: types.SimpleNamespace(root=1, property32=lambda *args: [active])
def attempt():
    try:
        return run(request)["ok"]
    except Fail as failure:
        return failure.code
results = [attempt()]
active = 43
results.append(attempt())
mapped = 43
results.append(attempt())
mapped, session = 42, "wayland"
results.append(attempt())
print(json.dumps([results, sent]))
`),
    ).toEqual([
      [true, "focus_changed", "unsupported_capability", "unsupported_capability"],
      [
        ["windowactivate", 42],
        ["windowactivate", 42],
      ],
    ]);
  });

  it("publishes an X11 capture only while the frame belongs to the exact client", () => {
    expect(
      runPython(`
import types
from pathlib import Path
from tempfile import TemporaryDirectory
native_request = {"app": {"kind": "window", "id": "fixture"}}
native_xid = 42
client = {"x": 81, "y": 150, "width": 320, "height": 160}
decorated = {"x": 80, "y": 130, "width": 322, "height": 185}
frame = client
clients = [42, 43]
anchors = {42: 21, 43: 22}
captured = []
share_during_capture = False

def capture(xid, bounds):
    captured.append([xid, bounds])
    if share_during_capture:
        anchors[43] = 21
    return b"scoped-png"

check_layout = lambda app: frame
check_capture_protections = lambda window: None
get_x11 = lambda: types.SimpleNamespace(root=1,
    frame=lambda xid: {42: client, 21: decorated}.get(xid),
    property32=lambda *args: clients, window_anchor=anchors.get,
    capture=capture)

def attempt():
    with TemporaryDirectory() as directory:
        path = Path(directory) / "fixture.png"
        try:
            outcome = do_screenshot(None, {"path": path})["delivery"]
        except Fail as failure:
            outcome = failure.code
        return [outcome, path.read_text() if path.exists() else None]

results = [attempt()]
frame = decorated
results.append(attempt())
anchors[43] = 21
results.append(attempt())
anchors[43] = 22
frame = dict(decorated, width=323)
results.append(attempt())
frame = decorated
share_during_capture = True
results.append(attempt())
print(json.dumps([results, captured]))
`),
    ).toEqual([
      [
        ["background", "scoped-png"],
        ["background", "scoped-png"],
        ["screenshot_failed", null],
        ["screenshot_failed", null],
        ["stale_observation", null],
      ],
      [
        [42, { x: 81, y: 150, width: 320, height: 160 }],
        [21, { x: 80, y: 130, width: 322, height: 185 }],
        [21, { x: 80, y: 130, width: 322, height: 185 }],
      ],
    ]);
  });

  it("withholds X11 capture when either protection scan cannot finish", () => {
    const result = runPython(`
import types
from pathlib import Path
from tempfile import TemporaryDirectory

Atspi = types.SimpleNamespace(
    Role=types.SimpleNamespace(INVALID="invalid", UNKNOWN="unknown", PASSWORD_TEXT="password text"),
    StateType=types.SimpleNamespace(DEFUNCT="defunct", ENABLED="enabled", SENSITIVE="sensitive",
        FOCUSED="focused", SELECTED="selected"))

class Accessible:
    def __init__(self, role="panel", children=(), broken=None, description=""):
        self.role = role
        self.children = children
        self.broken = broken
        self.description = description
        self.cache_clears = 0

    def clear_cache(self):
        self.cache_clears += 1
        self.cached_children = self.children

    def get_state_set(self):
        return types.SimpleNamespace(contains=lambda state: self.broken == state)

    def get_role(self):
        if self.broken == "role":
            raise RuntimeError("role lookup failed")
        return self.role

    def get_role_name(self):
        return self.role

    def get_name(self):
        return ""

    def get_text_iface(self):
        return None

    def get_description(self):
        if self.broken == "description":
            return None
        return self.description

    def get_child_count(self):
        if self.broken == "count":
            raise RuntimeError("child count failed")
        children = self.cached_children if self.cache_clears else self.children
        return -1 if self.broken == "negative count" else len(children)

    def get_child_at_index(self, index):
        if self.broken == "child":
            raise RuntimeError("child lookup failed")
        return (self.cached_children if self.cache_clears else self.children)[index]

native_request = {"app": {"kind": "window", "id": "fixture"}}
native_xid = 42
frame = {"x": 80, "y": 130, "width": 320, "height": 160}
check_layout = lambda app: frame

def attempt(before, after):
    global native_window, get_x11
    native_window = Accessible("frame", (before,))
    captured = []
    def capture(*args):
        captured.append(True)
        native_window.children = (after,)
        return b"scoped-png"
    get_x11 = lambda: types.SimpleNamespace(frame=lambda xid: frame, capture=capture)
    with TemporaryDirectory() as directory:
        path = Path(directory) / "fixture.png"
        try:
            outcome = do_screenshot(None, {"path": path})["delivery"]
        except Fail as failure:
            outcome = failure.code
        return [outcome, path.exists(), len(captured), native_window.cache_clears]

clear = Accessible()
deep = clear
for _ in range(MAX_DEPTH + 1):
    deep = Accessible(children=(deep,))
uninspectable = [
    Accessible(broken="count"), Accessible(broken="negative count"),
    Accessible(children=(None,)), Accessible(children=(clear,), broken="child"),
    Accessible(broken="defunct"), Accessible(broken="role"), Accessible("unknown"),
    Accessible("entry", broken="description"), Accessible(children=(clear,) * 600), deep,
]
protected = [Accessible("password text"), Accessible("entry", description="Password")]
print(json.dumps([
    attempt(clear, clear),
    [[attempt(node, clear), attempt(clear, node)] for node in uninspectable],
    [[attempt(node, clear), attempt(clear, node)] for node in protected],
]))
`);
    expect(result).toEqual([
      ["background", true, 1, 2],
      Array.from({ length: 10 }, () => [
        ["screenshot_failed", false, 0, 1],
        ["screenshot_failed", false, 1, 2],
      ]),
      Array.from({ length: 2 }, () => [
        ["sensitive_field", false, 0, 1],
        ["sensitive_field", false, 1, 2],
      ]),
    ]);
  });

  it("verifies a Linux insertion only by bounded, exact text readback at the caret", () => {
    expect(
      runPython(`
import types

class Field:
    def __init__(self, value, caret, effect, read_error):
        self.value = value
        self.caret = caret
        self.effect = effect
        self.read_error = read_error
        self.writes = []

    def get_text_iface(self):
        return self

    def get_editable_text_iface(self):
        return self

    def insert(self, offset, text, length):
        self.writes.append([offset, length])
        self.value = self.effect(self.value, offset, text)
        return True

def get_text(field, start, end):
    assert end <= 500
    if field.read_error == ("after" if field.writes else "before"):
        raise RuntimeError("text read failed")
    value = field.value[start:end]
    if field.read_error == "changed during read" and field.writes:
        field.value += "!"
    return value

Atspi = types.SimpleNamespace(
    Text=types.SimpleNamespace(get_character_count=lambda field: len(field.value),
        get_caret_offset=lambda field: field.caret, get_text=get_text),
    EditableText=types.SimpleNamespace(insert_text=Field.insert))

def insert(value, offset, text):
    return value[:offset] + text + value[offset:]

def attempt(value, caret, text, effect=insert, read_error=None):
    field = Field(value, caret, effect, read_error)
    globals()["node_at"] = lambda *args: {"el": field, "secure": False, "enabled": True}
    reply = do_type(None, {"text": text, "elementIndex": 1, "maxNodes": 20})
    return [reply["verification"]["state"], field.writes]

print(json.dumps([
    attempt("aβc", 2, "é🙂"),
    attempt("aβc", -1, "!"),
    attempt("has text", 0, "text", lambda value, *_: value),
    attempt("has text", 0, "text", lambda value, *_: value + "!"),
    attempt("abc", 0, "!", lambda value, *_: value + "!"),
    attempt("abc", 1, "!", read_error="before"),
    attempt("abc", 1, "!", read_error="after"),
    attempt("abc", 1, "!", read_error="changed during read"),
    attempt("a" * 499, 499, "!"),
    attempt("a" * 500, 0, "!"),
    attempt("a" * 501, 0, "!"),
]))
`),
    ).toEqual([
      ["verified", [[2, 6]]],
      ["verified", [[3, 1]]],
      ["unverified", [[0, 4]]],
      ["unverified", [[0, 4]]],
      ["unverified", [[0, 1]]],
      ["unverified", [[1, 1]]],
      ["unverified", [[1, 1]]],
      ["unverified", [[1, 1]]],
      ["verified", [[499, 1]]],
      ["unverified", [[0, 1]]],
      ["unverified", [[0, 1]]],
    ]);
  });
});

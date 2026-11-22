import { BLOCKED_APP_FRAGMENTS, SENSITIVE_LABEL_SOURCE, SENSITIVE_SUBROLE } from "./sensitive.ts";

/**
 * The macOS runtime: JavaScript for Automation, run with `osascript -l JavaScript -` so Tabs needs
 * no compiled helper. Orca ships a signed Swift helper for this; JXA reaches the same
 * accessibility (AXUIElement) and CoreGraphics event APIs through the ObjC bridge. Each call
 * starts a fresh process, so element indexes are re-derived by walking the window the same way
 * the snapshot did. Every result is one JSON line: `{ok:true,...}` or `{ok:false,code,message}`.
 *
 * Keep this source free of backticks and dollar-brace sequences; it lives in a template literal.
 */
export const JXA_RUNTIME = String.raw`
ObjC.import('ApplicationServices');
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

var SENSITIVE_SUBROLE = ${JSON.stringify(SENSITIVE_SUBROLE)};
var SENSITIVE_RE = new RegExp(${JSON.stringify(SENSITIVE_LABEL_SOURCE)}, 'i');
var BLOCKED_APPS = ${JSON.stringify(BLOCKED_APP_FRAGMENTS)};
var EDITABLE_ROLES = { AXTextField: 1, AXTextArea: 1, AXComboBox: 1, AXSearchField: 1 };
var TRANSPARENT_ROLES = { AXGroup: 1, AXUnknown: 1, AXScrollArea: 1, AXSplitGroup: 1, AXLayoutArea: 1, AXLayoutItem: 1 };
var VALUE_ROLES = { AXTextField: 1, AXTextArea: 1, AXComboBox: 1, AXSearchField: 1, AXCheckBox: 1, AXRadioButton: 1, AXSlider: 1, AXPopUpButton: 1, AXSwitch: 1, AXProgressIndicator: 1, AXIncrementor: 1, AXStepper: 1 };
var MAX_DEPTH = 40;

function fail(code, message) { throw { fail: true, code: code, message: message }; }
function sleep(seconds) { $.NSThread.sleepForTimeInterval(seconds); }

function axGet(el, name) {
  var ref = Ref();
  var err = $.AXUIElementCopyAttributeValue(el, $(name), ref);
  return err === 0 ? ref[0] : undefined;
}
function axStr(el, name) {
  var v = axGet(el, name);
  if (v === undefined) return '';
  var u = ObjC.unwrap(v);
  if (typeof u === 'string') return u;
  if (typeof u === 'number' || typeof u === 'boolean') return String(u);
  return '';
}
function axBool(el, name) {
  var v = axGet(el, name);
  if (v === undefined) return undefined;
  return !!ObjC.unwrap(v);
}
function axChildren(el) {
  var v = axGet(el, 'AXChildren');
  if (v === undefined) return [];
  var out = [];
  var n = v.count;
  for (var i = 0; i < n; i++) out.push(v.objectAtIndex(i));
  return out;
}
function axPair(v, a, b) {
  if (v === undefined) return null;
  var d = String(ObjC.unwrap(v.description));
  var m = new RegExp(a + ':(-?[0-9.]+)[ ]+' + b + ':(-?[0-9.]+)').exec(d);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}
function axFrame(el) {
  var pos = axPair(axGet(el, 'AXPosition'), 'x', 'y');
  var size = axPair(axGet(el, 'AXSize'), 'w', 'h');
  if (!pos || !size) return null;
  return { x: pos[0], y: pos[1], width: size[0], height: size[1] };
}
function clip(text, max) {
  var flat = String(text).replace(/[\r\n\t]+/g, ' ');
  return flat.length > max ? flat.slice(0, max) + '...' : flat;
}

function runningApps() {
  var list = $.NSWorkspace.sharedWorkspace.runningApplications;
  var out = [];
  for (var i = 0; i < list.count; i++) out.push(list.objectAtIndex(i));
  return out;
}
function appInfo(app) {
  return {
    name: ObjC.unwrap(app.localizedName) || '',
    bundleId: ObjC.unwrap(app.bundleIdentifier) || null,
    pid: Number(app.processIdentifier)
  };
}
function resolveApp(sel) {
  var apps = runningApps().filter(function (a) { return Number(a.activationPolicy) !== 2; });
  if (sel.kind === 'pid') {
    var byPid = apps.filter(function (a) { return Number(a.processIdentifier) === sel.pid; });
    if (byPid.length) return byPid[0];
    fail('app_not_found', 'No running app has pid ' + sel.pid + '. Call computer_list_apps.');
  }
  var q = sel.query.toLowerCase();
  var exact = apps.filter(function (a) {
    var i = appInfo(a);
    return (i.bundleId || '').toLowerCase() === q || i.name.toLowerCase() === q;
  });
  if (exact.length === 1) return exact[0];
  var partial = exact.length ? exact : apps.filter(function (a) {
    var i = appInfo(a);
    return i.name.toLowerCase().indexOf(q) >= 0 || (i.bundleId || '').toLowerCase().indexOf(q) >= 0;
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    fail('app_not_found', 'App "' + sel.query + '" is ambiguous: ' + partial.slice(0, 6).map(function (a) { var i = appInfo(a); return i.name + ' (' + i.bundleId + ')'; }).join(', ') + '. Use a bundle id or pid:N.');
  }
  fail('app_not_found', 'No running app matches "' + sel.query + '". Call computer_list_apps.');
}

function rejectBlocked(app) {
  var i = appInfo(app);
  var hay = (i.name + ' ' + (i.bundleId || '')).toLowerCase();
  for (var b = 0; b < BLOCKED_APPS.length; b++) if (hay.indexOf(BLOCKED_APPS[b]) >= 0) fail('app_blocked', i.name + ' is a password manager and is off limits to computer use.');
}
function requireTrusted() {
  if (!$.AXIsProcessTrusted()) {
    fail('permission_denied', 'Accessibility permission is not granted. Open System Settings > Privacy & Security > Accessibility and enable Tabs, then retry.');
  }
}

function windowsOf(appEl) {
  var v = axGet(appEl, 'AXWindows');
  var out = [];
  if (v !== undefined) for (var i = 0; i < v.count; i++) out.push(v.objectAtIndex(i));
  return out;
}
function pickWindow(appEl) {
  var w = axGet(appEl, 'AXFocusedWindow');
  if (w === undefined) w = axGet(appEl, 'AXMainWindow');
  if (w !== undefined) return w;
  var all = windowsOf(appEl);
  if (all.length) return all[0];
  fail('window_not_found', 'The app has no accessible window. Ask the user to open or show one.');
}

function isSensitive(node) {
  if (node.subrole === SENSITIVE_SUBROLE) return true;
  if (!EDITABLE_ROLES[node.role]) return false;
  var labels = [node.title, node.desc, node.placeholder];
  for (var i = 0; i < labels.length; i++) if (labels[i] && SENSITIVE_RE.test(labels[i])) return true;
  return false;
}
function describe(el) {
  var node = {
    el: el,
    role: axStr(el, 'AXRole'),
    subrole: axStr(el, 'AXSubrole'),
    title: axStr(el, 'AXTitle'),
    desc: axStr(el, 'AXDescription'),
    placeholder: axStr(el, 'AXPlaceholderValue')
  };
  node.sensitive = isSensitive(node);
  return node;
}

// Walks the window depth-first. Index N is nodes[N - 1], the same order a snapshot prints.
function walk(win, maxNodes) {
  var nodes = [];
  var state = { truncated: false };
  function visit(el, depth) {
    if (depth > MAX_DEPTH) { state.truncated = true; return; }
    var node = describe(el);
    var isStatic = node.role === 'AXStaticText';
    node.text = isStatic || VALUE_ROLES[node.role] ? (node.sensitive ? '' : axStr(el, 'AXValue')) : '';
    var label = node.title || node.desc || (isStatic ? node.text : '');
    var transparent = TRANSPARENT_ROLES[node.role] && !label && !node.sensitive;
    var childDepth = depth;
    if (!transparent) {
      if (nodes.length >= maxNodes) { state.truncated = true; return; }
      node.depth = depth;
      node.enabled = axBool(el, 'AXEnabled');
      node.focused = axBool(el, 'AXFocused') === true;
      node.selected = axBool(el, 'AXSelected') === true;
      nodes.push(node);
      childDepth = depth + 1;
    }
    var kids = axChildren(el);
    for (var i = 0; i < kids.length; i++) visit(kids[i], childDepth);
  }
  visit(win, 0);
  return { nodes: nodes, truncated: state.truncated };
}

function renderNode(node, index, baseDepth) {
  var role = node.role.replace(/^AX/, '') || 'Unknown';
  if (node.subrole) role += '/' + node.subrole.replace(/^AX/, '');
  var parts = [new Array(node.depth - baseDepth + 1).join('\t') + index, role];
  var label = node.title || node.desc;
  if (label) parts.push('"' + clip(label, 100) + '"');
  if (node.role === 'AXStaticText' && !label && node.text) parts.push('"' + clip(node.text, 160) + '"');
  else if (node.sensitive) parts.push('(secure)');
  else if (node.text && VALUE_ROLES[node.role]) parts.push('value=' + JSON.stringify(clip(node.text, 100)));
  if (node.enabled === false) parts.push('(disabled)');
  if (node.focused) parts.push('(focused)');
  if (node.selected) parts.push('(selected)');
  return parts.join(' ');
}

function snapshot(app, maxNodes, rootIndex) {
  var pid = Number(app.processIdentifier);
  var appEl = $.AXUIElementCreateApplication(pid);
  // Chromium and Electron only build their accessibility tree when asked.
  $.AXUIElementSetAttributeValue(appEl, $('AXManualAccessibility'), $.kCFBooleanTrue);
  var win = pickWindow(appEl);
  var frame = axFrame(win) || { x: 0, y: 0, width: 0, height: 0 };
  var walked = walk(win, maxNodes);
  var nodes = walked.nodes;
  var from = 0;
  var to = nodes.length;
  if (rootIndex !== undefined) {
    if (rootIndex < 1 || rootIndex > nodes.length) fail('element_not_found', 'Element ' + rootIndex + ' is not in the current window. Take a fresh snapshot.');
    from = rootIndex - 1;
    to = from + 1;
    while (to < nodes.length && nodes[to].depth > nodes[from].depth) to++;
  }
  var lines = [];
  var focused = null;
  for (var i = from; i < to; i++) {
    lines.push(renderNode(nodes[i], i + 1, nodes[from].depth));
    if (nodes[i].focused) focused = i + 1;
  }
  var info = appInfo(app);
  var title = axStr(win, 'AXTitle');
  var windows = windowsOf(appEl);
  var windowIndex = 0;
  for (var w = 0; w < windows.length; w++) if (axStr(windows[w], 'AXTitle') === title && axFrame(windows[w]) && axFrame(windows[w]).x === frame.x) { windowIndex = w; break; }
  var header = [
    'App: ' + info.name + ' (' + (info.bundleId || 'no bundle id') + ', pid ' + info.pid + ')',
    'Window: ' + JSON.stringify(clip(title, 120)) + ' at (' + Math.round(frame.x) + ', ' + Math.round(frame.y) + ') size ' + Math.round(frame.width) + 'x' + Math.round(frame.height) + ' points; click coordinates are window-local.'
  ];
  var footer = [(to - from) + ' elements' + (walked.truncated ? ' (snapshot limit reached: pass rootElementIndex to read a subtree, or raise maxNodes)' : '') + '.'];
  return {
    id: pid + ':' + Date.now(),
    app: info,
    window: { title: title, key: 'index:' + windowIndex, frame: frame },
    treeText: header.join('\n') + '\n\n' + lines.join('\n') + '\n\n' + footer.join('\n'),
    elementCount: to - from,
    focusedElementIndex: focused,
    truncated: walked.truncated
  };
}

function nodeAt(app, index, maxNodes) {
  var appEl = $.AXUIElementCreateApplication(Number(app.processIdentifier));
  $.AXUIElementSetAttributeValue(appEl, $('AXManualAccessibility'), $.kCFBooleanTrue);
  var win = pickWindow(appEl);
  var walked = walk(win, Math.max(maxNodes, index));
  if (index < 1 || index > walked.nodes.length) fail('element_not_found', 'Element ' + index + ' is not in the current window. Take a fresh snapshot.');
  return { node: walked.nodes[index - 1], win: win, appEl: appEl };
}

function focusedNode(appEl) {
  var el = axGet(appEl, 'AXFocusedUIElement');
  if (el === undefined) return null;
  var node = describe(el);
  return node;
}

function activate(app) {
  if (app.hidden) app.unhide();
  app.activateWithOptions(2);
  sleep(0.2);
}
// Background delivery: events go straight to the target process, so the app is not raised and the
// real pointer does not move. Foreground delivery posts to the HID tap after raising the app.
function post(app, ev, foreground) {
  if (foreground) $.CGEventPost($.kCGHIDEventTap, ev);
  else $.CGEventPostToPid(Number(app.processIdentifier), ev);
}
function mouseEvent(app, kind, point, button, clickState, foreground) {
  var ev = $.CGEventCreateMouseEvent(null, kind, point, button);
  $.CGEventSetIntegerValueField(ev, $.kCGMouseEventClickState, clickState);
  post(app, ev, foreground);
}
function postClick(app, point, count, right, foreground) {
  var down = right ? $.kCGEventRightMouseDown : $.kCGEventLeftMouseDown;
  var up = right ? $.kCGEventRightMouseUp : $.kCGEventLeftMouseUp;
  var button = right ? $.kCGMouseButtonRight : $.kCGMouseButtonLeft;
  for (var i = 1; i <= count; i++) {
    mouseEvent(app, down, point, button, i, foreground);
    mouseEvent(app, up, point, button, i, foreground);
    sleep(0.05);
  }
}
function targetPoint(app, target, req) {
  var appEl = $.AXUIElementCreateApplication(Number(app.processIdentifier));
  var win = pickWindow(appEl);
  if (target.kind === 'point') {
    var wf = axFrame(win);
    if (!wf) fail('window_not_found', 'Could not read the window frame.');
    return { point: $.CGPointMake(wf.x + target.x, wf.y + target.y), node: null };
  }
  var found = nodeAt(app, target.index, req.maxNodes);
  var f = axFrame(found.node.el);
  if (!f || f.width <= 0 || f.height <= 0) fail('element_not_clickable', 'Element ' + target.index + ' has no on-screen frame.');
  return { point: $.CGPointMake(f.x + f.width / 2, f.y + f.height / 2), node: found.node };
}
function actionNames(el) {
  var ref = Ref();
  if ($.AXUIElementCopyActionNames(el, ref) !== 0) return [];
  var list = ref[0];
  var out = [];
  for (var i = 0; i < list.count; i++) out.push(ObjC.unwrap(list.objectAtIndex(i)));
  return out;
}
function describeFor(node, index) { return renderNode(node, index, node.depth); }

function doClick(app, req) {
  requireTrusted();
  var right = req.button === 'right';
  if (req.target.kind === 'element') {
    var found = nodeAt(app, req.target.index, req.maxNodes);
    var node = found.node;
    if (node.enabled === false) fail('element_not_enabled', 'Element ' + req.target.index + ' is disabled. Nothing was sent.');
    if (!req.foreground) {
      if (right) {
        if ($.AXUIElementPerformAction(node.el, $('AXShowMenu')) === 0) {
          return { path: 'accessibility', delivery: 'background', detail: 'opened the context menu of ' + describeFor(node, req.target.index) };
        }
      } else if (EDITABLE_ROLES[node.role] && req.clickCount === 1) {
        $.AXUIElementSetAttributeValue(node.el, $('AXFocused'), $.kCFBooleanTrue);
        return { path: 'accessibility', delivery: 'background', detail: 'focused ' + describeFor(node, req.target.index) };
      } else if (req.clickCount === 1 && $.AXUIElementPerformAction(node.el, $('AXPress')) === 0) {
        return { path: 'accessibility', delivery: 'background', detail: 'pressed ' + describeFor(node, req.target.index) };
      }
    }
  }
  var t = targetPoint(app, req.target, req);
  if (req.foreground) activate(app);
  postClick(app, t.point, req.clickCount, right, req.foreground);
  return {
    path: 'synthetic',
    delivery: req.foreground ? 'foreground' : 'background',
    detail: (right ? 'right-clicked' : 'clicked') + ' with a synthetic mouse event' + (req.foreground ? '; the app was raised' : ' sent to the app without raising it'),
    fallbackReason: req.target.kind === 'element' ? 'element has no matching accessibility action' : undefined
  };
}

function readBack(node) { return axStr(node.el, 'AXValue'); }
function insertText(node, text) {
  $.AXUIElementSetAttributeValue(node.el, $('AXFocused'), $.kCFBooleanTrue);
  var before = readBack(node);
  if ($.AXUIElementSetAttributeValue(node.el, $('AXSelectedText'), $(text)) === 0) {
    var after = readBack(node);
    if (after !== before || text === '') return { how: 'selection', verified: after.indexOf(text) >= 0 };
  }
  if ($.AXUIElementSetAttributeValue(node.el, $('AXValue'), $(before + text)) === 0) {
    return { how: 'value', verified: readBack(node) === before + text };
  }
  return null;
}
function verification(verified) {
  return verified ? { state: 'verified', detail: 'the field now holds the text' } : { state: 'unverified', detail: 'the write succeeded but the field did not read back the expected text; check the tree' };
}
function doType(app, req) {
  requireTrusted();
  var appEl = $.AXUIElementCreateApplication(Number(app.processIdentifier));
  var node;
  if (req.elementIndex !== undefined) node = nodeAt(app, req.elementIndex, req.maxNodes).node;
  else node = focusedNode(appEl);
  if (!node) fail('element_not_found', 'No text field has focus in that app. Click a field first, or pass elementIndex.');
  if (node.sensitive) fail('sensitive_field', 'Refusing to type into a password or other secret field. Ask the user to enter it themselves.');
  if (node.enabled === false) fail('element_not_enabled', 'That field is disabled.');
  var done = insertText(node, req.text);
  if (done) return { path: 'accessibility', delivery: 'background', detail: 'inserted text via ' + done.how, verification: verification(done.verified) };
  if (req.elementIndex !== undefined) fail('value_not_settable', 'That element does not accept text through accessibility. Click it, then call computer_type without elementIndex.');
  activate(app);
  // Re-check right before sending keys: focus may have moved while the app came forward.
  var again = focusedNode(appEl);
  if (!again || again.sensitive) fail('sensitive_field', 'Refusing to type into a password or other secret field. Ask the user to enter it themselves.');
  Application('System Events').keystroke(req.text);
  return { path: 'synthetic', delivery: 'foreground', detail: 'typed with the keyboard; the app was raised', verification: { state: 'unverified', detail: 'keystrokes are not read back' } };
}

function doSetValue(app, req) {
  requireTrusted();
  var node = nodeAt(app, req.elementIndex, req.maxNodes).node;
  if (node.sensitive) fail('sensitive_field', 'Refusing to write a password or other secret field. Ask the user to enter it themselves.');
  if (node.enabled === false) fail('element_not_enabled', 'Element ' + req.elementIndex + ' is disabled.');
  if ($.AXUIElementSetAttributeValue(node.el, $('AXValue'), $(req.value)) !== 0) fail('value_not_settable', 'Element ' + req.elementIndex + ' does not accept a value. Use computer_type or another action.');
  var actual = readBack(node);
  var ok = actual === req.value;
  return {
    path: 'accessibility',
    delivery: 'background',
    detail: 'set the value of ' + describeFor(node, req.elementIndex),
    verification: ok ? { state: 'verified', detail: 'the element reads back the new value' } : { state: 'unverified', detail: 'the element reports a different value than requested (' + JSON.stringify(clip(actual, 60)) + ')' }
  };
}

function doSecondary(app, req) {
  requireTrusted();
  var node = nodeAt(app, req.elementIndex, req.maxNodes).node;
  if (node.enabled === false) fail('element_not_enabled', 'Element ' + req.elementIndex + ' is disabled.');
  var names = actionNames(node.el);
  var wanted = req.action.indexOf('AX') === 0 ? req.action : 'AX' + req.action;
  var match = names.filter(function (n) { return n.toLowerCase() === wanted.toLowerCase(); })[0];
  if (!match) fail('action_not_supported', 'Element ' + req.elementIndex + ' lists these actions: ' + (names.join(', ') || 'none') + '.');
  if ($.AXUIElementPerformAction(node.el, $(match)) !== 0) fail('action_not_supported', 'The app refused ' + match + '.');
  return { path: 'accessibility', delivery: 'background', detail: 'performed ' + match + ' on ' + describeFor(node, req.elementIndex) };
}

function doKey(app, req) {
  requireTrusted();
  var appEl = $.AXUIElementCreateApplication(Number(app.processIdentifier));
  if (req.key.insertsText) {
    var focus = focusedNode(appEl);
    if (focus && focus.sensitive) fail('sensitive_field', 'Refusing to send text-producing keys to a password or other secret field. Ask the user to enter it themselves.');
  }
  var using = req.key.modifiers.map(function (m) { return m + ' down'; });
  if (req.foreground) {
    activate(app);
    var se = Application('System Events');
    if (using.length) se.keyCode(req.key.keyCode, { using: using });
    else se.keyCode(req.key.keyCode);
    return { path: 'synthetic', delivery: 'foreground', detail: 'sent ' + req.key.label + ' after raising the app' };
  }
  var flags = 0;
  req.key.modifiers.forEach(function (m) {
    flags |= m === 'command' ? $.kCGEventFlagMaskCommand : m === 'control' ? $.kCGEventFlagMaskControl : m === 'option' ? $.kCGEventFlagMaskAlternate : $.kCGEventFlagMaskShift;
  });
  [true, false].forEach(function (isDown) {
    var ev = $.CGEventCreateKeyboardEvent(null, req.key.keyCode, isDown);
    $.CGEventSetFlags(ev, flags);
    $.CGEventPostToPid(Number(app.processIdentifier), ev);
  });
  return { path: 'synthetic', delivery: 'background', detail: 'sent ' + req.key.label + ' to the app without raising it' };
}

function doScroll(app, req) {
  requireTrusted();
  var t = targetPoint(app, req.target, req);
  if (req.foreground) {
    $.CGWarpMouseCursorPosition(t.point);
  }
  var ev = $.CGEventCreateScrollWheelEvent2(null, $.kCGScrollEventUnitLine, 2, req.dy, req.dx, 0);
  $.CGEventSetLocation(ev, t.point);
  post(app, ev, req.foreground);
  return { path: 'synthetic', delivery: req.foreground ? 'foreground' : 'background', detail: 'scrolled' + (req.foreground ? ' with the real pointer' : ' without moving the pointer') };
}

function doDrag(app, req) {
  requireTrusted();
  var from = targetPoint(app, req.from, req).point;
  var to = targetPoint(app, req.to, req).point;
  if (req.foreground) activate(app);
  var steps = 8;
  mouseEvent(app, $.kCGEventLeftMouseDown, from, $.kCGMouseButtonLeft, 1, req.foreground);
  for (var i = 1; i <= steps; i++) {
    var p = $.CGPointMake(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    mouseEvent(app, $.kCGEventLeftMouseDragged, p, $.kCGMouseButtonLeft, 1, req.foreground);
    sleep(0.02);
  }
  mouseEvent(app, $.kCGEventLeftMouseUp, to, $.kCGMouseButtonLeft, 1, req.foreground);
  return { path: 'synthetic', delivery: req.foreground ? 'foreground' : 'background', detail: 'dragged with synthetic mouse events' + (req.foreground ? '; the app was raised' : ' (some apps ignore background drags; retry with foreground)') };
}

function permissions() {
  var trusted = !!$.AXIsProcessTrusted();
  var me = Number($.NSProcessInfo.processInfo.processIdentifier);
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)));
  var others = list.filter(function (w) { return w.kCGWindowOwnerPID !== me && w.kCGWindowLayer === 0; });
  var named = others.filter(function (w) { return !!w.kCGWindowName; }).length;
  // Window titles of other apps are only readable with Screen Recording access.
  var screen = others.length < 2 ? 'unknown' : (named > 0 ? 'granted' : 'denied');
  return { accessibility: trusted, screenRecording: screen };
}

function run(argv) {
  try {
    var req = JSON.parse(argv[0]);
    var result = { ok: true };
    switch (req.op) {
      case 'permissions':
        result.permissions = permissions();
        break;
      case 'listApps':
        result.apps = runningApps().filter(function (a) { return Number(a.activationPolicy) === 0; }).map(function (a) {
          var i = appInfo(a);
          i.active = !!a.active;
          i.hidden = !!a.hidden;
          return i;
        });
        break;
      case 'focusApp':
        var target = resolveApp(req.app);
        rejectBlocked(target);
        activate(target);
        result.app = appInfo(target);
        break;
      case 'windowFrame':
        requireTrusted();
        var fa = resolveApp(req.app);
        rejectBlocked(fa);
        var wf = axFrame(pickWindow($.AXUIElementCreateApplication(Number(fa.processIdentifier))));
        if (!wf) fail('window_not_found', 'Could not read the window frame.');
        result.app = appInfo(fa);
        result.frame = wf;
        break;
      case 'snapshot':
        requireTrusted();
        var sa = resolveApp(req.app);
        rejectBlocked(sa);
        result.snapshot = snapshot(sa, req.maxNodes, req.rootElementIndex);
        break;
      default:
        var app = resolveApp(req.app);
        rejectBlocked(app);
        if (req.op === 'click') result.action = doClick(app, req);
        else if (req.op === 'type') result.action = doType(app, req);
        else if (req.op === 'key') result.action = doKey(app, req);
        else if (req.op === 'scroll') result.action = doScroll(app, req);
        else if (req.op === 'drag') result.action = doDrag(app, req);
        else if (req.op === 'setValue') result.action = doSetValue(app, req);
        else if (req.op === 'secondaryAction') result.action = doSecondary(app, req);
        else fail('invalid_argument', 'Unknown operation ' + req.op);
        sleep(0.35);
        result.snapshot = snapshot(app, req.maxNodes);
    }
    return JSON.stringify(result);
  } catch (e) {
    if (e && e.fail) return JSON.stringify({ ok: false, code: e.code, message: e.message });
    return JSON.stringify({ ok: false, code: 'accessibility_error', message: String(e && e.message ? e.message : e) });
  }
}
`;

import { BLOCKED_APP_FRAGMENTS, SENSITIVE_LABEL_SOURCE } from "./sensitive.ts";

/**
 * The Linux runtime: a Python 3 AT-SPI adapter run with `python3 -` (script on stdin, request in
 * the COMPUTER_USE_REQUEST environment variable). It follows the design of Orca's
 * native/computer-use-linux/runtime.py (MIT, (c) 2026 Lovecast Inc.) but is a compact rewrite
 * that speaks Tabs' request and response JSON. Needs PyGObject with AT-SPI (gir1.2-atspi-2.0),
 * and xdotool for pointer and key input on X11. Wayland blocks synthetic input, so pointer and
 * key actions fail there with a clear message while accessibility actions keep working.
 *
 * Keep this source free of backticks and dollar-brace sequences other than the two
 * interpolations; it lives in a template literal.
 */
export const LINUX_RUNTIME = String.raw`
import json, os, re, shutil, subprocess, sys, tempfile, time

try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except Exception as error:
    print(json.dumps({"ok": False, "code": "unsupported_capability", "message": "PyGObject with AT-SPI is not available (" + str(error) + "). Install python3-gi and gir1.2-atspi-2.0."}))
    sys.exit(0)

SENSITIVE_RE = re.compile(${JSON.stringify(SENSITIVE_LABEL_SOURCE)}, re.I)
BLOCKED_APPS = ${JSON.stringify(BLOCKED_APP_FRAGMENTS)}
EDITABLE = ("text", "entry", "password text", "terminal", "paragraph", "combo box")
TRANSPARENT = ("panel", "filler", "section", "unknown", "scroll pane", "viewport", "split pane", "layered pane", "redundant object")
VALUE_ROLES = ("text", "entry", "password text", "check box", "radio button", "slider", "spin button", "combo box", "toggle button", "progress bar")
MAX_DEPTH = 40
XKEYS = {"return": "Return", "tab": "Tab", "space": "space", "escape": "Escape", "backspace": "BackSpace", "forwarddelete": "Delete",
         "left": "Left", "right": "Right", "up": "Up", "down": "Down", "home": "Home", "end": "End", "pageup": "Prior", "pagedown": "Next"}
XMODS = {"control": "ctrl", "option": "alt", "shift": "shift", "super": "super", "command": "super"}


class Fail(Exception):
    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message


def clip(text, limit):
    flat = re.sub(r"[\r\n\t]+", " ", str(text))
    return flat[:limit] + "..." if len(flat) > limit else flat


def guard(fn, default=None):
    try:
        value = fn()
        return default if value is None else value
    except Exception:
        return default


def name_of(node):
    return guard(lambda: node.get_name(), "") or ""


def role_of(node):
    return guard(lambda: node.get_role_name(), "") or ""


def children(node):
    count = guard(lambda: node.get_child_count(), 0)
    out = []
    for i in range(count):
        child = guard(lambda: node.get_child_at_index(i))
        if child is not None:
            out.append(child)
    return out


def has_state(node, state):
    return guard(lambda: node.get_state_set().contains(state), False)


def text_of(node):
    iface = guard(lambda: node.get_text_iface())
    if iface is None:
        return ""
    return guard(lambda: Atspi.Text.get_text(iface, 0, min(Atspi.Text.get_character_count(iface), 500)), "") or ""


def is_secure(node):
    if guard(lambda: node.get_role(), None) == Atspi.Role.PASSWORD_TEXT:
        return True
    if role_of(node) in EDITABLE:
        label = name_of(node) + " " + (guard(lambda: node.get_description(), "") or "")
        return bool(SENSITIVE_RE.search(label))
    return False


def frame_of(node):
    rect = guard(lambda: Atspi.Component.get_extents(node.get_component_iface(), Atspi.CoordType.SCREEN))
    if rect is None:
        return None
    return {"x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height}


def desktop_apps():
    desktop = Atspi.get_desktop(0)
    return [a for a in children(desktop)]


def app_info(app):
    return {"name": name_of(app), "bundleId": None, "pid": guard(lambda: app.get_process_id(), 0)}


def resolve_app(sel):
    apps = desktop_apps()
    if sel["kind"] == "pid":
        found = [a for a in apps if app_info(a)["pid"] == sel["pid"]]
        if found:
            return found[0]
        raise Fail("app_not_found", "No running app has pid %d. Call computer_list_apps." % sel["pid"])
    q = sel["query"].lower()
    exact = [a for a in apps if name_of(a).lower() == q]
    partial = exact or [a for a in apps if q in name_of(a).lower()]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        raise Fail("app_not_found", 'App "%s" is ambiguous: %s. Use pid:N.' % (sel["query"], ", ".join(name_of(a) for a in partial[:6])))
    raise Fail("app_not_found", 'No running app matches "%s". Call computer_list_apps.' % sel["query"])


def reject_blocked(app):
    hay = name_of(app).lower()
    if any(b in hay for b in BLOCKED_APPS):
        raise Fail("app_blocked", name_of(app) + " is a password manager and is off limits to computer use.")


def pick_window(app):
    wins = [c for c in children(app) if role_of(c) in ("frame", "window", "dialog", "alert", "file chooser")]
    if not wins:
        raise Fail("window_not_found", "The app has no accessible window. Ask the user to open or show one.")
    for w in wins:
        if has_state(w, Atspi.StateType.ACTIVE):
            return w
    return wins[0]


def walk(win, max_nodes):
    nodes = []
    state = {"truncated": False}

    def visit(el, depth):
        if depth > MAX_DEPTH:
            state["truncated"] = True
            return
        role = role_of(el)
        label = name_of(el)
        secure = is_secure(el)
        text = "" if secure or role not in VALUE_ROLES else text_of(el)
        shown = label or (text if role in ("label", "static") else "")
        child_depth = depth
        if not (role in TRANSPARENT and not shown and not secure):
            if len(nodes) >= max_nodes:
                state["truncated"] = True
                return
            nodes.append({"el": el, "role": role, "label": label, "text": text, "secure": secure, "depth": depth,
                          "enabled": has_state(el, Atspi.StateType.ENABLED) or has_state(el, Atspi.StateType.SENSITIVE),
                          "focused": has_state(el, Atspi.StateType.FOCUSED), "selected": has_state(el, Atspi.StateType.SELECTED)})
            child_depth = depth + 1
        for kid in children(el):
            visit(kid, child_depth)

    visit(win, 0)
    return nodes, state["truncated"]


def render(node, index, base):
    parts = ["\t" * (node["depth"] - base) + str(index), node["role"].replace(" ", "") or "Unknown"]
    if node["label"]:
        parts.append('"' + clip(node["label"], 100) + '"')
    if node["secure"]:
        parts.append("(secure)")
    elif node["text"]:
        parts.append("value=" + json.dumps(clip(node["text"], 100)))
    if not node["enabled"]:
        parts.append("(disabled)")
    if node["focused"]:
        parts.append("(focused)")
    if node["selected"]:
        parts.append("(selected)")
    return " ".join(parts)


def snapshot(app, max_nodes, root_index=None):
    win = pick_window(app)
    frame = frame_of(win) or {"x": 0, "y": 0, "width": 0, "height": 0}
    nodes, truncated = walk(win, max_nodes)
    start, end = 0, len(nodes)
    if root_index is not None:
        if root_index < 1 or root_index > len(nodes):
            raise Fail("element_not_found", "Element %d is not in the current window. Take a fresh snapshot." % root_index)
        start = root_index - 1
        end = start + 1
        while end < len(nodes) and nodes[end]["depth"] > nodes[start]["depth"]:
            end += 1
    lines, focused = [], None
    for i in range(start, end):
        lines.append(render(nodes[i], i + 1, nodes[start]["depth"]))
        if nodes[i]["focused"]:
            focused = i + 1
    info = app_info(app)
    title = name_of(win)
    header = ["App: %s (pid %d)" % (info["name"], info["pid"]),
              "Window: %s at (%d, %d) size %dx%d points; click coordinates are window-local." % (json.dumps(clip(title, 120)), frame["x"], frame["y"], frame["width"], frame["height"])]
    footer = "%d elements%s." % (end - start, " (snapshot limit reached: pass rootElementIndex to read a subtree, or raise maxNodes)" if truncated else "")
    return {"id": "%d:%d" % (info["pid"], int(time.time() * 1000)), "app": info,
            "window": {"title": title, "key": "window", "frame": frame},
            "treeText": "\n".join(header) + "\n\n" + "\n".join(lines) + "\n\n" + footer,
            "elementCount": end - start, "focusedElementIndex": focused, "truncated": truncated}


def node_at(app, index, max_nodes):
    nodes, _ = walk(pick_window(app), max(max_nodes, index))
    if index < 1 or index > len(nodes):
        raise Fail("element_not_found", "Element %d is not in the current window. Take a fresh snapshot." % index)
    return nodes[index - 1]


def actions_of(node):
    iface = guard(lambda: node["el"].get_action_iface())
    if iface is None:
        return []
    return [(i, guard(lambda: Atspi.Action.get_action_name(iface, i), "") or "") for i in range(guard(lambda: Atspi.Action.get_n_actions(iface), 0))]


def do_action(node, wanted):
    iface = guard(lambda: node["el"].get_action_iface())
    for i, name in actions_of(node):
        if name.lower() in wanted:
            return bool(guard(lambda: Atspi.Action.do_action(iface, i), False))
    return False


def xdotool(*args):
    if not shutil.which("xdotool"):
        raise Fail("unsupported_capability", "xdotool is required for pointer and key input. Install it (X11 only).")
    if os.environ.get("WAYLAND_DISPLAY") and not os.environ.get("DISPLAY"):
        raise Fail("background_unavailable", "Synthetic pointer and key input is blocked on Wayland. Use element actions (click, set value, type into an element).")
    subprocess.run(["xdotool"] + [str(a) for a in args], check=False, timeout=10)


def center(app, target, max_nodes):
    if target["kind"] == "point":
        f = frame_of(pick_window(app))
        if not f:
            raise Fail("window_not_found", "Could not read the window frame.")
        return int(f["x"] + target["x"]), int(f["y"] + target["y"]), None
    node = node_at(app, target["index"], max_nodes)
    f = frame_of(node["el"])
    if not f or f["width"] <= 0 or f["height"] <= 0:
        raise Fail("element_not_clickable", "Element %d has no on-screen frame." % target["index"])
    return int(f["x"] + f["width"] / 2), int(f["y"] + f["height"] / 2), node


def focus(app):
    pid = app_info(app)["pid"]
    if shutil.which("xdotool") and pid:
        subprocess.run(["xdotool", "search", "--pid", str(pid), "windowactivate"], check=False, timeout=10)
        time.sleep(0.2)


def do_click(app, req):
    right = req.get("button") == "right"
    if req["target"]["kind"] == "element":
        node = node_at(app, req["target"]["index"], req["maxNodes"])
        if not node["enabled"]:
            raise Fail("element_not_enabled", "Element %d is disabled. Nothing was sent." % req["target"]["index"])
        if not req["foreground"] and not right and req["clickCount"] == 1 and do_action(node, ("click", "press", "activate", "jump", "select", "toggle")):
            return {"path": "accessibility", "delivery": "background", "detail": "activated " + render(node, req["target"]["index"], node["depth"])}
    x, y, _ = center(app, req["target"], req["maxNodes"])
    focus(app)
    xdotool("mousemove", x, y)
    xdotool("click", "--repeat", req["clickCount"], "3" if right else "1")
    return {"path": "synthetic", "delivery": "foreground", "detail": ("right-clicked" if right else "clicked") + " with the real pointer; the window was raised"}


def editable_write(node, text, replace):
    iface = guard(lambda: node["el"].get_editable_text_iface())
    if iface is None:
        return False
    if replace:
        return bool(guard(lambda: Atspi.EditableText.set_text_contents(iface, text), False))
    text_iface = guard(lambda: node["el"].get_text_iface())
    caret = guard(lambda: Atspi.Text.get_caret_offset(text_iface), -1) if text_iface else -1
    if caret < 0:
        caret = guard(lambda: Atspi.Text.get_character_count(text_iface), 0) if text_iface else 0
    return bool(guard(lambda: Atspi.EditableText.insert_text(iface, caret, text, len(text.encode("utf-8"))), False))


def reread(node):
    return text_of(node["el"])


def do_type(app, req):
    if req.get("elementIndex") is not None:
        node = node_at(app, req["elementIndex"], req["maxNodes"])
    else:
        nodes, _ = walk(pick_window(app), req["maxNodes"])
        focused = [n for n in nodes if n["focused"]]
        if not focused:
            raise Fail("element_not_found", "No text field has focus in that app. Click a field first, or pass elementIndex.")
        node = focused[0]
    if node["secure"]:
        raise Fail("sensitive_field", "Refusing to type into a password or other secret field. Ask the user to enter it themselves.")
    if not node["enabled"]:
        raise Fail("element_not_enabled", "That field is disabled.")
    before = reread(node)
    if editable_write(node, req["text"], False):
        ok = req["text"] in reread(node) or reread(node) != before
        return {"path": "accessibility", "delivery": "background", "detail": "inserted text through the editable-text interface",
                "verification": {"state": "verified" if ok else "unverified", "detail": "the field now holds the text" if ok else "the write succeeded but the field did not change; check the tree"}}
    if req.get("elementIndex") is not None:
        raise Fail("value_not_settable", "That element does not accept text through accessibility. Click it, then call computer_type without elementIndex.")
    focus(app)
    xdotool("type", "--delay", 5, "--", req["text"])
    return {"path": "synthetic", "delivery": "foreground", "detail": "typed with the keyboard; the window was raised", "verification": {"state": "unverified", "detail": "keystrokes are not read back"}}


def do_set_value(app, req):
    node = node_at(app, req["elementIndex"], req["maxNodes"])
    if node["secure"]:
        raise Fail("sensitive_field", "Refusing to write a password or other secret field. Ask the user to enter it themselves.")
    if not node["enabled"]:
        raise Fail("element_not_enabled", "Element %d is disabled." % req["elementIndex"])
    if not editable_write(node, req["value"], True):
        raise Fail("value_not_settable", "Element %d does not accept a value. Use computer_type or another action." % req["elementIndex"])
    ok = reread(node) == req["value"]
    return {"path": "accessibility", "delivery": "background", "detail": "set the value of " + render(node, req["elementIndex"], node["depth"]),
            "verification": {"state": "verified" if ok else "unverified", "detail": "the element reads back the new value" if ok else "the element reports a different value than requested"}}


def do_secondary(app, req):
    node = node_at(app, req["elementIndex"], req["maxNodes"])
    names = [n for _, n in actions_of(node)]
    if req["action"].lower() not in [n.lower() for n in names]:
        raise Fail("action_not_supported", "Element %d lists these actions: %s." % (req["elementIndex"], ", ".join(names) or "none"))
    if not do_action(node, (req["action"].lower(),)):
        raise Fail("action_not_supported", "The app refused " + req["action"] + ".")
    return {"path": "accessibility", "delivery": "background", "detail": "performed " + req["action"] + " on " + render(node, req["elementIndex"], node["depth"])}


def do_key(app, req):
    key = req["key"]
    if key.get("insertsText"):
        nodes, _ = walk(pick_window(app), req["maxNodes"])
        if any(n["focused"] and n["secure"] for n in nodes):
            raise Fail("sensitive_field", "Refusing to send text-producing keys to a password or other secret field. Ask the user to enter it themselves.")
    focus(app)
    chord = "+".join([XMODS[m] for m in key["modifiers"]] + [XKEYS.get(key["name"], key["name"])])
    xdotool("key", chord)
    return {"path": "synthetic", "delivery": "foreground", "detail": "sent " + key["label"] + " after raising the window"}


def do_scroll(app, req):
    x, y, _ = center(app, req["target"], req["maxNodes"])
    focus(app)
    xdotool("mousemove", x, y)
    buttons = []
    if req["dy"] != 0:
        buttons.append(("4" if req["dy"] > 0 else "5", abs(req["dy"])))
    if req["dx"] != 0:
        buttons.append(("6" if req["dx"] > 0 else "7", abs(req["dx"])))
    for button, count in buttons:
        xdotool("click", "--repeat", count, button)
    return {"path": "synthetic", "delivery": "foreground", "detail": "scrolled with the real pointer"}


def do_drag(app, req):
    fx, fy, _ = center(app, req["from"], req["maxNodes"])
    tx, ty, _ = center(app, req["to"], req["maxNodes"])
    focus(app)
    xdotool("mousemove", fx, fy, "mousedown", 1, "mousemove", (fx + tx) // 2, (fy + ty) // 2, "mousemove", tx, ty, "mouseup", 1)
    return {"path": "synthetic", "delivery": "foreground", "detail": "dragged with the real pointer"}


def do_screenshot(app, req):
    f = frame_of(pick_window(app))
    if not f:
        raise Fail("window_not_found", "The app has no window to capture.")
    region = "%d,%d %dx%d" % (f["x"], f["y"], f["width"], f["height"])
    if shutil.which("grim") and os.environ.get("WAYLAND_DISPLAY"):
        cmd = ["grim", "-g", region, req["path"]]
    elif shutil.which("import"):
        cmd = ["import", "-window", "root", "-crop", "%dx%d+%d+%d" % (f["width"], f["height"], f["x"], f["y"]), req["path"]]
    elif shutil.which("scrot"):
        cmd = ["scrot", "-a", "%d,%d,%d,%d" % (f["x"], f["y"], f["width"], f["height"]), req["path"]]
    else:
        raise Fail("screenshot_failed", "Install grim (Wayland), ImageMagick import, or scrot to capture windows.")
    subprocess.run(cmd, check=False, timeout=15)
    if not os.path.exists(req["path"]):
        raise Fail("screenshot_failed", "The screenshot tool did not produce a file.")
    return {"path": "synthetic", "delivery": "background", "detail": "captured the window"}


def run(req):
    result = {"ok": True}
    op = req["op"]
    if op == "permissions":
        reachable = guard(lambda: len(desktop_apps()) >= 0, False)
        result["permissions"] = {"accessibility": bool(reachable), "screenRecording": "unknown" if os.environ.get("WAYLAND_DISPLAY") else "granted"}
    elif op == "listApps":
        result["apps"] = [dict(app_info(a), active=False, hidden=False) for a in desktop_apps() if name_of(a)]
    elif op == "focusApp":
        app = resolve_app(req["app"])
        reject_blocked(app)
        focus(app)
        result["app"] = app_info(app)
    elif op == "windowFrame":
        app = resolve_app(req["app"])
        reject_blocked(app)
        result["app"] = app_info(app)
        result["frame"] = frame_of(pick_window(app))
    elif op == "snapshot":
        app = resolve_app(req["app"])
        reject_blocked(app)
        result["snapshot"] = snapshot(app, req["maxNodes"], req.get("rootElementIndex"))
    else:
        app = resolve_app(req["app"])
        reject_blocked(app)
        handlers = {"click": do_click, "type": do_type, "key": do_key, "scroll": do_scroll, "drag": do_drag,
                    "setValue": do_set_value, "secondaryAction": do_secondary, "screenshot": do_screenshot}
        if op not in handlers:
            raise Fail("invalid_argument", "Unknown operation " + op)
        result["action"] = handlers[op](app, req)
        if op == "screenshot":
            return result
        time.sleep(0.35)
        result["snapshot"] = snapshot(app, req.get("maxNodes", 400))
    return result


try:
    print(json.dumps(run(json.loads(os.environ["COMPUTER_USE_REQUEST"]))))
except Fail as failure:
    print(json.dumps({"ok": False, "code": failure.code, "message": failure.message}))
except Exception as error:
    print(json.dumps({"ok": False, "code": "accessibility_error", "message": str(error)}))
`;

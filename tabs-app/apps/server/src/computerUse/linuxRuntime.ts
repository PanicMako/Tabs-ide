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
import ctypes as C
import hashlib, json, os, re, shutil, struct, subprocess, time, zlib
import xml.etree.ElementTree as ET

try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except Exception:
    Atspi = None


SENSITIVE_RE = re.compile(${JSON.stringify(SENSITIVE_LABEL_SOURCE)}, re.I)
BLOCKED_APPS = ${JSON.stringify(BLOCKED_APP_FRAGMENTS)}
EDITABLE = ("text", "entry", "password text", "terminal", "paragraph", "combo box")
TRANSPARENT = ("panel", "filler", "section", "unknown", "scroll pane", "viewport", "split pane", "layered pane", "redundant object")
VALUE_ROLES = ("text", "entry", "password text", "check box", "radio button", "slider", "spin button", "combo box", "toggle button", "progress bar")
MAX_DEPTH = 40
TEXT_READ_LIMIT = 500
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
    return guard(lambda: Atspi.Text.get_text(iface, 0, min(Atspi.Text.get_character_count(iface), TEXT_READ_LIMIT)), "") or ""


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



native_request = None
native_window = None
native_xid = None
x11 = None


def session_type():
    if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland":
        return "wayland"
    return "x11" if os.environ.get("DISPLAY") else "headless"


def portal_capabilities():
    # Introspection can activate the portal without requesting a screen or input session.
    try:
        result = subprocess.run(
            ["gdbus", "introspect", "--session", "--dest", "org.freedesktop.portal.Desktop",
             "--object-path", "/org/freedesktop/portal/desktop", "--xml"],
            capture_output=True, check=True, text=True, timeout=1)
        node = ET.fromstring(result.stdout)
    except (OSError, subprocess.SubprocessError, UnicodeError, ET.ParseError):
        return []
    if node.tag != "node":
        return []
    interfaces = {interface.get("name") for interface in node.findall("interface")}
    return [name for name in ("ScreenCast", "RemoteDesktop") if "org.freedesktop.portal." + name in interfaces]


class Visual(C.Structure):
    _fields_ = [("extension_data", C.c_void_p), ("visualid", C.c_ulong), ("visual_class", C.c_int),
                ("red_mask", C.c_ulong), ("green_mask", C.c_ulong), ("blue_mask", C.c_ulong)]


class XImage(C.Structure):
    _fields_ = [("width", C.c_int), ("height", C.c_int), ("xoffset", C.c_int), ("format", C.c_int),
                ("data", C.c_void_p), ("byte_order", C.c_int), ("bitmap_unit", C.c_int),
                ("bitmap_bit_order", C.c_int), ("bitmap_pad", C.c_int), ("depth", C.c_int),
                ("bytes_per_line", C.c_int), ("bits_per_pixel", C.c_int),
                ("red_mask", C.c_ulong), ("green_mask", C.c_ulong), ("blue_mask", C.c_ulong)]


class XRRMonitorInfo(C.Structure):
    _fields_ = [
        ("name", C.c_ulong), ("primary", C.c_int), ("automatic", C.c_int),
        ("noutput", C.c_int), ("x", C.c_int), ("y", C.c_int),
        ("width", C.c_int), ("height", C.c_int), ("mwidth", C.c_int), ("mheight", C.c_int),
        ("outputs", C.POINTER(C.c_ulong)),
    ]


class X11:
    def __init__(self):
        self.lib = C.CDLL("libX11.so.6")
        ul, i, p = C.c_ulong, C.c_int, C.c_void_p
        self.bind(self.lib, "XOpenDisplay", p, C.c_char_p)
        self.bind(self.lib, "XDefaultRootWindow", ul, p)
        self.bind(self.lib, "XDefaultScreen", i, p)
        self.bind(self.lib, "XDefaultVisual", C.POINTER(Visual), p, i)
        self.bind(self.lib, "XInternAtom", ul, p, C.c_char_p, i)
        self.bind(self.lib, "XGetSelectionOwner", ul, p, ul)
        self.bind(self.lib, "XGetWindowProperty", i, p, ul, ul, C.c_long, C.c_long, i, ul,
                  C.POINTER(ul), C.POINTER(i), C.POINTER(ul), C.POINTER(ul), C.POINTER(p))
        self.bind(self.lib, "XQueryPointer", i, p, ul, C.POINTER(ul), C.POINTER(ul),
                  *([C.POINTER(i)] * 4), C.POINTER(C.c_uint))
        self.bind(self.lib, "XTranslateCoordinates", i, p, ul, ul, i, i, C.POINTER(i), C.POINTER(i), C.POINTER(ul))
        self.bind(self.lib, "XQueryTree", i, p, ul, C.POINTER(ul), C.POINTER(ul), C.POINTER(p), C.POINTER(C.c_uint))
        self.bind(self.lib, "XGetGeometry", i, p, ul, C.POINTER(ul), C.POINTER(i), C.POINTER(i),
                  *([C.POINTER(C.c_uint)] * 4))
        self.bind(self.lib, "XGetImage", C.POINTER(XImage), p, ul, i, i, C.c_uint, C.c_uint, ul, i)
        self.bind(self.lib, "XDestroyImage", i, C.POINTER(XImage))
        self.bind(self.lib, "XFreePixmap", i, p, ul)
        self.bind(self.lib, "XFree", i, p)
        self.bind(self.lib, "XSync", i, p, i)
        self.bind(self.lib, "XSetErrorHandler", p, p)
        self.handle = self.lib.XOpenDisplay(None)
        if not self.handle:
            raise ValueError("Could not open the X server.")
        self.error = False
        self.on_error = C.CFUNCTYPE(i, p, p)(self.record_error)
        self.lib.XSetErrorHandler(self.on_error)
        self.root = self.lib.XDefaultRootWindow(self.handle)
        self.randr = guard(self.open_randr)
        self.composite = guard(lambda: C.CDLL("libXcomposite.so.1"))
        if self.composite:
            self.bind(self.composite, "XCompositeQueryExtension", i, p, C.POINTER(i), C.POINTER(i))
            self.bind(self.composite, "XCompositeNameWindowPixmap", ul, p, ul)
            if not self.composite.XCompositeQueryExtension(self.handle, C.byref(i()), C.byref(i())):
                self.composite = None

    @staticmethod
    def bind(lib, name, result, *args):
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = result, args

    def record_error(self, _display, _event):
        self.error = True
        return 0

    def open_randr(self):
        lib = C.CDLL("libXrandr.so.2")
        integer = C.POINTER(C.c_int)
        self.bind(lib, "XRRQueryVersion", C.c_int, C.c_void_p, integer, integer)
        major, minor = C.c_int(), C.c_int()
        if not lib.XRRQueryVersion(self.handle, C.byref(major), C.byref(minor)) or (major.value, minor.value) < (1, 5):
            return None
        self.bind(lib, "XRRGetMonitors", C.POINTER(XRRMonitorInfo), C.c_void_p, C.c_ulong, C.c_int, integer)
        self.bind(lib, "XRRFreeMonitors", None, C.POINTER(XRRMonitorInfo))
        return lib

    def monitor_layout(self):
        if not self.randr:
            return None
        count = C.c_int()
        monitors = self.randr.XRRGetMonitors(self.handle, self.root, 1, C.byref(count))
        if not monitors:
            return None
        try:
            return sorted([
                (m.name, m.primary, m.x, m.y, m.width, m.height, m.mwidth, m.mheight,
                 sorted(m.outputs[j] for j in range(m.noutput)))
                for m in monitors[:count.value]
            ])
        finally:
            self.randr.XRRFreeMonitors(monitors)

    def atom(self, name):
        return self.lib.XInternAtom(self.handle, name.encode("ascii"), True)

    def property32(self, window, name):
        atom = self.atom(name)
        if not atom:
            return []
        actual, fmt, count, left, data = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong(), C.c_void_p()
        status = self.lib.XGetWindowProperty(self.handle, window, atom, 0, 65536, False, 0,
                                            C.byref(actual), C.byref(fmt), C.byref(count), C.byref(left), C.byref(data))
        try:
            if status == 0 and data and fmt.value == 32:
                return list(C.cast(data, C.POINTER(C.c_ulong))[:count.value])
            return []
        finally:
            if data:
                self.lib.XFree(data)

    def translate(self, src, dst, x, y):
        dx, dy, child = C.c_int(), C.c_int(), C.c_ulong()
        okay = self.lib.XTranslateCoordinates(self.handle, src, dst, x, y, C.byref(dx), C.byref(dy), C.byref(child))
        if not okay:
            return None
        return dx.value, dy.value, child.value

    def frame(self, window):
        root, x, y = C.c_ulong(), C.c_int(), C.c_int()
        w, h, border, depth = [C.c_uint() for _ in range(4)]
        ok = self.lib.XGetGeometry(self.handle, window, C.byref(root), C.byref(x), C.byref(y),
                                   C.byref(w), C.byref(h), C.byref(border), C.byref(depth))
        if ok and root.value == self.root:
            point = self.translate(window, self.root, 0, 0)
            if point:
                return {"x": point[0], "y": point[1], "width": w.value, "height": h.value}
        return None

    def window_anchor(self, window):
        current = window
        for _ in range(32):
            root, parent, data, count = C.c_ulong(), C.c_ulong(), C.c_void_p(), C.c_uint()
            ok = self.lib.XQueryTree(self.handle, current, C.byref(root), C.byref(parent), C.byref(data), C.byref(count))
            if data:
                self.lib.XFree(data)
            if not ok or not parent.value:
                break
            if parent.value == self.root:
                return current
            current = parent.value
        return None

    def pointer_at(self, x, y):
        root, child = C.c_ulong(), C.c_ulong()
        rx, ry, wx, wy = (C.c_int() for _ in range(4))
        mask = C.c_uint()
        ok = self.lib.XQueryPointer(self.handle, self.root, C.byref(root), C.byref(child),
                                    C.byref(rx), C.byref(ry), C.byref(wx), C.byref(wy), C.byref(mask))
        return ok and (rx.value, ry.value) == (x, y)

    def capture_available(self):
        if not self.composite:
            return False
        atom = self.atom("_NET_WM_CM_S" + str(self.lib.XDefaultScreen(self.handle)))
        return bool(atom and self.lib.XGetSelectionOwner(self.handle, atom))

    def capture(self, window, frame):
        if not self.capture_available():
            raise Fail("unsupported_capability", "This X11 session has no compositor-backed window capture.")
        self.error = False
        pixmap = self.composite.XCompositeNameWindowPixmap(self.handle, window)
        self.lib.XSync(self.handle, False)
        if not pixmap or self.error:
            raise Fail("screenshot_failed", "The X11 compositor did not expose this window.")
        try:
            w, h = frame["width"], frame["height"]
            if w <= 0 or h <= 0 or w * h > 40_000_000:
                raise Fail("screenshot_failed", "The selected window has an unsupported capture size.")
            image = self.lib.XGetImage(self.handle, pixmap, 0, 0, w, h, C.c_ulong(-1), 2)
            if not image:
                raise Fail("screenshot_failed", "Could not read the selected window's compositor surface.")
            try:
                data = image.contents
                masks = (data.red_mask, data.green_mask, data.blue_mask)
                if masks == (0, 0, 0) and data.depth in (24, 32):
                    visual = self.lib.XDefaultVisual(self.handle, self.lib.XDefaultScreen(self.handle)).contents
                    masks = (visual.red_mask, visual.green_mask, visual.blue_mask)
                if data.bits_per_pixel != 32 or data.byte_order != 0 or masks != (0xff0000, 0xff00, 0xff):
                    raise Fail("unsupported_capability", "This X11 compositor uses an unsupported pixel format.")
                raw = C.string_at(data.data, data.bytes_per_line * h)
                encoder = zlib.compressobj()
                body = []
                for y in range(h):
                    start = y * data.bytes_per_line
                    source = raw[start:start + w * 4]
                    row = bytearray(w * 3)
                    row[0::3], row[1::3], row[2::3] = source[2::4], source[1::4], source[0::4]
                    body.append(encoder.compress(b"\x00" + row))
                body.append(encoder.flush())
                def chunk(kind, payload):
                    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
                return b"".join((b"\x89PNG\r\n\x1a\n",
                                 chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)),
                                 chunk(b"IDAT", b"".join(body)), chunk(b"IEND", b"")))
            finally:
                self.lib.XDestroyImage(image)
        finally:
            self.lib.XFreePixmap(self.handle, pixmap)


def get_x11():
    global x11
    if x11 is None and session_type() == "x11":
        x11 = guard(X11, False)
    return x11


def permissions():
    session = session_type()
    reachable = Atspi is not None and session != "headless" and guard(lambda: Atspi.get_desktop(0).get_child_count() >= 0, False)
    server = get_x11()
    # Real X11 input requires a window manager, xdotool, and an active X server.
    physical = bool(reachable and server and shutil.which("xdotool") and server.property32(server.root, "_NET_SUPPORTING_WM_CHECK"))
    capture = bool(reachable and server and server.capture_available())
    if session == "headless":
        details = "No X11 or Wayland desktop session is available."
    elif session == "wayland":
        portals = portal_capabilities()
        details = "Wayland AT-SPI accessibility is available. " if reachable else "Wayland AT-SPI is unreachable. "
        details += ("Advertised portals: " + ", ".join(portals) + ". ") if portals else "No ScreenCast or RemoteDesktop portal was detected. "
        details += "Window capture and physical input are unavailable until Tabs supports compositor-approved sessions."
    elif not reachable:
        details = "AT-SPI is unreachable. Check the desktop accessibility bus and install python3-gi and gir1.2-atspi-2.0."
    else:
        details = "X11 AT-SPI accessibility is available. "
        details += "Scoped capture uses the X11 compositor. " if capture else "No XComposite window capture is available. "
        details += "Physical input requires the selected window in front." if physical else "Physical input requires xdotool and an EWMH window manager."
    return {"accessibility": bool(reachable), "screenRecording": "unknown", "capabilities": {
        "session": session, "windowSelection": bool(reachable), "accessibilityActions": bool(reachable),
        "windowCapture": capture, "foregroundInput": physical, "details": details
    }}


def windows_of(app):
    return [node for node in children(app) if role_of(node) in ("frame", "window", "dialog", "alert", "file chooser")]


def process_start(pid):
    def read():
        with open("/proc/%d/stat" % pid) as file:
            return file.read().rsplit(")", 1)[1].split()[19]
    return guard(read, "")


def path_of(node):
    return guard(lambda: node.path, "") or ""


def window_identity(app, win):
    pid = app_info(app)["pid"]
    start, path = process_start(pid), path_of(win)
    if not start or not path:
        return ""
    bus = guard(lambda: win.app.bus_name, "") or ""
    return json.dumps([pid, start, bus, path], separators=(",", ":"))


def window_choices():
    wins = []
    for app in desktop_apps():
        if name_of(app).lower() in ("tabs", "tabs ide"):
            continue
        try:
            reject_blocked(app)
        except Fail:
            continue
        for win in windows_of(app):
            identity = window_identity(app, win)
            if identity:
                info = app_info(app)
                wins.append({"id": identity, "app": info["name"], "title": name_of(win), "pid": info["pid"],
                             "frame": frame_of(win) or {"x": 0, "y": 0, "width": 0, "height": 0}})
    return wins


def x11_window(app, win):
    server = get_x11()
    f = frame_of(win)
    if not server or not f:
        return None
    pid = app_info(app)["pid"]
    # A geometry match is used only when it is unique in both APIs.
    if sum(frame_of(other) == f for other in windows_of(app)) != 1:
        return None
    clients = server.property32(server.root, "_NET_CLIENT_LIST_STACKING")
    def matches_frame(window):
        if server.frame(window) == f:
            return True
        anchor = server.window_anchor(window)
        return anchor and server.frame(anchor) == f

    matches = [window for window in clients if server.property32(window, "_NET_WM_PID") == [pid] and matches_frame(window)]
    return matches[0] if len(matches) == 1 else None


def x11_display_ref(app, win):
    xid = x11_window(app, win)
    if xid is None:
        return None
    layout = get_x11().monitor_layout()
    if not layout:
        return str(xid)
    signature = hashlib.sha256(json.dumps(layout, separators=(",", ":")).encode()).hexdigest()
    return "%d:%s" % (xid, signature)


def resolve_exact(req):
    global native_request, native_window, native_xid
    pid = json.loads(req["app"]["id"])[0]
    app = resolve_app({"kind": "pid", "pid": pid})
    reject_blocked(app)
    if name_of(app).lower() in ("tabs", "tabs ide"):
        raise Fail("app_blocked", "Tabs cannot operate its own desktop controls.")
    wins = [win for win in windows_of(app) if window_identity(app, win) == req["app"]["id"]]
    if len(wins) != 1:
        raise Fail("window_stale", "The selected window closed or no longer has a unique accessibility identity.")
    native_request, native_window = req, wins[0]
    native_xid = x11_window(app, native_window)
    check_layout(app)
    return app


def check_control():
    control = native_request.get("controlFile") if native_request else None
    if control and not os.path.exists(control):
        raise Fail("user_turn", "The user has taken control.")


def check_layout(app, reobserve=False):
    check_control()
    if has_state(native_window, Atspi.StateType.DEFUNCT) or window_identity(app, native_window) != native_request["app"]["id"]:
        raise Fail("window_stale", "The selected window is no longer available.")
    expected = native_request.get("native", {})
    frame = frame_of(native_window) or {"x": 0, "y": 0, "width": 0, "height": 0}
    if not reobserve and (expected.get("frame") is not None and expected["frame"] != frame or
                         expected.get("display") is not None and expected["display"] != x11_display_ref(app, native_window)):
        raise Fail("stale_observation", "The window moved, resized or changed its X11 display layout.")
    return frame


def node_token(node):
    path = path_of(node["el"])
    if not path:
        return None
    return json.dumps([path, node["role"], clip(node["label"], 120), frame_of(node["el"])], separators=(",", ":"))


def check_node(node, expected):
    if not expected or node_token(node) != expected:
        raise Fail("stale_observation", "The accessibility element changed.")
    check_control()


def check_foreground(app, x=None, y=None):
    if not native_request["native"]["foreground"] or not native_request.get("foreground"):
        raise Fail("background_unavailable", "This action requires granted physical input.")
    if session_type() == "wayland":
        raise Fail("unsupported_capability", "Physical input is unavailable in this Wayland session. Use accessibility actions on the selected window.")
    server = get_x11()
    if not server or not native_xid or not shutil.which("xdotool"):
        raise Fail("unsupported_capability", "The selected window cannot be mapped to a supported X11 input target.")
    f = check_layout(app)
    if server.property32(server.root, "_NET_ACTIVE_WINDOW") != [native_xid] or not has_state(native_window, Atspi.StateType.ACTIVE):
        raise Fail("focus_changed", "Bring the selected window to the front before sending physical input.")
    if x is None:
        return
    if not (f["x"] <= x < f["x"] + f["width"] and f["y"] <= y < f["y"] + f["height"]):
        raise Fail("element_not_clickable", "The point is outside the selected window.")
    hit = server.translate(server.root, server.root, x, y)
    if not hit or hit[2] != server.window_anchor(native_xid):
        raise Fail("target_occluded", "Another window or overlay covers this point.")


def check_pointer(x, y):
    if not get_x11().pointer_at(x, y):
        raise Fail("focus_changed", "The pointer moved before input.")


def check_click_overlap(x, y, hit_path):
    # GTK can return the first matching accessible even when a later sibling
    # paints over it. Refuse competing controls instead of guessing their order.
    pending = children(native_window)
    for _ in range(600):
        if not pending:
            return
        element = pending.pop()
        if element not in hit_path:
            if not has_state(element, Atspi.StateType.SHOWING):
                continue
            frame = frame_of(element)
            if frame is not None:
                if not (frame["x"] <= x < frame["x"] + frame["width"] and
                        frame["y"] <= y < frame["y"] + frame["height"]):
                    continue
                if is_secure(element):
                    raise Fail("sensitive_field", "Ask the user to handle this protected control.")
                actions = guard(lambda: Atspi.Action.get_n_actions(element.get_action_iface()), 0)
                if actions > 0:
                    raise Fail("target_occluded", "Another actionable control overlaps this point.")
        pending.extend(children(element))
    if pending:
        raise Fail("target_occluded", "The accessibility hit could not be resolved.")


def check_click_hit(x, y, node):
    target = node["el"] if node is not None else None
    hit = native_window
    for _ in range(MAX_DEPTH):
        next_hit = guard(lambda: Atspi.Component.get_accessible_at_point(hit.get_component_iface(), x, y, Atspi.CoordType.SCREEN))
        if next_hit is None or next_hit == hit:
            break
        hit = next_hit
    else:
        raise Fail("target_occluded", "The accessibility hit could not be resolved.")

    matches_target = target is None
    hit_path = []
    secure = False
    for _ in range(MAX_DEPTH + 1):
        if hit is None:
            break
        matches_target = matches_target or hit == target
        if hit == native_window:
            if matches_target:
                if secure:
                    raise Fail("sensitive_field", "Ask the user to handle this protected control.")
                check_click_overlap(x, y, hit_path)
                return
            break
        hit_path.append(hit)
        secure = secure or is_secure(hit)
        hit = guard(hit.get_parent)
    raise Fail("target_occluded", "AT-SPI could not verify the click target at this point.")


def click_pointer(app, x, y, button, count, *, verify_hit=False, node=None):
    check_foreground(app, x, y)
    if verify_hit:
        check_click_hit(x, y, node)
        check_foreground(app, x, y)
    xdotool("mousemove", x, y)
    for _ in range(count):
        if verify_hit:
            check_click_hit(x, y, node)
        check_foreground(app, x, y)
        check_pointer(x, y)
        xdotool("click", button)


def pick_window(app):
    if native_window is not None:
        return native_window
    wins = windows_of(app)
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


def snapshot(app, max_nodes, root_index=None, after_action=False):
    win = pick_window(app)
    frame = (check_layout(app, after_action) if native_request else frame_of(win)) or {"x": 0, "y": 0, "width": 0, "height": 0}
    display = x11_display_ref(app, win) if native_request and native_xid else None
    nodes, truncated = walk(win, max_nodes)
    start, end = 0, len(nodes)
    if root_index is not None:
        if root_index < 1 or root_index > len(nodes):
            raise Fail("element_not_found", "Element %d is not in the current window. Take a fresh snapshot." % root_index)
        start = root_index - 1
        if native_request:
            check_node(nodes[start], native_request["native"].get("elements", {}).get(str(root_index)))
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
    result = {"id": "%d:%d" % (info["pid"], int(time.time() * 1000)), "app": info,
            "window": {"title": title, "key": "window", "frame": frame},
            "treeText": "\n".join(header) + "\n\n" + "\n".join(lines) + "\n\n" + footer,
            "elementCount": end - start, "focusedElementIndex": focused, "truncated": truncated}
    if native_request:
        elements = [node_token(node) for node in nodes]
        if check_layout(app, after_action) != frame or (native_xid and x11_display_ref(app, win) != display):
            raise Fail("stale_observation", "The layout changed while it was being read.")
        result["window"]["key"] = native_request["app"]["id"]
        result["elements"] = elements
        if display is not None:
            result["display"] = display
    return result


def node_at(app, index, max_nodes):
    nodes, _ = walk(pick_window(app), max(max_nodes, index))
    if index < 1 or index > len(nodes):
        raise Fail("element_not_found", "Element %d is not in the current window. Take a fresh snapshot." % index)
    node = nodes[index - 1]
    if native_request:
        check_node(node, native_request["native"].get("elements", {}).get(str(index)))
        check_layout(app)
    return node


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
    if session_type() != "x11":
        raise Fail("background_unavailable", "Synthetic pointer and key input is blocked on Wayland. Use element actions (click, set value, type into an element).")
    command = subprocess.run(["xdotool"] + [str(a) for a in args], capture_output=True, timeout=3)
    if command.returncode != 0:
        raise Fail("background_unavailable", "The X server declined this input.")


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
        if native_request and node["secure"]:
            raise Fail("sensitive_field", "Ask the user to handle this protected control.")
        if not node["enabled"]:
            raise Fail("element_not_enabled", "Element %d is disabled. Nothing was sent." % req["target"]["index"])
        if not req["foreground"] and not right and req["clickCount"] == 1 and do_action(node, ("click", "press", "activate", "jump", "select", "toggle")):
            return {"path": "accessibility", "delivery": "background", "detail": "activated " + render(node, req["target"]["index"], node["depth"])}
    x, y, node = center(app, req["target"], req["maxNodes"])
    if native_request:
        click_pointer(app, x, y, "3" if right else "1", req["clickCount"], verify_hit=True, node=node)
    else:
        focus(app)
        xdotool("mousemove", x, y)
        xdotool("click", "--repeat", req["clickCount"], "3" if right else "1")
    return {"path": "synthetic", "delivery": "foreground", "detail": ("right-clicked" if right else "clicked") + " with the real pointer"}


def read_complete_text(iface):
    if iface is None:
        return None
    count = Atspi.Text.get_character_count(iface)
    if 0 <= count <= TEXT_READ_LIMIT:
        value = Atspi.Text.get_text(iface, 0, count)
        if value is not None and len(value) == count and Atspi.Text.get_character_count(iface) == count:
            return value
    return None


def insert_text(node, text):
    iface = guard(lambda: node["el"].get_editable_text_iface())
    if iface is None:
        return None
    text_iface = guard(lambda: node["el"].get_text_iface())
    caret = guard(lambda: Atspi.Text.get_caret_offset(text_iface), -1) if text_iface else -1
    if caret < 0:
        caret = guard(lambda: Atspi.Text.get_character_count(text_iface), 0) if text_iface else 0
    before = guard(lambda: read_complete_text(text_iface))
    if not guard(lambda: Atspi.EditableText.insert_text(iface, caret, text, len(text.encode("utf-8"))), False):
        return None
    if before is not None and 0 <= caret <= len(before) and len(before) + len(text) <= TEXT_READ_LIMIT:
        expected = before[:caret] + text + before[caret:]
        if guard(lambda: read_complete_text(text_iface)) == expected:
            return "verified"
    return "unverified"


def do_type(app, req):
    if req.get("elementIndex") is not None:
        node = node_at(app, req["elementIndex"], req["maxNodes"])
    else:
        nodes, _ = walk(pick_window(app), req["maxNodes"])
        focused = [n for n in nodes if n["focused"]]
        if not focused:
            raise Fail("element_not_found", "No text field has focus in that app. Click a field first, or pass elementIndex.")
        node = focused[0]
        if native_request:
            check_node(node, native_request["native"].get("focused"))
            check_layout(app)
    if node["secure"]:
        raise Fail("sensitive_field", "Refusing to type into a password or other secret field. Ask the user to enter it themselves.")
    if not node["enabled"]:
        raise Fail("element_not_enabled", "That field is disabled.")
    verification = insert_text(node, req["text"])
    if verification is not None:
        return {"path": "accessibility", "delivery": "background", "detail": "inserted text through the editable-text interface",
                "verification": {"state": verification, "detail": "the field reads back the expected insertion" if verification == "verified" else "the field did not provide exact readback of the insertion; check the tree"}}
    if req.get("elementIndex") is not None:
        raise Fail("value_not_settable", "That element does not accept text through accessibility. Click it, then call computer_type without elementIndex.")
    if native_request:
        raise Fail("background_unavailable", "This field needs direct keyboard input. Ask the user to type it.")
    focus(app)
    xdotool("type", "--delay", 5, "--", req["text"])
    return {"path": "synthetic", "delivery": "foreground", "detail": "typed with the keyboard; the window was raised", "verification": {"state": "unverified", "detail": "keystrokes are not read back"}}


def do_set_value(app, req):
    node = node_at(app, req["elementIndex"], req["maxNodes"])
    if node["secure"]:
        raise Fail("sensitive_field", "Refusing to write a password or other secret field. Ask the user to enter it themselves.")
    if not node["enabled"]:
        raise Fail("element_not_enabled", "Element %d is disabled." % req["elementIndex"])
    iface = guard(lambda: node["el"].get_editable_text_iface())
    if iface is None or not guard(lambda: Atspi.EditableText.set_text_contents(iface, req["value"]), False):
        raise Fail("value_not_settable", "Element %d does not accept a value. Use computer_type or another action." % req["elementIndex"])
    ok = text_of(node["el"]) == req["value"]
    return {"path": "accessibility", "delivery": "background", "detail": "set the value of " + render(node, req["elementIndex"], node["depth"]),
            "verification": {"state": "verified" if ok else "unverified", "detail": "the element reads back the new value" if ok else "the element reports a different value than requested"}}


def do_secondary(app, req):
    node = node_at(app, req["elementIndex"], req["maxNodes"])
    if native_request and (node["secure"] or req["action"].lower() not in ("click", "press", "activate", "toggle", "select", "increment", "decrement")):
        raise Fail("background_unavailable", "This action may change focus or touch a protected field. Ask the user to take control.")
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
    if native_request:
        nodes, _ = walk(pick_window(app), req["maxNodes"])
        focused = next((node for node in nodes if node["focused"]), None)
        if not focused or focused["secure"]:
            raise Fail("sensitive_field", "The focused control is unavailable or protected.")
        check_node(focused, native_request["native"].get("focused"))
        check_foreground(app)
    else:
        focus(app)
    chord = "+".join([XMODS[m] for m in key["modifiers"]] + [XKEYS.get(key["name"], key["name"])])
    if native_request:
        xdotool("key", "--window", native_xid, chord)
    else:
        xdotool("key", chord)
    return {"path": "synthetic", "delivery": "foreground", "detail": "sent " + key["label"] + " to the selected window"}


def do_scroll(app, req):
    x, y, node = center(app, req["target"], req["maxNodes"])
    if not native_request:
        focus(app)
        xdotool("mousemove", x, y)
    buttons = []
    if req["dy"] != 0:
        buttons.append(("4" if req["dy"] > 0 else "5", abs(req["dy"])))
    if req["dx"] != 0:
        buttons.append(("6" if req["dx"] > 0 else "7", abs(req["dx"])))
    for button, count in buttons:
        if native_request:
            click_pointer(app, x, y, button, count, verify_hit=True, node=node)
        else:
            xdotool("click", "--repeat", count, button)
    return {"path": "synthetic", "delivery": "foreground", "detail": "scrolled with the real pointer"}


def do_drag(app, req):
    fx, fy, source = center(app, req["from"], req["maxNodes"])
    tx, ty, destination = center(app, req["to"], req["maxNodes"])
    if native_request:
        check_foreground(app, tx, ty)
        check_click_hit(tx, ty, destination)
        check_click_hit(fx, fy, source)
        check_foreground(app, fx, fy)
        xdotool("mousemove", fx, fy)
        check_click_hit(fx, fy, source)
        check_foreground(app, fx, fy)
        check_pointer(fx, fy)
        last = (fx, fy)
        xdotool("mousedown", 1)
        try:
            for i in range(1, 9):
                x, y = fx + (tx - fx) * i // 8, fy + (ty - fy) * i // 8
                if i == 8:
                    check_click_hit(x, y, destination)
                check_foreground(app, x, y)
                check_pointer(*last)
                xdotool("mousemove", x, y)
                last = (x, y)
        finally:
            xdotool("mouseup", 1)
    else:
        focus(app)
        xdotool("mousemove", fx, fy, "mousedown", 1, "mousemove", (fx + tx) // 2, (fy + ty) // 2, "mousemove", tx, ty, "mouseup", 1)
    return {"path": "synthetic", "delivery": "foreground", "detail": "dragged with the real pointer"}


def x11_capture_target(server, window, frame):
    if server.frame(window) == frame:
        return window
    # Some toolkits report the outer window manager frame through AT-SPI.
    anchor = server.window_anchor(window)
    if not anchor or server.frame(anchor) != frame:
        return None
    clients = server.property32(server.root, "_NET_CLIENT_LIST_STACKING")
    if [client for client in clients if server.window_anchor(client) == anchor] == [window]:
        return anchor
    return None


def check_capture_protections(win):
    incomplete = "AT-SPI could not check the entire window for protected fields."
    remaining = 600
    pending = [(win, 0)]
    try:
        # Each pass must inspect current metadata. The semantic tree tolerates unreadable branches.
        win.clear_cache()
        while pending:
            el, depth = pending.pop()
            remaining -= 1
            if el is None or depth > MAX_DEPTH or el.get_state_set().contains(Atspi.StateType.DEFUNCT):
                raise Fail("screenshot_failed", incomplete)
            role = el.get_role()
            role_name = el.get_role_name()
            if role is None or role in (Atspi.Role.INVALID, Atspi.Role.UNKNOWN) or not role_name:
                raise Fail("screenshot_failed", incomplete)
            secure = role == Atspi.Role.PASSWORD_TEXT
            if role_name in EDITABLE and not secure:
                name, description = el.get_name(), el.get_description()
                if name is None or description is None:
                    raise Fail("screenshot_failed", incomplete)
                secure = SENSITIVE_RE.search(name + " " + description) is not None
            if secure:
                raise Fail("sensitive_field", "Ask the user to finish the protected step before capturing this window.")
            count = el.get_child_count()
            if not 0 <= count <= remaining - len(pending):
                raise Fail("screenshot_failed", incomplete)
            pending.extend((el.get_child_at_index(index), depth + 1) for index in range(count - 1, -1, -1))
    except Fail:
        raise
    except Exception as error:
        raise Fail("screenshot_failed", incomplete) from error


def check_x11_capture_scope(app, server, frame, target):
    if check_layout(app) != frame:
        raise Fail("stale_observation", "The selected X11 capture surface changed.")
    check_capture_protections(native_window)
    if check_layout(app) != frame or x11_capture_target(server, native_xid, frame) != target:
        raise Fail("stale_observation", "The selected X11 capture surface changed.")


def do_screenshot(app, req):
    if native_request:
        frame = check_layout(app)
        if not native_xid:
            raise Fail("unsupported_capability", "This session cannot capture the exact selected window.")
        server = get_x11()
        target = x11_capture_target(server, native_xid, frame)
        if target is None:
            raise Fail("screenshot_failed", "The X11 capture and accessibility coordinates do not match for the selected window.")
        check_x11_capture_scope(app, server, frame, target)
        png = server.capture(target, frame)
        check_x11_capture_scope(app, server, frame, target)
        with open(req["path"], "wb") as file:
            file.write(png)
        return {"path": "synthetic", "delivery": "background", "detail": "captured the selected window's compositor surface"}
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
        result["permissions"] = permissions()
        return result
    if op == "listWindows":
        result["permissions"] = permissions()
        result["windows"] = window_choices() if result["permissions"]["accessibility"] else []
        return result
    if Atspi is None:
        raise Fail("unsupported_capability", "Install python3-gi and gir1.2-atspi-2.0 for AT-SPI access.")
    selected = resolve_exact(req) if req.get("app", {}).get("kind") == "window" else None
    if op == "listApps":
        result["apps"] = [dict(app_info(a), active=False, hidden=False) for a in desktop_apps() if name_of(a)]
    elif op == "focusApp":
        app = selected or resolve_app(req["app"])
        reject_blocked(app)
        if selected:
            if session_type() != "x11" or not native_xid or x11_window(app, native_window) != native_xid:
                raise Fail("unsupported_capability", "Use the desktop window switcher to show this window.")
            xdotool("windowactivate", native_xid)
            check_layout(app)
            server = get_x11()
            if server.property32(server.root, "_NET_ACTIVE_WINDOW") != [native_xid]:
                raise Fail("focus_changed", "Use the window switcher to show the selected window.")
        else:
            focus(app)
        result["app"] = app_info(app)
    elif op == "windowFrame":
        app = selected or resolve_app(req["app"])
        reject_blocked(app)
        result["app"] = app_info(app)
        result["frame"] = frame_of(pick_window(app))
    elif op == "snapshot":
        app = selected or resolve_app(req["app"])
        reject_blocked(app)
        result["snapshot"] = snapshot(app, req["maxNodes"], req.get("rootElementIndex"))
    else:
        app = selected or resolve_app(req["app"])
        reject_blocked(app)
        handlers = {"click": do_click, "type": do_type, "key": do_key, "scroll": do_scroll, "drag": do_drag,
                    "setValue": do_set_value, "secondaryAction": do_secondary, "screenshot": do_screenshot}
        if op not in handlers:
            raise Fail("invalid_argument", "Unknown operation " + op)
        result["action"] = handlers[op](app, req)
        if op == "screenshot":
            return result
        if not selected:
            time.sleep(0.35)
        try:
            result["snapshot"] = snapshot(app, req.get("maxNodes", 400), after_action=bool(selected))
        except Exception:
            if not selected:
                raise
            # The action already ran and may have closed the window.
    return result


try:
    print(json.dumps(run(json.loads(os.environ["COMPUTER_USE_REQUEST"]))))
except Fail as failure:
    print(json.dumps({"ok": False, "code": failure.code, "message": failure.message}))
except Exception as error:
    print(json.dumps({"ok": False, "code": "accessibility_error", "message": str(error)}))
`;

#!/usr/bin/env python3
"""Run an opt-in native handoff smoke test from the tabs-app directory on Linux.

    bun -e 'import { LINUX_RUNTIME } from "./apps/server/src/computerUse/linuxRuntime.ts"; process.stdout.write(LINUX_RUNTIME)' \
        | /usr/bin/python3 apps/server/scripts/fixtures/linuxNativeHandoff.py x11

Use "wayland" for Weston or "sway" for Sway with a ScreenCast portal.
Use "wayland-desktop" inside an existing graphical Wayland session with its
session D-Bus to test window selection, scoped input, and capability reporting.
All modes need PyGObject, GTK 3 and AT-SPI typelibs, at-spi2-core,
dbus-run-session and dbus-update-activation-environment.
X11 uses xvfb-run (Xvfb and xauth), Openbox, xdotool and xcompmgr. Wayland
uses Weston with kiosk-shell, or Sway, PipeWire, xdg-desktop-portal-wlr,
xdg-desktop-portal, gdbus and fusermount3. The portal check uses D-Bus introspection.
In a disposable Xorg session with two 1024x768 dummy outputs named DUMMY0 and DUMMY1,
set TABS_QA_X11_MONITORS=1 and run --session x11 under dbus-run-session with xrandr
and libXrandr installed.

For a manual monitor move, replace x11 in the pipeline above with x11-monitors.
Run from a terminal in a disposable graphical X11 session with an EWMH window
manager, its session D-Bus, xdotool, xrandr and libXrandr. Configure two active
monitors at different scales before running if testing mixed scale. Follow the
prompt to move the fixture by its title bar. The script reads RandR geometry
and checks the stale window guard and fresh semantic input after the move.
Record the desktop's configured scales alongside the report since X11
snapshots expose a RandR layout fingerprint, without a per-window scale field.
"""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
import time


def wait_for(description, probe, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(0.05)
    raise RuntimeError(f"Timed out waiting for {description}")


def randr_monitors(output):
    monitors = {}
    for line in output.splitlines()[1:]:
        match = re.fullmatch(r"\s*\d+:\s+(\S+)\s+(\d+)/(\d+)x(\d+)/(\d+)([+-]\d+)([+-]\d+)(?:\s+.*)?",
                             line.replace("+-", "-"))
        if not match:
            raise RuntimeError(f"Could not parse active RandR monitor: {line}")
        width, mm_width, height, mm_height, x, y = map(int, match.groups()[1:])
        monitors[match[1].lstrip("+*")] = dict(x=x, y=y, width=width, height=height,
                                               mm_width=mm_width, mm_height=mm_height)
    return monitors


def monitor_containing(monitors, frame):
    matches = [name for name, monitor in monitors.items()
               if monitor["x"] <= frame["x"] and monitor["y"] <= frame["y"]
               and frame["x"] + frame["width"] <= monitor["x"] + monitor["width"]
               and frame["y"] + frame["height"] <= monitor["y"] + monitor["height"]]
    return matches[0] if len(matches) == 1 else None


def gtk_target(state_path):
    import gi

    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk

    counts = {"Alpha": 0, "Beta": 0}
    windows = {}
    covering = {}
    protected_entries = {}
    cover_path = state_path.with_name("cover")
    protected_path = state_path.with_name("protected")
    covers_clicked = 0

    def record(*_args):
        state = {name: {"active": win.is_active(), "clicks": counts[name]}
                 for name, win in windows.items()}
        state["cover_clicks"] = covers_clicked
        state["covered"] = [name for name, widget in covering.items() if widget.get_visible()]
        state["protected"] = [name for name, entry in protected_entries.items() if entry.get_parent()]
        temp = state_path.with_suffix(".tmp")
        temp.write_text(json.dumps(state))
        temp.replace(state_path)

    def clicked(_button, name):
        counts[name] += 1
        record()

    def clicked_cover(_button):
        nonlocal covers_clicked
        covers_clicked += 1
        record()

    def update_overlays():
        def requested_window(path):
            try:
                return path.read_text()
            except FileNotFoundError:
                return ""

        covered = requested_window(cover_path)
        protected = requested_window(protected_path)
        changed = False
        for name, widget in covering.items():
            if widget.get_visible() != (name == covered):
                widget.set_visible(name == covered)
                changed = True
        for name, entry in protected_entries.items():
            parent = entry.get_parent()
            if name == protected and parent is None:
                windows[name].get_child().add_overlay(entry)
                entry.show()
                changed = True
            elif name != protected and parent is not None:
                parent.remove(entry)
                changed = True
        if changed:
            record()
        return True

    for name, x in [("Alpha", 80), ("Beta", 520)]:
        window = Gtk.Window(title="Tabs native handoff fixture")
        windows[name] = window
        window.set_default_size(320, 160)
        window.move(x, 130)
        button = Gtk.Button(label=f"Activate {name}")
        button.connect("clicked", clicked, name)
        overlay = Gtk.Overlay()
        overlay.add(button)
        covering[name] = cover = Gtk.Button(label="Cover selected control")
        cover.connect("clicked", clicked_cover)
        cover.set_no_show_all(True)
        overlay.add_overlay(cover)
        protected_entries[name] = entry = Gtk.Entry()
        entry.set_visibility(False)
        entry.set_halign(Gtk.Align.CENTER)
        entry.set_valign(Gtk.Align.END)
        entry.set_text("fixture-only-password")
        entry.get_accessible().set_name("Fixture password field")
        window.add(overlay)
        window.connect("notify::is-active", record)
        window.show_all()
    record()
    GLib.timeout_add(30, update_overlays)
    Gtk.main()


def run_session(backend, source, directory, stack):
    manual_monitors = backend == "x11-monitors"
    existing_session = backend in ("wayland-desktop", "x11-monitors")
    session = "x11" if backend in ("x11", "x11-monitors") else "wayland"
    env = dict(os.environ, XDG_SESSION_TYPE=session, GDK_BACKEND=session, NO_AT_BRIDGE="0")
    if not existing_session:
        env.pop("AT_SPI_BUS_ADDRESS", None)
        env["XDG_CONFIG_HOME"] = str(directory)
    if backend != "wayland-desktop":
        env.pop("WAYLAND_DISPLAY", None)
        env.pop("WAYLAND_SOCKET", None)
    env.pop("GTK_MODULES", None)

    def start(*args):
        log = stack.enter_context((directory / (Path(args[0]).name + ".log")).open("a+"))
        process = subprocess.Popen(args, env=env, stdout=log, stderr=log)

        def cleanup():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

        stack.callback(cleanup)
        return process

    def command(*args):
        return subprocess.check_output(args, env=env, text=True, timeout=5).strip()

    measurements = {}
    portal_started_by_probe = None

    def invoke(op, *, expected_error=None, measure=None, runtime_source=source, allow_moving=False, **fields):
        started = time.monotonic()
        proc = subprocess.run([sys.executable, "-"], input=runtime_source, text=True, check=True,
                              env=dict(env, COMPUTER_USE_REQUEST=json.dumps(dict(op=op, **fields))),
                              capture_output=True, timeout=25)
        result = json.loads(proc.stdout)
        if allow_moving and not result["ok"] and result["code"] == "stale_observation":
            return result
        if expected_error:
            assert not result["ok"] and result["code"] == expected_error, result
        else:
            assert result["ok"], result
        if measure:
            measurements[measure] = round(1000 * (time.monotonic() - started))
        return result

    if manual_monitors:
        monitors = randr_monitors(command("xrandr", "--listactivemonitors"))
        assert len(monitors) >= 2, "Configure at least two active RandR monitors for the manual move."
    elif backend == "x11":
        start("openbox")
        start("xcompmgr")
    elif not existing_session:
        env.pop("DISPLAY", None)
        env["XDG_RUNTIME_DIR"] = str(directory)
        if backend == "sway":
            env.update(XDG_CURRENT_DESKTOP="sway", WLR_BACKENDS="headless",
                       WLR_HEADLESS_OUTPUTS="1", WLR_RENDERER="pixman", WLR_LIBINPUT_NO_DEVICES="1")
            config = directory / "sway.conf"
            config.write_text("xwayland disable\noutput * mode 1024x768\n")
            start("sway", "--config", str(config))
            socket = wait_for("Sway socket", lambda: next(
                (path for path in directory.glob("wayland-*") if path.is_socket()), None))
            env["WAYLAND_DISPLAY"] = socket.name
        else:
            env["WAYLAND_DISPLAY"] = "wayland-tabs-smoke"
            start("weston", "--backend=headless", "--shell=kiosk-shell.so", "--no-config",
                  "--idle-time=0", f"--socket={env['WAYLAND_DISPLAY']}")
            wait_for("Weston socket", (directory / env["WAYLAND_DISPLAY"]).exists)
    if not existing_session:
        command("dbus-update-activation-environment", "XDG_SESSION_TYPE",
                *[key for key in ("DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR",
                                  "XDG_CURRENT_DESKTOP", "XDG_CONFIG_HOME") if key in env])
    if backend == "sway":
        portal_config = directory / "xdg-desktop-portal"
        portal_config.mkdir()
        (portal_config / "portals.conf").write_text(
            "[preferred]\ndefault=none\norg.freedesktop.impl.portal.ScreenCast=wlr\n")
        start("pipewire")
        wait_for("PipeWire socket", (directory / "pipewire-0").is_socket)
        portal_owner = ("gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
                        "--object-path", "/org/freedesktop/DBus", "--method",
                        "org.freedesktop.DBus.NameHasOwner", "org.freedesktop.portal.Desktop")
        assert command(*portal_owner) == "(false,)", "The fixture requires a cold desktop portal."
        cold_caps = invoke("permissions", measure="cold portal probe")["permissions"]["capabilities"]
        assert "Advertised portals: ScreenCast." in cold_caps["details"], cold_caps
        assert not cold_caps["foregroundInput"] and not cold_caps["windowCapture"], cold_caps
        portal_started_by_probe = command(*portal_owner) == "(true,)"
        assert portal_started_by_probe, "Tabs did not activate the ScreenCast portal."

    state_path = directory / "state.json"
    target = start(sys.executable, __file__, "--gtk-target", str(state_path))
    wait_for("GTK windows", state_path.exists)
    def state():
        return json.loads(state_path.read_text())

    control = directory / "control"
    control.touch()

    def list_target_windows():
        windows = [item for item in invoke("listWindows")["windows"] if item["pid"] == target.pid]
        return windows if len(windows) == 2 else None

    windows = wait_for("both AT-SPI windows", list_target_windows)
    caps = invoke("permissions", measure="permissions")["permissions"]["capabilities"]
    assert caps["session"] == session and caps["accessibilityActions"] and caps["windowSelection"], caps
    if backend == "sway":
        assert "Advertised portals: ScreenCast." in caps["details"], caps
    assert windows[0]["title"] == windows[1]["title"] and windows[0]["id"] != windows[1]["id"], windows

    def snapshot(window, **kwargs):
        return invoke("snapshot", app={"kind": "window", "id": window["id"]},
                      native={"foreground": False}, maxNodes=40, controlFile=str(control),
                      **kwargs).get("snapshot")

    observed = {window["id"]: snapshot(window, measure=f"snapshot {index + 1}")
                for index, window in enumerate(windows)}
    by_name = {}
    for window in windows:
        observation = observed[window["id"]]
        assert observation["window"]["key"] == window["id"], observation
        for name, other in [("Alpha", "Beta"), ("Beta", "Alpha")]:
            if f"Activate {name}" in observation["treeText"]:
                assert f"Activate {other}" not in observation["treeText"], observation
                by_name[name] = window
    assert len(by_name) == 2, observed

    name = "Alpha"
    if session == "x11":
        if not manual_monitors:
            assert caps["foregroundInput"] and caps["windowCapture"], caps
        xids = {}
        for candidate, window in by_name.items():
            display = observed[window["id"]].get("display", "")
            assert display, f"AT-SPI and X11 geometry did not identify the fixture window {candidate}."
            xids[display.split(":", 1)[0]] = candidate
        if manual_monitors:
            print("Focus either fixture window by its title bar so the other can be tested in the background.", flush=True)

        def active_fixture():
            try:
                active_id = command("xdotool", "getactivewindow")
            except subprocess.CalledProcessError:
                return None
            focused = xids.get(active_id)
            return (active_id, focused) if focused and state()[focused]["active"] else None

        active, focused_name = wait_for("GTK window focus", active_fixture, timeout=30 if manual_monitors else 10)
        name = "Beta" if focused_name == "Alpha" else "Alpha"
    elif state()[name]["active"]:
        name = "Beta"
    window = by_name[name]
    other = "Beta" if name == "Alpha" else "Alpha"
    observation = observed[window["id"]]

    def element(observation, name):
        for line in observation["treeText"].splitlines():
            if f'"Activate {name}"' in line:
                index = int(line.split()[0])
                token = observation["elements"][index - 1]
                assert token, observation
                return index, token
        raise AssertionError(observation)

    index, token = element(observation, name)
    _, sibling_token = element(observed[by_name[other]["id"]], other)
    request = {"app": {"kind": "window", "id": window["id"]}, "controlFile": str(control)}
    guard = {"foreground": False, "frame": observation["window"]["frame"], "elements": {index: token}}
    if session == "x11":
        guard["display"] = observation["display"]
    click = dict(request, native=guard, foreground=False, target={"kind": "element", "index": index},
                 maxNodes=40, button="left", clickCount=1)
    before = state()
    assert not before[name]["active"], before
    invoke("click", **dict(click, native=dict(guard, elements={index: sibling_token})),
           expected_error="stale_observation")
    control.unlink()
    invoke("click", **click, expected_error="user_turn")
    assert state() == before, state()
    control.touch()
    assert element(snapshot(window), name) == (index, token)
    display_checks = None
    if backend == "x11" and os.environ.get("TABS_QA_X11_MONITORS") == "1":
        monitors = command("xrandr", "--listactivemonitors")
        assert all(output in monitors for output in ("DUMMY0", "DUMMY1")), monitors
        xid, fingerprint = observation["display"].split(":", 1)
        assert fingerprint and observation["window"]["frame"]["x"] < 1024, observation
        runtime_functions, dispatcher = source.rsplit("\ntry:", 1)
        change_during_read = runtime_functions + """
fixture_node_token = node_token
def node_token(node):
    globals()["node_token"] = fixture_node_token
    subprocess.run(["xrandr", "--output", "DUMMY1", "--off"], check=True, capture_output=True, timeout=5)
    return fixture_node_token(node)
""" + "\ntry:" + dispatcher
        try:
            invoke("snapshot", **request, maxNodes=40, native={"foreground": False},
                   runtime_source=change_during_read, expected_error="stale_observation",
                   measure="refused monitor change during snapshot")
            refreshed = snapshot(window)
            assert refreshed["display"].split(":", 1)[0] == xid, refreshed
            assert refreshed["display"] != observation["display"], refreshed
            assert refreshed["window"]["frame"] == guard["frame"], refreshed
            invoke("click", **click, expected_error="stale_observation",
                   measure="refused stale monitor layout")
            assert state() == before, state()
        finally:
            command("xrandr", "--output", "DUMMY1", "--mode", "1024x768", "--pos", "1024x0")

        # The same window moves onto the second output while its sibling keeps focus.
        command("xdotool", "windowmove", "--sync", xid, "1240", "130")
        def moved_window():
            current = snapshot(window)
            return current if current["window"]["frame"]["x"] >= 1024 else None

        moved = wait_for("window on the second monitor", moved_window)
        assert moved["display"].split(":", 1)[0] == xid, moved
        invoke("click", **click, expected_error="stale_observation", measure="refused stale window move")
        assert state() == before, state()
        index, token = element(moved, name)
        guard.update(frame=moved["window"]["frame"], display=moved["display"], elements={index: token})
        click["target"] = {"kind": "element", "index": index}
        display_checks = {"windowId": xid, "duringReadLayoutRejected": True, "sameFrameLayoutRejected": True,
                          "previousFrame": observation["window"]["frame"],
                          "movedFrame": moved["window"]["frame"], "oldFrameRejected": True}
    action = invoke("click", **click, measure="background click")["action"]
    assert (action["path"], action["delivery"]) == ("accessibility", "background"), action
    wait_for("background click callback", lambda: state()[name]["clicks"] == 1)
    after = state()
    assert after == dict(before, **{name: dict(before[name], clicks=1)}), after

    physical = dict(click, foreground=True, native=dict(guard, foreground=True))
    capture_path = directory / "window.png"
    capture = dict(request, native=guard, path=str(capture_path))
    capture_size = None
    protected_capture_refused = False
    if manual_monitors:
        xid, _, fingerprint = observation["display"].partition(":")
        assert fingerprint, "The runtime did not report a RandR monitor layout fingerprint."
        origin = monitor_containing(monitors, observation["window"]["frame"])
        assert origin, "The starting fixture must fit entirely on one active monitor."
        print(f'Within 60 seconds, move the fixture with "Activate {name}" fully from {origin} onto another monitor. '
              "Keep that window still once it is there.", flush=True)

        def moved_fixture():
            current = snapshot(window, allow_moving=True)
            if current is None:
                return None
            monitor = monitor_containing(monitors, current["window"]["frame"])
            if not monitor or monitor == origin:
                return None
            time.sleep(0.5)
            settled = snapshot(window, allow_moving=True)
            if settled and settled["window"]["frame"] == current["window"]["frame"]:
                return settled, monitor
            return None

        moved, destination = wait_for("the selected fixture on another monitor", moved_fixture, timeout=60)
        assert randr_monitors(command("xrandr", "--listactivemonitors")) == monitors, "RandR layout changed during the trial."
        assert moved["window"]["key"] == window["id"] and moved["display"] == observation["display"], moved
        moved_state = state()
        invoke("click", **click, expected_error="stale_observation", measure="refused stale window move")
        assert state() == moved_state, state()
        index, token = element(moved, name)
        fresh_click = dict(click, target={"kind": "element", "index": index},
                           native=dict(guard, frame=moved["window"]["frame"], elements={index: token}))
        action = invoke("click", **fresh_click, measure="click after manual monitor move")["action"]
        assert (action["path"], action["delivery"]) == ("accessibility", "background"), action
        wait_for("click on the moved fixture", lambda: state()[name]["clicks"] == 2)
        assert state() == dict(moved_state, **{name: dict(moved_state[name], clicks=2)}), state()
        display_checks = {"windowId": xid, "randrLayoutFingerprint": fingerprint,
                          "previousMonitor": origin, "monitor": destination, "monitors": monitors,
                          "previousFrame": observation["window"]["frame"], "movedFrame": moved["window"]["frame"],
                          "oldFrameRejected": True, "freshAccessibilityClick": True}
    elif backend == "x11":
        assert command("xdotool", "getactivewindow") == active
        invoke("click", **physical, expected_error="focus_changed")
        response = invoke("screenshot", **capture, measure="background capture")
        assert response["action"]["delivery"] == "background", response
        png = capture_path.read_bytes()
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        frame = guard["frame"]
        capture_size = struct.unpack(">II", png[16:24])
        assert capture_size == (frame["width"], frame["height"])
        protected_path = directory / "protected"
        protected_path.write_text(name)
        wait_for("protected GTK field", lambda: name in state()["protected"])
        tree = snapshot(window)["treeText"]
        assert '"Fixture password field" (secure)' in tree and "fixture-only-password" not in tree, tree
        blocked_path = directory / "protected.png"
        invoke("screenshot", **dict(capture, path=str(blocked_path)),
               expected_error="sensitive_field", measure="refused protected capture")
        protected_capture_refused = not blocked_path.exists()
        assert protected_capture_refused
        protected_path.unlink()
        wait_for("protected GTK field to close", lambda: not state()["protected"])
        capture_path.unlink()
        invoke("screenshot", **capture, measure="capture after protected field closed")
        assert capture_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        command("xdotool", "windowactivate", "--sync", guard["display"].split(":", 1)[0])
        wait_for("GTK active window", lambda: state()[name]["active"])
        (directory / "cover").write_text(name)
        wait_for("same-window overlay", lambda: name in state()["covered"])
        covered_index, covered_token = element(snapshot(window), name)
        covered = dict(physical, target={"kind": "element", "index": covered_index},
                       native=dict(physical["native"], elements={covered_index: covered_token}))
        invoke("click", **covered, expected_error="target_occluded", measure="refused covered click")
        pointer_before = command("xdotool", "getmouselocation")
        invoke("scroll", **request, native=covered["native"], target=covered["target"],
               maxNodes=40, dx=0, dy=-1, foreground=True,
               expected_error="target_occluded", measure="refused covered scroll")
        invoke("drag", **request, **{"from": {"kind": "point", "x": 12, "y": 48}},
               to=covered["target"], native=covered["native"], maxNodes=40, foreground=True,
               expected_error="target_occluded", measure="refused covered drag")
        assert command("xdotool", "getmouselocation") == pointer_before
        assert state()[name]["clicks"] == 1 and state()["cover_clicks"] == 0, state()
        (directory / "cover").unlink()
        wait_for("uncovered control", lambda: not state()["covered"])
        action = invoke("click", **physical, measure="foreground click")["action"]
        assert (action["path"], action["delivery"]) == ("synthetic", "foreground"), action
        wait_for("foreground click callback", lambda: state()[name]["clicks"] == 2)
        assert state()[other]["clicks"] == 0, state()
    else:
        assert not caps["foregroundInput"] and not caps["windowCapture"], caps
        invoke("click", **physical, expected_error="unsupported_capability")
        invoke("screenshot", **capture, expected_error="unsupported_capability")
        assert state() == after and not capture_path.exists()

    print(json.dumps(dict(session=session, backend=backend, capabilities=caps, before=before, after_background=after,
                          final=state(), capture_size=capture_size,
                          protected_capture_refused=protected_capture_refused,
                          portal_started_by_probe=portal_started_by_probe,
                          display_checks=display_checks,
                          elapsed_ms=measurements), indent=2))


BACKENDS = ("x11", "wayland", "sway", "x11-monitors", "wayland-desktop")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--gtk-target":
        gtk_target(Path(sys.argv[2]))
    elif len(sys.argv) == 3 and sys.argv[1] == "--session" and sys.argv[2] in BACKENDS:
        backend = sys.argv[2]
        if backend == "x11-monitors" and (sys.platform != "linux" or os.environ.get("XDG_SESSION_TYPE") != "x11"
                                          or not all(os.environ.get(key) for key in ("DISPLAY", "DBUS_SESSION_BUS_ADDRESS"))):
            sys.exit("Run x11-monitors in a disposable graphical Linux X11 session with its session D-Bus.")
        if backend == "wayland-desktop" and (sys.platform != "linux" or os.environ.get("XDG_SESSION_TYPE") != "wayland"
                                             or not all(os.environ.get(key) for key in ("WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS"))):
            sys.exit("Run wayland-desktop inside a graphical Linux Wayland session with its session D-Bus.")
        source = sys.stdin.read()
        if not source.strip():
            sys.exit("Pipe the production Linux runtime into this fixture")
        with TemporaryDirectory(prefix="tabs-linux-handoff-") as path:
            directory = Path(path)
            try:
                with ExitStack() as stack:
                    if backend == "sway":
                        def unmount_document_portal():
                            mount = directory / "doc"
                            if mount.is_mount():
                                subprocess.run(["fusermount3", "-u", str(mount)], check=True, timeout=5)

                        stack.callback(unmount_document_portal)
                    run_session(backend, source, directory, stack)
            except Exception:
                for log in sorted(directory.glob("*.log")):
                    print(f"{log.name}\n{log.read_text()}", file=sys.stderr)
                raise
    elif sys.platform == "linux" and len(sys.argv) == 2 and sys.argv[1] in BACKENDS:
        backend = sys.argv[1]
        prefix = ["xvfb-run", "-a", "-s", "-screen 0 1024x768x24 -nolisten tcp"] if backend == "x11" else []
        bus = [] if backend in ("x11-monitors", "wayland-desktop") else ["dbus-run-session", "--"]
        child = subprocess.run([*prefix, *bus, sys.executable, __file__, "--session", backend], check=False)
        sys.exit(child.returncode)
    else:
        sys.exit(f"On Linux, pipe LINUX_RUNTIME to {sys.argv[0]} {'|'.join(BACKENDS)}")

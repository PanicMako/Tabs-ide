"""Build Finder's drag-to-Applications layout without automating Finder."""

import os
import subprocess
import sys

import dmgbuild


def estimate_image_size(app_path):
    total_bytes = 0
    try:
        output = subprocess.check_output(["du", "-sk", app_path], text=True)
        total_bytes = int(output.split()[0]) * 1024
    except Exception:
        for dirpath, _, filenames in os.walk(app_path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    st = os.lstat(fp)
                    if not os.path.islink(fp):
                        total_bytes += st.st_size
                except OSError:
                    pass
    # Tabs is a fat app bundle (>2.5 GB with bundled Code-OSS containing ~60k files).
    # HFS+ catalog files, journals, volume bitmaps, and directory records consume
    # several hundred megabytes beyond raw file sizes. Providing 1.5x + 1024MB headroom
    # (with a floor of 6144M) ensures ditto never runs out of disk space during staging.
    # dmgbuild will shrink the filesystem with `hdiutil resize -sectors min` after copying,
    # and UDZO compression discards unused sectors in the final DMG.
    size_mb = max(int(total_bytes * 1.5 / (1024 * 1024)) + 1024, 6144)
    return f"{size_mb}M"


def settings(app_path, background):
    app_name = os.path.basename(app_path)
    return {
        "format": "UDZO",
        "filesystem": "HFS+",
        "size": estimate_image_size(app_path),
        "files": [app_path],
        "symlinks": {"Applications": "/Applications"},
        "background": background,
        "window_rect": ((200, 120), (480, 560)),
        "default_view": "icon-view",
        "icon_size": 96,
        "text_size": 13,
        "icon_locations": {app_name: (240, 170), "Applications": (240, 430)},
        "hide_extensions": [app_name],
        "show_status_bar": False,
        "show_toolbar": False,
        "show_tab_view": False,
        "show_pathbar": False,
        "show_sidebar": False,
        "include_icon_view_settings": True,
    }



if __name__ == "__main__":
    app_path, output, volume_name, background = sys.argv[1:]
    if not os.path.isdir(app_path):
        raise SystemExit(f"App bundle is missing: {app_path}")
    dmgbuild.build_dmg(output, volume_name, settings=settings(app_path, background))

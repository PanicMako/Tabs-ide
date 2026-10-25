"""Build Finder's drag-to-Applications layout without automating Finder."""

import os
import sys

import dmgbuild


def settings(app_path, background):
    app_name = os.path.basename(app_path)
    return {
        "format": "UDZO",
        "filesystem": "HFS+",
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

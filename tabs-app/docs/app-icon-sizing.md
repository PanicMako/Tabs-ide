# Desktop icon sizing and fifth-treatment replacement

Updated 25 October 2026.

## Findings

The previous production SVG painted its rounded plate edge to edge on a 1024-square canvas. Electron's legacy Dock PNG and ICNS presentation did not add the transparent perimeter that neighboring macOS icons contain. Changing the output resolution alone would not change that visible size.

For a local optical comparison, the installed App Store, Safari and System Settings ICNS assets were converted to PNG with `sips`. At an alpha threshold of 128, each 256-square image has visible bounds `(25,25)` through `(231,231)`, a 206-square plate. The corrected Tabs macOS plate is 824 on a 1024-square transparent canvas, exactly the same proportion.

## Export policy

- macOS: 824-square plate centered on a 1024-square canvas; transparent 100-pixel perimeter. All ICNS resolutions and the runtime Dock PNG use the same fit.
- Windows and Linux: 896-square plate centered on a 1024-square canvas; a chosen optical margin rather than an OS-mandated value. Windows ICO includes 16, 20, 24, 32, 40, 48, 64, 128 and 256 pixel entries. Native Windows/Linux shell appearance still needs verification on those operating systems.
- Web/UI branding keeps its existing sizing; desktop presentation padding is applied only during native export.
- Packaging and manual regeneration share `scripts/lib/desktop-icon.ts`, so a release rebuild cannot reintroduce the edge-to-edge icon.

Apple's current guidance describes 1024-square layered icons and Icon Composer. Tabs currently ships legacy Electron PNG/ICNS assets; the transparent inset is an explicit presentation correction for that pipeline, not a claim that Apple mandates an 824-square source for Icon Composer.

## Fifth treatment

Only the persisted `blue-ink` option changes artwork. Its name is now Afterglow. `assets/prod/tabs-blue-ink-master.png` is extracted byte-for-byte from the supplied HTML's embedded PNG. The shared SVG exports for that option contain the raster, not approximated vector paths. A rounded presentation clip removes the rectangular outer corners without redrawing the artwork. Browser previews and native exports use the same supplied source. The other four brand designs, default choice, and marketing loading animation remain unchanged.

The HTML describes an original reference of approximately 430 square, embedded as a resampled 1024-square PNG. Higher export dimensions do not create additional source detail.

## Sources

- [Apple: App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Microsoft: Construct your Windows app's icon](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction) — exact-size entries and transparent backgrounds.
- [Microsoft: Design guidelines for Windows app icons](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design) — balanced silhouettes and small-size legibility.
- [Freedesktop: Icon Theme Specification](https://specifications.freedesktop.org/icon-theme/) — size-specific and scalable icon directories.

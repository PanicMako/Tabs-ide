/** Canonical Tabs artwork extracted as data from the approved identity handoff. */
export const TABS_MARK = {
  main: "M 61 8 C 39 8 21 26 21 48 L 21 168 C 21 205 48 230 83 230 L 180 230 C 195 230 205 242 205 257 L 205 331 C 205 358 225 378 253 378 L 360 378 C 375 378 385 366 385 351 L 385 330 C 385 317 375 312 365 310 C 353 308 347 300 347 285 L 347 224 C 347 193 325 171 297 171 L 216 171 C 201 171 191 161 191 146 L 191 48 C 191 25 172 8 149 8 Z M 76.5 108 C 70.15 108 65 113.15 65 119.5 L 65 152.5 C 65 158.85 70.15 164 76.5 164 C 82.85 164 88 158.85 88 152.5 L 88 119.5 C 88 113.15 82.85 108 76.5 108 Z M 137.5 108 C 131.15 108 126 113.15 126 119.5 L 126 152.5 C 126 158.85 131.15 164 137.5 164 C 143.85 164 149 158.85 149 152.5 L 149 119.5 C 149 113.15 143.85 108 137.5 108 Z",
  detached:
    "M 60 251 L 185 251 L 185 318 C 185 353 165 379 132 379 L 26 379 C 12 379 2 367 2 354 L 2 306 C 2 275 26 251 60 251 Z",
  wordmark:
    "M 0 1 H 94 V 17 H 60 V 80 H 38 V 17 H 0 Z M 82 80 L 118.5 1 H 150 L 185 80 H 160 L 152 62 H 112 L 103 80 Z M 120 48 H 144 L 132.5 19 Z M 192 1 H 248 C 274 1 284 11 284 24 C 284 35 279 41 269 44 C 283 46 289 55 289 65 C 289 78 279 80 252 80 H 192 Z M 212 17 V 34 H 249 C 258 34 261 31 261 26 C 261 20 256 17 249 17 Z M 212 47 V 65 H 251 C 261 65 265 62 265 56 C 265 50 261 47 251 47 Z M 384 26 H 362 V 22 C 362 17 356 15 346 15 H 328 C 314 15 310 18 310 23 C 310 29 317 31 330 33 L 355 37 C 379 40 386 48 386 62 C 386 76 373 81 349 81 H 324 C 300 81 290 75 290 57 H 313 C 313 64 318 66 330 66 H 348 C 362 66 365 63 365 58 C 365 52 358 50 345 48 L 320 44 C 298 41 291 34 291 23 C 291 7 304 0 330 0 H 350 C 372 0 384 6 384 21 Z",
} as const;
export const TABS_BRAND_COLORS = {
  cobalt: "#0E2AF3",
  referenceBlue: "#1529E9",
  ivory: "#F3EFE9",
  ink: "#111318",
} as const;
export const TABS_LOGO_VARIANTS = [
  {
    id: "signature",
    name: "Blueprint",
    bg: "#0E2AF3",
    fg: "#F3EFE9",
  },
  {
    id: "blue-white",
    name: "Daybreak",
    bg: "#FFFFFF",
    fg: "#0E2AF3",
  },
  {
    id: "mono",
    name: "Carbon Copy",
    bg: "#FFFFFF",
    fg: "#000000",
  },
  {
    id: "ivory-ink",
    name: "Moonstone",
    bg: "#111318",
    fg: "#F3EFE9",
  },
  {
    id: "blue-ink",
    name: "Afterglow",
    bg: "#111318",
    fg: "#1529E9",
  },
] as const;
export type TabsLogoVariant = (typeof TABS_LOGO_VARIANTS)[number]["id"];
export function isTabsLogoVariant(value: unknown): value is TabsLogoVariant {
  return TABS_LOGO_VARIANTS.some((variant) => variant.id === value);
}
export function resolveTabsLogoVariant(
  preference: string | undefined,
  isDark: boolean,
): TabsLogoVariant {
  if (isTabsLogoVariant(preference)) return preference;
  if (preference === "dark") return "ivory-ink";
  if (preference === "light") return "blue-white";
  return isDark ? "ivory-ink" : "blue-white";
}
export function tabsLogoSvg(
  id: TabsLogoVariant,
  format: "icon" | "symbol" | "horizontal" = "icon",
  rasterHref = "/brand/blue-ink-master.png",
): string {
  const variant = TABS_LOGO_VARIANTS.find((item) => item.id === id)!;
  if (id === "blue-ink") {
    // The fifth treatment is supplied raster artwork, not an approximation of the vector mark.
    if (format === "horizontal")
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 670 180"><image href="${rasterHref}" x="12" y="12" width="156" height="156"/><path fill="${variant.fg}" fill-rule="evenodd" transform="translate(196 46) scale(1.20)" d="${TABS_MARK.wordmark}"/></svg>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><clipPath id="blue-ink-plate"><rect width="1024" height="1024" rx="224"/></clipPath></defs><image href="${rasterHref}" width="1024" height="1024" clip-path="url(#blue-ink-plate)"/></svg>`;
  }
  const mark = `<path fill="${variant.fg}" fill-rule="evenodd" d="${TABS_MARK.main}"/><path fill="${variant.fg}" d="${TABS_MARK.detached}"/>`;
  if (format === "symbol")
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 390">${mark}</svg>`;
  if (format === "horizontal")
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 670 180"><g transform="translate(16 12) scale(.405)">${mark}</g><path fill="${variant.fg}" fill-rule="evenodd" transform="translate(196 46) scale(1.20)" d="${TABS_MARK.wordmark}"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="${variant.bg}"/><g transform="translate(145 144) scale(1.88)">${mark}</g></svg>`;
}

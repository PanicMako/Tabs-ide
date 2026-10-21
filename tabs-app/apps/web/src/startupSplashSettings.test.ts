import { expect, it } from "vitest";
import { readFirstPaintSplashSettings } from "./startupSplashSettings";

it("uses persisted loader appearance without loading the settings or router graph", () => {
  expect(
    readFirstPaintSplashSettings({
      getItem: () =>
        JSON.stringify({
          splashLoaderStyle: "solari",
          splashLoaderPalette: "block",
          splashLoaderTheme: "light",
        }),
    }),
  ).toEqual({ loader: "solari", palette: "block", theme: "light" });
});

it.each(["{invalid", "null", "42"])(
  "keeps the airport defaults for invalid optional appearance: %s",
  (value) => {
    expect(readFirstPaintSplashSettings({ getItem: () => value })).toEqual({
      loader: "solari",
      palette: "mono",
      theme: "system",
    });
  },
);

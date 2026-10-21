import type { SplashScreenProps } from "./components/SplashScreen";

export function readFirstPaintSplashSettings(storage: Pick<Storage, "getItem">): SplashScreenProps {
  try {
    const parsed = JSON.parse(storage.getItem("tabs:client-settings:v1") ?? "null") as Record<
      string,
      unknown
    > | null;
    return {
      loader: parsed?.splashLoaderStyle === "glass" ? "glass" : "solari",
      palette: parsed?.splashLoaderPalette === "block" ? "block" : "mono",
      theme:
        parsed?.splashLoaderTheme === "light" || parsed?.splashLoaderTheme === "dark"
          ? parsed.splashLoaderTheme
          : "system",
    };
  } catch {
    return { loader: "solari", palette: "mono", theme: "system" };
  }
}

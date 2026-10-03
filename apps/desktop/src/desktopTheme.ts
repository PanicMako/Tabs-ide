export function isLightDesktopTheme(themeId: string, customConfig?: unknown): boolean {
  if (themeId === "custom" || themeId.startsWith("environment:")) {
    return (
      typeof customConfig === "object" &&
      customConfig !== null &&
      "baseVariant" in customConfig &&
      customConfig.baseVariant === "light"
    );
  }
  return themeId === "tabs-light" || themeId === "solarized-light" || themeId === "light";
}

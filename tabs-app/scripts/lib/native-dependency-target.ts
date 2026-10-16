export type DesktopBuildPlatform = "mac" | "linux" | "win";
export type DesktopBuildArch = "arm64" | "x64" | "universal";

export interface NativeDependencyTarget {
  readonly installArgs: readonly string[];
  readonly requiredPackages: readonly string[];
}

export function resolveNativeDependencyTarget(
  platform: DesktopBuildPlatform,
  arch: DesktopBuildArch,
): NativeDependencyTarget {
  const os = platform === "mac" ? "darwin" : platform === "win" ? "win32" : "linux";
  const arches = arch === "universal" ? ["arm64", "x64"] : [arch];
  const requiredPackages = arches.flatMap((targetArch) => {
    const ffiSuffix =
      platform === "linux"
        ? `linux-${targetArch}-gnu`
        : `${os}-${targetArch}${platform === "win" ? "-msvc" : ""}`;
    const fffSuffix = platform === "linux" ? `linux-${targetArch}-gnu` : `${os}-${targetArch}`;
    return [`@yuuang/ffi-rs-${ffiSuffix}`, `@ff-labs/fff-bin-${fffSuffix}`];
  });

  return {
    installArgs: [
      "install",
      "--production",
      "--no-progress",
      `--os=${os}`,
      `--cpu=${arch === "universal" ? "*" : arch}`,
    ],
    requiredPackages,
  };
}

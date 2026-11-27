import type { DesktopBuildArch, DesktopBuildPlatform } from "./native-dependency-target.ts";

/** Package targets the release pipeline knows how to build and verify, per OS. */
export const SUPPORTED_TARGETS: Record<DesktopBuildPlatform, readonly string[]> = {
  mac: ["dmg"],
  linux: ["AppImage", "deb"],
  win: ["nsis", "appx"],
};

/** Architectures whose full launch/install path has been verified end to end. */
export const VERIFIED_ARCHES: Record<DesktopBuildPlatform, readonly DesktopBuildArch[]> = {
  mac: ["arm64", "x64"],
  linux: ["x64"],
  win: ["x64"],
};

export function splitTargets(target: string): string[] {
  return target
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Returns an error message when the platform/target/arch combination must not
 * be built, or null. ARM64 Windows/Linux builds are refused unless they run on
 * a native arm64 host, so x64 Electron, Code-OSS runtime files or native
 * modules can never be packed into an ARM64 artifact.
 */
export function validateBuildTarget(input: {
  readonly platform: DesktopBuildPlatform;
  readonly target: string;
  readonly arch: DesktopBuildArch;
  readonly hostArch: string;
  readonly allowUnverifiedArch?: boolean;
}): string | null {
  const targets = splitTargets(input.target);
  if (targets.length === 0) return "No package target was given.";
  for (const target of targets) {
    if (!SUPPORTED_TARGETS[input.platform].includes(target)) {
      return `Unsupported ${input.platform} target "${target}". Supported: ${SUPPORTED_TARGETS[input.platform].join(", ")}.`;
    }
  }
  if (new Set(targets).size !== targets.length)
    return `Duplicate package target in "${input.target}".`;
  if (input.platform !== "mac" && targets.includes("appx") && targets.length > 1) {
    return "The appx target must be built on its own.";
  }
  if (input.platform === "win" && targets.includes("appx") && input.arch === "arm64") {
    return "Store AppX for arm64 is not verified; build x64 only.";
  }
  if (input.arch === "arm64" && input.platform !== "mac") {
    if (input.hostArch !== "arm64") {
      return `${input.platform} arm64 packages must be built on a native arm64 host (host is ${input.hostArch}); cross-building would pack x64 binaries.`;
    }
    if (!input.allowUnverifiedArch) {
      return `${input.platform} arm64 is not yet verified (Electron, Code-OSS runtime, native modules, launch smoke). Set TABS_ALLOW_UNVERIFIED_ARCH=1 for a non-release experiment.`;
    }
  }
  return null;
}

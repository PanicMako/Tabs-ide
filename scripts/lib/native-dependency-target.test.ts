import { describe, expect, it } from "vitest";

import {
  resolveNativeDependencyTarget,
  type DesktopBuildArch,
  type DesktopBuildPlatform,
} from "./native-dependency-target";

const targets: ReadonlyArray<{
  platform: DesktopBuildPlatform;
  arch: DesktopBuildArch;
  installArgs: readonly string[];
  packages: readonly string[];
}> = [
  {
    platform: "mac",
    arch: "x64",
    installArgs: ["install", "--production", "--no-progress", "--os=darwin", "--cpu=x64"],
    packages: ["@yuuang/ffi-rs-darwin-x64", "@ff-labs/fff-bin-darwin-x64"],
  },
  {
    platform: "mac",
    arch: "arm64",
    installArgs: ["install", "--production", "--no-progress", "--os=darwin", "--cpu=arm64"],
    packages: ["@yuuang/ffi-rs-darwin-arm64", "@ff-labs/fff-bin-darwin-arm64"],
  },
  {
    platform: "linux",
    arch: "x64",
    installArgs: ["install", "--production", "--no-progress", "--os=linux", "--cpu=x64"],
    packages: ["@yuuang/ffi-rs-linux-x64-gnu", "@ff-labs/fff-bin-linux-x64-gnu"],
  },
  {
    platform: "linux",
    arch: "arm64",
    installArgs: ["install", "--production", "--no-progress", "--os=linux", "--cpu=arm64"],
    packages: ["@yuuang/ffi-rs-linux-arm64-gnu", "@ff-labs/fff-bin-linux-arm64-gnu"],
  },
  {
    platform: "win",
    arch: "x64",
    installArgs: ["install", "--production", "--no-progress", "--os=win32", "--cpu=x64"],
    packages: ["@yuuang/ffi-rs-win32-x64-msvc", "@ff-labs/fff-bin-win32-x64"],
  },
  {
    platform: "win",
    arch: "arm64",
    installArgs: ["install", "--production", "--no-progress", "--os=win32", "--cpu=arm64"],
    packages: ["@yuuang/ffi-rs-win32-arm64-msvc", "@ff-labs/fff-bin-win32-arm64"],
  },
  {
    platform: "mac",
    arch: "universal",
    installArgs: ["install", "--production", "--no-progress", "--os=darwin", "--cpu=*"],
    packages: [
      "@yuuang/ffi-rs-darwin-arm64",
      "@ff-labs/fff-bin-darwin-arm64",
      "@yuuang/ffi-rs-darwin-x64",
      "@ff-labs/fff-bin-darwin-x64",
    ],
  },
];

describe("resolveNativeDependencyTarget", () => {
  it.each(targets)(
    "maps $platform/$arch to its native optional packages",
    ({ platform, arch, installArgs, packages }) => {
      expect(resolveNativeDependencyTarget(platform, arch)).toEqual({
        installArgs,
        requiredPackages: packages,
      });
    },
  );
});

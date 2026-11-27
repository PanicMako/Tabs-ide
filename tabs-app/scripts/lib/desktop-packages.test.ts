import { describe, expect, it } from "vitest";
import { validateBuildTarget } from "./desktop-targets.ts";
import { missingDebPayloadPaths, parseDebControl, verifyDebControl } from "./linux-deb.ts";
import {
  createAppxBuildConfig,
  DEFAULT_APPX_DISPLAY_NAME,
  DEFAULT_APPX_MAX_VERSION_TESTED,
  DEFAULT_APPX_MIN_VERSION,
  readAppxManifest,
  resolveAppxIdentity,
  toAppxVersion,
  verifyAppxManifest,
} from "./windows-appx.ts";

const identityEnv = {
  TABS_APPX_IDENTITY_NAME: "Example.Tabs",
  TABS_APPX_PUBLISHER: "CN=00000000-0000-0000-0000-000000000000",
  TABS_APPX_PUBLISHER_DISPLAY_NAME: "Example Publisher",
};

describe("validateBuildTarget", () => {
  const base = { platform: "linux", target: "AppImage,deb", arch: "x64", hostArch: "x64" } as const;
  it("accepts the existing and new x64 targets", () => {
    expect(validateBuildTarget(base)).toBeNull();
    expect(validateBuildTarget({ ...base, platform: "win", target: "nsis" })).toBeNull();
    expect(validateBuildTarget({ ...base, platform: "win", target: "appx" })).toBeNull();
    expect(
      validateBuildTarget({ ...base, platform: "mac", target: "dmg", arch: "arm64" }),
    ).toBeNull();
  });
  it("rejects unknown, duplicate and mixed appx targets", () => {
    expect(validateBuildTarget({ ...base, target: "rpm" })).toContain("Unsupported");
    expect(validateBuildTarget({ ...base, target: "deb,deb" })).toContain("Duplicate");
    expect(validateBuildTarget({ ...base, platform: "win", target: "nsis,appx" })).toContain("own");
  });
  it("refuses unverified or cross-built arm64 packages", () => {
    expect(validateBuildTarget({ ...base, arch: "arm64" })).toContain("native arm64 host");
    expect(validateBuildTarget({ ...base, arch: "arm64", hostArch: "arm64" })).toContain(
      "not yet verified",
    );
    expect(
      validateBuildTarget({ ...base, arch: "arm64", hostArch: "arm64", allowUnverifiedArch: true }),
    ).toBeNull();
    expect(
      validateBuildTarget({
        ...base,
        platform: "win",
        target: "appx",
        arch: "arm64",
        hostArch: "arm64",
        allowUnverifiedArch: true,
      }),
    ).toContain("not verified");
  });
});

const appxManifestFixture = (
  name = "Example.Tabs",
  displayName = "Tabs IDE",
  appId = "Tabs",
  minVersion = DEFAULT_APPX_MIN_VERSION,
  maxVersionTested = DEFAULT_APPX_MAX_VERSION_TESTED,
) => `<Package><Identity Name="${name}" ProcessorArchitecture="x64" Publisher='CN=00000000-0000-0000-0000-000000000000' Version="2.10.0.0" />
<Properties><DisplayName>${displayName}</DisplayName><PublisherDisplayName>Example Publisher</PublisherDisplayName></Properties>
<Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="${minVersion}" MaxVersionTested="${maxVersionTested}" /></Dependencies>
<Applications><Application Id="${appId}" Executable="app\\Tabs.exe" EntryPoint="Windows.FullTrustApplication">
<uap:VisualElements DisplayName="${displayName}" Square150x150Logo="assets\\Square150x150Logo.png" Square44x44Logo="assets\\Square44x44Logo.png" Description="Tabs" BackgroundColor="#464646"/>
</Application></Applications>
<Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities></Package>`;

describe("Store AppX identity", () => {
  it("requires every Partner Center value and never defaults", () => {
    expect(() => resolveAppxIdentity({})).toThrow(/TABS_APPX_IDENTITY_NAME, TABS_APPX_PUBLISHER,/);
    expect(() => resolveAppxIdentity({ ...identityEnv, TABS_APPX_PUBLISHER: "Example" })).toThrow(
      /CN=/,
    );
    expect(() => resolveAppxIdentity({ ...identityEnv, TABS_APPX_IDENTITY_NAME: "a b" })).toThrow();
    const identity = resolveAppxIdentity(identityEnv);
    expect(identity.identityName).toBe("Example.Tabs");
    expect(identity.displayName).toBe(DEFAULT_APPX_DISPLAY_NAME);
    expect(identity.displayName).toBe("Tabs IDE");
  });
  it("supports custom display name overrides if configured", () => {
    const custom = resolveAppxIdentity({
      ...identityEnv,
      TABS_APPX_DISPLAY_NAME: "Custom Tabs IDE",
    });
    expect(custom.displayName).toBe("Custom Tabs IDE");
  });
  it("derives a four-part package version", () => {
    expect(toAppxVersion("2.10.0")).toBe("2.10.0.0");
    expect(toAppxVersion("2.10.0-beta.1")).toBe("2.10.0.0");
    expect(() => toAppxVersion("nope")).toThrow();
  });
  it("configures Store AppX builds with MinVersion > 10.0.17134.0 for Partner Center MSIX acceptance", () => {
    const config = createAppxBuildConfig(resolveAppxIdentity(identityEnv));
    expect(config.minVersion).toBe("10.0.17763.0");
    expect(config.maxVersionTested).toBe("10.0.22621.0");
    expect(config.electronUpdaterAware).toBe(false);
  });
  it("verifies the generated manifest against the identity", () => {
    const expected = {
      ...resolveAppxIdentity(identityEnv),
      version: "2.10.0",
      arch: "x64",
      minVersion: DEFAULT_APPX_MIN_VERSION,
      maxVersionTested: DEFAULT_APPX_MAX_VERSION_TESTED,
    } as const;
    const parsed = readAppxManifest(appxManifestFixture());
    expect(parsed.capabilities).toEqual(["runFullTrust"]);
    expect(parsed.displayName).toBe("Tabs IDE");
    expect(parsed.visualElementsDisplayName).toBe("Tabs IDE");
    expect(parsed.applicationId).toBe("Tabs");
    expect(parsed.targetDeviceFamilyMinVersion).toBe(DEFAULT_APPX_MIN_VERSION);
    expect(parsed.targetDeviceFamilyMaxVersionTested).toBe(DEFAULT_APPX_MAX_VERSION_TESTED);
    expect(verifyAppxManifest(appxManifestFixture(), expected)).toEqual([]);
    expect(verifyAppxManifest(appxManifestFixture("Other.Name"), expected)[0]).toContain(
      "Identity Name",
    );
  });
  it("rejects manifests targeting MinVersion <= 10.0.17134.0 or invalid MaxVersionTested", () => {
    const expected = {
      ...resolveAppxIdentity(identityEnv),
      version: "2.10.0",
      arch: "x64",
      minVersion: DEFAULT_APPX_MIN_VERSION,
      maxVersionTested: DEFAULT_APPX_MAX_VERSION_TESTED,
    } as const;
    for (const badMin of ["10.0.14316.0", "10.0.17134.0"]) {
      const problems = verifyAppxManifest(
        appxManifestFixture("Example.Tabs", "Tabs IDE", "Tabs", badMin),
        expected,
      );
      expect(problems.some((p) => p.includes("10.0.17134.0"))).toBe(true);
    }
    const inverted = verifyAppxManifest(
      appxManifestFixture("Example.Tabs", "Tabs IDE", "Tabs", "10.0.22621.0", "10.0.17763.0"),
      expected,
    );
    expect(inverted.some((p) => p.includes("MaxVersionTested"))).toBe(true);
    const missingDeps = verifyAppxManifest(
      appxManifestFixture().replace(/<Dependencies>[\s\S]*?<\/Dependencies>/, ""),
      expected,
    );
    expect(missingDeps.some((p) => p.includes("TargetDeviceFamily MinVersion"))).toBe(true);
    expect(missingDeps.some((p) => p.includes("TargetDeviceFamily MaxVersionTested"))).toBe(true);
  });
  it("rejects packages where DisplayName is Tabs instead of reserved Tabs IDE", () => {
    const expected = {
      ...resolveAppxIdentity(identityEnv),
      version: "2.10.0",
      arch: "x64",
    } as const;
    const problems = verifyAppxManifest(appxManifestFixture("Example.Tabs", "Tabs"), expected);
    expect(
      problems.some((p) =>
        p.includes("Package Properties DisplayName is Tabs; expected Tabs IDE."),
      ),
    ).toBe(true);
    expect(
      problems.some((p) => p.includes("VisualElements DisplayName is Tabs; expected Tabs IDE.")),
    ).toBe(true);
  });
  it("rejects altered application IDs", () => {
    const expected = {
      ...resolveAppxIdentity(identityEnv),
      version: "2.10.0",
      arch: "x64",
    } as const;
    const problems = verifyAppxManifest(
      appxManifestFixture("Example.Tabs", "Tabs IDE", "AlteredAppId"),
      expected,
    );
    expect(problems.some((p) => p.includes("Application Id is AlteredAppId; expected Tabs."))).toBe(
      true,
    );
  });
});

describe("Debian package checks", () => {
  const info = ` Package: tabs-desktop\n Version: 2.10.0\n Architecture: amd64\n Maintainer: Tabs <a@b.c>\n`;
  it("checks architecture and version", () => {
    const control = parseDebControl(info);
    expect(verifyDebControl(control, { version: "2.10.0", arch: "x64" })).toEqual([]);
    expect(verifyDebControl(control, { version: "2.10.0", arch: "arm64" })[0]).toContain(
      "Architecture",
    );
    expect(verifyDebControl(control, { version: "2.11.0", arch: "x64" })[0]).toContain("Version");
  });
  it("reports missing payload paths", () => {
    expect(missingDebPayloadPaths("./opt/Tabs/resources/app.asar\n")).toHaveLength(2);
  });
});

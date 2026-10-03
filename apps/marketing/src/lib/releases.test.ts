import { describe, it, expect } from "vitest";
import {
  validateRelease,
  pickAsset,
  detectPlatform,
  RELEASES_URL,
  selectDownloadRelease,
  releaseChannel,
} from "./releases";
import snapshot from "../data/releases.json";

// Keep channel tests independent of the snapshot refreshed during deployment.
const stableVersion = "1.3.30";
const stableSnapshot = validateRelease({
  tag_name: `v${stableVersion}`,
  name: "Stable test release",
  body: "Stable release notes.",
  html_url: `${RELEASES_URL}/tag/v${stableVersion}`,
  published_at: "2026-10-02T12:00:00Z",
  prerelease: false,
  assets: [
    `Tabs-${stableVersion}-arm64.dmg`,
    `Tabs-${stableVersion}-x64.dmg`,
    `Tabs-${stableVersion}-x64.exe`,
    `Tabs-${stableVersion}-x86_64.AppImage`,
    `Tabs-${stableVersion}-arm64.zip`,
    `Tabs-${stableVersion}-x64.zip`,
    "latest.yml",
    "latest-linux.yml",
    "tabs-mac-preview-update.json",
    "tabs-mac-preview-update.json.sig",
  ].map((name) => ({
    name,
    browser_download_url: `${RELEASES_URL}/download/v${stableVersion}/${name}`,
  })),
});

describe("latest-release downloads", () => {
  it("selects the correct architecture without downloading a blockmap", () => {
    const r = validateRelease(snapshot[0]);
    expect(pickAsset(r, "mac-arm64")).toMatch(/-arm64\.dmg$/);
    expect(pickAsset(r, "mac-x64")).toMatch(/-x64\.dmg$/);
    expect(pickAsset(r, "windows-x64")).toMatch(/-x64\.exe$/);
    expect(pickAsset(r, "linux-x64")).toMatch(/-x86_64\.AppImage$/);
    expect(pickAsset({ ...r, assets: [] }, "windows-x64")).toBeNull();
  });
  it("resolves a future version without a hardcoded version", () => {
    const old = snapshot[0]!;
    const future = JSON.parse(
      JSON.stringify(old)
        .replaceAll(old.tag_name, "v1.4.0")
        .replaceAll(old.tag_name.slice(1), "1.4.0"),
    );
    expect(pickAsset(validateRelease(future), "windows-x64")).toContain(
      "/v1.4.0/Tabs-1.4.0-x64.exe",
    );
  });
  it("rejects rate limit errors and external asset URLs", () => {
    expect(() => validateRelease({ message: "rate limited" })).toThrow();
    expect(releaseChannel(validateRelease({ ...snapshot[0], prerelease: true }))).toBe("beta");
    expect(() =>
      validateRelease({
        ...snapshot[0],
        assets: [{ name: "evil.exe", browser_download_url: "https://example.com/evil.exe" }],
      }),
    ).toThrow();
    expect(() =>
      validateRelease({ ...snapshot[0], html_url: `${RELEASES_URL}/tag/wrong` }),
    ).toThrow();
  });
  it("does not guess Mac architecture or deliver x64 to mobile and ARM", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBeNull();
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows-x64");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux-x64");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14)")).toBeNull();
    expect(detectPlatform("Mozilla/5.0 (X11; Linux aarch64)")).toBeNull();
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; ARM64)")).toBeNull();
  });
});

describe("public beta channel", () => {
  const stable = stableSnapshot;
  const beta = {
    ...JSON.parse(
      JSON.stringify(stable)
        .replaceAll(stableVersion, "1.3.31-beta.1")
        .replaceAll(`v${stableVersion}`, "v1.3.31-beta.1"),
    ),
    prerelease: true,
    published_at: "2026-10-03T12:00:00Z",
  };
  beta.assets.push(
    ...beta.assets
      .filter(
        (asset: { name: string }) =>
          asset.name === "latest.yml" || asset.name === "latest-linux.yml",
      )
      .map((asset: { name: string; browser_download_url: string }) => ({
        ...asset,
        name: asset.name.replace("latest", "beta"),
        browser_download_url: asset.browser_download_url.replace("latest", "beta"),
      })),
  );
  it("accepts a complete beta and retains its channel", () => {
    expect(releaseChannel(validateRelease(beta))).toBe("beta");
    expect(selectDownloadRelease([stable, beta])?.tag_name).toBe("v1.3.31-beta.1");
  });
  it("selects the plain v1.3.31 prerelease with beta metadata", () => {
    const plainBeta = JSON.parse(JSON.stringify(beta).replaceAll("1.3.31-beta.1", "1.3.31"));
    expect(releaseChannel(validateRelease(plainBeta))).toBe("beta");
    expect(selectDownloadRelease([stable, plainBeta])?.tag_name).toBe("v1.3.31");
  });
  it("selects stable deterministically when newer", () => {
    expect(
      selectDownloadRelease([beta, { ...stable, published_at: "2026-10-04T12:00:00Z" }])?.tag_name,
    ).toBe(stable.tag_name);
  });
  it.each([
    "v1.3.31-alpha.1",
    "v1.3.31-nightly.1",
    "v1.3.31-internal.1",
    "v1.3.31-beta",
    "v1.3.31-beta.01",
  ])("rejects nonpublic or malformed tag %s", (tag_name) => {
    expect(() => validateRelease({ ...beta, tag_name })).toThrow();
  });
  it("rejects drafts, incomplete releases, and empty feeds", () => {
    expect(selectDownloadRelease([{ ...beta, draft: true }])).toBeUndefined();
    for (const asset of beta.assets.filter(
      (a: { name: string }) => !a.name.endsWith(".blockmap"),
    )) {
      expect(
        selectDownloadRelease([
          { ...beta, assets: beta.assets.filter((a: { name: string }) => a.name !== asset.name) },
        ]),
      ).toBeUndefined();
    }
    expect(selectDownloadRelease([])).toBeUndefined();
    expect(() => validateRelease({ ...beta, prerelease: false })).toThrow();
  });
});

it("accepts a plain v1.3.31 tag explicitly marked Pre-release", () => {
  const release = JSON.parse(JSON.stringify(stableSnapshot).replaceAll(stableVersion, "1.3.31"));
  release.prerelease = true;
  expect(releaseChannel(validateRelease(release))).toBe("beta");
});

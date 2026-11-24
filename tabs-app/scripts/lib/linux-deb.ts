/** Debian package metadata checks, parsed from `dpkg-deb --info` output. */
export const DEB_ARCH_BY_BUILD_ARCH = { x64: "amd64", arm64: "arm64" } as const;

export function parseDebControl(info: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of info.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^\s?([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (match?.[1]) fields[match[1]] = (match[2] ?? "").trim();
  }
  return fields;
}

export function verifyDebControl(
  control: Record<string, string>,
  expected: { readonly version: string; readonly arch: keyof typeof DEB_ARCH_BY_BUILD_ARCH },
): string[] {
  const problems: string[] = [];
  const wantedArch = DEB_ARCH_BY_BUILD_ARCH[expected.arch];
  if (control.Architecture !== wantedArch) {
    problems.push(
      `Architecture is ${control.Architecture ?? "<missing>"}; expected ${wantedArch}.`,
    );
  }
  // Debian normalises "2.10.0-beta.1" to "2.10.0~beta.1"; accept either spelling.
  const normalised = (control.Version ?? "").replace("~", "-");
  if (normalised !== expected.version) {
    problems.push(`Version is ${control.Version ?? "<missing>"}; expected ${expected.version}.`);
  }
  if (!control.Maintainer) problems.push("Maintainer is empty.");
  if (!control.Package) problems.push("Package name is empty.");
  return problems;
}

/** Paths that must exist in the .deb payload (from `dpkg-deb --contents`). */
export const REQUIRED_DEB_PAYLOAD_PATHS = [
  "resources/app.asar",
  "resources/tabs-code-oss/out-build/nls.messages.json",
  "resources/tabs-code-oss/node_modules/minimist/index.js",
] as const;

export function missingDebPayloadPaths(contents: string): string[] {
  return REQUIRED_DEB_PAYLOAD_PATHS.filter((required) => !contents.includes(`/${required}`));
}

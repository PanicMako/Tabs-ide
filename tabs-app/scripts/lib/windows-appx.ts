/**
 * Microsoft Store (AppX/MSIX) packaging identity.
 *
 * The identity must be copied verbatim from Partner Center → Product identity
 * (Package/Identity/Name, Package/Identity/Publisher and the publisher display
 * name). Nothing here has a default on purpose: guessing an identity produces a
 * package Partner Center rejects, or worse, one that collides with another
 * product.
 */
export interface AppxIdentity {
  readonly identityName: string;
  readonly publisher: string;
  readonly publisherDisplayName: string;
  readonly displayName: string;
}

export const DEFAULT_APPX_DISPLAY_NAME = "Tabs IDE";
/** Windows 10 1809; Partner Center rejects MSIX packages targeting MinVersion <= 10.0.17134.0. */
export const DEFAULT_APPX_MIN_VERSION = "10.0.17763.0";
export const DEFAULT_APPX_MAX_VERSION_TESTED = "10.0.22621.0";
const STORE_MSIX_MIN_EXCLUSIVE_VERSION = "10.0.17134.0";

export const APPX_IDENTITY_ENV = {
  identityName: "TABS_APPX_IDENTITY_NAME",
  publisher: "TABS_APPX_PUBLISHER",
  publisherDisplayName: "TABS_APPX_PUBLISHER_DISPLAY_NAME",
  displayName: "TABS_APPX_DISPLAY_NAME",
} as const;

export type AppxEnvironment = Readonly<Record<string, string | undefined>>;

/** electron-builder's own bounds for Identity Name (3-50 of [A-Za-z0-9.-]). */
const IDENTITY_NAME_PATTERN = /^[A-Za-z0-9.-]{3,50}$/;
/** Partner Center publishes the publisher as a distinguished name, e.g. `CN=<GUID>`. */
const PUBLISHER_PATTERN = /^CN=\S.*$/;

export function resolveAppxIdentity(env: AppxEnvironment): AppxIdentity {
  const read = (key: string) => env[key]?.trim() ?? "";
  const identityName = read(APPX_IDENTITY_ENV.identityName);
  const publisher = read(APPX_IDENTITY_ENV.publisher);
  const publisherDisplayName = read(APPX_IDENTITY_ENV.publisherDisplayName);
  const displayName = read(APPX_IDENTITY_ENV.displayName) || DEFAULT_APPX_DISPLAY_NAME;

  const requiredKeys = [
    APPX_IDENTITY_ENV.identityName,
    APPX_IDENTITY_ENV.publisher,
    APPX_IDENTITY_ENV.publisherDisplayName,
  ] as const;
  const missing = requiredKeys.filter((key) => read(key) === "");
  if (missing.length > 0) {
    throw new Error(
      `Microsoft Store packaging needs the Partner Center product identity. Missing: ${missing.join(", ")}. ` +
        "Copy the values from Partner Center → Product identity; they are never inferred.",
    );
  }
  if (!IDENTITY_NAME_PATTERN.test(identityName)) {
    throw new Error(
      `${APPX_IDENTITY_ENV.identityName} must be 3-50 characters of letters, digits, '.' or '-'.`,
    );
  }
  if (!PUBLISHER_PATTERN.test(publisher)) {
    throw new Error(
      `${APPX_IDENTITY_ENV.publisher} must be the Partner Center publisher distinguished name (for example "CN=...").`,
    );
  }
  return { identityName, publisher, publisherDisplayName, displayName };
}

/** Windows package versions are four numeric parts; the Store reserves the last one. */
export function toAppxVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`Cannot derive a Windows package version from "${version}".`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

export function createAppxBuildConfig(identity: AppxIdentity) {
  return {
    identityName: identity.identityName,
    publisher: identity.publisher,
    publisherDisplayName: identity.publisherDisplayName,
    applicationId: "Tabs",
    displayName: identity.displayName,
    minVersion: DEFAULT_APPX_MIN_VERSION,
    maxVersionTested: DEFAULT_APPX_MAX_VERSION_TESTED,
    artifactName: "Tabs-${version}-${arch}.${ext}",
    // Store-managed updates only: never write electron-updater metadata.
    electronUpdaterAware: false,
    setBuildNumber: false,
  };
}

export interface AppxManifestFacts {
  readonly identityName: string | null;
  readonly publisher: string | null;
  readonly publisherDisplayName: string | null;
  readonly displayName: string | null;
  readonly visualElementsDisplayName: string | null;
  readonly applicationId: string | null;
  readonly version: string | null;
  readonly processorArchitecture: string | null;
  readonly executable: string | null;
  readonly capabilities: readonly string[];
  readonly targetDeviceFamilyMinVersion: string | null;
  readonly targetDeviceFamilyMaxVersionTested: string | null;
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function parseWindowsVersion(
  value: string | null,
): readonly [number, number, number, number] | null {
  if (!value) return null;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const;
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)) return null;
  return parts;
}

function compareWindowsVersions(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  for (let i = 0; i < 4; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

export function readAppxManifest(xml: string): AppxManifestFacts {
  const identityTag = xml.match(/<Identity\b[^>]*>/)?.[0] ?? "";
  const applicationTag = xml.match(/<Application\b[^>]*>/)?.[0] ?? "";
  const propertiesTag = xml.match(/<Properties\b[^>]*>([\s\S]*?)<\/Properties>/)?.[1] ?? "";
  const publisherDisplayName =
    propertiesTag.match(/<PublisherDisplayName>([^<]*)<\/PublisherDisplayName>/)?.[1] ??
    xml.match(/<PublisherDisplayName>([^<]*)<\/PublisherDisplayName>/)?.[1] ??
    null;
  const displayName =
    propertiesTag.match(/<DisplayName>([^<]*)<\/DisplayName>/)?.[1] ??
    xml.match(/<Properties\b[^>]*>[\s\S]*?<DisplayName>([^<]*)<\/DisplayName>/)?.[1] ??
    xml.match(/<DisplayName>([^<]*)<\/DisplayName>/)?.[1] ??
    null;
  const visualElementsTag = xml.match(/<(?:uap:)?VisualElements\b[^>]*>/)?.[0] ?? "";
  const visualElementsDisplayName = attribute(visualElementsTag, "DisplayName");
  const capabilities = [...xml.matchAll(/<(?:\w+:)?Capability\b[^>]*\sName\s*=\s*"([^"]+)"/g)].map(
    (m) => m[1] as string,
  );
  const targetDeviceFamilyTags = [...xml.matchAll(/<(?:\w+:)?TargetDeviceFamily\b[^>]*>/g)].map(
    (m) => m[0],
  );
  const desktopFamilyTag =
    targetDeviceFamilyTags.find((tag) => attribute(tag, "Name") === "Windows.Desktop") ??
    targetDeviceFamilyTags[0] ??
    "";
  return {
    identityName: attribute(identityTag, "Name"),
    publisher: attribute(identityTag, "Publisher"),
    publisherDisplayName,
    displayName,
    visualElementsDisplayName,
    applicationId: attribute(applicationTag, "Id"),
    version: attribute(identityTag, "Version"),
    processorArchitecture: attribute(identityTag, "ProcessorArchitecture"),
    executable: attribute(applicationTag, "Executable"),
    capabilities,
    targetDeviceFamilyMinVersion: attribute(desktopFamilyTag, "MinVersion"),
    targetDeviceFamilyMaxVersionTested: attribute(desktopFamilyTag, "MaxVersionTested"),
  };
}

/** Returns a list of human-readable problems; empty means the manifest is acceptable. */
export function verifyAppxManifest(
  xml: string,
  expected: AppxIdentity & {
    readonly version: string;
    readonly arch: "x64" | "arm64";
    readonly minVersion?: string;
    readonly maxVersionTested?: string;
  },
): string[] {
  const facts = readAppxManifest(xml);
  const problems: string[] = [];
  const check = (label: string, actual: string | null, wanted: string) => {
    if (actual !== wanted)
      problems.push(`${label} is ${actual ?? "<missing>"}; expected ${wanted}.`);
  };
  check("Identity Name", facts.identityName, expected.identityName);
  check("Identity Publisher", facts.publisher, expected.publisher);
  check("PublisherDisplayName", facts.publisherDisplayName, expected.publisherDisplayName);
  check("Package Properties DisplayName", facts.displayName, expected.displayName);
  if (facts.visualElementsDisplayName !== null) {
    check("VisualElements DisplayName", facts.visualElementsDisplayName, expected.displayName);
  }
  check("Application Id", facts.applicationId, "Tabs");
  check("Identity Version", facts.version, toAppxVersion(expected.version));
  check("ProcessorArchitecture", facts.processorArchitecture, expected.arch);
  if (!facts.executable?.endsWith("Tabs.exe")) {
    problems.push(
      `Application Executable is ${facts.executable ?? "<missing>"}; expected Tabs.exe.`,
    );
  }
  if (!facts.capabilities.includes("runFullTrust")) {
    problems.push("Manifest does not declare the runFullTrust capability.");
  }
  const storeMinExclusive = parseWindowsVersion(STORE_MSIX_MIN_EXCLUSIVE_VERSION)!;
  const minVersion = parseWindowsVersion(facts.targetDeviceFamilyMinVersion);
  if (!minVersion) {
    problems.push(
      `TargetDeviceFamily MinVersion is ${facts.targetDeviceFamilyMinVersion ?? "<missing>"}; expected a 4-part version > ${STORE_MSIX_MIN_EXCLUSIVE_VERSION}.`,
    );
  } else if (compareWindowsVersions(minVersion, storeMinExclusive) <= 0) {
    problems.push(
      `TargetDeviceFamily MinVersion is ${facts.targetDeviceFamilyMinVersion}; Microsoft Store rejects MSIX packages targeting MinVersion <= ${STORE_MSIX_MIN_EXCLUSIVE_VERSION}.`,
    );
  } else if (expected.minVersion) {
    check("TargetDeviceFamily MinVersion", facts.targetDeviceFamilyMinVersion, expected.minVersion);
  }
  const maxVersionTested = parseWindowsVersion(facts.targetDeviceFamilyMaxVersionTested);
  if (!maxVersionTested) {
    problems.push(
      `TargetDeviceFamily MaxVersionTested is ${facts.targetDeviceFamilyMaxVersionTested ?? "<missing>"}; expected a 4-part version >= MinVersion.`,
    );
  } else {
    if (minVersion && compareWindowsVersions(maxVersionTested, minVersion) < 0) {
      problems.push(
        `TargetDeviceFamily MaxVersionTested (${facts.targetDeviceFamilyMaxVersionTested}) must be >= MinVersion (${facts.targetDeviceFamilyMinVersion}).`,
      );
    }
    if (expected.maxVersionTested) {
      check(
        "TargetDeviceFamily MaxVersionTested",
        facts.targetDeviceFamilyMaxVersionTested,
        expected.maxVersionTested,
      );
    }
  }
  return problems;
}

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
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match ? (match[1] ?? match[2] ?? null) : null;
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
  };
}

/** Returns a list of human-readable problems; empty means the manifest is acceptable. */
export function verifyAppxManifest(
  xml: string,
  expected: AppxIdentity & { readonly version: string; readonly arch: "x64" | "arm64" },
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
  return problems;
}

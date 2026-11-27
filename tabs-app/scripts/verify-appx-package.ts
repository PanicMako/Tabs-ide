// Usage: node --experimental-strip-types verify-appx-package.ts <AppxManifest.xml> <version> [x64|arm64]
// The workflow extracts the .appx (a zip) first; identity is read from the same env as the build.
import { readFileSync } from "node:fs";
import {
  DEFAULT_APPX_MAX_VERSION_TESTED,
  DEFAULT_APPX_MIN_VERSION,
  readAppxManifest,
  resolveAppxIdentity,
  verifyAppxManifest,
} from "./lib/windows-appx.ts";

const [manifestPath, version, arch = "x64"] = process.argv.slice(2);
if (!manifestPath || !version || (arch !== "x64" && arch !== "arm64")) {
  console.error("usage: verify-appx-package.ts <AppxManifest.xml> <version> [x64|arm64]");
  process.exit(2);
}

const manifestXml = readFileSync(manifestPath, "utf8");
const identity = resolveAppxIdentity(process.env);
const problems = verifyAppxManifest(manifestXml, {
  ...identity,
  version,
  arch: arch as "x64" | "arm64",
  minVersion: DEFAULT_APPX_MIN_VERSION,
  maxVersionTested: DEFAULT_APPX_MAX_VERSION_TESTED,
});

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`::error::${problem}`);
  }
  process.exit(1);
}

const facts = readAppxManifest(manifestXml);
console.log(`AppX manifest verified successfully:`);
console.log(`  Package/Properties/DisplayName: ${facts.displayName}`);
console.log(`  VisualElements DisplayName:     ${facts.visualElementsDisplayName}`);
console.log(`  Package/Identity Name:          ${facts.identityName}`);
console.log(`  Package/Identity Publisher:     ${facts.publisher}`);
console.log(`  PublisherDisplayName:           ${facts.publisherDisplayName}`);
console.log(`  Application Id:                 ${facts.applicationId}`);
console.log(`  Identity Version:               ${facts.version}`);
console.log(`  ProcessorArchitecture:          ${facts.processorArchitecture}`);
console.log(`  Executable:                     ${facts.executable}`);
console.log(`  Capabilities:                   ${facts.capabilities.join(", ")}`);
console.log(`  TargetDeviceFamily MinVersion:  ${facts.targetDeviceFamilyMinVersion}`);
console.log(`  TargetDeviceFamily MaxTested:   ${facts.targetDeviceFamilyMaxVersionTested}`);

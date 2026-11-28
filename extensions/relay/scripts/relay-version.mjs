#!/usr/bin/env node

const listing = "https://exchange.buildwithtabs.com/v1/extensions/panicmako/relay?limit=1";
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: node relay-version.mjs [--installed <version>]");
  process.exit(0);
}

try {
  const installed = args[1];
  if (
    args.length !== 0 &&
    (args.length !== 2 || args[0] !== "--installed" || !versionPattern.test(installed))
  ) {
    throw new Error("Usage: node relay-version.mjs [--installed <version>]");
  }

  const response = await fetch(listing, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Exchange returned HTTP ${response.status}.`);
  const { versions } = await response.json();
  if (!Array.isArray(versions) || versions.length > 1) {
    throw new Error("Exchange returned an invalid Relay listing.");
  }
  const release = versions[0];
  if (!release) {
    console.log("Exchange has no published Relay versions.");
  } else {
    const { version } = release;
    const api = release.manifest?.engines?.api;
    if (
      typeof version !== "string" || !versionPattern.test(version) ||
      typeof api !== "string" || !/^[\x20-\x7e]{1,128}$/.test(api)
    ) {
      throw new Error("Exchange returned invalid Relay version information.");
    }
    console.log(`Relay ${version} is the newest release on Tabs Exchange (extension API ${api}).`);
    if (installed !== undefined) {
      console.log(
        installed === version
          ? "You have that version installed."
          : `Your installed version is ${installed}.`,
      );
    }
  }
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`Could not check Relay on Exchange. ${message}`);
  process.exitCode = 1;
}

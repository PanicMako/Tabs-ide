import type { DesktopExchangeListing } from "@tabs/contracts";

export function filterExchangeListings(
  listings: readonly DesktopExchangeListing[],
  publisher: "all" | "verified",
  access: "all" | "none" | "network" | "workspace-read",
) {
  return listings.filter(
    (listing) =>
      (publisher === "all" || listing.verifiedPublisher) &&
      (access === "all" ||
        (access === "none"
          ? listing.capabilities.length === 0
          : listing.capabilities.includes(access))),
  );
}

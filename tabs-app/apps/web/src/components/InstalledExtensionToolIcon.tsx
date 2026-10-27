import { useEffect, useState } from "react";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { TabsExtensionIcon } from "./Icons";

/** Uses the same registry listing icon as the marketplace, without loading its UI. */
export function InstalledExtensionToolIcon({
  extension,
}: {
  readonly extension: DesktopInstalledExtension | undefined;
}) {
  const [image, setImage] = useState<{ identity: string; data: string } | null>(null);
  const identity = extension
    ? `${extension.registryOrigin}:${extension.id}:${extension.manifest.version}:${extension.digest}`
    : "";
  useEffect(() => {
    let cancelled = false;
    const bridge = window.desktopBridge;
    if (
      extension?.source === "exchange" &&
      extension.registryOrigin &&
      extension.manifest.listing?.icon &&
      bridge?.getExchangeListingAsset
    ) {
      void bridge
        .getExchangeListingAsset(
          {
            registryOrigin: extension.registryOrigin,
            id: extension.id,
            namespace: extension.manifest.publisher,
            name: extension.manifest.name,
            version: extension.manifest.version,
            digest: extension.digest ?? "",
            displayName: extension.manifest.displayName,
            description: extension.manifest.description,
            verifiedPublisher: false,
            tabsCompatibility: extension.manifest.engines.tabs,
            capabilities: extension.manifest.capabilities ?? [],
            listingAssets: { icon: true, readme: false, screenshots: 0 },
          },
          "icon",
        )
        .then((asset) => {
          if (!cancelled) setImage(asset ? { identity, data: asset.data } : null);
        })
        .catch(() => {
          if (!cancelled) setImage(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [extension, identity]);
  return image?.identity === identity ? (
    <img
      src={image.data}
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-md object-contain"
      onError={() => setImage(null)}
    />
  ) : (
    <TabsExtensionIcon aria-hidden="true" className="size-4" />
  );
}

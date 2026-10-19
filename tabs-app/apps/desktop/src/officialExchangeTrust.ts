import * as Crypto from "node:crypto";
import { Metadata, MetadataKind } from "@tufjs/models";
import type { ExchangeTrustConfiguration } from "./exchangeInstall";
import { DEFAULT_EXCHANGE_ORIGIN } from "./registryTrustStore";

// Public root v1 matched to the operator release record on 2026-10-19.
// This initial anchor ships with Tabs. Never replace it from catalog responses;
// tuf-js verifies subsequent root rotations and metadata expiry.
export const OFFICIAL_EXCHANGE_ROOT_SHA256 =
  "fcaf50f87eead342fa2b3e5535ce85e7416b388feae9be29424d3f8112ca286e";
export const OFFICIAL_EXCHANGE_ROOT =
  '{"signed":{"_type":"root","spec_version":"1.0.0","version":1,"expires":"2027-10-19T08:50:09.223Z","consistent_snapshot":false,"keys":{"4e669f3a87f353bf3c663b2b1592551dcf4f590ee125eb42d0422b29f50be530":{"keytype":"ed25519","scheme":"ed25519","keyval":{"public":"d9b33c834b6bbfa2e6b5b9f9c08ffeda5ab6102d4af05a9e37889a05ab4eed8f"}},"770eb1945acd005345282e75bb69ef7dc58c834f05817cdda7020048a30fb111":{"keytype":"ed25519","scheme":"ed25519","keyval":{"public":"b2738b485372178e9075548c1cffd6d1ee00ae49901b83155c5c80f38b112316"}},"482366ecdc743f9278c00672b5b870b6ff0e4201a60614fa501d7463a60ee9d2":{"keytype":"ed25519","scheme":"ed25519","keyval":{"public":"894dd4f02358e7fe72e3dfe3227943187e97d8f90b2ccb6782290e5518ff8071"}},"c46d535bce7d5bd19898f349d44bad97f77eee00bfad9121c853d9657c01af56":{"keytype":"ed25519","scheme":"ed25519","keyval":{"public":"4db8341bceca78343a1ee05f9b69215039dd5ac6f2b9d7dde491441df8c4dbca"}}},"roles":{"root":{"keyids":["4e669f3a87f353bf3c663b2b1592551dcf4f590ee125eb42d0422b29f50be530"],"threshold":1},"targets":{"keyids":["770eb1945acd005345282e75bb69ef7dc58c834f05817cdda7020048a30fb111"],"threshold":1},"snapshot":{"keyids":["482366ecdc743f9278c00672b5b870b6ff0e4201a60614fa501d7463a60ee9d2"],"threshold":1},"timestamp":{"keyids":["c46d535bce7d5bd19898f349d44bad97f77eee00bfad9121c853d9657c01af56"],"threshold":1}}},"signatures":[{"keyid":"4e669f3a87f353bf3c663b2b1592551dcf4f590ee125eb42d0422b29f50be530","sig":"408b5d3442da0c861d1638a55b80b47031763d3affd90e8966b670db677bcf4ac438552e90b94f89688cf93860bd4d70607f37465c8625f68b11ad8d59a0df01"}]}';

export function officialExchangeTrust(origin: string): ExchangeTrustConfiguration | null {
  if (origin !== DEFAULT_EXCHANGE_ORIGIN) return null;
  const root = Buffer.from(OFFICIAL_EXCHANGE_ROOT);
  if (Crypto.createHash("sha256").update(root).digest("hex") !== OFFICIAL_EXCHANGE_ROOT_SHA256)
    throw new Error("Bundled Exchange certificate fingerprint is invalid.");
  const metadata = Metadata.fromJSON(MetadataKind.Root, JSON.parse(root.toString("utf8")));
  metadata.verifyDelegate("root", metadata);
  return { origin, root, trustId: "registry-fcaf50f87eead342" };
}

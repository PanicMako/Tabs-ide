import * as Crypto from "node:crypto";
import { Metadata, MetadataKind } from "@tufjs/models";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXCHANGE_ORIGIN } from "./registryTrustStore";
import { officialExchangeTrust, OFFICIAL_EXCHANGE_ROOT_SHA256 } from "./officialExchangeTrust";

describe("bundled official Exchange certificate", () => {
  it("makes a fresh desktop ready without user configuration, with the pinned signed public root", () => {
    const trust = officialExchangeTrust(DEFAULT_EXCHANGE_ORIGIN)!;
    expect(trust.trustId).toBe("registry-fcaf50f87eead342");
    expect(Crypto.createHash("sha256").update(trust.root).digest("hex")).toBe(
      OFFICIAL_EXCHANGE_ROOT_SHA256,
    );
    const root = Metadata.fromJSON(MetadataKind.Root, JSON.parse(trust.root.toString("utf8")));
    expect(() => root.verifyDelegate("root", root)).not.toThrow();
    expect(root.signed.version).toBe(1);
  });
  it("never grants the official certificate to a private registry or lookalike origin", () => {
    for (const origin of [
      "https://private.example",
      DEFAULT_EXCHANGE_ORIGIN + ".evil.example",
      DEFAULT_EXCHANGE_ORIGIN + "/",
      "http://exchange.buildwithtabs.com",
    ])
      expect(officialExchangeTrust(origin)).toBeNull();
  });
});

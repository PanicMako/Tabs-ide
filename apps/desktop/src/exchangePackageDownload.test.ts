import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadSignedExchangePackage } from "./exchangePackageDownload";

const origin = "https://exchange.tabs.example";
const body = Buffer.from("signed package fixture");
const target = {
  path: "extensions/acme/dashboard/1.0.0.tabsext",
  bytes: body.length,
  digest: Crypto.createHash("sha256").update(body).digest("hex"),
};
const roots: string[] = [];
const stagingRoot = () => {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-exchange-download-test-"));
  roots.push(root);
  return root;
};
const respond = (bytes: Buffer, url = `${origin}/v1/tuf/targets/${target.path}`) => {
  const response = new Response(new Uint8Array(bytes));
  Object.defineProperty(response, "url", { value: url });
  return response;
};

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("signed Exchange package download", () => {
  it("stores only bytes matching signed target metadata", async () => {
    const root = stagingRoot();
    const archive = await downloadSignedExchangePackage({
      origin,
      target,
      stagingRoot: root,
      fetcher: async () => respond(body),
    });
    expect(FS.readFileSync(archive)).toEqual(body);
  });

  it("rejects digest mismatch, truncated and oversized responses without retaining staging files", async () => {
    for (const bytes of [
      Buffer.from("signed package fixturE"),
      body.subarray(0, -1),
      Buffer.concat([body, body]),
    ]) {
      const root = stagingRoot();
      await expect(
        downloadSignedExchangePackage({
          origin,
          target,
          stagingRoot: root,
          fetcher: async () => respond(bytes),
        }),
      ).rejects.toThrow();
      expect(FS.readdirSync(root)).toEqual([]);
    }
  });

  it("rejects a changed URL and invalid signed path", async () => {
    const root = stagingRoot();
    await expect(
      downloadSignedExchangePackage({
        origin,
        target,
        stagingRoot: root,
        fetcher: async () => respond(body, "https://other.example/package"),
      }),
    ).rejects.toThrow(/changed destination/);
    await expect(
      downloadSignedExchangePackage({
        origin,
        target: { ...target, path: "extensions/acme/../evil/1.0.0.tabsext" },
        stagingRoot: root,
      }),
    ).rejects.toThrow(/invalid/);
    await expect(
      downloadSignedExchangePackage({
        origin,
        target: { ...target, path: "extensions/acme/dashboard/1.0.0-%2Fadmin.tabsext" },
        stagingRoot: root,
      }),
    ).rejects.toThrow(/invalid/i);
  });
});

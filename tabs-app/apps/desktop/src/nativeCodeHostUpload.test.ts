import { describe, expect, it, vi } from "vitest";

import { uploadFileViaGitHubMobileApi } from "./nativeCodeHostUpload";

describe("uploadFileViaGitHubMobileApi", () => {
  it("requests a policy, uploads exact bytes, and confirms the asset", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          upload_url: "https://uploads.example.test/asset",
          asset_upload_url: "/mobile/upload/assets/42",
          form: { key: "uploads/42" },
          asset: { name: "image.png", href: "https://github.com/assets/42" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      uploadFileViaGitHubMobileApi(fetch, "secret-token", "123", "image.png", bytes, "image/png"),
    ).resolves.toEqual({
      fileName: "image.png",
      assetUrl: "https://github.com/assets/42",
      contentType: "image/png",
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.github.com/mobile/upload/policy");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      name: "image.png",
      size: 4,
      content_type: "image/png",
      repository_id: 123,
    });
    const uploadBody = fetch.mock.calls[1]?.[1]?.body as Buffer;
    expect(uploadBody.indexOf(Buffer.from(bytes))).toBeGreaterThanOrEqual(0);
    expect(fetch.mock.calls[2]?.[0]).toBe("https://api.github.com/mobile/upload/assets/42");
  });

  it("rejects malformed policy confirmation URLs", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        upload_url: "https://uploads.example.test/asset",
        asset_upload_url: "https://attacker.example/confirm",
        form: {},
        asset: { name: "x.txt", href: "https://github.com/assets/42" },
      }),
    );

    await expect(
      uploadFileViaGitHubMobileApi(fetch, "token", "1", "x.txt", new Uint8Array(), "text/plain"),
    ).rejects.toThrow("invalid confirmation URL");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

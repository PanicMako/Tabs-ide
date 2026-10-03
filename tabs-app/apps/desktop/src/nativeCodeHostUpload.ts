type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type GitHubUploadPolicy = {
  upload_url?: unknown;
  asset_upload_url?: unknown;
  form?: unknown;
  asset?: unknown;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub upload policy is missing ${field}`);
  }
  return value;
}

function requireStringRecord(value: unknown, field: string): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GitHub upload policy is missing ${field}`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    throw new Error(`GitHub upload policy contains an invalid ${field}`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Upload a Copilot chat attachment through GitHub's native-app API. This runs
 * in Electron main because the renderer cannot make these requests through
 * browser CORS. The protocol mirrors Code-OSS's NativeHostMainService.
 */
export async function uploadFileViaGitHubMobileApi(
  fetch: FetchLike,
  token: string,
  repoId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType: string,
): Promise<{ fileName: string; assetUrl: string; contentType: string }> {
  if (!/^\d+$/.test(repoId)) throw new Error("GitHub repository id must be numeric");

  const policyResponse = await fetch("https://api.github.com/mobile/upload/policy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: fileName,
      size: fileBytes.byteLength,
      content_type: contentType,
      repository_id: Number.parseInt(repoId, 10),
    }),
  });
  if (!policyResponse.ok) {
    throw new Error(
      `GitHub upload policy request failed ${policyResponse.status}: ${(await policyResponse.text()).slice(0, 300)}`,
    );
  }

  const policy = (await policyResponse.json()) as GitHubUploadPolicy;
  const uploadUrl = requireString(policy.upload_url, "upload_url");
  const confirmPath = requireString(policy.asset_upload_url, "asset_upload_url");
  const formFields = requireStringRecord(policy.form, "form");
  const asset = requireStringRecord(policy.asset, "asset");
  const assetUrl = requireString(asset.href, "asset.href");
  const serverFileName = requireString(asset.name, "asset.name");
  const confirmUrl = new URL(confirmPath, "https://api.github.com");
  if (confirmUrl.origin !== "https://api.github.com") {
    throw new Error("GitHub upload policy returned an invalid confirmation URL");
  }

  const boundary = `----TabsCodeUpload${Date.now()}`;
  let preamble = "";
  for (const [key, value] of Object.entries(formFields)) {
    preamble += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
  }
  const safeName = serverFileName.replace(/[\r\n]+/g, " ").replace(/[\\"]/g, "_");
  preamble += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(preamble, "utf8"),
    Buffer.from(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  if (uploadResponse.status !== 201 && uploadResponse.status !== 204) {
    throw new Error(
      `GitHub attachment upload failed ${uploadResponse.status}: ${(await uploadResponse.text()).slice(0, 300)}`,
    );
  }

  const confirmResponse = await fetch(confirmUrl.toString(), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!confirmResponse.ok) {
    throw new Error(
      `GitHub attachment confirmation failed ${confirmResponse.status}: ${(await confirmResponse.text()).slice(0, 300)}`,
    );
  }

  return { fileName, assetUrl, contentType };
}

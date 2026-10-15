import * as Crypto from "node:crypto";
import { ExtensionCredentials, type CredentialCryptography } from "./extensionCredentials";

function registryIdentity(origin: string) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Registry credentials require an exact HTTPS origin.");
  return {
    extensionId: `registry.r${Crypto.createHash("sha256").update(origin).digest("hex").slice(0, 32)}`,
    profileId: "default",
    host: url.hostname,
  };
}

/** Separate main-process vault, never exposed to an extension or profile broker. */
export class RegistryCredentials {
  private readonly vault: ExtensionCredentials;
  constructor(root: string, cryptography: CredentialCryptography, platform = process.platform) {
    this.vault = new ExtensionCredentials(root, cryptography, platform);
  }
  set(origin: string, token: string) {
    if (!/^tex_[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("Enter a valid expiring registry read token.");
    this.vault.set(registryIdentity(origin), token);
  }
  has(origin: string) {
    return this.vault.list(registryIdentity(origin).extensionId).length > 0;
  }
  get(origin: string) {
    return this.has(origin) ? this.vault.get(registryIdentity(origin)) : null;
  }
  remove(origin: string) {
    this.vault.removeNamespace(registryIdentity(origin).extensionId);
  }
}

/** Authentication gates access; it never replaces TUF verification. */
export function registryFetch(
  credentials: RegistryCredentials,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  const authenticated = async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.username || url.password || url.hash)
      throw new Error("Invalid registry transport URL.");
    const headers = new Headers(init.headers);
    if (headers.has("Authorization")) throw new Error("Registry credentials must be host-owned.");
    const token = url.protocol === "https:" ? credentials.get(url.origin) : null;
    if (token) {
      if (!url.pathname.startsWith("/v1/"))
        throw new Error("Registry credential cannot access this path.");
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetcher(input, {
      ...init,
      headers,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("Registry redirects are forbidden; credentials were not forwarded.");
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "Registry access expired or was denied. Reconnect in Extensions settings. This is not a signed package revocation.",
      );
    if (response.url && new URL(response.url).origin !== url.origin)
      throw new Error("Registry transport changed origin.");
    return response;
  };
  // Preserve runtime-specific fetch properties (for example Bun's preconnect).
  return Object.assign(authenticated, fetcher);
}

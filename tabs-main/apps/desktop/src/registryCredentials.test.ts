import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RegistryCredentials, registryFetch } from "./registryCredentials";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});
function fixture(available = true) {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-registry-vault-"));
  roots.push(root);
  const vault = new RegistryCredentials(
    root,
    {
      isEncryptionAvailable: () => available,
      getSelectedStorageBackend: () => "keychain",
      encryptString: (value) => Buffer.from(value).reverse(),
      decryptString: (value) => Buffer.from(value).reverse().toString(),
    },
    "darwin",
  );
  return { root, vault };
}
const origin = "https://private.example";
const token = `tex_${"a".repeat(43)}`;

it("isolates credentials by exact origin and never writes the raw token", () => {
  const { root, vault } = fixture();
  vault.set(origin, token);
  expect(vault.get(origin)).toBe(token);
  expect(vault.get("https://private.example:444")).toBeNull();
  expect(vault.get("https://other.example")).toBeNull();
  expect(FS.readFileSync(Path.join(root, FS.readdirSync(root)[0]!), "utf8")).not.toContain(token);
  expect(() => vault.set("http://private.example", token)).toThrow();
  vault.remove(origin);
  expect(vault.has(origin)).toBe(false);
});
it("does not substitute plaintext for unavailable OS encryption", () => {
  const { vault } = fixture(false);
  expect(() => vault.set(origin, token)).toThrow(/OS-backed/);
  expect(vault.get(origin)).toBeNull();
});
it("binds authorization to its origin and prohibits redirected credentials", async () => {
  const { vault } = fixture();
  vault.set(origin, token);
  const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
    Response.json({ ok: true }),
  );
  const request = registryFetch(vault, fetcher);
  await request(`${origin}/v1/extensions?q=notes`);
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
    `Bearer ${token}`,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: "manual",
    credentials: "omit",
    cache: "no-store",
  });
  await request("https://other.example/v1/extensions");
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).has("Authorization")).toBe(false);
  await expect(request(`${origin}/auth/github/start`)).rejects.toThrow(/path/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("denied transport gives reconnect instructions without asserting signed revocation", async () => {
  const { vault } = fixture();
  vault.set(origin, token);
  const request = registryFetch(vault, async () => new Response(null, { status: 401 }));
  await expect(request(`${origin}/v1/tuf/metadata/timestamp.json`)).rejects.toThrow(/Reconnect/);
  expect(vault.has(origin)).toBe(true);
});
it("fails closed on redirects rather than treating them as offline transport", async () => {
  const { vault } = fixture();
  vault.set(origin, token);
  const fetcher = vi.fn(
    async () =>
      new Response(null, { status: 302, headers: { Location: "https://attacker.example" } }),
  );
  await expect(
    registryFetch(vault, fetcher)(`${origin}/v1/tuf/metadata/timestamp.json`),
  ).rejects.toThrow(/redirects are forbidden/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

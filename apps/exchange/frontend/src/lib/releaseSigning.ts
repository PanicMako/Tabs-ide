import { canonicalize } from "@tufjs/canonical-json";
export const roles = ["root", "targets", "snapshot", "timestamp"] as const;
type Role = (typeof roles)[number];
export interface SigningBackup {
  format: "tabs-signing-v1";
  origin: string;
  root: string;
  keys: Record<Role, { id: string; privateKey: string }>;
}
export interface ReleasePlan {
  origin: string;
  root: string | null;
  pin: string | null;
  versions: Record<Role, number>;
  targets: Record<string, { length: number; hashes: { sha256: string } }>;
}
const encode = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const bytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const base64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));
export const fingerprint = async (value: string) =>
  hex(await crypto.subtle.digest("SHA-256", encode(value)));
async function sign(signed: object, key: SigningBackup["keys"][Role]) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes(key.privateKey),
    "Ed25519",
    false,
    ["sign"],
  );
  const sig = hex(await crypto.subtle.sign("Ed25519", privateKey, encode(canonicalize(signed))));
  return JSON.stringify({ signed, signatures: [{ keyid: key.id, sig }] });
}
export async function createSigningBackup(origin: string): Promise<SigningBackup> {
  const keys = {} as SigningBackup["keys"];
  const publicKeys: Record<string, object> = {};
  const delegations: Record<string, object> = {};
  for (const role of roles) {
    const pair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicHex = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
    const publicKey = { keytype: "ed25519", scheme: "ed25519", keyval: { public: publicHex } };
    const id = await fingerprint(canonicalize(publicKey));
    publicKeys[id] = publicKey;
    delegations[role] = { keyids: [id], threshold: 1 };
    keys[role] = {
      id,
      privateKey: base64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    };
  }
  const root = await sign(
    {
      _type: "root",
      spec_version: "1.0.0",
      version: 1,
      expires: new Date(Date.now() + 365 * 86400000).toISOString(),
      consistent_snapshot: false,
      keys: publicKeys,
      roles: delegations,
    },
    keys.root,
  );
  return { format: "tabs-signing-v1", origin, root, keys };
}
async function passwordKey(password: string, salt: Uint8Array, usages: KeyUsage[]) {
  if (password.length < 12 || password.length > 1024)
    throw new Error("Use a backup password of 12 to 1024 characters.");
  const material = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 600000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}
export async function lockBackup(backup: SigningBackup, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await passwordKey(password, salt, ["encrypt"]),
    encode(JSON.stringify(backup)),
  );
  return JSON.stringify({
    format: "tabs-encrypted-signing-v1",
    salt: base64(salt.buffer),
    iv: base64(iv.buffer),
    encrypted: base64(encrypted),
  });
}
export async function unlockBackup(
  value: string,
  password: string,
  origin: string,
): Promise<SigningBackup> {
  try {
    if (value.length > 100000) throw new Error();
    const envelope = JSON.parse(value);
    if (
      envelope.format !== "tabs-encrypted-signing-v1" ||
      typeof envelope.salt !== "string" ||
      typeof envelope.iv !== "string" ||
      typeof envelope.encrypted !== "string"
    )
      throw new Error();
    const salt = bytes(envelope.salt),
      iv = bytes(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error();
    const raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await passwordKey(password, salt, ["decrypt"]),
      bytes(envelope.encrypted),
    );
    const backup = JSON.parse(new TextDecoder().decode(raw)) as SigningBackup;
    if (
      backup.format !== "tabs-signing-v1" ||
      backup.origin !== origin ||
      typeof backup.root !== "string" ||
      backup.root.length > 32000
    )
      throw new Error();
    const root = JSON.parse(backup.root).signed;
    for (const role of roles) {
      const key = backup.keys[role];
      if (
        !key ||
        typeof key.id !== "string" ||
        typeof key.privateKey !== "string" ||
        root.roles[role].threshold !== 1 ||
        !root.roles[role].keyids.includes(key.id)
      )
        throw new Error();
      const proof = JSON.parse(await sign({ challenge: "verify-backup" }, key));
      const pub = Uint8Array.from(root.keys[key.id].keyval.public.match(/../g), (pair: string) =>
        parseInt(pair, 16),
      );
      const verify = await crypto.subtle.importKey("raw", pub, "Ed25519", false, ["verify"]);
      const sig = Uint8Array.from(proof.signatures[0].sig.match(/../g), (pair: string) =>
        parseInt(pair, 16),
      );
      if (!(await crypto.subtle.verify("Ed25519", verify, sig, encode(canonicalize(proof.signed)))))
        throw new Error();
    }
    return backup;
  } catch {
    throw new Error(
      "Could not unlock this backup. Check the file, password, and registry address.",
    );
  }
}
export async function signRelease(plan: ReleasePlan, backup: SigningBackup) {
  if (
    plan.origin !== backup.origin ||
    (plan.root && plan.root !== backup.root) ||
    (plan.pin && (await fingerprint(backup.root)) !== plan.pin)
  )
    throw new Error("This backup does not match the registry’s trust root.");
  if (Date.parse(JSON.parse(backup.root).signed.expires) <= Date.now() + 86400000)
    throw new Error(
      "The trust root needs rotation before signing. Use the operator rotation procedure.",
    );
  const expiry = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  const common = (role: Role, days: number) => ({
    _type: role,
    spec_version: "1.0.0",
    version: plan.versions[role] + 1,
    expires: expiry(days),
  });
  const targets = await sign(
    { ...common("targets", 30), targets: plan.targets },
    backup.keys.targets,
  );
  const describe = async (value: string, version: number) => ({
    version,
    length: encode(value).length,
    hashes: { sha256: await fingerprint(value) },
  });
  const snapshot = await sign(
    {
      ...common("snapshot", 7),
      meta: { "targets.json": await describe(targets, plan.versions.targets + 1) },
    },
    backup.keys.snapshot,
  );
  const timestamp = await sign(
    {
      ...common("timestamp", 1),
      meta: { "snapshot.json": await describe(snapshot, plan.versions.snapshot + 1) },
    },
    backup.keys.timestamp,
  );
  return {
    "root.json": backup.root,
    "targets.json": targets,
    "snapshot.json": snapshot,
    "timestamp.json": timestamp,
  };
}

import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

const PROFILE_ID = /^[a-z][a-z0-9-]{0,62}$/;
const MAX_CREDENTIAL_BYTES = 16 * 1024;
const MAX_RECORDS = 128;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface ExtensionCredentialIdentity {
  readonly extensionId: string;
  readonly profileId: string;
  readonly projectId?: string;
  readonly host: string;
}

interface CredentialRecord extends ExtensionCredentialIdentity {
  readonly ciphertext: string;
}

/** The Electron safeStorage subset used by the main-process credential vault. */
export interface CredentialCryptography {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/** Only encrypted values reach disk. No secret value is returned to extension UI. */
export class ExtensionCredentials {
  constructor(
    private readonly root: string,
    private readonly cryptography: CredentialCryptography,
    private readonly platform = process.platform,
  ) {}

  set(identity: ExtensionCredentialIdentity, value: string): void {
    this.validateIdentity(identity);
    if (
      typeof value !== "string" ||
      !value ||
      Buffer.byteLength(value) > MAX_CREDENTIAL_BYTES ||
      Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 32 || code === 127;
      })
    ) {
      throw new Error("Invalid extension credential value.");
    }
    this.requireOsEncryption();
    const records = this.read(identity.extensionId);
    const ciphertext = this.cryptography
      .encryptString(JSON.stringify({ ...identity, value }))
      .toString("base64");
    const next = records.filter((record) => !this.matches(record, identity));
    next.push({ ...identity, ciphertext });
    if (next.length > MAX_RECORDS) throw new Error("Too many extension credentials.");
    this.write(identity.extensionId, next);
  }

  get(identity: ExtensionCredentialIdentity): string | null {
    this.validateIdentity(identity);
    this.requireOsEncryption();
    const record = this.read(identity.extensionId).find((entry) => this.matches(entry, identity));
    if (!record) return null;
    const decrypted: unknown = JSON.parse(
      this.cryptography.decryptString(Buffer.from(record.ciphertext, "base64")),
    );
    if (
      !decrypted ||
      typeof decrypted !== "object" ||
      (decrypted as ExtensionCredentialIdentity).extensionId !== identity.extensionId ||
      !this.matches(decrypted as ExtensionCredentialIdentity, identity) ||
      typeof (decrypted as { value?: unknown }).value !== "string"
    )
      throw new Error("Extension credential identity mismatch.");
    return (decrypted as { value: string }).value;
  }

  list(extensionId: string): ReadonlyArray<ExtensionCredentialIdentity> {
    return this.read(extensionId).map(({ profileId, projectId, host }) =>
      projectId === undefined
        ? { extensionId, profileId, host }
        : { extensionId, profileId, projectId, host },
    );
  }

  delete(identity: ExtensionCredentialIdentity): void {
    this.validateIdentity(identity);
    const records = this.read(identity.extensionId);
    const next = records.filter((record) => !this.matches(record, identity));
    if (next.length !== records.length) this.write(identity.extensionId, next);
  }

  /** Called only after the user chooses to delete this extension's data. */
  removeNamespace(extensionId: string): void {
    const file = this.filename(extensionId);
    this.assertSafePath(file);
    if (FS.existsSync(file)) FS.unlinkSync(file);
  }

  private requireOsEncryption(): void {
    if (
      !this.cryptography.isEncryptionAvailable() ||
      (this.platform === "linux" &&
        ["basic_text", "unknown"].includes(this.cryptography.getSelectedStorageBackend()))
    ) {
      throw new Error("OS-backed credential encryption is unavailable.");
    }
  }

  private validateIdentity(identity: ExtensionCredentialIdentity): void {
    if (
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?$/.test(identity.extensionId) ||
      !PROFILE_ID.test(identity.profileId) ||
      (identity.projectId !== undefined &&
        (typeof identity.projectId !== "string" ||
          !identity.projectId ||
          identity.projectId.length > 240)) ||
      !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(identity.host)
    ) {
      throw new Error("Invalid extension credential identity.");
    }
  }

  private matches(left: ExtensionCredentialIdentity, right: ExtensionCredentialIdentity): boolean {
    return (
      left.profileId === right.profileId &&
      left.projectId === right.projectId &&
      left.host === right.host
    );
  }

  private filename(extensionId: string): string {
    if (typeof extensionId !== "string" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?$/.test(extensionId)) {
      throw new Error("Invalid extension credential namespace.");
    }
    const namespace = Crypto.createHash("sha256").update(extensionId).digest("hex");
    return Path.join(this.root, `${namespace}.json`);
  }

  private assertSafePath(file: string): void {
    if (FS.existsSync(this.root)) {
      const rootStat = FS.lstatSync(this.root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error("Extension credential directory is invalid.");
      }
    }
    if (FS.existsSync(file)) {
      const fileStat = FS.lstatSync(file);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_FILE_BYTES) {
        throw new Error("Extension credential file is invalid.");
      }
    }
  }

  private read(extensionId: string): CredentialRecord[] {
    const file = this.filename(extensionId);
    this.assertSafePath(file);
    if (!FS.existsSync(file)) return [];
    const raw: unknown = JSON.parse(FS.readFileSync(file, "utf8"));
    if (
      !Array.isArray(raw) ||
      raw.length > MAX_RECORDS ||
      raw.some((record) => {
        if (
          !record ||
          typeof record !== "object" ||
          typeof record.ciphertext !== "string" ||
          Object.keys(record).some(
            (key) => !["extensionId", "profileId", "projectId", "host", "ciphertext"].includes(key),
          )
        )
          return true;
        try {
          this.validateIdentity(record);
        } catch {
          return true;
        }
        return (
          record.extensionId !== extensionId || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.ciphertext)
        );
      })
    )
      throw new Error("Extension credential file is invalid.");
    const keys = (raw as CredentialRecord[]).map((record) =>
      JSON.stringify([record.profileId, record.projectId ?? null, record.host]),
    );
    if (new Set(keys).size !== keys.length) {
      throw new Error("Extension credential file contains duplicate identities.");
    }
    return raw as CredentialRecord[];
  }

  private write(extensionId: string, records: CredentialRecord[]): void {
    const file = this.filename(extensionId);
    this.assertSafePath(file);
    FS.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.assertSafePath(file);
    const serialized = JSON.stringify(records);
    if (Buffer.byteLength(serialized) > MAX_FILE_BYTES)
      throw new Error("Extension credentials are full.");
    const temporary = `${file}.${Crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      FS.writeFileSync(temporary, serialized, { flag: "wx", mode: 0o600 });
      FS.renameSync(temporary, file);
    } finally {
      if (FS.existsSync(temporary)) FS.unlinkSync(temporary);
    }
  }
}

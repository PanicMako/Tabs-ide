import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import * as Yauzl from "yauzl";
import * as Yazl from "yazl";
import type { TabsExtensionManifest } from "@tabs/contracts";
import { validateTabsExtensionManifest } from "@tabs/shared/extensions";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_FILES = 1_000;
const MAX_DEPTH = 16;
// ZIP's DOS timestamp has no timezone. Use the same local calendar fields in
// every timezone and omit the optional UTC timestamp extra field.
const FIXED_TIME = new Date(2020, 0, 1, 0, 0, 0);
const FILE_MODE = 0o100644;

export interface InspectedTabsext {
  readonly digest: string;
  readonly bytes: number;
  readonly manifest: TabsExtensionManifest;
  readonly id: string;
  readonly files: ReadonlyArray<string>;
}

function validateArchivePath(name: string): string {
  if (
    !name ||
    name.length > 240 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes(":") ||
    name.includes("%") ||
    name.includes("?") ||
    name.includes("#")
  )
    throw new Error(`Invalid package path: ${name}`);
  const parts = name.split("/");
  if (parts.length > MAX_DEPTH || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid package path: ${name}`);
  }
  if (name.normalize("NFC") !== name) throw new Error(`Non-normalized package path: ${name}`);
  return name.normalize("NFC").toLowerCase();
}

async function sha256File(path: string): Promise<string> {
  const hash = Crypto.createHash("sha256");
  for await (const chunk of FS.createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function collectFiles(root: string): Array<{ path: string; bytes: number }> {
  const files: Array<{ path: string; bytes: number }> = [];
  let total = 0;
  let entries = 0;
  const visit = (directory: string, relative: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error("Package directory is too deeply nested.");
    for (const entry of FS.readdirSync(directory, { withFileTypes: true })) {
      entries++;
      if (entries > MAX_FILES) throw new Error("Package has too many files or directories.");
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      validateArchivePath(name);
      const absolute = Path.join(directory, entry.name);
      const stat = FS.lstatSync(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error(`Package contains a link or special file: ${name}`);
      }
      if (stat.isDirectory()) {
        visit(absolute, name, depth + 1);
      } else {
        total += stat.size;
        files.push({ path: name, bytes: stat.size });
        if (files.length > MAX_FILES || total > MAX_UNPACKED_BYTES) {
          throw new Error("Package exceeds file or size limits.");
        }
      }
    }
  };
  visit(root, "", 0);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const seen = new Set<string>();
  for (const file of files) {
    const key = validateArchivePath(file.path);
    if (seen.has(key)) throw new Error(`Package paths collide: ${file.path}`);
    seen.add(key);
  }
  return files;
}

/** Create the same bytes for the same source files, regardless of their filesystem mtimes. */
export async function packTabsext(input: {
  readonly directory: string;
  readonly destination: string;
  readonly tabsVersion: string;
}): Promise<InspectedTabsext> {
  const root = FS.realpathSync(input.directory);
  if (!FS.statSync(root).isDirectory()) throw new Error("Package source must be a directory.");
  const destination = Path.resolve(input.destination);
  if (destination.startsWith(`${root}${Path.sep}`)) {
    throw new Error("Place the archive outside its source directory.");
  }
  if (!destination.endsWith(".tabsext")) throw new Error("Archive must end in .tabsext.");
  if (FS.existsSync(destination)) throw new Error("Destination already exists.");
  const files = collectFiles(root);
  if (!files.some((file) => file.path === "tabs-extension.json")) {
    throw new Error("Package is missing tabs-extension.json.");
  }
  const manifestBytes = FS.readFileSync(Path.join(root, "tabs-extension.json"));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.");
  const parsed = validateTabsExtensionManifest(
    JSON.parse(manifestBytes.toString("utf8")),
    input.tabsVersion,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  for (const tool of parsed.manifest.contributes.tools) {
    if (!files.some((file) => file.path === tool.entry))
      throw new Error(`Missing tool entry: ${tool.entry}`);
    if (tool.icon && !files.some((file) => file.path === tool.icon)) {
      throw new Error(`Missing tool icon: ${tool.icon}`);
    }
  }
  const zip = new Yazl.ZipFile();
  for (const file of files) {
    // yazl supports forceDosTimestamp, though @types/yazl has not declared it.
    const options = {
      mtime: FIXED_TIME,
      mode: FILE_MODE,
      compress: true,
      forceDosTimestamp: true,
    };
    zip.addFile(Path.join(root, ...file.path.split("/")), file.path, options);
  }
  zip.end();
  const temporary = Path.join(Path.dirname(destination), `.tabsext-pack-${Crypto.randomUUID()}`);
  try {
    await pipeline(zip.outputStream, FS.createWriteStream(temporary, { flags: "wx" }));
    const inspected = await inspectTabsext(temporary, input.tabsVersion);
    FS.linkSync(temporary, destination);
    FS.unlinkSync(temporary);
    return inspected;
  } catch (error) {
    if (FS.existsSync(temporary)) FS.unlinkSync(temporary);
    throw error;
  }
}

async function openZip(path: string): Promise<Yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    Yauzl.open(
      path,
      {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    );
  });
}

async function nextEntry(zip: Yauzl.ZipFile): Promise<Yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const clear = () => {
      zip.removeListener("entry", onEntry);
      zip.removeListener("end", onEnd);
      zip.removeListener("error", onError);
    };
    const onEntry = (entry: Yauzl.Entry) => {
      clear();
      resolve(entry);
    };
    const onEnd = () => {
      clear();
      resolve(null);
    };
    const onError = (error: Error) => {
      clear();
      reject(error);
    };
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

async function entryStream(zip: Yauzl.ZipFile, entry: Yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

function checkEntry(
  entry: Yauzl.Entry,
  seen: Set<string>,
  totals: { count: number; bytes: number },
): void {
  if (entry.fileName.endsWith("/")) throw new Error("Directory entries are not allowed.");
  const key = validateArchivePath(entry.fileName);
  if (seen.has(key)) throw new Error(`Duplicate or colliding package path: ${entry.fileName}`);
  seen.add(key);
  const mode = entry.externalFileAttributes >>> 16;
  const type = mode & 0o170000;
  if (type && type !== 0o100000) throw new Error("Links and special files are not allowed.");
  if (entry.isEncrypted() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
    throw new Error("Encrypted or unsupported ZIP entries are not allowed.");
  }
  totals.count++;
  totals.bytes += entry.uncompressedSize;
  if (totals.count > MAX_FILES || totals.bytes > MAX_UNPACKED_BYTES) {
    throw new Error("Package exceeds file or size limits.");
  }
}

async function readBounded(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new Error("Package entry exceeds its size limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Validate ZIP metadata, manifest, entry names and expected tool assets without extracting. */
export async function inspectTabsext(path: string, tabsVersion: string): Promise<InspectedTabsext> {
  const stat = FS.statSync(path);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES)
    throw new Error("Archive exceeds the size limit.");
  const digest = await sha256File(path);
  const zip = await openZip(path);
  const seen = new Set<string>();
  const totals = { count: 0, bytes: 0 };
  const files: string[] = [];
  let manifest: TabsExtensionManifest | null = null;
  let id: string | null = null;
  try {
    for (;;) {
      const entry = await nextEntry(zip);
      if (!entry) break;
      checkEntry(entry, seen, totals);
      files.push(entry.fileName);
      if (entry.fileName === "tabs-extension.json") {
        if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.");
        const contents = await readBounded(await entryStream(zip, entry), MAX_MANIFEST_BYTES);
        const parsed = validateTabsExtensionManifest(
          JSON.parse(contents.toString("utf8")),
          tabsVersion,
        );
        if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
        manifest = parsed.manifest;
        id = parsed.id;
      }
    }
  } finally {
    zip.close();
  }
  if (!manifest || !id) throw new Error("Package is missing a valid manifest.");
  for (const tool of manifest.contributes.tools) {
    if (!files.includes(tool.entry)) throw new Error(`Missing tool entry: ${tool.entry}`);
    if (tool.icon && !files.includes(tool.icon)) throw new Error(`Missing tool icon: ${tool.icon}`);
  }
  return { digest, bytes: stat.size, manifest, id, files };
}

/** Extract only into a new directory; never overwrite an installed package. */
export async function extractTabsext(input: {
  readonly archive: string;
  readonly destination: string;
  readonly expectedDigest: string;
  readonly tabsVersion: string;
}): Promise<InspectedTabsext> {
  const destination = Path.resolve(input.destination);
  if (FS.existsSync(destination)) throw new Error("Destination already exists.");
  const parent = Path.dirname(destination);
  FS.mkdirSync(parent, { recursive: true });
  const stage = FS.mkdtempSync(Path.join(parent, ".tabsext-stage-"));
  const archiveCopy = Path.join(stage, "archive.tabsext");
  const content = Path.join(stage, "content");
  let zip: Yauzl.ZipFile | null = null;
  try {
    FS.copyFileSync(input.archive, archiveCopy, FS.constants.COPYFILE_EXCL);
    const inspected = await inspectTabsext(archiveCopy, input.tabsVersion);
    if (inspected.digest !== input.expectedDigest) throw new Error("Archive digest mismatch.");
    FS.mkdirSync(content);
    zip = await openZip(archiveCopy);
    const seen = new Set<string>();
    const totals = { count: 0, bytes: 0 };
    for (;;) {
      const entry = await nextEntry(zip);
      if (!entry) break;
      checkEntry(entry, seen, totals);
      const output = Path.join(content, ...entry.fileName.split("/"));
      FS.mkdirSync(Path.dirname(output), { recursive: true });
      let actual = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          actual += chunk.length;
          if (actual > entry.uncompressedSize || actual > MAX_UNPACKED_BYTES) {
            callback(new Error("Package entry expands beyond its declared size."));
          } else callback(null, chunk);
        },
      });
      await pipeline(
        await entryStream(zip, entry),
        meter,
        FS.createWriteStream(output, { flags: "wx", mode: 0o600 }),
      );
      if (actual !== entry.uncompressedSize) throw new Error("Package entry size mismatch.");
    }
    if (FS.existsSync(destination)) throw new Error("Destination already exists.");
    FS.renameSync(content, destination);
    return inspected;
  } finally {
    zip?.close();
    FS.rmSync(stage, { recursive: true, force: true });
  }
}

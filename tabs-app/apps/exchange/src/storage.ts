import * as Crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

export async function boundedObject(
  storage: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!(object.Body instanceof Readable)) throw new Error("Package object is not a Node stream.");
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of object.Body) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buffer.length;
    if (size > 25 * 1024 * 1024) throw new Error("Package object exceeds size limit.");
    parts.push(buffer);
  }
  return Buffer.concat(parts);
}

export async function verifiedPackageObject(
  storage: S3Client,
  bucket: string,
  key: string,
  expectedBytes: number,
  expectedDigest: string,
): Promise<Buffer> {
  const bytes = await boundedObject(storage, bucket, key);
  if (
    bytes.length !== expectedBytes ||
    Crypto.createHash("sha256").update(bytes).digest("hex") !== expectedDigest
  ) {
    throw new Error("Package object failed digest verification.");
  }
  return bytes;
}

/** Never overwrite a quarantine key; a retry may reuse only identical stored bytes. */
export async function putImmutablePackageObject(
  storage: S3Client,
  bucket: string,
  key: string,
  bytes: Buffer,
  expectedDigest: string,
): Promise<void> {
  if (Crypto.createHash("sha256").update(bytes).digest("hex") !== expectedDigest) {
    throw new Error("Package upload digest does not match its archive.");
  }
  try {
    await storage.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: "application/octet-stream",
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412
    ) {
      throw error;
    }
    const existing = await boundedObject(storage, bucket, key);
    if (
      existing.length !== bytes.length ||
      Crypto.createHash("sha256").update(existing).digest("hex") !== expectedDigest
    ) {
      throw new Error("Existing quarantine object does not match the submitted archive.");
    }
  }
}

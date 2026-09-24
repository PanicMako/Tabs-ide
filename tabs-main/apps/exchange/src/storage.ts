import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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

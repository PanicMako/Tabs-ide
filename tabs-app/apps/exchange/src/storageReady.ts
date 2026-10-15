import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import { setTimeout as delay } from "node:timers/promises";
import { createStorage } from "./config.ts";

/** Readiness is authenticated and read-only; it never creates a public bucket. */
export async function waitForStorage(
  storage: S3Client,
  bucket: string,
  attempts = 12,
  delayMs = 1000,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await storage.send(new HeadBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(5000),
      });
      return;
    } catch {
      if (attempt + 1 === attempts)
        throw new Error("Private object storage failed its authenticated readiness check.");
      await delay(delayMs);
    }
  }
  throw new Error("Invalid storage readiness attempt limit.");
}

if (import.meta.main) {
  const storage = createStorage();
  try {
    if (!process.env.S3_BUCKET) throw new Error("Missing S3_BUCKET.");
    await waitForStorage(storage, process.env.S3_BUCKET);
    process.stdout.write("Private object bucket is ready.\n");
  } catch {
    process.stderr.write("Private object storage is unavailable or credentials are invalid.\n");
    process.exitCode = 1;
  } finally {
    storage.destroy();
  }
}

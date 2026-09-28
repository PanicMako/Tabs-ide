import * as Crypto from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { putImmutablePackageObject } from "./storage.ts";

const bytes = Buffer.from("reviewed archive bytes");
const digest = Crypto.createHash("sha256").update(bytes).digest("hex");
const key = `quarantine/acme/dashboard/1.0.0/${digest}.tabsext`;

function fixture() {
  let stored: Buffer | null = null;
  const send = vi.fn(async (command: GetObjectCommand | PutObjectCommand) => {
    if (command instanceof PutObjectCommand) {
      expect(command.input.IfNoneMatch).toBe("*");
      expect(command.input.Key).toBe(key);
      if (stored) {
        throw Object.assign(new Error("PreconditionFailed"), {
          $metadata: { httpStatusCode: 412 },
        });
      }
      stored = Buffer.from(command.input.Body as Buffer);
      return {};
    }
    if (command instanceof GetObjectCommand && stored) {
      return { Body: Readable.from([stored]) };
    }
    throw new Error("Object is unavailable.");
  });
  return {
    storage: { send } as unknown as S3Client,
    send,
    replace: (value: Buffer) => {
      stored = value;
    },
    contents: () => stored,
  };
}

describe("immutable Exchange quarantine objects", () => {
  it("creates a key once and permits an identical retry without overwriting it", async () => {
    const subject = fixture();
    await putImmutablePackageObject(subject.storage, "packages", key, bytes, digest);
    expect(subject.contents()).toEqual(bytes);
    await putImmutablePackageObject(subject.storage, "packages", key, bytes, digest);
    expect(subject.contents()).toEqual(bytes);
    expect(subject.send).toHaveBeenCalledTimes(3);
  });

  it("rejects a changed existing object and an invalid submitted digest", async () => {
    const subject = fixture();
    subject.replace(Buffer.from("changed bytes"));
    await expect(
      putImmutablePackageObject(subject.storage, "packages", key, bytes, digest),
    ).rejects.toThrow(/does not match/);
    expect(subject.contents()).toEqual(Buffer.from("changed bytes"));
    await expect(
      putImmutablePackageObject(subject.storage, "packages", key, bytes, "f".repeat(64)),
    ).rejects.toThrow(/digest does not match/);
  });

  it("does not treat other object-store failures as an existing key", async () => {
    const storage = {
      send: vi.fn(async () => {
        throw new Error("Storage unavailable");
      }),
    } as unknown as S3Client;
    await expect(
      putImmutablePackageObject(storage, "packages", key, bytes, digest),
    ).rejects.toThrow(/Storage unavailable/);
  });
});

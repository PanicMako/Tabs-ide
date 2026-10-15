import { expect, it, vi } from "vitest";
import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import { waitForStorage } from "./storageReady.ts";

it("retries authenticated read-only readiness with a bounded deadline", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("not ready")).mockResolvedValue({});
  await waitForStorage({ send } as unknown as S3Client, "private-bucket", 2, 0);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
  expect(send.mock.calls[0]?.[1].abortSignal).toBeInstanceOf(AbortSignal);
});
it("fails closed without printing upstream credentials or creating a bucket", async () => {
  const send = vi.fn().mockRejectedValue(new Error("secret-upstream-token"));
  await expect(
    waitForStorage({ send } as unknown as S3Client, "private-bucket", 1, 0),
  ).rejects.toThrow("authenticated readiness");
  expect(send).toHaveBeenCalledTimes(1);
});

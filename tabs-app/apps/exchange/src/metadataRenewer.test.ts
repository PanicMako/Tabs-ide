import { expect, it, vi } from "vitest";
import { createMetadataRenewer } from "./metadataRenewer.ts";

it("coalesces concurrent readers and checks again after the cache interval", async () => {
  let now = 1_000;
  let finish!: () => void;
  const renew = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const ensureFresh = createMetadataRenewer(renew, () => now);
  const first = ensureFresh(),
    second = ensureFresh();
  expect(first).toBe(second);
  await Promise.resolve();
  finish();
  await first;
  await ensureFresh();
  expect(renew).toHaveBeenCalledOnce();
  now += 30_001;
  const next = ensureFresh();
  await Promise.resolve();
  finish();
  await next;
  expect(renew).toHaveBeenCalledTimes(2);
});

it("retries after a failed renewal rather than caching a stale publication", async () => {
  const renew = vi
    .fn()
    .mockRejectedValueOnce(new Error("storage unavailable"))
    .mockResolvedValueOnce(undefined);
  const ensureFresh = createMetadataRenewer(renew);
  await expect(ensureFresh()).rejects.toThrow("storage unavailable");
  await expect(ensureFresh()).resolves.toBeUndefined();
  expect(renew).toHaveBeenCalledTimes(2);
});

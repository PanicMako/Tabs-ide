import { afterEach, describe, expect, it, vi } from "vitest";
import {
  uploadPackage,
  validateUpload,
  UncertainUploadError,
} from "../frontend/src/scripts/upload.ts";

class UploadRequest {
  static latest: UploadRequest;
  headers: Record<string, string> = {};
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  timeout = 0;
  status = 202;
  responseURL = "https://exchange.example/v1/publisher/upload";
  responseText = JSON.stringify({ digest: "a".repeat(64) });
  onload?: () => void;
  onloadend?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  open = vi.fn();
  send = vi.fn();
  constructor() {
    UploadRequest.latest = this;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  abort() {
    this.onabort?.();
    this.onloadend?.();
  }
  finish() {
    this.onload?.();
    this.onloadend?.();
  }
}
afterEach(() => vi.unstubAllGlobals());
const file = { name: "tool.tabsext", size: 100 } as File;
function start(signal = new AbortController().signal) {
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  vi.stubGlobal("location", { origin: "https://exchange.example" });
  return uploadPackage(file, "my-team", "csrf", signal, vi.fn());
}
describe("publisher upload transport", () => {
  it("checks package limits before transport", () => {
    expect(() => validateUpload({ name: "tool.zip", size: 10 })).toThrow(".tabsext");
    expect(() => validateUpload({ name: "tool.tabsext", size: 0 })).toThrow("non-empty");
    expect(() => validateUpload({ name: "tool.tabsext", size: 25 * 1024 * 1024 + 1 })).toThrow(
      "25 MiB",
    );
  });
  it("uses namespace and CSRF binding and accepts only the exact upload endpoint", async () => {
    const pending = start();
    const xhr = UploadRequest.latest;
    expect(xhr.open).toHaveBeenCalledWith("POST", "/v1/publisher/upload");
    expect(xhr.headers["X-Tabs-Publisher-Namespace"]).toBe("my-team");
    expect(xhr.headers["X-CSRF-Token"]).toBe("csrf");
    xhr.finish();
    await expect(pending).resolves.toEqual({ digest: "a".repeat(64) });
  });
  it("classifies redirects and cancellation as uncertain rather than retrying", async () => {
    const redirected = start();
    UploadRequest.latest.responseURL = "https://other.example/v1/publisher/upload";
    UploadRequest.latest.finish();
    await expect(redirected).rejects.toBeInstanceOf(UncertainUploadError);
    const controller = new AbortController();
    const cancelled = start(controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(UncertainUploadError);
    expect(UploadRequest.latest.send).toHaveBeenCalledTimes(1);
  });
  it("explains duplicate versions without automatic retry", async () => {
    const pending = start();
    UploadRequest.latest.status = 409;
    UploadRequest.latest.responseText = JSON.stringify({ code: "VERSION_ALREADY_SUBMITTED" });
    UploadRequest.latest.finish();
    await expect(pending).rejects.toThrow("version already exists");
  });
  it("treats malformed acceptance responses as uncertain", async () => {
    for (const body of ["null", "[]", "{}", "not-json"]) {
      const pending = start();
      UploadRequest.latest.responseText = body;
      UploadRequest.latest.finish();
      await expect(pending).rejects.toBeInstanceOf(UncertainUploadError);
    }
  });
});

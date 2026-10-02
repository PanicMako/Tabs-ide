import { exchangeErrorGuidance } from "@tabs/shared/exchangeErrors";

export const PACKAGE_LIMIT = 25 * 1024 * 1024;

export function validateUpload(file: Pick<File, "name" | "size">): void {
  if (!file.name.endsWith(".tabsext")) throw new Error("Choose one .tabsext package.");
  if (file.size === 0 || file.size > PACKAGE_LIMIT)
    throw new Error("Packages must be non-empty and no larger than 25 MiB.");
}

export class UncertainUploadError extends Error {}

export function uploadPackage(
  file: File,
  namespace: string,
  csrf: string,
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<{ digest: string }> {
  validateUpload(file);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(namespace)) throw new Error("Select a valid namespace.");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const uncertain = () => reject(new UncertainUploadError("Upload outcome is unknown."));
    const abort = () => xhr.abort();
    xhr.open("POST", "/v1/publisher/upload");
    xhr.timeout = 120_000;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("X-Tabs-Publisher-Namespace", namespace);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.min(100, Math.floor((event.loaded / event.total) * 100)));
    };
    xhr.onerror = uncertain;
    xhr.ontimeout = uncertain;
    xhr.onabort = uncertain;
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    xhr.onload = () => {
      const expected = new URL("/v1/publisher/upload", location.origin);
      if (xhr.responseURL !== expected.href || xhr.responseText.length > 1024 * 1024) {
        uncertain();
        return;
      }
      let body: { digest?: unknown; error?: unknown };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        uncertain();
        return;
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        uncertain();
        return;
      }
      if (
        xhr.status === 202 &&
        typeof body.digest === "string" &&
        /^[a-f0-9]{64}$/.test(body.digest)
      ) {
        resolve({ digest: body.digest });
      } else if (xhr.status >= 500 || xhr.status === 202) {
        uncertain();
      } else {
        reject(new Error(exchangeErrorGuidance(xhr.status, body).message));
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener("abort", abort);
      uncertain();
      return;
    }
    xhr.send(file);
  });
}

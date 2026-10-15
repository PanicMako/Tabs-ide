import type { NativeApi } from "@tabs/contracts";

import { createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    (window as any).__tabsNativeApi = cachedApi;
    return cachedApi;
  }

  cachedApi = createWsNativeApi();
  (window as any).__tabsNativeApi = cachedApi;
  return cachedApi;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}

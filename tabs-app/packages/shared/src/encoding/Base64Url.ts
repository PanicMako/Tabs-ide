import * as Encoding from "effect/Encoding";

export const encode = (bytes: Uint8Array | string): string =>
  typeof bytes === "string"
    ? Encoding.encodeBase64Url(new TextEncoder().encode(bytes))
    : Encoding.encodeBase64Url(bytes);
export const decode = (str: string) => Encoding.decodeBase64Url(str);
export const decodeString = (str: string) => Encoding.decodeBase64UrlString(str);

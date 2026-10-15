import * as Encoding from "effect/Encoding";

export const encode = (bytes: Uint8Array): string => Encoding.encodeBase64(bytes);
export const decode = (str: string) => Encoding.decodeBase64(str);
export const decodeString = (str: string) => Encoding.decodeBase64String(str);

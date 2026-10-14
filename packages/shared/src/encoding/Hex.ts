import * as Encoding from "effect/Encoding";

export const encode = (bytes: Uint8Array): string => Encoding.encodeHex(bytes);
export const decode = (str: string) => Encoding.decodeHex(str);
export const decodeString = (str: string) => Encoding.decodeHexString(str);

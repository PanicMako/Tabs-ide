const SEGMENT = /^[a-z][a-z0-9-]{1,62}$/;

export interface SearchCursor {
  readonly namespace: string;
  readonly name: string;
}

export function encodeSearchCursor(value: SearchCursor): string {
  return Buffer.from(JSON.stringify([value.namespace, value.name])).toString("base64url");
}

export function decodeSearchCursor(value: string): SearchCursor | null {
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [namespace, name] = decoded;
    if (
      typeof namespace !== "string" ||
      !SEGMENT.test(namespace) ||
      typeof name !== "string" ||
      !SEGMENT.test(name)
    ) {
      return null;
    }
    if (encodeSearchCursor({ namespace, name }) !== value) return null;
    return { namespace, name };
  } catch {
    return null;
  }
}

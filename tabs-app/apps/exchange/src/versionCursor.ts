const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const VERSION = /^[0-9A-Za-z.+-]{1,128}$/;

export interface VersionCursor {
  readonly submittedAt: string;
  readonly version: string;
}

export function encodeVersionCursor(value: VersionCursor): string {
  return Buffer.from(JSON.stringify([value.submittedAt, value.version])).toString("base64url");
}

export function decodeVersionCursor(value: string): VersionCursor | null {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [submittedAt, version] = decoded;
    const parsed = typeof submittedAt === "string" ? new Date(submittedAt) : null;
    if (
      typeof submittedAt !== "string" ||
      !CURSOR_TIME.test(submittedAt) ||
      !parsed ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 23) !== submittedAt.slice(0, 23) ||
      typeof version !== "string" ||
      !VERSION.test(version)
    ) {
      return null;
    }
    return { submittedAt, version };
  } catch {
    return null;
  }
}

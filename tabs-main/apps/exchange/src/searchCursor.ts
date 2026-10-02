const SEGMENT = /^[a-z][a-z0-9-]{1,62}$/;

export interface SearchCursor {
  readonly namespace: string;
  readonly name: string;
  readonly submittedAt?: string;
  readonly publishedAt?: string | null;
  readonly relevance?: number;
  readonly sortName?: string;
}

export function encodeSearchCursor(value: SearchCursor): string {
  return Buffer.from(
    JSON.stringify(
      value.sortName !== undefined
        ? [value.namespace, value.name, "display-name", value.sortName]
        : value.relevance !== undefined
          ? [value.namespace, value.name, "relevance", value.relevance]
          : value.publishedAt !== undefined
            ? [value.namespace, value.name, "published", value.publishedAt]
            : value.submittedAt
              ? [value.namespace, value.name, value.submittedAt]
              : [value.namespace, value.name],
    ),
  ).toString("base64url");
}

export function decodeSearchCursor(value: string): SearchCursor | null {
  if (value.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || ![2, 3, 4].includes(decoded.length)) return null;
    if (decoded.length === 4) {
      const [namespace, name, kind, publishedAt] = decoded;
      if (
        !["published", "relevance", "display-name"].includes(kind) ||
        typeof namespace !== "string" ||
        !SEGMENT.test(namespace) ||
        typeof name !== "string" ||
        !SEGMENT.test(name)
      )
        return null;
      if (kind === "display-name") {
        if (typeof publishedAt !== "string" || !publishedAt || publishedAt.length > 1500)
          return null;
        const result = { namespace, name, sortName: publishedAt };
        return encodeSearchCursor(result) === value ? result : null;
      }
      if (value.length > 256) return null;
      if (kind === "relevance") {
        if (!Number.isInteger(publishedAt) || publishedAt < 0 || publishedAt > 4) return null;
        const result = { namespace, name, relevance: publishedAt as number };
        return encodeSearchCursor(result) === value ? result : null;
      }
      if (
        publishedAt !== null &&
        (typeof publishedAt !== "string" ||
          !decodeSearchCursor(encodeSearchCursor({ namespace, name, submittedAt: publishedAt })))
      )
        return null;
      const result = { namespace, name, publishedAt };
      return encodeSearchCursor(result) === value ? result : null;
    }
    if (value.length > 256) return null;
    const [namespace, name, submittedAt] = decoded;
    if (
      decoded.length === 3 &&
      (typeof submittedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(submittedAt) ||
        !Number.isFinite(Date.parse(submittedAt)) ||
        Number(submittedAt.slice(0, 4)) < 1 ||
        new Date(submittedAt).toISOString() !== `${submittedAt.slice(0, 23)}Z`)
    )
      return null;
    if (
      typeof namespace !== "string" ||
      !SEGMENT.test(namespace) ||
      typeof name !== "string" ||
      !SEGMENT.test(name)
    ) {
      return null;
    }
    const result = { namespace, name, ...(submittedAt ? { submittedAt } : {}) };
    if (encodeSearchCursor(result) !== value) return null;
    return result;
  } catch {
    return null;
  }
}

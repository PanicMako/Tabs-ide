export function reviewHistoryPath(namespace: string, name: string) {
  if (![namespace, name].every((value) => /^[a-z][a-z0-9-]{1,62}$/.test(value)))
    throw new Error("Enter a valid publisher namespace and extension name.");
  return `/v1/review/${namespace}/${name}/history`;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit)
    throw new Error("Invalid review history response.");
  return value;
}

export function reviewHistoryRecords(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid review history response.");
  const data = value as { versions?: unknown; decisions?: unknown };
  if (
    !Array.isArray(data.versions) ||
    !Array.isArray(data.decisions) ||
    data.versions.length > 100 ||
    data.decisions.length > 100
  )
    throw new Error("Invalid review history response.");
  return {
    versions: data.versions.map((row) => {
      if (!row || typeof row !== "object") throw new Error("Invalid review history response.");
      return {
        version: text(row.version, 128),
        status: text(row.status, 32),
        digest: text(row.digest, 64),
        login: text(row.uploader_login, 100),
        timestamp: text(row.submitted_at, 100),
      };
    }),
    decisions: data.decisions.map((row) => {
      if (!row || typeof row !== "object") throw new Error("Invalid review history response.");
      return {
        action: text(row.action, 32),
        version: text(row.version, 128),
        digest: text(row.digest, 64),
        login: text(row.reviewer_login, 100),
        timestamp: text(row.created_at, 100),
        reason: text(row.reason, 2000),
      };
    }),
  };
}

export function reviewHistoryLines(value: unknown): { versions: string[]; decisions: string[] } {
  const records = reviewHistoryRecords(value);
  return {
    versions: records.versions.map(
      (row) =>
        `${row.version}: ${row.status}. SHA-256 ${row.digest}. Uploaded by ${row.login} at ${row.timestamp}.`,
    ),
    decisions: records.decisions.map(
      (row) =>
        `${row.action} ${row.version}: SHA-256 ${row.digest}. Reviewer ${row.login} at ${row.timestamp}. Reason: ${row.reason}`,
    ),
  };
}

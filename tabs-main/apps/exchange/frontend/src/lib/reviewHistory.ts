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

export function reviewHistoryLines(value: unknown): { versions: string[]; decisions: string[] } {
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
      return `${text(row.version, 128)}: ${text(row.status, 32)}. SHA-256 ${text(row.digest, 64)}. Uploaded by ${text(row.uploader_login, 100)} at ${text(row.submitted_at, 100)}.`;
    }),
    decisions: data.decisions.map((row) => {
      if (!row || typeof row !== "object") throw new Error("Invalid review history response.");
      return `${text(row.action, 32)} ${text(row.version, 128)}: SHA-256 ${text(row.digest, 64)}. Reviewer ${text(row.reviewer_login, 100)} at ${text(row.created_at, 100)}. Reason: ${text(row.reason, 2000)}`;
    }),
  };
}

export interface SubmissionAppeal {
  message: string;
  created_at: string;
  response: string | null;
  responded_at: string | null;
}

export function submissionAppeals(
  data: unknown,
  identity: { namespace: string; name: string; version: string; digest: string },
): SubmissionAppeal[] {
  const appeals = (data as { appeals?: unknown } | null)?.appeals;
  if (!Array.isArray(appeals) || appeals.length > 100)
    throw new Error("Invalid appeal history response.");
  return appeals.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid appeal record.");
    for (const key of ["namespace", "name", "version", "digest"] as const)
      if (entry[key] !== identity[key])
        throw new Error("Appeal identity did not match this release.");
    for (const key of ["message", "created_at"])
      if (typeof entry[key] !== "string" || !entry[key] || entry[key].length > 4000)
        throw new Error("Invalid appeal record.");
    for (const key of ["response", "responded_at"])
      if (entry[key] !== null && (typeof entry[key] !== "string" || entry[key].length > 4000))
        throw new Error("Invalid appeal response.");
    return {
      message: entry.message,
      created_at: entry.created_at,
      response: entry.response,
      responded_at: entry.responded_at,
    };
  });
}

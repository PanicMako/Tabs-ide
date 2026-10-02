export interface ReviewAppeal {
  id: string;
  namespace: string;
  name: string;
  version: string;
  digest: string;
  message: string;
  status: string;
  review_reason: string | null;
}

export function reviewAppeals(data: unknown): ReviewAppeal[] {
  const entries = (data as { appeals?: unknown } | null)?.appeals;
  if (!Array.isArray(entries) || entries.length > 100) throw new Error("Invalid appeal queue.");
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid appeal evidence.");
    if (
      typeof entry.id !== "string" &&
      (typeof entry.id !== "number" || !Number.isSafeInteger(entry.id))
    )
      throw new Error("Invalid appeal identity.");
    const id = String(entry.id);
    if (!/^[1-9][0-9]{0,18}$/.test(id) || seen.has(id)) throw new Error("Invalid appeal identity.");
    seen.add(id);
    if (
      !/^[a-z][a-z0-9-]{1,62}$/.test(entry.namespace) ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(entry.name) ||
      !/^[0-9A-Za-z.+-]{1,128}$/.test(entry.version) ||
      !/^[a-f0-9]{64}$/.test(entry.digest)
    )
      throw new Error("Invalid appeal package identity.");
    if (
      typeof entry.message !== "string" ||
      !entry.message ||
      entry.message.length > 4000 ||
      typeof entry.status !== "string" ||
      entry.status.length > 30 ||
      (entry.review_reason !== null &&
        (typeof entry.review_reason !== "string" || entry.review_reason.length > 4000))
    )
      throw new Error("Invalid appeal evidence.");
    return {
      id,
      namespace: entry.namespace,
      name: entry.name,
      version: entry.version,
      digest: entry.digest,
      message: entry.message,
      status: entry.status,
      review_reason: entry.review_reason,
    };
  });
}

export function appealResponse(id: string, response: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(id) || !response.trim() || response.length > 4000)
    throw new Error("Enter a response of 1 to 4000 characters for the displayed appeal.");
  return { path: `/v1/review/appeals/${id}/response`, body: { response: response.trim() } };
}

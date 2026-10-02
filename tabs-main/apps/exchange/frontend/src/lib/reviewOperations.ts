export function reviewOperationsSummary(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Missing operations response.");
  const queue = (value as { queue?: Record<string, unknown> }).queue;
  if (!queue || typeof queue !== "object") throw new Error("Missing operations queue.");
  const count = (key: string) => {
    const result = queue[key];
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0)
      throw new Error("Invalid operations count.");
    return result;
  };
  if (typeof queue.worker_recently_seen !== "boolean") throw new Error("Missing worker health.");
  const approved = count("awaiting_signed_publication");
  const revoked = count("pending_signed_revocations");
  return `Worker heartbeat: ${queue.worker_recently_seen ? "recent" : "missing or stale"}. Queued: ${count("queued")}. Scanning: ${count("scanning")}. Stale scans: ${count("stale_scans")}. Awaiting review: ${count("awaiting_review")}. ${approved} approved release(s) await signed publication. ${revoked} revoked release(s) remain in published signed targets.${revoked ? " Publish updated signed metadata promptly." : ""}`;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Missing operational evidence.");
  return value as Record<string, unknown>;
}

function date(value: unknown): string {
  if (value === null) return "none recorded";
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid operational date.");
  return new Date(value).toISOString();
}

/** Server-reported diagnostics, not client verification of signed metadata. */
export function reviewOperationsDetail(value: unknown) {
  const summary = reviewOperationsSummary(value);
  const data = object(value);
  const queue = object(data.queue);
  const activity = [
    ["Last worker heartbeat", "last_worker_heartbeat_at"],
    ["Last completed scan", "last_scan_at"],
    ["Oldest queued package", "oldest_queued_at"],
    ["Last review", "last_reviewed_at"],
    ["Last signed publication", "last_signed_publication_at"],
  ].map(([label, key]) => `${label}: ${date(queue[key!])}.`);

  const roles = ["root", "timestamp", "snapshot", "targets"];
  if (!Array.isArray(data.metadataFreshness) || data.metadataFreshness.length !== roles.length)
    throw new Error("Incomplete stored metadata evidence.");
  const seen = new Set<string>();
  const metadataByRole = new Map<string, string>();
  for (const value of data.metadataFreshness) {
    const entry = object(value);
    if (
      typeof entry.role !== "string" ||
      !roles.includes(entry.role) ||
      seen.has(entry.role) ||
      typeof entry.status !== "string" ||
      !["missing", "invalid", "expired", "expiring", "valid"].includes(entry.status)
    )
      throw new Error("Invalid stored metadata evidence.");
    seen.add(entry.role);
    if (
      entry.status === "missing" || entry.status === "invalid"
        ? entry.expiresAt !== null
        : entry.expiresAt === null
    )
      throw new Error("Inconsistent stored metadata expiry.");
    metadataByRole.set(
      entry.role,
      `${entry.role}: ${entry.status}${entry.expiresAt === null ? "" : `; expires ${date(entry.expiresAt)}`}.`,
    );
  }

  const readiness = object(data.readiness);
  if (
    typeof readiness.ready !== "boolean" ||
    typeof readiness.healthzOk !== "boolean" ||
    !Array.isArray(readiness.alerts) ||
    readiness.alerts.length > 100
  )
    throw new Error("Invalid operational advisory.");
  let critical = false;
  const alerts = readiness.alerts.map((value) => {
    const alert = object(value);
    if (
      (alert.level !== "critical" && alert.level !== "warning") ||
      typeof alert.subsystem !== "string" ||
      !["worker", "queue", "tuf", "database", "storage"].includes(alert.subsystem) ||
      typeof alert.message !== "string" ||
      !alert.message.trim() ||
      alert.message.length > 2000
    )
      throw new Error("Invalid operational alert.");
    if (alert.level === "critical") critical = true;
    return `${alert.level}: ${alert.subsystem}. ${alert.message}`;
  });
  if (readiness.ready && (critical || !readiness.healthzOk))
    throw new Error("Inconsistent operational advisory.");

  if (
    !Array.isArray(data.pendingRevocations) ||
    data.pendingRevocations.length > 100 ||
    data.pendingRevocations.length > (queue.pending_signed_revocations as number)
  )
    throw new Error("Invalid pending revocation evidence.");
  const identities = new Set<string>();
  const revocations = data.pendingRevocations.map((value) => {
    const entry = object(value);
    if (
      typeof entry.namespace !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(entry.namespace) ||
      typeof entry.name !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(entry.name) ||
      typeof entry.version !== "string" ||
      !/^[0-9A-Za-z.+-]{1,128}$/.test(entry.version) ||
      typeof entry.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.digest)
    )
      throw new Error("Invalid pending revocation identity.");
    const identity = `${entry.namespace}.${entry.name}@${entry.version}`;
    if (identities.has(identity)) throw new Error("Duplicate pending revocation identity.");
    identities.add(identity);
    return `${identity}: SHA-256 ${entry.digest}. Revoked: ${date(entry.reviewed_at)}.`;
  });
  const remaining = (queue.pending_signed_revocations as number) - revocations.length;
  return {
    summary,
    activity,
    metadata: roles.map((role) => metadataByRole.get(role)!),
    advisory: readiness.ready
      ? "Server advisory: no critical operational alerts reported. This is not a production-readiness certificate or an independent storage/signature check."
      : "Server advisory: operational attention required. Inspect the alerts before assuming scans or updates are available.",
    alerts: alerts.length ? alerts : ["No operational alerts reported by the server."],
    revocations: revocations.length
      ? revocations
      : [
          (queue.pending_signed_revocations as number) === 0
            ? "No signed revocations are pending in this snapshot."
            : "Pending revocation identities were not included. Do not assume the backlog is empty.",
        ],
    remaining,
  };
}

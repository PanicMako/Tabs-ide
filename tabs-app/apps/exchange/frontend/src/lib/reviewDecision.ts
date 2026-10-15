export interface ReviewIdentity {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}

export function reviewDecision(
  identity: ReviewIdentity,
  action: string,
  reason: string,
  confirmedDigest: string,
  state: "review" | "approved" = "review",
) {
  if (
    !/^[a-z][a-z0-9-]{1,62}$/.test(identity.namespace) ||
    !/^[a-z][a-z0-9-]{1,62}$/.test(identity.name) ||
    !/^[0-9A-Za-z.+-]{1,128}$/.test(identity.version) ||
    !/^[a-f0-9]{64}$/.test(identity.digest)
  )
    throw new Error("Invalid review identity. Refresh the queue.");
  if (state === "approved" ? action !== "revoke" : action !== "approve" && action !== "reject")
    throw new Error(
      state === "approved" ? "Choose revoke for an approved release." : "Choose approve or reject.",
    );
  if (!reason.trim() || reason.length > 2000)
    throw new Error("Enter a reason of 1 to 2000 characters.");
  if (confirmedDigest.trim() !== identity.digest)
    throw new Error("Confirm the exact displayed SHA-256 digest.");
  return {
    path: `/v1/review/${identity.namespace}/${identity.name}/${encodeURIComponent(identity.version)}`,
    body: { action, digest: identity.digest, reason: reason.trim() },
  };
}

export function reviewRescan(identity: ReviewIdentity, reason: string, confirmedDigest: string) {
  const validated = reviewDecision(identity, "reject", reason, confirmedDigest);
  return {
    path: `${validated.path}/rescan`,
    body: { digest: validated.body.digest, reason: validated.body.reason },
  };
}

export function reviewArchivePath(identity: ReviewIdentity) {
  const validated = reviewDecision(identity, "reject", "Archive inspection", identity.digest);
  return `${validated.path}/download`;
}

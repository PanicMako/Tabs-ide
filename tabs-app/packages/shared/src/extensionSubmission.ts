export function submissionLifecycle(value: unknown): {
  code: string;
  label: string;
  terminal: boolean;
} {
  if (!value || typeof value !== "object" || !("status" in value))
    return { code: "unknown", label: "Unknown submission state", terminal: false };
  const published = "published" in value && value.published === true;
  switch (value.status) {
    case "queued":
      return { code: "uploaded", label: "Uploaded; waiting for scanning", terminal: false };
    case "scanning":
      return { code: "scanning", label: "Scanning", terminal: false };
    case "review":
      return { code: "review", label: "Awaiting manual review", terminal: false };
    case "rejected":
      return { code: "rejected", label: "Rejected", terminal: true };
    case "revoked":
      return { code: "revoked", label: "Revoked", terminal: true };
    case "approved":
      return published
        ? { code: "published", label: "Published in signed metadata", terminal: true }
        : { code: "approved", label: "Approved; awaiting signed publication", terminal: false };
    default:
      return { code: "unknown", label: "Unknown submission state", terminal: false };
  }
}

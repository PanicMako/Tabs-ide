function extractCheckoutOverwritePaths(message: string): string[] {
  const paths = new Set<string>();
  for (const line of message.split(/\r?\n/g)) {
    if (!line.startsWith("\t")) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    paths.add(trimmed);
  }
  return [...paths];
}

function stripKnownGitErrorPrefix(message: string): string {
  const prefixes = [
    "Git command failed in ",
    "Git manager failed in ",
    "GitHub CLI failed in ",
    "Text generation failed in ",
  ];
  if (!prefixes.some((prefix) => message.startsWith(prefix))) {
    return message;
  }
  const separatorIndex = message.indexOf(" - ");
  if (separatorIndex < 0) {
    return message;
  }
  return message.slice(separatorIndex + 3).trim();
}

export function toGitUserFacingErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    const raw = String(obj.detail || obj.message || obj.reason || "");
    if (raw && raw !== "Internal server error") {
      return stripKnownGitErrorPrefix(raw.trim());
    }
  }
  if (!(error instanceof Error)) {
    return "An unexpected error occurred.";
  }

  const detail = stripKnownGitErrorPrefix(error.message.trim());
  if (detail === "Internal server error") {
    return "AI generation failed on server. Please check your Google Gemini API key in Settings → Providers.";
  }
  if (!detail.toLowerCase().includes("would be overwritten by checkout")) {
    return detail;
  }

  const paths = extractCheckoutOverwritePaths(error.message);
  if (paths.length === 0) {
    return "Switching branches would overwrite local changes. Commit, stash, or discard them first.";
  }
  const preview = paths.slice(0, 3).join(", ");
  const remainingCount = Math.max(0, paths.length - 3);
  return `Switching branches would overwrite ${paths.length} local file${paths.length === 1 ? "" : "s"}. Commit, stash, or discard them first. Affected: ${preview}${remainingCount > 0 ? `, and ${remainingCount} more` : ""}.`;
}

const SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN = /^\/[A-Za-z]:[\\/]/;
const POSITION_SUFFIX_CAPTURE_PATTERN = /:(\d+)(?::(\d+))?$/;
const POSITION_HASH_PATTERN = /^#L(\d+)(?:C(\d+))?$/i;

export interface FilePathPosition {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

export function stripSlashPrefixedWindowsDrive(path: string): string {
  return SLASH_PREFIXED_WINDOWS_DRIVE_PATTERN.test(path) ? path.slice(1) : path;
}

export function splitFilePathPosition(path: string, hash = ""): FilePathPosition {
  const suffixMatch = path.match(POSITION_SUFFIX_CAPTURE_PATTERN);
  const match = suffixMatch ?? hash.match(POSITION_HASH_PATTERN);
  if (!match?.[1]) return { path };

  const line = Number.parseInt(match[1], 10);
  const column = match[2] === undefined ? undefined : Number.parseInt(match[2], 10);
  return {
    path: suffixMatch ? path.slice(0, -suffixMatch[0].length) : path,
    ...(line > 0 ? { line } : {}),
    ...(column !== undefined && column > 0 ? { column } : {}),
  };
}

export function formatFilePathPosition(position: FilePathPosition): string {
  if (!position.line) return position.path;
  return `${position.path}:${position.line}${position.column ? `:${position.column}` : ""}`;
}

export function fileBasename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const last = normalized.split("/").pop();
  return last || path;
}

export function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(value) || value.startsWith("\\\\");
}

function normalizePathSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

function trimTrailingPathSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function stripRelativePrefixes(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function formatWorkspaceRelativePath(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
): string {
  const position = splitFilePathPosition(pathWithPosition);
  const normalizedPath = stripSlashPrefixedWindowsDrive(normalizePathSeparators(position.path));

  let displayPath = normalizedPath;
  if (workspaceRoot) {
    const normalizedWorkspaceRoot = stripSlashPrefixedWindowsDrive(
      normalizePathSeparators(trimTrailingPathSeparators(workspaceRoot)),
    );
    const workspaceLabel = fileBasename(normalizedWorkspaceRoot);
    const caseInsensitive = isWindowsAbsolutePath(stripSlashPrefixedWindowsDrive(workspaceRoot));
    const pathForCompare = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
    const workspaceForCompare = caseInsensitive
      ? normalizedWorkspaceRoot.toLowerCase()
      : normalizedWorkspaceRoot;
    const workspaceWithSeparator = `${workspaceForCompare}/`;
    const workspaceLabelWithSeparator = `${caseInsensitive ? workspaceLabel.toLowerCase() : workspaceLabel}/`;

    if (pathForCompare === workspaceForCompare) {
      displayPath = workspaceLabel;
    } else if (pathForCompare.startsWith(workspaceWithSeparator)) {
      const relativeSuffix = normalizedPath.slice(normalizedWorkspaceRoot.length + 1);
      displayPath = `${workspaceLabel}/${relativeSuffix}`;
    } else if (!normalizedPath.startsWith("/")) {
      const relativePath = stripRelativePrefixes(normalizedPath);
      displayPath = pathForCompare.startsWith(workspaceLabelWithSeparator)
        ? normalizedPath
        : `${workspaceLabel}/${relativePath}`;
    }
  }

  return formatFilePathPosition({ ...position, path: displayPath });
}

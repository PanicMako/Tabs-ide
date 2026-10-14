/** Internal tree drags carry paths, not uploaded file bytes. */
export const WORKSPACE_FILE_MIME = "application/x-tabs-workspace-path";
export const ADD_WORKSPACE_FILE_EVENT = "tabs:add-workspace-file-context";
export interface WorkspaceFileContext {
  path: string;
  cwd: string;
  kind: "file" | "directory";
  environmentId: string | null;
  threadId?: string | null | undefined;
}
export function parseWorkspaceFileContext(value: string): WorkspaceFileContext | null {
  try {
    const data = JSON.parse(value) as Partial<WorkspaceFileContext>;
    if (
      typeof data.path !== "string" ||
      !data.path ||
      data.path.length > 8192 ||
      Array.from(data.path).some((char) => char.charCodeAt(0) < 32) ||
      /^([\\/]|[a-z]:)/i.test(data.path) ||
      data.path.split(/[\\/]/).some((part) => part === "..") ||
      typeof data.cwd !== "string" ||
      !data.cwd ||
      Array.from(data.cwd).some((char) => char.charCodeAt(0) < 32) ||
      (data.kind !== "file" && data.kind !== "directory") ||
      (data.environmentId !== null && typeof data.environmentId !== "string")
    )
      return null;
    return data as WorkspaceFileContext;
  } catch {
    return null;
  }
}
export function absoluteWorkspacePath(cwd: string, path: string): string {
  const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${path.replace(/\//g, separator)}`;
}
export function workspaceFileMention(
  context: WorkspaceFileContext,
  cwd: string | undefined,
): string {
  let path =
    cwd?.replace(/[\\/]+$/, "") === context.cwd.replace(/[\\/]+$/, "")
      ? context.path
      : absoluteWorkspacePath(context.cwd, context.path);
  if (context.kind === "directory" && !path.endsWith("/")) path += "/";
  return `@${JSON.stringify(path)} `;
}

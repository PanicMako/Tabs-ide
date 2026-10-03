import { fileURLToPath } from "node:url";

type UriLike = {
  scheme?: unknown;
  authority?: unknown;
  path?: unknown;
  fsPath?: unknown;
};

export type NativeCodeOpenTarget =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "workspace"; readonly path: string };

export function filePathFromNativeUri(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const uri = value as UriLike;
  if (uri.scheme !== undefined && uri.scheme !== "file") return null;
  if (typeof uri.fsPath === "string" && uri.fsPath.length > 0) return uri.fsPath;
  if (uri.scheme !== "file" || typeof uri.path !== "string") return null;
  try {
    const authority = typeof uri.authority === "string" ? uri.authority : "";
    // URI.toJSON() supplies a decoded path. Encode it before constructing a
    // URL so literal percent escapes, query markers and fragments remain part
    // of the filename rather than acquiring URL semantics.
    const encodedPath = encodeURI(uri.path).replace(/[?#]/g, encodeURIComponent);
    return fileURLToPath(new URL(`file://${authority}${encodedPath}`));
  } catch {
    return null;
  }
}

export function getNativeCodeOpenTargets(openables: unknown): NativeCodeOpenTarget[] {
  if (!Array.isArray(openables)) return [];
  const targets: NativeCodeOpenTarget[] = [];
  for (const openable of openables) {
    if (!openable || typeof openable !== "object") continue;
    const candidate = openable as Record<string, unknown>;
    const filePath = filePathFromNativeUri(candidate.fileUri);
    if (filePath) {
      targets.push({ kind: "file", path: filePath });
      continue;
    }
    const folderPath = filePathFromNativeUri(candidate.folderUri);
    if (folderPath) {
      targets.push({ kind: "folder", path: folderPath });
      continue;
    }
    const workspacePath = filePathFromNativeUri(candidate.workspaceUri);
    if (workspacePath) targets.push({ kind: "workspace", path: workspacePath });
  }
  return targets;
}

export interface NativeAgentsUri {
  readonly scheme: string;
  readonly path: string;
  readonly authority?: string;
  readonly query?: string;
  readonly fragment?: string;
}

export interface NativeAgentsWindowPayload {
  readonly folderUri?: NativeAgentsUri | undefined;
  readonly sessionResource?: NativeAgentsUri | undefined;
  readonly onboardingSessionResource?: NativeAgentsUri | undefined;
  readonly folderUriIsDefault: boolean;
  readonly source: string;
  readonly draft?: { readonly inputText: string; readonly attachments: string } | undefined;
}

function agentsUri(value: unknown): NativeAgentsUri | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid Agents resource URI");
  const uri = value as Record<string, unknown>;
  if (
    typeof uri.scheme !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(uri.scheme) ||
    typeof uri.path !== "string"
  )
    throw new Error("Invalid Agents resource URI");
  const result: Record<string, string> = { scheme: uri.scheme, path: uri.path };
  for (const key of ["authority", "query", "fragment"] as const) {
    if (uri[key] !== undefined) {
      if (typeof uri[key] !== "string") throw new Error("Invalid Agents resource URI");
      result[key] = uri[key];
    }
  }
  return result as unknown as NativeAgentsUri;
}

export function parseNativeAgentsWindowOptions(options: unknown): NativeAgentsWindowPayload {
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)))
    throw new Error("Invalid Agents window options");
  const opts = (options ?? {}) as Record<string, unknown>;
  const draft = opts.draft as Record<string, unknown> | undefined;
  if (
    draft !== undefined &&
    (!draft || typeof draft.inputText !== "string" || typeof draft.attachments !== "string")
  )
    throw new Error("Invalid Agents draft: inputText and serialized attachments are required");
  return {
    folderUri: agentsUri(opts.folderUri),
    sessionResource: agentsUri(opts.sessionResource),
    onboardingSessionResource: agentsUri(opts.onboardingSessionResource),
    folderUriIsDefault: opts.folderUriIsDefault === true,
    source: typeof opts.source === "string" ? opts.source : "unknown",
    draft: draft
      ? { inputText: draft.inputText as string, attachments: draft.attachments as string }
      : undefined,
  };
}

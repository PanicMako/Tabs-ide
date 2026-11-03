import { readdir, realpath } from "node:fs/promises";
import * as Path from "node:path";

// Editor resources are bundled locally. Keep project storage persistent without
// retaining a separate copy of downloaded resources and compiled JS per project.
export const EDITOR_SESSION_OPTIONS = { cache: false } as const;
export const EDITOR_CACHE_PREFERENCES = { v8CacheOptions: "none" } as const;
const EDITOR_PARTITION_PREFIX = "tabs-code-host:";

interface EditorCacheSession {
  clearCache(): Promise<void>;
  clearCodeCaches(options: { urls: string[] }): Promise<void>;
}

export async function clearLegacyEditorCaches(
  sessionDataPath: string,
  fromPartition: (partition: string, options: typeof EDITOR_SESSION_OPTIONS) => EditorCacheSession,
  warn: (message: string) => void,
): Promise<void> {
  const partitionsPath = Path.join(sessionDataPath, "Partitions");
  // A redirected profile must never cause cleanup in another app's storage.
  if ((await realpath(partitionsPath).catch(() => null)) !== partitionsPath) return;
  const entries = await readdir(partitionsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let partition: string;
    try {
      partition = decodeURIComponent(entry.name);
    } catch {
      continue;
    }
    if (!partition.startsWith(EDITOR_PARTITION_PREFIX)) continue;
    const projectId = partition.slice(EDITOR_PARTITION_PREFIX.length);
    if (!projectId || /[\\/]/.test(projectId) || projectId.includes("\0")) continue;
    try {
      const editorSession = fromPartition(`persist:${partition}`, EDITOR_SESSION_OPTIONS);
      // These APIs leave cookies, IndexedDB, localStorage, service workers and
      // editor state intact. Never use clearStorageData() for cache maintenance.
      for (const clear of [
        () => editorSession.clearCache(),
        () => editorSession.clearCodeCaches({ urls: [] }),
      ]) {
        try {
          await clear();
        } catch (error) {
          warn(`[editor-cache] Could not clear ${entry.name}: ${String(error)}`);
        }
      }
    } catch (error) {
      warn(`[editor-cache] Could not open ${entry.name}: ${String(error)}`);
    }
  }
}

// Finds transcript files for each supported agent CLI. Only directory listings and stat calls
// run here; contents are read by the indexer, and only for files whose mtime/size changed.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { SessionSearchAgent } from "@tabs/contracts";

export interface SessionSearchRoots {
  readonly claudeProjects: string;
  readonly codexSessions: ReadonlyArray<string>;
  readonly geminiTmp: string;
  readonly opencodeDb: string;
}

export function defaultRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): SessionSearchRoots {
  const claudeHome = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const codexHome = env.CODEX_HOME?.trim() || join(home, ".codex");
  const dataHome = env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
  return {
    claudeProjects: join(claudeHome, "projects"),
    codexSessions: [join(codexHome, "sessions"), join(codexHome, "archived_sessions")],
    geminiTmp: join(home, ".gemini", "tmp"),
    opencodeDb: join(dataHome, "opencode", "opencode.db"),
  };
}

export interface DiscoveredFile {
  readonly agent: Exclude<SessionSearchAgent, "opencode">;
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statFile(
  agent: DiscoveredFile["agent"],
  path: string,
): Promise<DiscoveredFile | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { agent, path, mtimeMs: info.mtimeMs, size: info.size } : null;
  } catch {
    return null;
  }
}

/** `projects/<encoded-cwd>/<session>.jsonl`; subagent transcripts live deeper and are skipped. */
async function discoverClaude(root: string): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  for (const project of await listDir(root)) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    const files = (await listDir(dir)).filter((e) => e.isFile() && e.name.endsWith(".jsonl"));
    const stats = await Promise.all(files.map((e) => statFile("claude", join(dir, e.name))));
    for (const file of stats) if (file) out.push(file);
  }
  return out;
}

/** `sessions/YYYY/MM/DD/rollout-*.jsonl` (also flat archives); walk to any depth, bounded. */
async function discoverCodex(root: string, depth = 0): Promise<DiscoveredFile[]> {
  if (depth > 5) return [];
  const out: DiscoveredFile[] = [];
  const subdirs: string[] = [];
  const pending: Promise<DiscoveredFile | null>[] = [];
  for (const entry of await listDir(root)) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) subdirs.push(full);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) pending.push(statFile("codex", full));
  }
  for (const file of await Promise.all(pending)) if (file) out.push(file);
  for (const sub of subdirs) out.push(...(await discoverCodex(sub, depth + 1)));
  return out;
}

/** `tmp/<project>/chats/session-*.json[l]` */
async function discoverGemini(root: string): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  for (const project of await listDir(root)) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name, "chats");
    const files = (await listDir(dir)).filter(
      (e) => e.isFile() && (e.name.endsWith(".jsonl") || e.name.endsWith(".json")),
    );
    const stats = await Promise.all(files.map((e) => statFile("gemini", join(dir, e.name))));
    for (const file of stats) if (file) out.push(file);
  }
  return out;
}

export async function discoverTranscriptFiles(
  roots: SessionSearchRoots,
): Promise<DiscoveredFile[]> {
  const groups = await Promise.all([
    discoverClaude(roots.claudeProjects),
    Promise.all(roots.codexSessions.map((root) => discoverCodex(root))).then((r) => r.flat()),
    discoverGemini(roots.geminiTmp),
  ]);
  return groups.flat();
}

/** Newest first, so recent sessions become searchable before the long tail finishes. */
export function newestFirst<T extends { readonly mtimeMs: number }>(files: ReadonlyArray<T>): T[] {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

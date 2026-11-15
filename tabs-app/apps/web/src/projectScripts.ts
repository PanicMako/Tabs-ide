import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type KeybindingCommand,
  type ProjectScript,
} from "@tabs/contracts";
import { Schema } from "effect";

export interface ProjectScriptInput {
  readonly name: ProjectScript["name"];
  readonly command: ProjectScript["command"];
  readonly icon: ProjectScript["icon"];
  readonly runOnWorktreeCreate: ProjectScript["runOnWorktreeCreate"];
  readonly waitForSetup: boolean;
  readonly runOnSettle: boolean;
  readonly stopOnSettle?: boolean;
  readonly previewUrl: Exclude<ProjectScript["previewUrl"], undefined> | null;
  readonly autoOpenPreview: boolean;
}

/** Builds the stored script from every editor field, so saving never drops a setting. */
export function buildProjectScript(id: string, input: ProjectScriptInput): ProjectScript {
  return {
    id,
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    ...(input.runOnWorktreeCreate && input.waitForSetup ? { async: false } : {}),
    ...(input.runOnSettle ? { runOnSettle: true } : {}),
    ...(input.stopOnSettle ? { stopOnSettle: true } : {}),
    ...(input.previewUrl === null
      ? {}
      : { previewUrl: input.previewUrl, autoOpenPreview: input.autoOpenPreview }),
  };
}

/** A project has one setup and one settle action; the saved one takes the role from the rest. */
export function releaseClaimedRoles(
  script: ProjectScript,
  saved: Pick<ProjectScriptInput, "runOnWorktreeCreate" | "runOnSettle">,
): ProjectScript {
  const releaseSetup = saved.runOnWorktreeCreate && script.runOnWorktreeCreate;
  const releaseSettle = saved.runOnSettle && script.runOnSettle === true;
  if (!releaseSetup && !releaseSettle) return script;
  return {
    ...script,
    ...(releaseSetup ? { runOnWorktreeCreate: false } : {}),
    ...(releaseSettle ? { runOnSettle: false } : {}),
  };
}

export {
  projectScriptMenuLabel,
  projectScriptTerminalInput,
  settleProjectScript,
} from "@tabs/shared/projectScripts";

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export const commandForProjectScript = (scriptId: string): KeybindingCommand =>
  `script.${scriptId}.run` as KeybindingCommand;

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!Schema.is(SCRIPT_RUN_COMMAND_PATTERN)(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  // This last-resort fallback only triggers after exhausting thousands of suffixes.
  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    TABS_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.TABS_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function primaryProjectScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  // A settle action is cleanup, never the one-click run.
  const regular = scripts.find((script) => !script.runOnWorktreeCreate && !script.runOnSettle);
  return regular ?? scripts.find((script) => !script.runOnSettle) ?? null;
}

export function setupProjectScript(scripts: ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/**
 * Start the Code workbench in the background so the Code tool opens onto an editor
 * that is already running. The editor is its own process and does not depend on the
 * backend, so it can begin while the splash is still up. The project is remembered
 * from the last run, because the real project list is not hydrated yet at that point.
 */
const STORAGE_KEY = "tabs:code-prewarm-project:v1";

interface PrewarmProject {
  readonly id: string;
  readonly cwd: string;
}

export function rememberCodePrewarmProject(project: PrewarmProject): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: project.id, cwd: project.cwd }));
  } catch {
    // Remembering is a convenience only.
  }
}

/** The project no longer uses Code, so the next launch must not start an editor for it. */
export function forgetCodePrewarmProject(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Remembering is a convenience only.
  }
}

export function readRememberedCodePrewarmProject(): PrewarmProject | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as {
      id?: unknown;
      cwd?: unknown;
    } | null;
    return typeof parsed?.id === "string" && typeof parsed.cwd === "string" && parsed.cwd
      ? { id: parsed.id, cwd: parsed.cwd }
      : null;
  } catch {
    return null;
  }
}

/** Ask the desktop to load the editor for this project in the background. Best-effort. */
export function prewarmCodeHost(project: PrewarmProject): Promise<void> {
  const bridge = window.desktopBridge;
  if (!bridge) return Promise.resolve();
  return bridge
    .getCodeHostState()
    .then((state) =>
      state.available
        ? bridge.ensureCodeSession({
            projectId: project.id,
            workspaceRoot: project.cwd,
            prewarm: true,
          })
        : undefined,
    )
    .catch(() => undefined);
}

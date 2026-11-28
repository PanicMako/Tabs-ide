import type { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { projectsAtom, threadsAtom } from "../state/threads";
import { useWorkspaceActiveProjectId } from "../state/workspaceShell";
import { useDraftThread } from "../state/composerDrafts";
import { useHandleNewThread } from "./useHandleNewThread";

export interface ActiveProjectTarget {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly projectCwd: string;
  readonly projectName: string;
  readonly threadId?: ThreadId | null;
}

/**
 * The last place each thread resolved to. Settled and older threads are not always in the
 * client's thread list: they load into it lazily and can be paged out again while the thread is
 * still open (the chat keeps its own copy). Without this, every side-panel surface — terminal,
 * browser, files, diff, pull requests — flipped to its "start a thread" empty state whenever the
 * open thread dropped out of that list, and came back only when it was reloaded.
 */
const lastTargetByThreadId = new Map<string, ActiveProjectTarget>();
const scopedTargets = new Map<string, ActiveProjectTarget>();

function targetKey(threadId: ThreadId, environmentId: EnvironmentId | null) {
  return JSON.stringify([environmentId, threadId]);
}

export function rememberThreadTarget(target: ActiveProjectTarget | null): void {
  if (target?.threadId) {
    lastTargetByThreadId.set(target.threadId, target);
    scopedTargets.set(targetKey(target.threadId, target.environmentId), target);
  }
}

export function rememberedThreadTarget(
  threadId: ThreadId,
  environmentId?: EnvironmentId | null,
): ActiveProjectTarget | null {
  return (
    (environmentId === undefined
      ? lastTargetByThreadId.get(threadId)
      : scopedTargets.get(targetKey(threadId, environmentId))) ?? null
  );
}

export function useActiveProjectTarget(
  requestedThreadId?: ThreadId | null,
  requestedEnvironmentId?: EnvironmentId | null,
): ActiveProjectTarget | null {
  const { activeThread, routeThreadId } = useHandleNewThread();
  const draftThread = useDraftThread(requestedThreadId ?? routeThreadId, requestedEnvironmentId);
  const projects = useAtomValue(projectsAtom);
  const threads = useAtomValue(threadsAtom);
  const activeProjectId = useWorkspaceActiveProjectId();

  const matchesEnvironment = (environmentId: EnvironmentId | undefined) =>
    requestedEnvironmentId === undefined || (environmentId ?? null) === requestedEnvironmentId;
  const thread = requestedThreadId
    ? (threads.find(
        (candidate) =>
          candidate.id === requestedThreadId && matchesEnvironment(candidate.environmentId),
      ) ?? draftThread)
    : (activeThread ?? draftThread);
  const threadId = requestedThreadId ?? activeThread?.id ?? (draftThread ? routeThreadId : null);
  if (requestedThreadId && !thread) {
    // The thread is open but not in the list right now: keep using where it last lived, or the
    // project the workspace has open, rather than telling the user to start a thread.
    const remembered = rememberedThreadTarget(requestedThreadId, requestedEnvironmentId);
    if (remembered) return remembered;
    const activeProject = activeProjectId
      ? projects.find(
          (candidate) =>
            candidate.id === activeProjectId && matchesEnvironment(candidate.environmentId),
        )
      : null;
    if (!activeProject?.cwd) return null;
    return {
      environmentId: activeProject.environmentId ?? null,
      projectId: activeProject.id,
      cwd: activeProject.cwd,
      projectCwd: activeProject.cwd,
      projectName: activeProject.name,
      threadId: requestedThreadId,
    };
  }

  const project = thread
    ? projects.find(
        (candidate) =>
          candidate.id === thread.projectId && matchesEnvironment(candidate.environmentId),
      )
    : activeProjectId
      ? projects.find(
          (candidate) =>
            candidate.id === activeProjectId && matchesEnvironment(candidate.environmentId),
        )
      : null;

  if (!project) return null;

  const cwd = thread?.worktreePath ?? project.cwd;
  if (!cwd) return null;

  const target: ActiveProjectTarget = {
    environmentId: project.environmentId ?? null,
    projectId: project.id,
    cwd,
    projectCwd: project.cwd,
    projectName: project.name,
    threadId,
  };
  rememberThreadTarget(target);
  return target;
}

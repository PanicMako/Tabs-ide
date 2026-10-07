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
  readonly projectName: string;
  readonly threadId?: ThreadId | null;
}

export function useActiveProjectTarget(
  requestedThreadId?: ThreadId | null,
): ActiveProjectTarget | null {
  const { activeThread, routeThreadId } = useHandleNewThread();
  const draftThread = useDraftThread(requestedThreadId ?? routeThreadId);
  const projects = useAtomValue(projectsAtom);
  const threads = useAtomValue(threadsAtom);
  const activeProjectId = useWorkspaceActiveProjectId();

  const thread = requestedThreadId
    ? (threads.find((candidate) => candidate.id === requestedThreadId) ?? draftThread)
    : (activeThread ?? draftThread);
  const threadId = requestedThreadId ?? activeThread?.id ?? (draftThread ? routeThreadId : null);
  if (requestedThreadId && !thread) return null;

  const project = thread
    ? projects.find((candidate) => candidate.id === thread.projectId)
    : activeProjectId
      ? projects.find((candidate) => candidate.id === activeProjectId)
      : null;

  if (!project) return null;

  const cwd = thread?.worktreePath ?? project.cwd;
  if (!cwd) return null;

  return {
    environmentId: project.environmentId ?? null,
    projectId: project.id,
    cwd,
    projectName: project.name,
    threadId,
  };
}

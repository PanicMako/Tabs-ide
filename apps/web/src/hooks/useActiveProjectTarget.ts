import type { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { projectsAtom, threadsAtom } from "../state/threads";
import { useWorkspaceActiveProjectId } from "../state/workspaceShell";
import { useHandleNewThread } from "./useHandleNewThread";

export interface ActiveProjectTarget {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly projectName: string;
  readonly threadId?: ThreadId | null;
}

export function useActiveProjectTarget(): ActiveProjectTarget | null {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const projects = useAtomValue(projectsAtom);
  const activeProjectId = useWorkspaceActiveProjectId();

  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? null;

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

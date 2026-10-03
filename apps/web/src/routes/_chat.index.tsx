import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { DiagnosticsSettings } from "../components/settings/DiagnosticsSettings";
import { Button } from "../components/ui/button";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { isPopoutMode } from "../lib/utils";
import { projectsAtom, threadsAtom } from "../state/threads";
import { useWorkspaceActiveProjectId, useRememberedThreadId } from "../state/workspaceShell";
import { composerDraftActions, createScopedComposerDraftActions } from "../state/composerDrafts";
import { useAtomValue } from "@effect/atom-react";

function ChatIndexRouteView() {
  if (isPopoutMode()) {
    return (
      <div className="isolate flex h-screen min-h-0 min-w-0 flex-col overflow-y-auto overscroll-y-none bg-background text-foreground">
        <DiagnosticsSettings />
      </div>
    );
  }

  const activeProjectId = useWorkspaceActiveProjectId();
  const rememberedThreadId = useRememberedThreadId(activeProjectId);
  const projects = useAtomValue(projectsAtom);
  const threads = useAtomValue(threadsAtom);
  const settings = useSettings();
  const { handleNewThread } = useHandleNewThread();
  const navigate = useNavigate();
  const location = useLocation();

  const activeProject = activeProjectId
    ? (projects.find((project) => project.id === activeProjectId) ?? null)
    : null;
  const draftActions = activeProject?.environmentId
    ? createScopedComposerDraftActions(activeProject.environmentId)
    : composerDraftActions;
  const projectThreads = activeProject
    ? threads.filter(
        (thread) =>
          thread.projectId === activeProject.id &&
          thread.environmentId === activeProject.environmentId,
      )
    : [];

  const rememberedDraft = rememberedThreadId
    ? draftActions.getDraftThread(rememberedThreadId)
    : null;
  const isRememberedDraft = Boolean(rememberedDraft);
  const isRememberedSaved = Boolean(
    rememberedThreadId && projectThreads.some((t) => t.id === rememberedThreadId),
  );

  const projectDraft = activeProjectId
    ? draftActions.getDraftThreadByProjectId(activeProjectId)
    : null;

  const targetThreadId =
    isRememberedDraft || isRememberedSaved
      ? rememberedThreadId
      : (projectDraft?.threadId ?? projectThreads[0]?.id ?? null);

  useEffect(() => {
    if (location.pathname === "/" && activeProject?.environmentId && targetThreadId) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: activeProject.environmentId, threadId: targetThreadId },
        replace: true,
      });
    }
  }, [location.pathname, activeProject, targetThreadId, navigate]);

  if (activeProject && projectThreads.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10">
        <div className="max-w-3xl text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground/90 sm:text-4xl">
            {`What should we build in ${activeProject.name}?`}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground/60 sm:text-base">
            This project does not have any agent threads yet. Create the first thread when you are
            ready to start working with the project context and workspace tools.
          </p>
          <div className="mt-7 flex justify-center">
            <Button
              size="lg"
              className="rounded-full px-5"
              onClick={() =>
                void handleNewThread(activeProject.id, {
                  environmentId: activeProject.environmentId,
                  envMode: settings.defaultThreadEnvMode,
                })
              }
            >
              Create first thread
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-foreground/70">No agent thread selected</p>
        <p className="mt-2 text-sm text-muted-foreground/50">
          Pick a thread from the current project or create a new one from the Agents panel.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

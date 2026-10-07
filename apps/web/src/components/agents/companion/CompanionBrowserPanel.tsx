import { useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@tabs/contracts";
import { lazy, memo, Suspense } from "react";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { projectsAtom } from "~/state/threads";

const NativeBrowser = lazy(() =>
  import("~/components/WorkspaceShell").then((module) => ({
    default: module.DesktopCustomEmbedTool,
  })),
);

export const CompanionBrowserPanel = memo(function CompanionBrowserPanel({
  threadId,
}: {
  threadId?: ThreadId | null | undefined;
}) {
  const target = useActiveProjectTarget(threadId);
  const projects = useAtomValue(projectsAtom);
  const project = projects.find((candidate) => candidate.id === target?.projectId);
  if (!project || !target)
    return <div className="p-6 text-sm text-muted-foreground">Open a project to browse.</div>;
  return (
    <Suspense
      fallback={
        <div role="status" className="p-6 text-sm text-muted-foreground">
          Starting browser...
        </div>
      }
    >
      <NativeBrowser
        key={`${target.environmentId}:${target.projectId}:${target.threadId}`}
        companion
        project={{ ...project, cwd: target.cwd }}
        title="Browser"
        url="https://www.google.com"
        sessionId={`agents-${target.environmentId ?? "local"}-${target.threadId ?? "project"}`}
        resumeLastVisitedPage
      />
    </Suspense>
  );
});

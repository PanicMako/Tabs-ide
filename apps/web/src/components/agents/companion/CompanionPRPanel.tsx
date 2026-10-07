import { useQuery } from "@tanstack/react-query";
import { GitPullRequest } from "lucide-react";
import { memo } from "react";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { PRsPanel } from "~/components/git/PRsPanel";
import { GitApiProvider, gitWorkspaceScopeKey } from "~/components/git/gitApiContext";

export const CompanionPRPanel = memo(function CompanionPRPanel() {
  const target = useActiveProjectTarget();

  const apiQuery = useQuery({
    queryKey: ["companion-git-api", target?.environmentId ?? null],
    queryFn: async () => {
      return environmentApi(target?.environmentId ?? null);
    },
    enabled: Boolean(target?.cwd),
  });

  if (!target || !target.cwd) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-muted-foreground">
        <GitPullRequest className="mb-2 size-8 opacity-40" />
        <p className="text-xs font-medium">No active repository</p>
        <p className="text-[11px] text-muted-foreground/80 mt-1">
          Open a thread or project with a git repository to view Pull Requests.
        </p>
      </div>
    );
  }

  const api = apiQuery.data ?? null;
  const scopeKey = gitWorkspaceScopeKey(target.environmentId ?? undefined, target.cwd);

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <GitApiProvider api={api} scopeKey={scopeKey}>
        <PRsPanel
          cwd={target.cwd}
          environmentId={target.environmentId ?? undefined}
          branchName=""
          onOpenCreatePR={() => {}}
        />
      </GitApiProvider>
    </div>
  );
});

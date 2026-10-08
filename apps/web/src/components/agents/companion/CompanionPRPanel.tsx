import "~/components/git/GitToolV2.css";
import type { ThreadId } from "@tabs/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CompanionHeading, CompanionEmpty } from "./CompanionChrome";
import { memo, useState } from "react";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { PRsPanel } from "~/components/git/PRsPanel";
import { GitApiProvider, gitWorkspaceScopeKey } from "~/components/git/gitApiContext";

import { toastManager } from "~/components/ui/toast";
import { CreatePRModal } from "~/components/git/gitModals";
import {
  gitStatusQueryOptions,
  gitBranchesQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "~/lib/gitErrorMessages";

export const CompanionPRPanel = memo(function CompanionPRPanel({
  threadId,
}: {
  threadId?: ThreadId | null | undefined;
}) {
  const target = useActiveProjectTarget(threadId);
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const status = useQuery(
    gitStatusQueryOptions(target?.cwd ?? null, target?.environmentId ?? undefined),
  );
  const branches = useQuery(
    gitBranchesQueryOptions(target?.cwd ?? null, target?.environmentId ?? undefined),
  );

  const apiQuery = useQuery({
    queryKey: ["companion-git-api", target?.environmentId ?? null],
    queryFn: async () => {
      return environmentApi(target?.environmentId ?? null);
    },
    enabled: Boolean(target?.cwd),
  });

  if (!target || !target.cwd) {
    return (
      <CompanionEmpty kind="pr" title="Pick a repository">
        Open a project to browse and create pull requests.
      </CompanionEmpty>
    );
  }

  if (apiQuery.isPending || status.isPending)
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        Loading repository...
      </div>
    );
  const error = apiQuery.error ?? status.error;
  if (error)
    return (
      <div role="alert" className="p-6 text-sm">
        <p>{toGitUserFacingErrorMessage(error)}</p>
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => {
            void apiQuery.refetch();
            void status.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  const api = apiQuery.data ?? null;
  const branchName = status.data?.branch ?? "Detached HEAD";
  const scopeKey = gitWorkspaceScopeKey(target.environmentId ?? undefined, target.cwd);

  return (
    <div className="companion-workspace">
      <CompanionHeading kind="pr" detail={branchName} />
      <div className="git-tool-v2 flex min-h-0 flex-1 flex-col overflow-auto">
        <GitApiProvider api={api} scopeKey={scopeKey}>
          <PRsPanel
            cwd={target.cwd}
            environmentId={target.environmentId ?? undefined}
            branchName={branchName}
            onOpenCreatePR={() => {
              setCreating(true);
            }}
          />
          {creating && (
            <>
              <CreatePRModal
                currentBranch={branchName}
                branches={branches.data?.branches ?? []}
                lastSubject=""
                onClose={() => setCreating(false)}
                onCreate={async (pr) => {
                  if (!api) return;
                  try {
                    await api.git.createPullRequest({
                      cwd: target.cwd,
                      title: pr.title,
                      body: pr.body,
                      headBranch: pr.head,
                      baseBranch: pr.base,
                      draft: pr.draft,
                    });
                    await invalidateGitQueries(queryClient);
                    setCreating(false);
                  } catch (error) {
                    toastManager.add({
                      type: "error",
                      title: "Pull request creation failed",
                      description: toGitUserFacingErrorMessage(error),
                    });
                  }
                }}
              />
            </>
          )}
        </GitApiProvider>
      </div>
    </div>
  );
});

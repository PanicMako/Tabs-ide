import type { GitBranch } from "@tabs/contracts";
import { environmentApi } from "../connection/environmentApiRegistry";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
} from "./BranchToolbar.logic";

/** Shared checkout behavior for the composer and workspace card, including linked worktrees. */
export async function selectWorkspaceBranch(input: {
  branch: GitBranch;
  projectCwd: string;
  activeWorktreePath: string | null;
  environmentId?: string | undefined;
  prepare: () => Promise<boolean>;
  setThreadBranch: (branch: string | null, worktreePath: string | null) => Promise<boolean>;
}): Promise<string | null> {
  if (!(await input.prepare())) return null;
  const target = resolveBranchSelectionTarget({
    activeProjectCwd: input.projectCwd,
    activeWorktreePath: input.activeWorktreePath,
    branch: input.branch,
  });
  let name = input.branch.isRemote
    ? deriveLocalBranchNameFromRemoteRef(input.branch.name, input.branch.remoteName)
    : input.branch.name;
  if (!target.reuseExistingWorktree) {
    const api = await environmentApi(input.environmentId);
    await api.git.checkout({ cwd: target.checkoutCwd, branch: input.branch.name });
    if (input.branch.isRemote) {
      const status = await api.git.status({ cwd: target.checkoutCwd }).catch(() => null);
      if (status?.branch) name = status.branch;
    }
  }
  return (await input.setThreadBranch(name, target.nextWorktreePath)) ? name : null;
}

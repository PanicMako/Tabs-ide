import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  GithubIcon,
  LogOutIcon,
  UserPlusIcon,
} from "lucide-react";

import {
  gitEnvironmentQueryOptions,
  gitHubLogoutMutationOptions,
  gitHubSwitchAccountMutationOptions,
} from "../../lib/gitReactQuery";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

const GH_INSTALL_URL = "https://cli.github.com/";

/**
 * GitHub account control rendered at the top of the Git workspace. Shows the
 * active `gh` account, lets the user switch between signed-in accounts, sign in
 * (via the terminal), or sign out — and guides installation when `gh` is
 * missing.
 */
export function GitAccountMenu(props: {
  cwd: string;
  /** Opens the terminal and runs `gh auth login`. */
  onSignIn: () => void | Promise<void>;
}) {
  const { cwd, onSignIn } = props;
  const queryClient = useQueryClient();
  const environmentQuery = useQuery(gitEnvironmentQueryOptions(cwd));
  const switchMutation = useMutation(gitHubSwitchAccountMutationOptions({ cwd, queryClient }));
  const logoutMutation = useMutation(gitHubLogoutMutationOptions({ cwd, queryClient }));

  const gitHub = environmentQuery.data?.gitHub ?? null;
  const busy = switchMutation.isPending || logoutMutation.isPending;
  const accounts = gitHub?.accounts ?? [];
  const activeLogin = gitHub?.activeLogin ?? null;

  const handleSwitch = (account: { host: string; login: string }) => {
    if (account.login === activeLogin) return;
    switchMutation.mutate(account, {
      onSuccess: () => toastManager.add({ type: "success", title: `Switched to ${account.login}` }),
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Could not switch account",
          description: error instanceof Error ? error.message : "GitHub CLI command failed.",
        }),
    });
  };

  const handleLogout = (account: { host: string; login: string }) => {
    logoutMutation.mutate(account, {
      onSuccess: () => toastManager.add({ type: "success", title: `Signed ${account.login} out` }),
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: "Could not sign out",
          description: error instanceof Error ? error.message : "GitHub CLI command failed.",
        }),
    });
  };

  // gh not installed → guide to install.
  if (environmentQuery.data && gitHub && !gitHub.cliInstalled) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full gap-1.5"
        onClick={() => window.open(GH_INSTALL_URL, "_blank", "noopener,noreferrer")}
      >
        <DownloadIcon className="size-3.5" />
        Install GitHub CLI
      </Button>
    );
  }

  const triggerLabel = activeLogin ?? (accounts.length > 0 ? accounts[0]?.login : null);

  return (
    <Menu highlightItemOnHover={false}>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full gap-1.5 max-w-[220px]"
            disabled={!environmentQuery.data}
          />
        }
      >
        {busy ? <Spinner className="size-3.5" /> : <GithubIcon className="size-3.5 shrink-0" />}
        <span className="truncate">
          {triggerLabel ?? (environmentQuery.isLoading ? "Checking…" : "Sign in")}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-[260px]">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          GitHub accounts
        </div>
        {accounts.length === 0 ? (
          <div className="px-3 pb-2 text-sm text-muted-foreground">
            {gitHub?.cliInstalled ? "No accounts signed in yet." : "GitHub CLI is not available."}
          </div>
        ) : (
          accounts.map((account) => {
            const isActive = account.login === activeLogin;
            return (
              <MenuItem
                key={`${account.host}:${account.login}`}
                className="flex items-center gap-2"
                onClick={() => handleSwitch(account)}
                disabled={busy}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center shrink-0",
                    isActive ? "text-foreground" : "text-transparent",
                  )}
                >
                  <CheckIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {account.login}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {account.host}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Sign ${account.login} out`}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleLogout(account);
                  }}
                >
                  <LogOutIcon className="size-3.5" />
                </button>
              </MenuItem>
            );
          })
        )}
        <MenuSeparator />
        <MenuItem
          className="flex items-center gap-2"
          onClick={() => void onSignIn()}
          disabled={!gitHub?.cliInstalled}
        >
          <UserPlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm">
            {accounts.length > 0 ? "Add another account" : "Sign in with GitHub"}
          </span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

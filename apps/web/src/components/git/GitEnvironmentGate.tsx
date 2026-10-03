import type { ReactNode } from "react";
import { DownloadIcon, FolderGitIcon, GitBranchIcon, TerminalIcon } from "lucide-react";

import type { GitEnvironmentResult } from "@tabs/contracts";
import { isWindowsPlatform } from "../../lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { GitCheckingState } from "./GitCheckingState";

const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";

function installCommand(): { label: string; command: string } {
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  if (isWindowsPlatform(platform)) {
    return { label: "Windows (winget)", command: "winget install --id Git.Git -e" };
  }
  if (/Mac/i.test(platform)) {
    return { label: "macOS (Homebrew)", command: "brew install git" };
  }
  return { label: "Debian / Ubuntu", command: "sudo apt-get install git" };
}

function GateShell(props: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg rounded-3xl border border-border/40 bg-background/60 p-8 text-center shadow-sm backdrop-blur-xl">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-foreground">
          {props.icon}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{props.title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{props.description}</p>
        {props.children ? <div className="mt-6">{props.children}</div> : null}
      </div>
    </div>
  );
}

/**
 * Gates the Git workspace behind friendly setup states: a calm loading state, a
 * "Git isn't installed" guide, and a "not a repository yet" call-to-action.
 * Renders `children` once the environment is ready and the folder is a repo.
 */
export function GitEnvironmentGate(props: {
  environment: GitEnvironmentResult | undefined;
  isRepo: boolean | undefined;
  isLoading: boolean;
  initPending: boolean;
  onInitRepo: () => void;
  children: ReactNode;
}) {
  const { environment, isRepo, isLoading, initPending, onInitRepo, children } = props;

  const isDataReady = !isLoading && environment !== undefined && isRepo !== undefined;

  // Git missing is a definitive, blocking state.
  if (environment && !environment.git.installed) {
    const install = installCommand();
    return (
      <GateShell
        icon={<DownloadIcon className="size-7" />}
        title="Git isn't installed"
        description="The version-control tools need Git on your system. Install it, then reopen this tab."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {install.label}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-background/70 px-2.5 py-1.5 font-mono text-sm text-foreground">
                {install.command}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(install.command)}
              >
                Copy
              </Button>
            </div>
          </div>
          <Button
            type="button"
            className="w-full rounded-full"
            onClick={() => window.open(GIT_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
          >
            <DownloadIcon className="size-4" />
            Download Git
          </Button>
        </div>
      </GateShell>
    );
  }

  // Block only while core data is resolving, unless the user explicitly opted
  // into displaying the complete loading animation.
  if (!isDataReady) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center p-12 text-center">
        <GitCheckingState rotateMessages size={56} />
      </div>
    );
  }

  if (isRepo === false) {
    return (
      <GateShell
        icon={<FolderGitIcon className="size-7" />}
        title="Not a Git repository yet"
        description="This folder isn't tracked by Git. Initialize it to start committing, branching, and syncing."
      >
        <div className="space-y-3">
          <Button
            type="button"
            className="w-full rounded-full"
            disabled={initPending}
            onClick={onInitRepo}
          >
            {initPending ? <Spinner className="size-4" /> : <GitBranchIcon className="size-4" />}
            Initialize repository
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <TerminalIcon className="size-3.5" />
            Already have a remote? Clone it from the projects menu.
          </p>
        </div>
      </GateShell>
    );
  }

  return <>{children}</>;
}

import type { GitHubAccount } from "@tabs/contracts";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitBranch as GitBranchIcon,
  Terminal,
  UserPlus,
  Users,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";

import { keybindingsAtom } from "../../state/settings";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { GitHubIcon } from "../Icons";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface TopBarProps {
  repoName: string;
  branchLabel: string;
  accentDotTone: "ok" | "warn" | "bad" | "info";
  accounts: ReadonlyArray<GitHubAccount>;
  activeAccountLogin: string | null;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onSwitchAccount: (login: string) => void;
  onOpenAccounts: () => void;
  onOpenSignIn: () => void;
}

const STATUS_CONFIG: Record<
  "ok" | "warn" | "bad" | "info",
  {
    label: string;
    dotClass: string;
    badgeClass: string;
    Icon: typeof CheckCircle2;
  }
> = {
  ok: {
    label: "In sync with remote",
    dotClass: "bg-emerald-500 shadow-emerald-500/50",
    badgeClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/25",
    Icon: CheckCircle2,
  },
  warn: {
    label: "Commits behind remote",
    dotClass: "bg-amber-500 shadow-amber-500/50",
    badgeClass: "text-amber-500 bg-amber-500/10 border-amber-500/25",
    Icon: AlertCircle,
  },
  bad: {
    label: "Merge conflict detected",
    dotClass: "bg-rose-500 shadow-rose-500/50",
    badgeClass: "text-rose-500 bg-rose-500/10 border-rose-500/25",
    Icon: AlertCircle,
  },
  info: {
    label: "Remote configured",
    dotClass: "bg-sky-500 shadow-sky-500/50",
    badgeClass: "text-sky-500 bg-sky-500/10 border-sky-500/25",
    Icon: CheckCircle2,
  },
};

function AccountAvatar({
  login,
  size = "md",
  className,
}: {
  login: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    setHasError(false);
  }, [login]);

  const sizeClass = {
    sm: "size-4.5 text-[9px]",
    md: "size-5 text-[10px]",
    lg: "size-9 text-xs",
  }[size];

  if (login && !hasError) {
    return (
      <img
        src={`https://github.com/${login}.png?size=${size === "lg" ? 80 : 48}`}
        alt={login}
        onError={() => setHasError(true)}
        className={cn(
          "rounded-full object-cover shrink-0 ring-1 ring-border/70",
          sizeClass,
          className,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-indigo-500/20 via-primary/25 to-sky-500/20 border border-border/80 flex items-center justify-center font-mono font-bold text-foreground shrink-0 select-none",
        sizeClass,
        className,
      )}
    >
      {login ? login[0]?.toUpperCase() : <GitHubIcon className="size-3 text-muted-foreground" />}
    </div>
  );
}

export function TopBar({
  repoName,
  branchLabel,
  accentDotTone,
  accounts,
  activeAccountLogin,
  terminalOpen,
  onToggleTerminal,
  onSwitchAccount,
  onOpenAccounts,
  onOpenSignIn,
}: TopBarProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const keybindings = useAtomValue(keybindingsAtom);

  const terminalShortcut = useMemo(() => {
    return shortcutLabelForCommand(keybindings, "terminal.toggle") ?? "⌃`";
  }, [keybindings]);

  const statusInfo = STATUS_CONFIG[accentDotTone] ?? STATUS_CONFIG.info;
  const StatusIcon = statusInfo.Icon;

  return (
    <div
      className="flex items-center gap-3 px-5 py-2.5 border-b border-border/50 shrink-0 select-none"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Left: Repository & Branch indicator */}
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/70 min-w-0">
        <FolderGit2 size={13} className="text-muted-foreground/70 shrink-0" />
        <span className="text-foreground/90 font-semibold truncate">{repoName}</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-border/80 bg-muted/40 text-foreground shrink-0 font-medium">
          <GitBranchIcon size={11} className="text-muted-foreground/80" />
          <span className="git-branch-label truncate" title={branchLabel}>
            {branchLabel}
          </span>
        </span>
      </div>

      <div className="flex-1" />

      {/* Right: Paired IDE control tools */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Tool 1: GitHub Account Capsule */}
        <Popover open={accountOpen} onOpenChange={setAccountOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={
                  activeAccountLogin
                    ? `GitHub account @${activeAccountLogin} (${statusInfo.label})`
                    : "GitHub account sign in"
                }
                className={cn(
                  "group relative flex items-center gap-2 h-8 pl-1.5 pr-2.5 rounded-full text-xs font-mono font-medium border transition-all duration-150 select-none cursor-pointer shadow-2xs backdrop-blur-sm",
                  accountOpen
                    ? "border-primary/50 bg-accent/60 text-foreground ring-1 ring-primary/25"
                    : "border-border/70 bg-background/80 hover:bg-muted/70 hover:border-border text-foreground/90",
                )}
              />
            }
          >
            <div className="relative shrink-0 flex items-center justify-center">
              <AccountAvatar login={activeAccountLogin} size="md" />
              {activeAccountLogin && (
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background shrink-0 shadow-xs transition-colors",
                    statusInfo.dotClass,
                  )}
                />
              )}
            </div>
            <span className="text-xs font-mono font-medium text-foreground/90 tracking-tight max-w-[130px] truncate">
              {activeAccountLogin || "Sign in"}
            </span>
            <ChevronDown
              className={cn(
                "size-3 text-muted-foreground/70 group-hover:text-foreground transition-transform duration-200 shrink-0",
                accountOpen && "rotate-180 text-foreground",
              )}
            />
          </PopoverTrigger>

          <PopoverPopup
            align="end"
            side="bottom"
            sideOffset={6}
            className="w-80 p-0 rounded-xl border border-border/80 bg-background/95 backdrop-blur-md shadow-2xl overflow-hidden z-50 text-foreground"
          >
            {activeAccountLogin ? (
              <div className="p-3.5 border-b border-border/60 bg-muted/20">
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <AccountAvatar login={activeAccountLogin} size="lg" />
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background shrink-0 shadow-xs",
                        statusInfo.dotClass,
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-foreground truncate">
                        @{activeAccountLogin}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded-full border border-border/60 bg-background/60 font-mono text-muted-foreground/80 shrink-0">
                        <GitHubIcon className="size-2.5" />
                        github.com
                      </span>
                    </div>
                    <div className="mt-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium",
                          statusInfo.badgeClass,
                        )}
                      >
                        <StatusIcon className="size-2.5" />
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-center border-b border-border/60 bg-muted/10">
                <div className="size-10 rounded-full bg-muted/60 border border-border/80 flex items-center justify-center mx-auto mb-2 text-muted-foreground">
                  <GitHubIcon className="size-5" />
                </div>
                <div className="text-xs font-semibold text-foreground mb-1">GitHub Account</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                  Connect your GitHub account to push, pull, create PRs, and review changes.
                </div>
                <Button
                  size="sm"
                  className="w-full justify-center gap-2"
                  onClick={() => {
                    onOpenSignIn();
                    setAccountOpen(false);
                  }}
                >
                  <GitHubIcon className="size-3.5" />
                  Sign in to GitHub
                </Button>
              </div>
            )}

            {/* Account Switcher if multiple accounts */}
            {accounts.length > 1 && (
              <div className="py-1.5 border-b border-border/50">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold font-mono">
                  Switch account
                </div>
                <div className="px-1.5 space-y-0.5">
                  {accounts.map((a) => {
                    const isCurrent = a.login === activeAccountLogin;
                    return (
                      <button
                        key={`${a.host}:${a.login}`}
                        type="button"
                        onClick={() => {
                          onSwitchAccount(a.login);
                          setAccountOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer",
                          isCurrent
                            ? "bg-accent/60 text-foreground"
                            : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <AccountAvatar login={a.login} size="sm" />
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-mono font-medium truncate">
                            @{a.login}
                          </span>
                          <span className="block text-[10px] text-muted-foreground/60 truncate">
                            {a.host}
                          </span>
                        </div>
                        {isCurrent && <Check className="size-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="p-1.5 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  onOpenAccounts();
                  setAccountOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              >
                <Users className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1">Manage accounts</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenSignIn();
                  setAccountOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              >
                <UserPlus className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1">Add another account</span>
              </button>
              {activeAccountLogin && (
                <a
                  href={`https://github.com/${activeAccountLogin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setAccountOpen(false)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                >
                  <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1">View profile on GitHub</span>
                </a>
              )}
            </div>
          </PopoverPopup>
        </Popover>

        {/* Tool 2: Quick Terminal Capsule */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onToggleTerminal}
                aria-label={terminalOpen ? "Close Git terminal drawer" : "Open Git terminal drawer"}
                aria-pressed={terminalOpen}
                className={cn(
                  "group relative flex items-center gap-2 h-8 px-2.5 rounded-full text-xs font-mono font-medium border transition-all duration-150 select-none cursor-pointer shadow-2xs backdrop-blur-sm",
                  terminalOpen
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 dark:text-emerald-300 ring-1 ring-emerald-500/25 hover:bg-emerald-500/15 hover:border-emerald-500/50"
                    : "border-border/70 bg-background/80 hover:bg-muted/70 hover:border-border text-muted-foreground hover:text-foreground",
                )}
              />
            }
          >
            <span className="flex items-center gap-1.5">
              {terminalOpen ? (
                <span className="relative flex size-2 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
              ) : (
                <Terminal className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
              )}
              <span
                className={cn(
                  "text-xs tracking-tight transition-colors",
                  terminalOpen
                    ? "font-semibold text-emerald-400 dark:text-emerald-300"
                    : "font-medium text-foreground/90",
                )}
              >
                Terminal
              </span>
            </span>

            {terminalOpen ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 dark:text-emerald-200 font-sans font-semibold uppercase tracking-wider border border-emerald-500/30">
                Active
              </span>
            ) : (
              <Kbd className="h-4.5 px-1.5 text-[10px] font-mono border-border/60 bg-muted/60 text-muted-foreground/80 group-hover:border-border group-hover:text-foreground">
                {terminalShortcut}
              </Kbd>
            )}
          </TooltipTrigger>
          <TooltipPopup side="bottom" sideOffset={6}>
            {terminalOpen
              ? `Close Git terminal drawer (${terminalShortcut})`
              : `Open Git terminal drawer (${terminalShortcut})`}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

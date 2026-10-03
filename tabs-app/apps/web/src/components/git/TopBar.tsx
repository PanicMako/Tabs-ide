import type { GitHubAccount } from "@tabs/contracts";
import { Check, FolderGit2, GitBranch as GitBranchIcon, Terminal, Users } from "lucide-react";
import { useState } from "react";

import { Dropdown, TONE } from "./gitPrimitives";
import { Button } from "../ui/button";

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
}: {
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
}) {
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div
      className="flex items-center gap-3 px-5 py-2.5 border-b border-border/50 shrink-0"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/70 min-w-0">
        <FolderGit2 size={13} className="text-muted-foreground/70 shrink-0" />
        <span className="text-foreground/90 truncate">{repoName}</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/50 text-foreground shrink-0 font-medium">
          <GitBranchIcon size={11} />
          {branchLabel}
        </span>
      </div>

      <div className="flex-1" />

      {/* Account button */}
      <Dropdown
        open={accountOpen}
        setOpen={setAccountOpen}
        align="right"
        width="w-72"
        trigger={(toggle) => (
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-2 h-7 pl-1.5 pr-2.5 rounded-full bg-muted/50 hover:bg-muted border border-border transition-all cursor-pointer"
          >
            <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-mono font-semibold text-foreground/90">
              {activeAccountLogin ? activeAccountLogin[0]?.toUpperCase() : "–"}
            </span>
            <span className="text-xs font-mono text-foreground/90">
              {activeAccountLogin || "signed out"}
            </span>
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: TONE[accentDotTone].dot }}
            />
          </button>
        )}
      >
        {activeAccountLogin ? (
          <>
            <div className="px-3 pt-3 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-mono">
              Switch account
            </div>
            <div className="pb-1">
              {accounts.map((a) => (
                <button
                  key={a.login}
                  type="button"
                  onClick={() => {
                    onSwitchAccount(a.login);
                    setAccountOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <span className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] font-mono font-semibold text-foreground/90 shrink-0">
                    {a.login[0]?.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-foreground/90 flex-1 truncate">
                    {a.login}
                  </span>
                  {a.login === activeAccountLogin && (
                    <Check size={12} className="text-muted-foreground/70 shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <div className="h-px bg-border/50" />
            <button
              type="button"
              onClick={() => {
                onOpenAccounts();
                setAccountOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <Users size={12} /> Manage accounts
            </button>
          </>
        ) : (
          <div className="p-3">
            <div className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">
              No GitHub account is signed in. Sign in to push, pull, or open pull requests.
            </div>
            <Button
              size="sm"
              className="w-full justify-center"
              onClick={() => {
                onOpenSignIn();
                setAccountOpen(false);
              }}
            >
              Sign in to GitHub
            </Button>
          </div>
        )}
      </Dropdown>

      {/* Quick Terminal toggle button */}
      <button
        type="button"
        onClick={onToggleTerminal}
        title={terminalOpen ? "Hide terminal" : "Open terminal"}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
          terminalOpen
            ? "bg-accent border border-border text-foreground"
            : "bg-muted/50 hover:bg-muted border border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Terminal size={12} />
        <span>Terminal</span>
      </button>
    </div>
  );
}

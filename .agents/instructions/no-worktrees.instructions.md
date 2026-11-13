# No git worktrees: use a branch in the main checkout

Git worktrees duplicate the whole repository, including `node_modules`, Code-OSS build output and packaged apps. One sync worktree is 12-16 GB, and they pile up until the disk is full. Do not create them.

## Rules

1. **Never run `git worktree add`** (or start a session in a new worktree) unless the user explicitly asks for a worktree in that message.
2. **Work on a branch in the main checkout instead:** `git switch -c <type>/<name>` from the latest `origin/main`. Large tasks such as a VS Code sync (`chore/sync-vscode-<version>`) are no exception.
3. **If the checkout has uncommitted work**, do not stash broadly or reset. Commit only your own paths (`git commit -m ... -- <paths>`), and for a path that overlaps the user's edit, stash just that path under a unique name, apply it after the change, then drop it. Never discard the user's uncommitted work.
4. **Release and merge flow:** push the branch, run any required CI on it, merge it fast-forward into `main`, pull `main` into the main checkout, then delete the local and remote branch.
5. **Clean up after yourself:** before finishing, `git worktree list` must show only the main checkout (plus worktrees owned by other apps such as Codex or Tabs sessions, which you leave alone). If you ever created one because the user asked, remove it with `git worktree remove` once its branch is pushed, after confirming it has no unpushed or uncommitted work, and say how much space that freed.
6. **Keep generated output small:** delete throwaway builds (`release/`, copied checkouts, scratch clones) when a task is done, and tell the user what you removed.

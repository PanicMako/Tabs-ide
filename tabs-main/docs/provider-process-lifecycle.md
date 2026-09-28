# Local provider process lifecycle

Tabs starts a local OpenCode or Kilo `serve` process in its own process group. A CLI launcher may start a native worker in that group. Normal scope shutdown terminates the whole group, and an independent watchdog now terminates it if the Tabs backend dies before finalizers run.

## September 2026 Kilo incident

On macOS, 88 orphaned Kilo server groups were found from a Tabs development worktree. Their launchers had parent PID 1 and their native workers consumed about 4.7 GiB of resident memory. The machine had 18 GiB RAM and was swapping heavily. The groups were stopped after verifying their command lines, parent PIDs, process groups, and working directories.

The observed orphaned parents are consistent with a backend exit that did not complete provider cleanup. Detached provider groups can survive the death of their parent. Development startup cleanup also previously acted on individual PIDs, which could leave a native worker behind, and it only searched the current worktree. The precise trigger of each backend exit was not captured.

## Safeguards

- The provider runtime starts a small detached watchdog for each local server. It checks the backend owner and provider group every two seconds. If the owner disappears, it terminates the group.
- Development startup cleanup kills complete provider groups. It recognizes orphaned local provider servers from registered worktrees of this repository while protecting current process descendants.
- Normal Effect scope cleanup remains the primary shutdown path.

## If memory pressure returns

Check Activity Monitor's Memory tab and identify the full executable path and parent process of any repeated `.kilo` or `.opencode` entries. From a terminal, `ps -axo pid,ppid,pgid,rss,command | rg 'kilo serve|opencode serve'` shows the process relationships. A local server with parent PID 1 is a candidate orphan; confirm its working directory with `lsof -a -p PID -d cwd -Fn` before stopping it. Do not kill unrelated Kilo or OpenCode sessions.

After a crash, starting the Tabs development runner from this repository invokes orphan cleanup for registered Tabs worktrees. The watchdog applies to newly started provider servers after the updated backend is rebuilt and launched. Existing installed builds and older worktrees do not gain this protection until updated.

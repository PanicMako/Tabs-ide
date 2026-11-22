import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import type {
  WorkspaceCleanupItem,
  WorkspaceCleanupRules,
  WorkspaceCleanupRun,
} from "@tabs/contracts";
import {
  AlertTriangleIcon,
  BrushCleaningIcon,
  CheckIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useConfirm } from "~/hooks/useConfirm";
import { ensureNativeApi } from "~/nativeApi";
import { useSurfaceMotionSettings } from "~/panelAnimations";
import {
  getSurfacePreset,
  playSurfaceEnter,
  playSurfaceExit,
  clearSurfaceMotion,
} from "~/lib/motion";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { useGsapSurface } from "~/hooks/useGsapSurface";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./SettingsLayout";
import { maintenanceBytes } from "./WorkspaceMaintenanceView";
import {
  VERDICT_LABEL,
  confirmationMessage,
  defaultSelection,
  describeRules,
  formatAge,
  groupReasons,
  parseStaleDays,
  removableIds,
  selectedReclaimBytes,
  loadCleanupRules,
  saveCleanupRules,
  scanInPages,
  summarizeScan,
} from "./workspaceCleanupModel";
import "./workspace-cleanup.css";

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

const RULE_SWITCHES: ReadonlyArray<{
  key: Exclude<keyof WorkspaceCleanupRules, "staleAfterDays">;
  label: string;
}> = [
  { key: "removeWhenBranchMerged", label: "Branch merged into default" },
  { key: "removeWhenPullRequestMerged", label: "Pull request merged" },
  { key: "removeWhenPullRequestClosed", label: "Pull request closed" },
  { key: "removeWhenStale", label: "No activity for" },
  { key: "keepIfDirty", label: "Keep if uncommitted changes" },
  { key: "keepIfUnpushed", label: "Keep if unpushed commits" },
];

function evidenceLine(item: WorkspaceCleanupItem, now: number) {
  const e = item.evidence;
  const last = [e.lastCommitAt, e.lastThreadActivityAt, e.lastTerminalActivityAt]
    .filter((value): value is number => value !== null)
    .reduce<number | null>((max, value) => (max === null ? value : Math.max(max, value)), null);
  return [
    `Active ${formatAge(last, now)}`,
    e.diskBytes === null ? null : maintenanceBytes(e.diskBytes),
    e.dirty ? `${e.dirtyFileCount} changed` : null,
    e.unpushedCommits > 0 ? `${e.unpushedCommits} unpushed` : null,
    e.pullRequest ? `PR ${e.pullRequest}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Evidence-based stale worktree cleanup for one repository. Adapted from Orca's workspace cleanup. */
export function WorkspaceCleanupSection({ cwd }: { cwd: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rules, setRules] = useState<WorkspaceCleanupRules>(() => loadCleanupRules(storage()));
  const [items, setItems] = useState<WorkspaceCleanupItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly WorkspaceCleanupRun[]>([]);
  const [scannedAt, setScannedAt] = useState(Date.now());
  const generation = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const rulesPanel = useGsapSurface<HTMLDivElement>(undefined, "panel");
  const motion = useSurfaceMotionSettings();
  const { confirm, confirmDialog } = useConfirm();

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await ensureNativeApi().maintenance!.cleanupHistory(8));
    } catch {
      setHistory([]);
    }
  }, []);

  const scan = useCallback(
    async (nextRules: WorkspaceCleanupRules) => {
      if (!cwd) return;
      const revision = ++generation.current;
      setScanning(true);
      setError(null);
      setItems([]);
      setSelected(new Set());
      let collected: WorkspaceCleanupItem[] = [];
      try {
        await scanInPages(
          ensureNativeApi().maintenance!,
          { cwd, rules: nextRules, includePullRequests: true },
          (page) => {
            collected = [...collected, ...page.items];
            setItems(collected);
            setTotal(page.total);
            setScannedAt(page.scannedAt);
            setSelected(defaultSelection(collected));
          },
          () => revision !== generation.current,
        );
      } catch (cause) {
        if (revision === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (revision === generation.current) setScanning(false);
      }
    },
    [cwd],
  );

  // Enter and exit the panel with the app's surface motion; it unmounts once the exit finishes.
  useLayoutEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !mounted) return;
    const spec = getSurfacePreset("panel");
    if (open) {
      if (!motion.active) return;
      const tween = playSurfaceEnter(node, spec, motion, false);
      return () => void tween.kill();
    }
    if (!motion.active) {
      setMounted(false);
      return;
    }
    const exit = playSurfaceExit(node, spec, motion);
    if (!exit) {
      setMounted(false);
      return;
    }
    exit.tween.eventCallback("onComplete", () => setMounted(false));
    return () => {
      exit.tween.kill();
      exit.hold?.cancel();
      clearSurfaceMotion(node);
      gsap.killTweensOf(node);
    };
  }, [open, mounted, motion]);

  useEffect(() => {
    if (!open) return;
    void scan(rules);
    void loadHistory();
    return () => {
      generation.current++;
    };
    // Rules re-scan explicitly from the toolbar so editing a field never fires a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cwd]);

  const updateRules = (patch: Partial<WorkspaceCleanupRules>) => {
    const next = { ...rules, ...patch };
    setRules(next);
    saveCleanupRules(storage(), next);
  };

  const run = async (dryRun: boolean) => {
    if (!cwd) return;
    const chosen = items.filter((item) => selected.has(item.id) && item.verdict !== "keep");
    if (chosen.length === 0) return;
    setWorking(true);
    setError(null);
    setMessage("");
    try {
      const selections: Array<{ id: string; path: string; confirmed: boolean }> = [];
      for (const item of chosen) {
        let confirmed = false;
        if (item.verdict === "confirm") {
          if (dryRun) continue;
          // Work that exists nowhere else needs its own yes, per item.
          if (!(await confirm(confirmationMessage(item)))) continue;
          confirmed = true;
        }
        selections.push({ id: item.id, path: item.path, confirmed });
      }
      if (!dryRun && selections.length > 0) {
        const safeCount = selections.filter((selection) => !selection.confirmed).length;
        if (
          safeCount > 0 &&
          !(await confirm(
            `Remove ${selections.length} worktree${selections.length === 1 ? "" : "s"}? Branches are kept. This cannot be undone.`,
          ))
        )
          return;
      }
      if (selections.length === 0) return;
      const result = await ensureNativeApi().maintenance!.cleanupApply({
        cwd,
        rules,
        selections,
        dryRun,
      });
      const count = (status: string) => result.outcomes.filter((o) => o.status === status).length;
      setMessage(
        dryRun
          ? `Preview: ${count("would-remove")} would be removed, ${count("skipped")} skipped.`
          : `Removed ${count("removed")}, skipped ${count("skipped")}, failed ${count("failed")}. Reclaimed ${maintenanceBytes(result.reclaimedBytes)}.`,
      );
      const problems = result.outcomes.filter(
        (o) => o.status === "skipped" || o.status === "failed",
      );
      if (problems.length)
        setError(problems.map((o) => `${o.branch ?? o.path}: ${o.detail ?? o.status}`).join("\n"));
      if (!dryRun) {
        await Promise.all([scan(rules), loadHistory()]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  const summary = summarizeScan(items);
  const busy = scanning || working;
  const ids = removableIds(items);
  const safeIds = [...defaultSelection(items)];
  const allSafeSelected = safeIds.length > 0 && safeIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;
  const reclaim = selectedReclaimBytes(items, selected);
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <div className="workspace-cleanup">
      <SettingsSection
        title="Clean up worktrees"
        description="Finds worktrees that are finished, shows why each one can go, and removes only the ones you pick. Branches are always kept."
        headerAction={
          <Button
            size="sm"
            variant="outline"
            disabled={!cwd}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <BrushCleaningIcon className="size-3.5" />
            {open ? "Close" : "Review worktrees"}
          </Button>
        }
      >
        {!open && (
          <p
            className="px-4 py-4 text-xs leading-relaxed text-muted-foreground"
            style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
          >
            {cwd
              ? "Nothing is removed until you review the list and confirm. " + describeRules(rules)
              : "Open a project to review its worktrees."}
          </p>
        )}
        {mounted && (
          <div ref={panel} className="wc-panel" aria-busy={busy}>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left text-xs text-muted-foreground hover:text-foreground">
                <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
                <span className="flex-1">{describeRules(rules)}</span>
                <span className="text-foreground">Edit rules</span>
              </CollapsibleTrigger>
              <CollapsiblePanel ref={rulesPanel}>
                <div className="grid gap-x-6 gap-y-2.5 px-4 pb-4 pl-9 sm:grid-cols-2">
                  {RULE_SWITCHES.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2.5 text-xs text-foreground">
                      <Switch
                        checked={rules[key]}
                        onCheckedChange={(checked) => updateRules({ [key]: checked })}
                      />
                      <span>{label}</span>
                      {key === "removeWhenStale" && (
                        <>
                          <Input
                            inputMode="numeric"
                            aria-label="Stale after days"
                            className="h-6 w-14 text-center"
                            value={String(rules.staleAfterDays)}
                            onChange={(event) =>
                              updateRules({ staleAfterDays: parseStaleDays(event.target.value) })
                            }
                          />
                          <span>days</span>
                        </>
                      )}
                    </label>
                  ))}
                  <div className="sm:col-span-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void scan(rules)}
                    >
                      <RefreshCwIcon /> Apply rules and scan again
                    </Button>
                  </div>
                </div>
              </CollapsiblePanel>
            </Collapsible>
            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-4 py-2.5">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox
                  aria-label="Select all safe worktrees"
                  disabled={busy || safeIds.length === 0}
                  checked={allSafeSelected}
                  indeterminate={!allSafeSelected && someSelected}
                  onCheckedChange={(checked) => setSelected(checked ? new Set(safeIds) : new Set())}
                />
                {someSelected ? `${selected.size} selected` : `Select all safe (${safeIds.length})`}
              </label>
              <span
                className="text-[11px] text-muted-foreground"
                role="status"
                aria-live="polite"
                style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
              >
                {scanning
                  ? `Scanning ${items.length} of ${total || "…"}`
                  : `${summary.safe} safe · ${summary.confirm} need a look · ${summary.keep} kept · ${maintenanceBytes(summary.reclaimable)} reclaimable`}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || selected.size === 0}
                  onClick={() => void run(true)}
                >
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || selected.size === 0}
                  onClick={() => void run(false)}
                >
                  <Trash2Icon className="size-3.5" />
                  {selected.size > 0
                    ? `Remove ${selected.size} · ${maintenanceBytes(reclaim)}`
                    : "Remove"}
                </Button>
              </span>
            </div>
            {working && (
              <div className="px-4 pb-3" role="status">
                <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/50" />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Removing {selected.size} worktree{selected.size === 1 ? "" : "s"}. This can take a
                  few seconds for large checkouts.
                </p>
              </div>
            )}
            {message && !working && (
              <p
                className="flex items-center gap-1.5 px-4 pb-2 text-xs text-foreground"
                role="status"
              >
                <CheckIcon className="size-3.5" />
                {message}
              </p>
            )}
            {error && (
              <div
                className="mx-4 mb-3 flex items-start gap-2 whitespace-pre-wrap rounded-[var(--radius-control)] border border-border/60 bg-foreground/5 px-3 py-2 text-xs text-foreground"
                role="alert"
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                {!scanning && (
                  <Button size="xs" variant="outline" onClick={() => void scan(rules)}>
                    Try again
                  </Button>
                )}
              </div>
            )}
            <ul className="max-h-[28rem] overflow-y-auto border-t border-border/60">
              {items.map((item) => {
                const { why, risks, kept } = groupReasons(item);
                const keep = item.verdict === "keep";
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0",
                      !keep && !busy && "cursor-pointer hover:bg-foreground/4",
                    )}
                    onClick={(event) => {
                      if (keep || busy) return;
                      if ((event.target as HTMLElement).closest("button,[role=checkbox]")) return;
                      toggle(item.id, !selected.has(item.id));
                    }}
                  >
                    <Checkbox
                      aria-label={`Select ${item.branch ?? item.path}`}
                      disabled={keep || busy}
                      checked={selected.has(item.id)}
                      onCheckedChange={(checked) => toggle(item.id, Boolean(checked))}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="truncate text-sm text-foreground"
                          style={{ fontFamily: "var(--font-row, var(--font-sans))" }}
                        >
                          {item.branch ?? "Detached HEAD"}
                        </span>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span
                                className="min-w-0 truncate text-[11px] text-muted-foreground"
                                style={{ fontFamily: "var(--font-mono)" }}
                              />
                            }
                          >
                            {item.path}
                          </TooltipTrigger>
                          <TooltipPopup side="top">{item.path}</TooltipPopup>
                        </Tooltip>
                      </div>
                      <p
                        className="text-[11px] text-muted-foreground"
                        style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
                      >
                        {evidenceLine(item, scannedAt)}
                      </p>
                      {(why.length > 0 || risks.length > 0 || kept.length > 0) && (
                        <dl
                          className="space-y-0.5 text-xs"
                          style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
                        >
                          {why.length > 0 && (
                            <div className="flex gap-2">
                              <dt className="w-24 shrink-0 text-muted-foreground">Why it can go</dt>
                              <dd className="text-foreground">{why.join(" · ")}</dd>
                            </div>
                          )}
                          {risks.length > 0 && (
                            <div className="flex gap-2">
                              <dt className="w-24 shrink-0 text-muted-foreground">Heads up</dt>
                              <dd className="text-foreground">{risks.join(" · ")}</dd>
                            </div>
                          )}
                          {kept.length > 0 && (
                            <div className="flex gap-2">
                              <dt className="w-24 shrink-0 text-muted-foreground">Why kept</dt>
                              <dd className="text-foreground">{kept.join(" · ")}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </div>
                    <span
                      className="whitespace-nowrap text-[11px] text-muted-foreground"
                      style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
                    >
                      {VERDICT_LABEL[item.verdict]}
                    </span>
                  </li>
                );
              })}
              {scanning &&
                items.length === 0 &&
                [0, 1, 2].map((row) => (
                  <li key={row} className="space-y-2 border-b border-border/60 px-4 py-4">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </li>
                ))}
            </ul>
            {!scanning && items.length === 0 && !error && (
              <div className="space-y-1 px-4 py-8 text-center">
                <p className="text-sm text-foreground">Nothing to clean up</p>
                <p className="text-xs text-muted-foreground">
                  Every worktree is either in use or newer than your rules. Scan again after a
                  branch is merged.
                </p>
              </div>
            )}
            {ids.length === 0 && items.length > 0 && !scanning && (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                Every worktree here is being kept, so there is nothing to select.
              </p>
            )}
            {history.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center gap-2 border-t border-border/60 px-4 py-2.5 text-left text-[11px] text-muted-foreground hover:text-foreground">
                  <ChevronRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                  Recent cleanups
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <ul
                    className="px-4 pb-3 pl-9 text-[11px] text-muted-foreground"
                    aria-label="Cleanup history"
                    style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
                  >
                    {history.map((entry) => (
                      <li key={entry.id} className="flex justify-between gap-3 py-0.5">
                        <span>
                          {new Date(entry.at).toLocaleString()} ·{" "}
                          {entry.outcomes.filter((o) => o.status === "removed").length} removed
                          {entry.outcomes.some((o) => o.forced) ? " (forced)" : ""}
                        </span>
                        <span>{maintenanceBytes(entry.reclaimedBytes)}</span>
                      </li>
                    ))}
                  </ul>
                </CollapsiblePanel>
              </Collapsible>
            )}
          </div>
        )}
      </SettingsSection>
      {confirmDialog}
    </div>
  );
}

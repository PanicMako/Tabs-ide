import type { Thread } from "../../types";
import { derivePendingApprovals, derivePendingUserInputs } from "../../session-logic";
import { hasUnseenCompletion, isThreadWorking } from "../Sidebar.logic";

/** Something an agent is waiting on you for. */
export interface InboxItem {
  readonly threadId: string;
  readonly environmentId: string | undefined;
  readonly projectId: string;
  readonly projectName: string;
  readonly threadTitle: string;
  readonly kind: "question" | "approval";
  /** What it asks, in a line. */
  readonly summary: string;
  readonly createdAt: string;
}

type ProjectNames = ReadonlyMap<string, string>;

function liveThreads(threads: readonly Thread[]): Thread[] {
  return threads.filter((thread) => !thread.archivedAt && !thread.isSubagent);
}

function approvalSummary(kind: "command" | "file-read" | "file-change", detail?: string): string {
  const what =
    kind === "command" ? "Run a command" : kind === "file-read" ? "Read files" : "Edit files";
  const trimmed = detail?.trim().split("\n")[0];
  return trimmed ? `${what}: ${trimmed.slice(0, 120)}` : what;
}

/** Every open question and approval across all projects, oldest first. */
export function deriveInbox(threads: readonly Thread[], projectNames: ProjectNames): InboxItem[] {
  const items: InboxItem[] = [];
  for (const thread of liveThreads(threads)) {
    const base = {
      threadId: thread.id,
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      projectName: projectNames.get(thread.projectId) ?? "Project",
      threadTitle: thread.title || "Untitled conversation",
    };
    for (const input of derivePendingUserInputs(thread.activities ?? [])) {
      const first = input.questions[0];
      items.push({
        ...base,
        kind: "question",
        summary:
          (first && "question" in first && typeof first.question === "string"
            ? first.question
            : null) ?? "The agent has a question for you",
        createdAt: input.createdAt,
      });
    }
    for (const approval of derivePendingApprovals(thread.activities ?? [])) {
      items.push({
        ...base,
        kind: "approval",
        summary: approvalSummary(approval.requestKind, approval.detail),
        createdAt: approval.createdAt,
      });
    }
  }
  return items.toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export interface AwayProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly finished: readonly Thread[];
  readonly failed: readonly Thread[];
  readonly waiting: number;
  readonly running: readonly Thread[];
}

/**
 * What happened in each project since `sinceMs`: conversations that finished
 * and you have not opened, ones that failed or stopped, how many wait on you,
 * and what is still running. Projects with nothing to report are left out.
 */
export function deriveAwaySummary(
  threads: readonly Thread[],
  projectNames: ProjectNames,
  sinceMs: number,
): AwayProject[] {
  const byProject = new Map<
    string,
    AwayProject & { finished: Thread[]; failed: Thread[]; running: Thread[]; waiting: number }
  >();
  const entry = (projectId: string) => {
    let project = byProject.get(projectId);
    if (!project) {
      project = {
        projectId,
        projectName: projectNames.get(projectId) ?? "Project",
        finished: [],
        failed: [],
        waiting: 0,
        running: [],
      };
      byProject.set(projectId, project);
    }
    return project;
  };
  for (const thread of liveThreads(threads)) {
    const turn = thread.latestTurn;
    const completedAt = turn?.completedAt ? Date.parse(turn.completedAt) : Number.NaN;
    const endedSince = Number.isFinite(completedAt) && completedAt >= sinceMs;
    const waiting =
      derivePendingUserInputs(thread.activities ?? []).length +
      derivePendingApprovals(thread.activities ?? []).length;
    if (waiting > 0) entry(thread.projectId).waiting += waiting;
    if (isThreadWorking(thread)) {
      if (waiting === 0) entry(thread.projectId).running.push(thread);
      continue;
    }
    if (!endedSince) continue;
    if (turn?.state === "error" || turn?.state === "interrupted") {
      entry(thread.projectId).failed.push(thread);
    } else if (hasUnseenCompletion(thread)) {
      entry(thread.projectId).finished.push(thread);
    }
  }
  return [...byProject.values()].filter(
    (project) =>
      project.finished.length > 0 ||
      project.failed.length > 0 ||
      project.waiting > 0 ||
      project.running.length > 0,
  );
}

/** One line for a toast: "3 finished · 1 waiting for you · 1 failed". */
export function awaySummaryLine(projects: readonly AwayProject[]): string | null {
  const finished = projects.reduce((sum, project) => sum + project.finished.length, 0);
  const failed = projects.reduce((sum, project) => sum + project.failed.length, 0);
  const waiting = projects.reduce((sum, project) => sum + project.waiting, 0);
  const parts = [
    finished ? `${finished} finished` : null,
    waiting ? `${waiting} waiting for you` : null,
    failed ? `${failed} stopped or failed` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export interface ArchivedThreadInput {
  readonly id: string;
  readonly environmentId?: string | undefined;
  readonly projectId: string;
  readonly title: string;
  readonly archivedAt: string | null;
}

export interface ArchivedProjectInput {
  readonly id: string;
  readonly environmentId?: string | undefined;
  readonly name: string;
}

export interface ArchivedThreadRow {
  readonly key: string;
  readonly threadId: string;
  readonly environmentId: string | null;
  readonly title: string;
  readonly projectName: string;
  readonly archivedAt: string;
}

/** Archived threads, newest archive first, each with the project it belongs to. */
export function archivedThreadRows(
  threads: ReadonlyArray<ArchivedThreadInput>,
  projects: ReadonlyArray<ArchivedProjectInput>,
): ReadonlyArray<ArchivedThreadRow> {
  return threads
    .flatMap((thread) => {
      if (thread.archivedAt === null) return [];
      const project = projects.find(
        (candidate) =>
          candidate.id === thread.projectId && candidate.environmentId === thread.environmentId,
      );
      return [
        {
          key: `${thread.environmentId ?? ""}:${thread.id}`,
          threadId: thread.id,
          environmentId: thread.environmentId ?? null,
          title: thread.title.trim() || "Untitled thread",
          projectName: project?.name ?? "Unknown project",
          archivedAt: thread.archivedAt,
        },
      ];
    })
    .toSorted((left, right) => Date.parse(right.archivedAt) - Date.parse(left.archivedAt));
}

/** "Archived today", "yesterday", "3 days ago": enough to find the one you meant. */
export function archivedAgoLabel(archivedAt: string, now: number = Date.now()): string {
  const days = Math.floor((now - Date.parse(archivedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "Archived today";
  if (days === 1) return "Archived yesterday";
  return `Archived ${days} days ago`;
}

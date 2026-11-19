const MAX_REMEMBERED = 10;
const closed: string[] = [];

/** Notes that a project tab was closed, newest last, so it can be brought back. */
export function rememberClosedProject(projectId: string): void {
  const index = closed.indexOf(projectId);
  if (index !== -1) closed.splice(index, 1);
  closed.push(projectId);
  if (closed.length > MAX_REMEMBERED) closed.splice(0, closed.length - MAX_REMEMBERED);
}

/** The most recently closed project that can still be reopened, removed from the list. */
export function takeClosedProject(canReopen: (projectId: string) => boolean): string | null {
  while (closed.length > 0) {
    const candidate = closed.pop()!;
    if (canReopen(candidate)) return candidate;
  }
  return null;
}

export function resetClosedProjectsForTest(): void {
  closed.length = 0;
}

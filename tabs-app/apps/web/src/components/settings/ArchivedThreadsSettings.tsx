import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@tabs/contracts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { archivedAgoLabel, archivedThreadRows } from "~/lib/archivedThreads";
import { newCommandId } from "~/lib/utils";
import { projectsAtom, threadsAtom } from "~/state/threads";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/** Threads you archived, with a way back. Archiving is quiet, so this is where they wait. */
export function ArchivedThreadsSettings() {
  const threads = useAtomValue(threadsAtom);
  const projects = useAtomValue(projectsAtom);
  const rows = useMemo(() => archivedThreadRows(threads, projects), [threads, projects]);
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());

  const restore = async (
    key: string,
    environmentId: string | null,
    threadId: string,
    title: string,
  ) => {
    setRestoring((current) => new Set(current).add(key));
    try {
      const api = await environmentApi((environmentId ?? null) as never);
      await api.orchestration.dispatchCommand({
        type: "thread.unarchive",
        commandId: newCommandId(),
        threadId: threadId as ThreadId,
      });
      toastManager.add({ type: "success", title: "Thread restored", description: title });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not restore the thread",
        description: error instanceof Error ? error.message : "The thread action failed.",
      });
    } finally {
      setRestoring((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <SettingsSection
      title="Archived threads"
      description="Threads you archived stay here until you bring them back."
    >
      {rows.length === 0 ? (
        <SettingsRow
          title="Nothing archived"
          description="When you archive a thread from the sidebar, it will wait here."
        />
      ) : (
        rows.map((row) => (
          <SettingsRow
            key={row.key}
            title={row.title}
            description={`${row.projectName} · ${archivedAgoLabel(row.archivedAt)}`}
            control={
              <Button
                size="xs"
                variant="outline"
                disabled={restoring.has(row.key)}
                onClick={() => void restore(row.key, row.environmentId, row.threadId, row.title)}
              >
                {restoring.has(row.key) ? "Restoring…" : "Restore"}
              </Button>
            }
          />
        ))
      )}
    </SettingsSection>
  );
}

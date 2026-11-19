import { toastManager } from "~/components/ui/toast";

type ToastApi = Pick<typeof toastManager, "add" | "close">;

/**
 * Tells the user a thread was archived and offers to bring it back. Archiving is quiet and
 * instant, so without this a mis-click means digging through the archive to undo it.
 */
export function announceThreadArchived(input: {
  readonly title: string;
  readonly undo: () => Promise<void>;
  readonly toast?: ToastApi;
}): void {
  const toast = input.toast ?? toastManager;
  const id = toast.add({
    type: "info",
    title: "Thread archived",
    description: input.title,
    timeout: 8000,
    actionProps: {
      children: "Undo",
      onClick: () => {
        toast.close(id);
        input.undo().catch((error: unknown) => {
          toast.add({
            type: "error",
            title: "Could not restore the thread",
            description: error instanceof Error ? error.message : "The thread action failed.",
          });
        });
      },
    },
  });
}
